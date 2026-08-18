/**
 * Feature lifecycle: lazy init on first open, reclaim after idle.
 * Configure with FEATURE_IDLE_MINUTES (default 10) or FEATURE_IDLE_MS.
 */
const { getFeatureIdleMs } = require('./featureIdle');

const LOG = {
    info: (msg) => console.log(`[FeatureMem] ${msg}`),
    warn: (msg) => console.warn(`[FeatureMem] ${msg}`),
};

const IDLE_MS = getFeatureIdleMs();
const BOARD_CAP = parseInt(process.env.FEATURE_MEM_BOARD_CAP || '2500', 10);
const CA_CAP = parseInt(process.env.FEATURE_MEM_CA_CAP || '2000', 10);
const HISTORY_CAP = parseInt(process.env.FEATURE_MEM_HISTORY_CAP || '2', 10);

const FEATURE_DATA = {
    trade: {
        arrays: ['boardMeetings', 'corporateActions'],
        nested: [
            ['stockData', 'live_stock_data'],
            ['stockData', 'stock_data_history'],
            ['mutualFundData', 'mutual_funds'],
            ['mutualFundData', 'mutual_fund_history'],
        ],
        seedKeys: [],
    },
    offer: { arrays: [], nested: [], seedKeys: [] },
    qless: { arrays: [], nested: [], seedKeys: [] },
    fleet: { arrays: [], nested: [], seedKeys: [] },
    queue: { arrays: [], nested: [], seedKeys: [] },
    appointments: { arrays: [], nested: [], seedKeys: [] },
    realestate: {
        arrays: ['trustScoreProjects', 'trustScoreFraudAlerts'],
        nested: [],
        seedKeys: ['trustScoreProjects', 'trustScoreFraudAlerts'],
    },
    trust_score: {
        arrays: ['trustScoreProjects', 'trustScoreFraudAlerts'],
        nested: [],
        seedKeys: ['trustScoreProjects', 'trustScoreFraudAlerts'],
    },
    matchmaking: {
        arrays: ['matchmaking_templates', 'matchmaking_submissions'],
        nested: [],
        seedKeys: ['matchmaking_templates', 'matchmaking_submissions'],
    },
    cyber: {
        arrays: [
            'surakshaValidations',
            'surakshaReports',
            'surakshaDevices',
            'spamNumbers',
            'callHistory',
            'communityReports',
            'cyberThreats',
            'autoValidationDetections',
            'mobileSecurityScans',
            'notificationValidations',
            'threatIntelligence',
            'threatAlerts',
            'cyberSecurityTips',
        ],
        nested: [],
        seedKeys: [
            'surakshaValidations',
            'surakshaReports',
            'surakshaDevices',
            'spamNumbers',
            'callHistory',
            'communityReports',
            'cyberThreats',
            'autoValidationDetections',
            'mobileSecurityScans',
            'notificationValidations',
            'threatIntelligence',
            'threatAlerts',
            'cyberSecurityTips',
        ],
    },
};

const refs = new Map();
const idleTimers = new Map();
const jobsStarted = new Set();
const heavyLoaded = new Set();
const basicReady = new Set();
const loadPromises = new Map();
const jobHandles = new Map();
let watchdog = null;
let runtime = { app: null, io: null };

function addTimer(feature, timer) {
    const entry = jobHandles.get(feature) || { timers: [] };
    entry.timers.push(timer);
    jobHandles.set(feature, entry);
}

function clearTimers(feature) {
    const entry = jobHandles.get(feature);
    if (!entry) return;
    (entry.timers || []).forEach((timer) => {
        clearInterval(timer);
        clearTimeout(timer);
    });
    jobHandles.delete(feature);
}

function bindRuntime({ app, io } = {}) {
    if (app) runtime.app = app;
    if (io) runtime.io = io;
}

function getMem() {
    try {
        const db = require('../database');
        return db.inMemoryDb || null;
    } catch (e) {
        return null;
    }
}

function heapMb() {
    return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
}

function capArray(arr, max) {
    if (!Array.isArray(arr) || arr.length <= max) return arr;
    arr.splice(0, arr.length - max);
    return arr;
}

function capByDate(rows, dateField, cap) {
    if (!Array.isArray(rows) || rows.length <= cap) return rows;
    const sorted = rows
        .slice()
        .sort((a, b) => new Date(b?.[dateField] || 0) - new Date(a?.[dateField] || 0));
    return sorted.slice(0, cap);
}

