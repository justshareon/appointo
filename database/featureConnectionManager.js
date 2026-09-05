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
const poolConfig = require('../utils/poolConfig');
const { MYSQL_FEATURES, FEATURES: FEATURE_CATALOG } = require('./featureRegistry');
const { isTransientConnectionError } = require('../utils/mysqlTransientErrors');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const LOG = {
    info: (msg) => console.log(`[FeatureDB] ${msg}`),
    warn: (msg) => console.warn(`[FeatureDB] ${msg}`),
    error: (msg, detail = '') => console.error(`[FeatureDB] ${msg}`, detail),
};

const { resolveDbType, isMysqlConfigured } = require('../utils/resolveDbType');
const DB_TYPE = resolveDbType();
const IDLE_CLOSE_MS = getFeatureIdleMs();

/** @type {Map<string, { pool: any, refCount: number, idleTimer: NodeJS.Timeout | null }>} */
const featurePools = new Map();
const als = new AsyncLocalStorage();

const MYSQL_FEATURE_IDS = MYSQL_FEATURES;

const lastRebuildAt = new Map();

const STALE_CODES = new Set([
    'PROTOCOL_CONNECTION_LOST',
    'PROTOCOL_ENQUEUE_AFTER_QUIT',
    'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
    'ECONNRESET',
    'EPIPE',
    'ETIMEDOUT',
    'ECONNREFUSED',
]);

async function recreatePool(feature) {
    const now = Date.now();
    if (now - (lastRebuildAt.get(feature) || 0) < 8000) {
        return liveEntry(feature)?.pool || null;
    }
    lastRebuildAt.set(feature, now);
    const entry = featurePools.get(feature);
    if (entry) {
        entry.closing = true;
        featurePools.delete(feature);
        try { await entry.pool.end(); } catch (e) { /* ignore */ }
    }
    const pool = createPoolInstance(feature);
    featurePools.set(feature, {
        pool,
        refCount: Math.max(1, entry?.refCount || 1),
        idleTimer: null,
        closing: false,
    });
    LOG.warn(`Recreated MySQL pool for "${feature}" after stale socket`);
    return pool;
}

function isStaleConnectionError(err) {
    if (!err) return false;
    if (STALE_CODES.has(err.code) || STALE_CODES.has(String(err.errno))) return true;
    if (isTransientConnectionError(err)) return true;
    return /socket has been ended|closed state|Cannot enqueue|Connection lost|server closed the connection/i.test(
        String(err.message || err)
    );
}

function shouldUseSsl() {
    const flag = String(process.env.DB_SSL || '').toLowerCase();
    if (flag === '0' || flag === 'false' || flag === 'off') return false;
    if (flag === '1' || flag === 'true' || flag === 'on') return true;
    const host = String(process.env.DB_HOST || 'localhost').toLowerCase();
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
}

function isMysqlEnabled() {
    return resolveDbType() === 'mysql';
}

function liveEntry(feature) {
    const entry = featurePools.get(feature);
    if (!entry || entry.closing) return null;
    return entry;
}

async function acquireForSync(feature = 'core') {
    if (!process.env.DB_HOST && !process.env.DB_NAME) {
        throw new Error('MySQL is not configured (set DB_HOST and DB_NAME in backend/.env)');
    }
    const existing = getCachedPool(feature) || getCachedPool('core');
    if (existing) return existing;

    const start = Date.now();
    const pool = createPoolInstance(feature);
    featurePools.set(feature, { pool, refCount: 1, idleTimer: null, closing: false });
    try {
        const conn = await pool.getConnection();
        conn.release();
        logMysqlPool(feature, 'sync-pool ready', Date.now() - start, 'ready');
        LOG.info(`Sync pool ready for feature "${feature}"`);
    } catch (err) {
        logMysqlPool(feature, 'sync-pool FAILED', Date.now() - start, err.message);
        LOG.error(`Sync pool failed for "${feature}"`, err.message);
        throw err;
    }
    return pool;
}

function instrumentPool(pool, feature) {
    const originalQuery = pool.query.bind(pool);
    const originalExecute = pool.execute.bind(pool);

    const withRetry = (fn) => async function retryMysql(...args) {
        let lastErr;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                return await fn(...args);
            } catch (err) {
                lastErr = err;
                if (!isStaleConnectionError(err) || attempt >= 2) throw err;
                const delayMs = (attempt + 1) * 2000;
                LOG.warn(
                    `MySQL "${feature}" transient error (attempt ${attempt + 1}/3), `
                    + `retry in ${delayMs}ms: ${err.message}`
                );
                await sleep(delayMs);
                if (attempt >= 1) {
                    try {
                        await recreatePool(feature);
                    } catch (poolErr) {
                        LOG.warn(`Pool recreate skipped for "${feature}": ${poolErr.message}`);
                    }
                }
            }
        }
        throw lastErr;
    };

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

    pool.query = timed(withRetry(originalQuery));
    pool.execute = timed(withRetry(originalExecute));
    const errorTarget = pool.pool && typeof pool.pool.on === 'function' ? pool.pool : pool;
    if (typeof errorTarget.on === 'function') {
        errorTarget.on('error', (err) => {
            LOG.warn(`Pool error (${feature}): ${err.message}`);
        });
    }
    return pool;
}

