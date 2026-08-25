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
                isSyncing,
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
                isSyncing,
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
        if (isSyncing) {
            return res.status(409).json({ status: 'in_progress', message: 'Sync loop already running' });
        }
        const { syncUntilComplete } = require('../services/autoSyncService');
        syncUntilComplete('api').catch((err) => LOG.error('[Sync API] until-complete:', err.message));
        res.json({ status: 'started', message: 'Sync will retry until all modules complete' });
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