function featureSize(feature) {
    const mem = getMem();
    const spec = FEATURE_DATA[feature];
    if (!mem || !spec) return 0;
    let n = 0;
    for (const key of spec.arrays || []) {
        n += Array.isArray(mem[key]) ? mem[key].length : 0;
    }
    for (const [parent, child] of spec.nested || []) {
        n += Array.isArray(mem[parent]?.[child]) ? mem[parent][child].length : 0;
    }
    return n;
}

function loadSeed(feature) {
    const spec = FEATURE_DATA[feature];
    if (!spec?.seedKeys?.length) return;
    const db = require('../database');
    if (typeof db.loadFeatureSeed === 'function') {
        db.loadFeatureSeed(spec.seedKeys);
    }
}

function acquire(feature) {
    if (!feature || feature === 'core') return;
    refs.set(feature, (refs.get(feature) || 0) + 1);
    const timer = idleTimers.get(feature);
    if (timer) {
        clearTimeout(timer);
        idleTimers.delete(feature);
    }
}

function release(feature) {
    if (!feature || feature === 'core') return;
    const next = Math.max(0, (refs.get(feature) || 1) - 1);
    refs.set(feature, next);
    if (next === 0) scheduleUnload(feature);
}

function scheduleUnload(feature) {
    if (!FEATURE_DATA[feature]) return;
    const existing = idleTimers.get(feature);
    if (existing) clearTimeout(existing);
    idleTimers.set(
        feature,
        setTimeout(() => unload(feature), IDLE_MS)
    );
}

function stopJobs(feature) {
    clearTimers(feature);
    if (feature === 'trade') {
        try { global.excelFileSyncJob?.stop?.(); } catch (e) { /* ignore */ }
        try { global.mutualFundSyncJob?.stop?.(); } catch (e) { /* ignore */ }
        try { global.corporateActionsSyncJob?.stop?.(); } catch (e) { /* ignore */ }
        try { global.boardMeetingsSyncJob?.stop?.(); } catch (e) { /* ignore */ }
        try { global.tradingDataRefreshJob?.stop?.(); } catch (e) { /* ignore */ }
    }
    if (feature === 'cyber') {
        try { global.threatIntelligenceJob?.stop?.(); } catch (e) { /* ignore */ }
        try { require('../services/databaseSyncService').stopPeriodicSync?.(); } catch (e) { /* ignore */ }
    }
    jobsStarted.delete(feature);
    heavyLoaded.delete(feature);
    basicReady.delete(feature);
}

function unload(feature) {
    if ((refs.get(feature) || 0) > 0) return;
    const spec = FEATURE_DATA[feature];
    const mem = getMem();
    if (!spec || !mem) return;

    const before = featureSize(feature);
    const heapBefore = heapMb();

    for (const key of spec.arrays || []) {
        if (Array.isArray(mem[key])) mem[key].length = 0;
    }
    for (const [parent, child] of spec.nested || []) {
        if (Array.isArray(mem[parent]?.[child])) mem[parent][child].length = 0;
    }

    stopJobs(feature);

    if (typeof global.gc === 'function') {
        try { global.gc(); } catch (e) { /* ignore */ }
    }

    LOG.info(
        `Reclaimed "${feature}" (${before} rows, jobs stopped) | heap ${heapBefore}MB -> ${heapMb()}MB | idle ${Math.round(IDLE_MS / 60000)}m`
    );
}

function startTradeJobs() {
    const app = runtime.app;
    if (!app) {
        LOG.warn('Trade jobs skipped — app runtime not bound yet');
        return;
    }
    try {
        const featureEngineeringService = require('../services/featureEngineeringService');
        featureEngineeringService.initializeTables().catch((err) => {
            LOG.warn(`Feature engineering skipped: ${err.message}`);
        });
    } catch (error) {
        LOG.warn(`Feature engineering skipped: ${error.message}`);
    }
    const config = require('../config/tradingConfig');
    if (config.dataSources.useYahooFinance) {
        const TradingDataRefreshJob = require('../jobs/tradingDataRefreshJob');
        const job = global.tradingDataRefreshJob || new TradingDataRefreshJob();
        job.start();
        global.tradingDataRefreshJob = job;
        LOG.info('Trade jobs: Yahoo Finance refresh started');
        return;
    }
    try {
        const ExcelFileSyncJob = require('../jobs/excelFileSyncJob');
        const excelFileSyncJob = global.excelFileSyncJob || new ExcelFileSyncJob();
        if (!excelFileSyncJob.endpointsRegistered) {
            excelFileSyncJob.registerEndpoints(app);
            excelFileSyncJob.endpointsRegistered = true;
        }
        excelFileSyncJob.start();
        global.excelFileSyncJob = excelFileSyncJob;
        LOG.info('Trade jobs: Excel sheet sync scheduled (no preload)');
    } catch (error) {
        LOG.warn(`Excel sync job skipped: ${error.message}`);
    }
    try {
        const MutualFundSyncJob = require('../jobs/mutualFundSyncJob');
        const job = global.mutualFundSyncJob || new MutualFundSyncJob();
        job.start();
        global.mutualFundSyncJob = job;
    } catch (error) {
        LOG.warn(`Mutual fund job skipped: ${error.message}`);
    }
    try {
        const CorporateActionsSyncJob = require('../jobs/corporateActionsSyncJob');
        const job = global.corporateActionsSyncJob || new CorporateActionsSyncJob();
        job.start();
        global.corporateActionsSyncJob = job;
    } catch (error) {
        LOG.warn(`Corporate actions job skipped: ${error.message}`);
    }
    try {
        const BoardMeetingsSyncJob = require('../jobs/boardMeetingsSyncJob');
        const job = global.boardMeetingsSyncJob || new BoardMeetingsSyncJob();
        job.start();
        global.boardMeetingsSyncJob = job;
    } catch (error) {
        LOG.warn(`Board meetings job skipped: ${error.message}`);
    }
}