function createPoolInstance(feature) {
    const dbName = process.env[`DB_NAME_${feature.toUpperCase()}`] || process.env.DB_NAME || 'qr_queue';
    const idleTimeout = parseInt(process.env.DB_POOL_IDLE_MS || '60000', 10);
    poolConfig.loadSettings().catch(() => {});
    const connectionLimit = poolConfig.resolveLimitSync(feature);
    const maxIdle = poolConfig.resolveMaxIdle(connectionLimit);
    const useSsl = shouldUseSsl();
    LOG.info(`Creating MySQL pool for feature "${feature}" (limit: ${connectionLimit}, maxIdle: ${maxIdle}, db: ${dbName})`);
    const config = {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'root',
        database: dbName,
        waitForConnections: true,
        connectionLimit,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000,
        idleTimeout,
        maxIdle,
    };
    if (useSsl) config.ssl = { rejectUnauthorized: false };
    return instrumentPool(mysql.createPool(config), feature);
}

async function acquire(feature = 'core') {
    if (!isMysqlEnabled()) return null;

    const entry = liveEntry(feature);
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
    featurePools.set(feature, { pool, refCount: 1, idleTimer: null, closing: false });

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
    const entry = liveEntry(feature);
    if (!entry || entry.refCount > 0) return;

    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(async () => {
        const current = featurePools.get(feature);
        if (!current || current.refCount > 0 || current.closing) return;
        current.closing = true;
        featurePools.delete(feature);
        try {
            await current.pool.end();
            LOG.info(`Closed idle pool for feature "${feature}" (idle ${Math.round(IDLE_CLOSE_MS / 60000)}m)`);
        } catch (err) {
            LOG.warn(`Failed closing pool for "${feature}": ${err.message}`);
        }
    }, IDLE_CLOSE_MS);
}

function release(feature = 'core') {
    const entry = featurePools.get(feature);
    if (!entry) return;
    entry.refCount = Math.max(0, entry.refCount - 1);
    if (entry.refCount === 0) scheduleClose(feature);
}

function getCachedPool(feature = 'core') {
    return liveEntry(feature)?.pool || null;
}

/**
 * Pool for current request (feature-specific first, then core).
 */
function getPool() {
    const store = als.getStore();
    if (store?.activeFeature) {
        const live = getCachedPool(store.activeFeature);
        if (live) return live;
    }
    if (store?.features?.length) {
        for (let i = store.features.length - 1; i >= 0; i -= 1) {
            const p = getCachedPool(store.features[i]);
            if (p) return p;
        }
    }
    return getCachedPool('core') || store?.activePool || null;
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
        const target = list[list.length - 1];
        list.forEach((f) => featureMemory.acquire(f));
        let memReleased = false;
        const onMemFinish = () => {
            if (memReleased) return;
            memReleased = true;
            list.forEach((f) => featureMemory.release(f));
        };
        res.on('finish', onMemFinish);
        req.on('aborted', onMemFinish);

        if (!isMysqlEnabled()) {
            try {
                await featureMemory.ensureFeature(target, { mode: 'basic' });
            } catch (err) {
                LOG.warn(`Init skipped: ${err.message}`);
            }
            return next();
        }

        try {
            for (const feature of list) {
                await acquire(feature);
            }
            const activeFeature = target;
            const activePool = getCachedPool(activeFeature) || getCachedPool('core');

            let released = false;
            const onFinish = () => {
                if (released) return;
                released = true;
                list.forEach((f) => release(f));
            };
            res.on('finish', onFinish);
            req.on('aborted', onFinish);

            await new Promise((resolve) => {
                als.run({ features: list, activePool, activeFeature, req, mysqlCount: 0, mysqlMs: 0 }, async () => {
                    try {
                        await featureMemory.ensureFeature(target, { mode: 'basic' });
                    } catch (err) {
                        LOG.warn(`Init skipped: ${err.message}`);
                    }
                    next();
                    resolve();
                });
            });
        } catch (err) {
            LOG.error('Feature DB middleware failed', err.message);
            next(err);
        }
    };
}

async function applyConfiguredLimits() {
    poolConfig.clearCache();
    await closeAll();
}

function getPoolStats() {
    poolConfig.loadSettings().catch(() => {});
    const rows = [];
    for (const feature of MYSQL_FEATURES) {
        const entry = liveEntry(feature);
        const connectionLimit = poolConfig.resolveLimitSync(feature);
        const row = {
            feature,
            label: FEATURE_CATALOG[feature]?.label || feature,
            open: !!entry,
            refCount: entry?.refCount || 0,
            connectionLimit,
            activeConnections: null,
            freeConnections: null,
            queued: null,
            actualLimit: null,
        };
        const inner = entry?.pool?.pool;
        if (inner) {
            row.activeConnections = inner._allConnections?.length ?? null;
            row.freeConnections = inner._freeConnections?.length ?? null;
            row.queued = inner._connectionQueue?.length ?? null;
            row.actualLimit = inner.config?.connectionLimit ?? connectionLimit;
        }
        rows.push(row);
    }
    return rows;
}

async function closeAll() {
    const entries = [...featurePools.entries()];
    featurePools.clear();
    for (const [feature, entry] of entries) {
        try {
            if (entry.idleTimer) clearTimeout(entry.idleTimer);
            entry.closing = true;
            await entry.pool.end();
            LOG.info(`Closed pool for feature "${feature}"`);
        } catch (err) {
            LOG.warn(`Error closing "${feature}": ${err.message}`);
        }
    }
}

process.on('SIGINT', () => closeAll().finally(() => process.exit(0)));
process.on('SIGTERM', () => closeAll().finally(() => process.exit(0)));

module.exports = {
    MYSQL_FEATURE_IDS,
    FEATURE_CATALOG,
    acquireForSync,
    isMysqlConfigured,
    isMysqlEnabled,
    acquire,
    release,
    getPool,
    getCachedPool,
    getPoolStats,
    applyConfiguredLimits,
    middleware,
    closeAll,
    runWithFeatures,
};
