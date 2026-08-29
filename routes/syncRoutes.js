/**
 * SYNC API ROUTES
 * POST /api/sync/all - Sync all in-memory data to MySQL
 * GET /api/sync/status - Check if sync is in progress
 */

const { syncAllToMysql } = require('../syncAllToMysql');
const syncStatus = require('../services/syncStatusService');
const { runSyncAttempt, isSyncRunning, syncUntilComplete } = require('../services/autoSyncService');
const { isMysqlConfigured } = require('../utils/resolveDbType');
const LOG = require('../utils/logger');

let lastSyncTime = null;
let lastSyncStatus = null;
let lastRecentSyncAt = 0;
const RECENT_SYNC_DEBOUNCE_MS = parseInt(process.env.SYNC_RECENT_DEBOUNCE_MS, 10) || 3 * 60 * 1000;

const getCombinedSyncing = () => isSyncRunning();

const setupSyncRoutes = (router) => {
    router.post('/all', async (req, res) => {
        if (getCombinedSyncing()) {
            return res.status(409).json({
                status: 'in_progress',
                message: 'Sync already in progress',
                startedAt: lastSyncTime,
            });
        }

        lastSyncTime = new Date();
        const forceFull = req.query.forceFull === 'true' || req.body?.forceFull === true;

        try {
            LOG.info(`[Sync API] Starting manual sync at ${lastSyncTime.toISOString()}${forceFull ? ' (force full)' : ''}`);
            const attempt = await runSyncAttempt('api', { forceFull });
            if (!attempt.ok) {
                throw new Error(attempt.error || attempt.reason || 'Sync failed');
            }
            const result = attempt.result;

            lastSyncStatus = {
                status: 'success',
                completedAt: new Date(),
                startedAt: lastSyncTime,
                resume: result.resume,
                summary: result.summary,
                modules: result.modules,
            };

            res.json(lastSyncStatus);
        } catch (err) {
            LOG.error('[Sync API] Sync failed:', err);
            lastSyncStatus = {
                status: 'error',
                error: err.message,
                completedAt: new Date(),
                startedAt: lastSyncTime,
            };

            res.status(500).json(lastSyncStatus);
        }
    });

    router.get('/status', async (req, res) => {
        try {
            const moduleState = await syncStatus.getModuleState();
            const latestRun = await syncStatus.getLatestRun();
            const complete = await syncStatus.isSyncComplete();
            res.json({
                isSyncing: getCombinedSyncing(),
                lastSyncTime,
                lastSyncStatus,
                latestRun,
                complete,
                needsSync: !complete,
                mysqlConfigured: isMysqlConfigured(),
                summary: moduleState.summary,
                modules: moduleState.modules,
            });
        } catch (err) {
            res.json({
                isSyncing: getCombinedSyncing(),
                lastSyncTime,
                lastSyncStatus,
                error: err.message,
            });
        }
    });

    router.get('/modules', async (req, res) => {
        try {
            const moduleState = await syncStatus.getModuleState();
            const latestRun = await syncStatus.getLatestRun();
            const complete = await syncStatus.isSyncComplete();
            res.json({ ...moduleState, latestRun, complete, needsSync: !complete });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post('/until-complete', async (req, res) => {
        if (getCombinedSyncing()) {
            return res.status(409).json({ status: 'in_progress', message: 'Sync loop already running' });
        }
        syncUntilComplete('api').catch((err) => LOG.error('[Sync API] until-complete:', err.message));
        res.json({ status: 'started', message: 'Sync will retry until all modules complete' });
    });

    router.post('/ensure-on-load', async (req, res) => {
        try {
            if (!isMysqlConfigured()) {
                return res.json({
                    complete: true,
                    mysqlConfigured: false,
                    needsSync: false,
                    syncing: false,
                    started: false,
                });
            }

            await syncStatus.init();
            const complete = await syncStatus.isSyncComplete();
            const syncing = getCombinedSyncing();
            let started = false;
            let recentSyncStarted = false;

            if (!complete && !syncing) {
                LOG.info('[Sync API] ensure-on-load: incomplete — starting until-complete');
                syncUntilComplete('page-load').catch((err) => {
                    LOG.error('[Sync API] ensure-on-load until-complete:', err.message);
                });
                started = true;
            }

            const wantRecent = req.query.recent !== 'false';
            const now = Date.now();
            if (complete && wantRecent && now - lastRecentSyncAt > RECENT_SYNC_DEBOUNCE_MS && !getCombinedSyncing()) {
                lastRecentSyncAt = now;
                const { runDriftSync } = require('../services/driftSyncService');
                LOG.info('[Sync API] ensure-on-load: running automatic memory↔MySQL drift sync');
                runDriftSync('page-load').catch((err) => {
                    LOG.error('[Sync API] ensure-on-load drift:', err.message);
                });
                recentSyncStarted = true;
            }

            const moduleState = await syncStatus.getModuleState();
            res.json({
                complete,
                needsSync: !complete,
                mysqlConfigured: true,
                syncing: syncing || started,
                started,
                recentSyncStarted,
                summary: moduleState.summary,
            });
        } catch (err) {
            LOG.error('[Sync API] ensure-on-load failed:', err.message);
            res.status(500).json({ complete: false, error: err.message, syncing: getCombinedSyncing() });
        }
    });

    const runEntitySync = (label, fn) => async (req, res) => {
        if (getCombinedSyncing()) {
            return res.status(409).json({ status: 'in_progress' });
        }
        try {
            const count = await fn();
            res.json({ status: 'success', itemsSynced: count });
        } catch (err) {
            res.status(500).json({ status: 'error', error: err.message });
        }
    };

    router.post('/users', runEntitySync('users', async () => {
        const { syncUsers } = require('../syncAllToMysql');
        return syncUsers();
    }));

    router.post('/vendors', runEntitySync('vendors', async () => {
        const { syncVendors } = require('../syncAllToMysql');
        return syncVendors();
    }));

    router.post('/products', runEntitySync('products', async () => {
        const { syncProducts } = require('../syncAllToMysql');
        return syncProducts();
    }));

    router.post('/3h', async (req, res) => {
        if (getCombinedSyncing()) {
            return res.status(409).json({
                status: 'in_progress',
                message: 'Sync already in progress',
            });
        }
        lastSyncTime = new Date();
        try {
            const { syncLast3Hours } = require('../syncLast3Hours');
            const counts = await syncLast3Hours({ exit: false });
            lastSyncStatus = {
                status: 'success',
                mode: 'last_3h',
                counts,
                completedAt: new Date(),
                startedAt: lastSyncTime,
            };
            res.json(lastSyncStatus);
        } catch (err) {
            LOG.error('[Sync API] 3h sync failed:', err);
            lastSyncStatus = {
                status: 'error',
                mode: 'last_3h',
                error: err.message,
                completedAt: new Date(),
                startedAt: lastSyncTime,
            };
            res.status(500).json(lastSyncStatus);
        }
    });

    router.post('/drift', async (req, res) => {
        try {
            const { runDriftSync } = require('../services/driftSyncService');
            const result = await runDriftSync('api');
            res.json({ status: result.ok ? 'success' : 'error', ...result });
        } catch (err) {
            res.status(500).json({ status: 'error', error: err.message });
        }
    });

    return router;
};

module.exports = {
    setupSyncRoutes,
    isSyncing: getCombinedSyncing,
    getLastSyncStatus: () => lastSyncStatus,
};