function startCyberJobs() {
    try {
        const ThreatIntelligenceJob = require('../jobs/threatIntelligenceJob');
        const job = global.threatIntelligenceJob || new ThreatIntelligenceJob(runtime.io);
        if (typeof job.schedule === 'function') job.schedule();
        global.threatIntelligenceJob = job;
        LOG.info('Cyber jobs: threat intelligence scheduled');
    } catch (error) {
        LOG.warn(`Threat intelligence job skipped: ${error.message}`);
    }
    try {
        if ((process.env.DB_TYPE || 'inmemory') === 'mysql') {
            require('../services/databaseSyncService').startPeriodicSync();
            LOG.info('Cyber jobs: MySQL sync scheduled');
        }
    } catch (error) {
        LOG.warn(`Database sync skipped: ${error.message}`);
    }
}

function startOfferJobs() {
    try {
        const dealsService = require('../dealsService');
        const ms = (process.env.DEALS_SYNC_INTERVAL_MINUTES || 30) * 60 * 1000;
        dealsService.autoSyncAllCompanies();
        addTimer('offer', setInterval(() => dealsService.autoSyncAllCompanies(), ms));
        LOG.info(`Offer jobs: deals auto-sync every ${ms / 60000} min`);
    } catch (error) {
        LOG.warn(`Offer deals sync skipped: ${error.message}`);
    }
}

function startAppointmentJobs() {
    const io = runtime.io;
    addTimer('appointments', setInterval(async () => {
        try {
            const db = require('../database');
            const affectedVendorIds = await db.autoExpireAppointments();
            if (!io || !affectedVendorIds?.length) return;
            for (const vId of affectedVendorIds) {
                const updatedQueue = await db.getQueueByVendor(vId);
                io.to(`vendor_${vId}`).emit('queue_updated', updatedQueue);
                io.to(`vendor_${vId}`).emit('appointments_updated');
                io.emit('appointments_updated');
            }
        } catch (e) {
            LOG.warn(`Auto-expire appointments failed: ${e.message}`);
        }
    }, 60000));
    LOG.info('Appointments jobs: auto-expire every 1 min');
}

function startQueueJobs() {
    const io = runtime.io;
    addTimer('queue', setInterval(async () => {
        try {
            const db = require('../database');
            const affectedVendorIds = await db.autoCompleteQueues();
            if (!io || !affectedVendorIds?.length) return;
            for (const vId of affectedVendorIds) {
                const updatedQueue = await db.getQueueByVendor(vId);
                io.to(`vendor_${vId}`).emit('queue_updated', updatedQueue);
            }
        } catch (e) {
            LOG.warn(`Auto-complete queues failed: ${e.message}`);
        }
    }, 3600000));
    LOG.info('Queue jobs: auto-complete every 60 min');
}

