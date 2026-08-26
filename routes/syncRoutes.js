/**
 * SYNC API ROUTES
 * POST /api/sync/all - Sync all in-memory data to MySQL
 * GET /api/sync/status - Check if sync is in progress
 */

const { syncAllToMysql } = require('../syncAllToMysql');
const syncStatus = require('../services/syncStatusService');
const LOG = require('../utils/logger');

let isSyncing = false;
let lastSyncTime = null;
let lastSyncStatus = null;
let lastRecentSyncAt = 0;
const RECENT_SYNC_DEBOUNCE_MS = parseInt(process.env.SYNC_RECENT_DEBOUNCE_MS, 10) || 3 * 60 * 1000;

const mysqlConfigured = () => !!(process.env.DB_HOST || process.env.DB_NAME);

const getCombinedSyncing = () => {
    try {
        const { isSyncRunning } = require('../services/autoSyncService');
        return isSyncing || isSyncRunning();
    } catch {
        return isSyncing;
    }
};

const setupSyncRoutes = (router) => {
    // Trigger full sync
    router.post('/all', async (req, res) => {
        if (isSyncing) {
            return res.status(409).json({
                status: 'in_progress',
                message: 'Sync already in progress',
                startedAt: lastSyncTime
            });
        }
        
        isSyncing = true;
        lastSyncTime = new Date();
        const forceFull = req.query.forceFull === 'true' || req.body?.forceFull === true;
        
        try {
            LOG.info(`[Sync API] Starting manual sync at ${lastSyncTime.toISOString()}${forceFull ? ' (force full)' : ''}`);
            const result = await syncAllToMysql({ triggerSource: 'api', forceFull });
            
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
                startedAt: lastSyncTime
            };
            
            res.status(500).json(lastSyncStatus);
        } finally {
            isSyncing = false;
        }
    });
    
    // Get sync status (in-memory + MySQL module map)
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

    // Module-by-module sync map (done / pending / failed)
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

    // Keep syncing in background until all modules complete
    router.post('/until-complete', async (req, res) => {
        if (getCombinedSyncing()) {
            return res.status(409).json({ status: 'in_progress', message: 'Sync loop already running' });
        }
        const { syncUntilComplete } = require('../services/autoSyncService');
        syncUntilComplete('api').catch((err) => LOG.error('[Sync API] until-complete:', err.message));
        res.json({ status: 'started', message: 'Sync will retry until all modules complete' });
    });

    /**
     * Page/app load: resume full sync if incomplete; when complete, optionally run 3h memory↔MySQL.
     * POST /api/sync/ensure-on-load?recent=true
     */
    router.post('/ensure-on-load', async (req, res) => {
        try {
            if (!mysqlConfigured()) {
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
                const { syncUntilComplete } = require('../services/autoSyncService');
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
                const { syncLast3Hours } = require('../syncLast3Hours');
                LOG.info('[Sync API] ensure-on-load: running recent 3h memory↔MySQL sync');
                syncLast3Hours({ exit: false }).catch((err) => {
                    LOG.error('[Sync API] ensure-on-load 3h:', err.message);
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
    
    // Sync specific entity types
    router.post('/users', async (req, res) => {
        if (isSyncing) {
            return res.status(409).json({ status: 'in_progress' });
        }
        
        isSyncing = true;
        
        try {
            const { syncUsers } = require('../syncAllToMysql');
            const count = await syncUsers();
            res.json({ status: 'success', itemsSynced: count });
        } catch (err) {
            res.status(500).json({ status: 'error', error: err.message });
        } finally {
            isSyncing = false;
        }
    });
    
    router.post('/vendors', async (req, res) => {
        if (isSyncing) {
            return res.status(409).json({ status: 'in_progress' });
        }
        
        isSyncing = true;
        
        try {
            const { syncVendors } = require('../syncAllToMysql');
            const count = await syncVendors();
            res.json({ status: 'success', itemsSynced: count });
        } catch (err) {
            res.status(500).json({ status: 'error', error: err.message });
        } finally {
            isSyncing = false;
        }
    });
    
    router.post('/products', async (req, res) => {
        if (isSyncing) {
            return res.status(409).json({ status: 'in_progress' });
        }
        
        isSyncing = true;
        
        try {
            const { syncProducts } = require('../syncAllToMysql');
            const count = await syncProducts();
            res.json({ status: 'success', itemsSynced: count });
        } catch (err) {
            res.status(500).json({ status: 'error', error: err.message });
        } finally {
            isSyncing = false;
        }
    });

    /**
     * Easy bidirectional sync for recent activity (products, appointments, chat, …)
     * POST /api/sync/3h
     */
    router.post('/3h', async (req, res) => {
        if (isSyncing) {
            return res.status(409).json({
                status: 'in_progress',
                message: 'Sync already in progress',
            });
        }
        isSyncing = true;
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
        } finally {
            isSyncing = false;
        }
    });
    
    return router;
};

module.exports = { setupSyncRoutes, isSyncing: () => isSyncing, getLastSyncStatus: () => lastSyncStatus };
