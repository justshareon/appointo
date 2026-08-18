/**
 * AUTO-SYNC SERVICE
 * Periodically syncs in-memory data to MySQL
 * This ensures data consistency even if manual syncs are missed
 */

const cron = require('node-cron');
const LOG = require('../utils/logger');
const { syncAllToMysql } = require('../syncAllToMysql');

let syncSchedule = null;
let isSyncRunning = false;

const startAutoSync = (intervalMinutes = 30) => {
    if (syncSchedule) {
        LOG.warning('[AutoSync] Sync schedule already running');
        return;
    }
    
    // Run every N minutes (default 30)
    const cronExpression = `*/${intervalMinutes} * * * *`;
    
    LOG.info(`[AutoSync] Starting auto-sync schedule every ${intervalMinutes} minutes`);
    
    syncSchedule = cron.schedule(cronExpression, async () => {
        if (isSyncRunning) {
            LOG.warning('[AutoSync] Sync already in progress, skipping this cycle');
            return;
        }
        
        isSyncRunning = true;
        LOG.info('[AutoSync] Starting periodic sync...');
        
        try {
            await syncAllToMysql();
            LOG.success('[AutoSync] Periodic sync completed successfully');
        } catch (err) {
            LOG.error('[AutoSync] Periodic sync failed:', err);
        } finally {
            isSyncRunning = false;
        }
    });
};

const stopAutoSync = () => {
    if (syncSchedule) {
        syncSchedule.stop();
        syncSchedule = null;
        LOG.info('[AutoSync] Auto-sync schedule stopped');
    }
};

// Sync on startup (optional)
const syncOnStartup = async (enabled = true) => {
    if (!enabled) return;
    
    LOG.info('[AutoSync] Performing startup sync...');
    
    try {
        await syncAllToMysql();
        LOG.success('[AutoSync] Startup sync completed');
    } catch (err) {
        LOG.error('[AutoSync] Startup sync failed:', err);
    }
};

module.exports = {
    startAutoSync,
    stopAutoSync,
    syncOnStartup,
    isSyncRunning: () => isSyncRunning
};