function startFleetJobs() {
    const io = runtime.io;
    addTimer('fleet', setInterval(async () => {
        try {
            const db = require('../database');
            if (db.getType() !== 'mysql' || !db.getPool) return;
            const pool = db.getPool();
            if (!pool) return;
            const [queues] = await pool.query(`
                SELECT DISTINCT gate_id FROM fleet_queues WHERE status = 'waiting'
            `);
            for (const row of queues) {
                const gateId = row.gate_id;
                const [queueRows] = await pool.query(`
                    SELECT driver_id, joined_at FROM fleet_queues
                    WHERE gate_id = ? AND status = 'waiting'
                    ORDER BY joined_at ASC
                `, [gateId]);
                for (let i = 0; i < queueRows.length; i++) {
                    const position = i + 1;
                    const avgProcessingTime = 3;
                    const [gateInfo] = await pool.query(
                        `SELECT estimated_wait_time FROM fleet_gates WHERE gate_id = ?`,
                        [gateId]
                    );
                    const baseWaitTime = gateInfo[0]?.estimated_wait_time || 10;
                    const estimatedWaitTime = Math.max(5, baseWaitTime + ((position - 1) * avgProcessingTime));
                    await pool.query(`
                        UPDATE fleet_queues
                        SET position = ?, estimated_wait_time = ?
                        WHERE driver_id = ? AND gate_id = ? AND status = 'waiting'
                    `, [position, estimatedWaitTime, queueRows[i].driver_id, gateId]);
                }
                if (io && queueRows.length > 0) {
                    io.emit('fleet_queue_updated', {
                        gate_id: gateId,
                        action: 'position_updated',
                        queue_count: queueRows.length,
                    });
                }
            }
        } catch (e) {
            LOG.warn(`Fleet queue update failed: ${e.message}`);
        }
    }, 30000));
    LOG.info('Fleet jobs: queue position refresh every 30s');
}

function startJobs(feature) {
    if (jobsStarted.has(feature)) return;
    jobsStarted.add(feature);
    if (feature === 'trade') startTradeJobs();
    if (feature === 'cyber') startCyberJobs();
    if (feature === 'offer') startOfferJobs();
    if (feature === 'appointments') startAppointmentJobs();
    if (feature === 'queue') startQueueJobs();
    if (feature === 'fleet') startFleetJobs();
}

async function loadHeavy(feature) {
    if (feature !== 'trade' || heavyLoaded.has('trade')) return;
    if (loadPromises.has('trade-heavy')) {
        await loadPromises.get('trade-heavy');
        return;
    }
    const promise = (async () => {
        LOG.info(`Loading trade market data (heap ${heapMb()}MB)`);
        try {
            if (global.boardMeetingsSyncJob) await global.boardMeetingsSyncJob.sync(true);
            if (global.corporateActionsSyncJob) await global.corporateActionsSyncJob.sync(true);
            if (global.mutualFundSyncJob) await global.mutualFundSyncJob.sync(true);
            heavyLoaded.add('trade');
        } finally {
            LOG.info(`Trade market data ready | rows=${featureSize('trade')} | heap ${heapMb()}MB`);
        }
    })().finally(() => loadPromises.delete('trade-heavy'));
    loadPromises.set('trade-heavy', promise);
    await promise;
}

async function ensureFeature(feature, options = {}) {
    const mode = options.mode || 'basic';
    if (!feature || feature === 'core' || !FEATURE_DATA[feature]) return;

    acquire(feature);
    try {
        if (!basicReady.has(feature)) {
            loadSeed(feature);
            startJobs(feature);
            basicReady.add(feature);
            LOG.info(`Initialized "${feature}" (${mode}, ${process.env.DB_TYPE || 'inmemory'}) | heap ${heapMb()}MB`);
        }
        if (mode === 'heavy') {
            await loadHeavy(feature);
        }
    } finally {
        release(feature);
    }
}

function startWatchdog() {
    if (watchdog) return;
    LOG.info(`Idle reclaim every ${Math.round(IDLE_MS / 60000)} min (FEATURE_IDLE_MINUTES / FEATURE_IDLE_MS)`);
    watchdog = setInterval(() => {
        const used = heapMb();
        if (used >= 600) {
            LOG.warn(`High heap ${used}MB — reclaiming idle features`);
            Object.keys(FEATURE_DATA).forEach((feature) => {
                if ((refs.get(feature) || 0) === 0) unload(feature);
            });
        }
    }, 60000);
    if (typeof watchdog.unref === 'function') watchdog.unref();
}

function middleware(...features) {
    const list = features.filter((f) => f && f !== 'core');
    return (req, res, next) => {
        if (!list.length) return next();
        list.forEach((f) => acquire(f));
        const onFinish = () => {
            list.forEach((f) => release(f));
            res.removeListener('finish', onFinish);
            res.removeListener('close', onFinish);
        };
        res.on('finish', onFinish);
        res.on('close', onFinish);
        const target = list[list.length - 1];
        Promise.resolve(ensureFeature(target, { mode: 'basic' }))
            .catch((err) => LOG.warn(`Init skipped: ${err.message}`))
            .finally(() => next());
    };
}

module.exports = {
    IDLE_MS,
    BOARD_CAP,
    CA_CAP,
    HISTORY_CAP,
    FEATURE_DATA,
    capArray,
    capByDate,
    acquire,
    release,
    unload,
    ensureFeature,
    startWatchdog,
    bindRuntime,
    middleware,
    heapMb,
};
