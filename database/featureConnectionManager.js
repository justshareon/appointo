/**
 * Lazy per-feature MySQL pool manager.
 * - Opens a pool only when a feature route is used
 * - Closes pool after idle timeout when no active requests
 * - Uses AsyncLocalStorage so concurrent requests stay isolated
 */
require('../loadEnv');
const { AsyncLocalStorage } = require('async_hooks');
const mysql = require('mysql2/promise');
const { logMysqlQuery, logMysqlPool } = require('../utils/dbTiming');
const { getFeatureIdleMs } = require('./featureIdle');
const featureMemory = require('./featureMemoryManager');

const LOG = {
    info: (msg) => console.log(`[FeatureDB] ${msg}`),
    warn: (msg) => console.warn(`[FeatureDB] ${msg}`),
    error: (msg, detail = '') => console.error(`[FeatureDB] ${msg}`, detail),
};

const DB_TYPE = process.env.DB_TYPE || 'inmemory';
const IDLE_CLOSE_MS = getFeatureIdleMs();

/** @type {Map<string, { pool: any, refCount: number, idleTimer: NodeJS.Timeout | null }>} */
const featurePools = new Map();
const als = new AsyncLocalStorage();

const FEATURES = [
    'core',
    'queue',
    'appointments',
    'shopping',
    'matchmaking',
    'trade',
    'offer',
    'qless',
    'fleet',
    'realestate',
    'cyber',
    'trust_score',
];

function isMysqlEnabled() {
    return DB_TYPE === 'mysql';
}

function instrumentPool(pool, feature) {
    const originalQuery = pool.query.bind(pool);
    const originalExecute = pool.execute.bind(pool);

    const timed = (fn) => async function timedMysql(...args) {
        const sql = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].sql) || 'query';
        const start = Date.now();
        try {
            return await fn(...args);
        } finally {
            const ms = Date.now() - start;
            logMysqlQuery(feature, sql, ms);
            const store = als.getStore();
            if (store) {
                store.mysqlCount = (store.mysqlCount || 0) + 1;
                store.mysqlMs = (store.mysqlMs || 0) + ms;
                if (store.req && store.req.dbTiming) {
                    store.req.dbTiming.mysqlCount += 1;
                    store.req.dbTiming.mysqlMs += ms;
                }
            }
        }
    };

    pool.query = timed(originalQuery);
    pool.execute = timed(originalExecute);
    return pool;
}

function createPoolInstance(feature) {
    const dbName = process.env[`DB_NAME_${feature.toUpperCase()}`] || process.env.DB_NAME || 'qr_queue';
    LOG.info(`Creating MySQL pool for feature "${feature}" (db: ${dbName} host: ${process.env.DB_HOST || 'localhost'})`);
    return instrumentPool(mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'root',
        database: dbName,
        waitForConnections: true,
        connectionLimit: parseInt(process.env[`DB_CONN_LIMIT_${feature.toUpperCase()}`] || '5', 10),
        queueLimit: 0,
        ssl: { rejectUnauthorized: false },
    }), feature);
}

async function acquire(feature = 'core') {
    if (!isMysqlEnabled()) return null;

    const entry = featurePools.get(feature);
    if (entry) {
        entry.refCount += 1;
        if (entry.idleTimer) {
            clearTimeout(entry.idleTimer);
            entry.idleTimer = null;
        }
        return entry.pool;
    }

    const start = Date.now();
    const pool = createPoolInstance(feature);
    featurePools.set(feature, { pool, refCount: 1, idleTimer: null });

    try {
        const conn = await pool.getConnection();
        conn.release();
        logMysqlPool(feature, 'create+connect', Date.now() - start, 'ready');
        LOG.info(`Pool ready for feature "${feature}"`);
    } catch (err) {
        logMysqlPool(feature, 'create+connect FAILED', Date.now() - start, err.message);
        LOG.error(`Pool connection test failed for "${feature}"`, err.message);
    }

    return pool;
}

function scheduleClose(feature) {
    const entry = featurePools.get(feature);
    if (!entry || entry.refCount > 0) return;

    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(async () => {
        const current = featurePools.get(feature);
        if (!current || current.refCount > 0) return;
        try {
            await current.pool.end();
            LOG.info(`Closed idle pool for feature "${feature}" (idle ${Math.round(IDLE_CLOSE_MS / 60000)}m)`);
        } catch (err) {
            LOG.warn(`Failed closing pool for "${feature}": ${err.message}`);
        }
        featurePools.delete(feature);
    }, IDLE_CLOSE_MS);
}

function release(feature = 'core') {
    const entry = featurePools.get(feature);
    if (!entry) return;
    entry.refCount = Math.max(0, entry.refCount - 1);
    if (entry.refCount === 0) scheduleClose(feature);
}

function getCachedPool(feature = 'core') {
    return featurePools.get(feature)?.pool || null;
}

/**
 * Pool for current request (feature-specific first, then core).
 */
function getPool() {
    const store = als.getStore();
    if (store?.activePool) return store.activePool;
    if (store?.features?.length) {
        for (let i = store.features.length - 1; i >= 0; i -= 1) {
            const p = getCachedPool(store.features[i]);
            if (p) return p;
        }
    }
    return getCachedPool('core');
}

function runWithFeatures(features, fn) {
    return als.run({ features }, fn);
}

/**
 * Express middleware: acquire feature pool for request, release on finish.
 */
function middleware(...features) {
    const list = features.length ? features : ['core'];
    return async (req, res, next) => {
        if (!isMysqlEnabled()) {
            return featureMemory.middleware(...list)(req, res, next);
        }

        try {
            featureMemory.middleware(...list)(req, res, () => {});
            for (const feature of list) {
                await acquire(feature);
            }
            const activeFeature = list[list.length - 1];
            const activePool = getCachedPool(activeFeature) || getCachedPool('core');

            const onFinish = () => {
                list.forEach((f) => release(f));
                res.removeListener('finish', onFinish);
                res.removeListener('close', onFinish);
            };
            res.on('finish', onFinish);
            res.on('close', onFinish);

            als.run({ features: list, activePool, activeFeature, req, mysqlCount: 0, mysqlMs: 0 }, () => next());
        } catch (err) {
            LOG.error('Feature DB middleware failed', err.message);
            next(err);
        }
    };
}

async function closeAll() {
    for (const [feature, entry] of featurePools.entries()) {
        try {
            if (entry.idleTimer) clearTimeout(entry.idleTimer);
            await entry.pool.end();
            LOG.info(`Closed pool for feature "${feature}"`);
        } catch (err) {
            LOG.warn(`Error closing "${feature}": ${err.message}`);
        }
    }
    featurePools.clear();
}

process.on('SIGINT', () => closeAll().finally(() => process.exit(0)));
process.on('SIGTERM', () => closeAll().finally(() => process.exit(0)));

module.exports = {
    FEATURES,
    isMysqlEnabled,
    acquire,
    release,
    getPool,
    getCachedPool,
    middleware,
    closeAll,
    runWithFeatures,
};
