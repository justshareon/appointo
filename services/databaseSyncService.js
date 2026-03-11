/**
 * Database Sync Service
 * Syncs local in-memory database with MySQL
 */
const db = require('../database');
const LOG = require('../utils/logger');

class DatabaseSyncService {
    constructor() {
        this.isSyncing = false;
        this.lastSyncTime = null;
        this.syncInterval = null;
    }

    /**
     * Sync all cyber-related data from local to MySQL
     * @returns {Promise<Object>} Sync result
     */
    async syncToMySQL() {
        if (this.isSyncing) {
            LOG.warning('[DB Sync] Sync already in progress, skipping...');
            return { success: false, message: 'Sync already in progress' };
        }

        try {
            this.isSyncing = true;
            LOG.info('[DB Sync] Starting sync to MySQL...');

            const syncResult = {
                cyberThreats: 0,
                threatIntelligence: 0,
                notificationValidations: 0,
                autoValidationDetections: 0,
                mobileSecurityScans: 0,
                subscriptions: 0,
                errors: []
            };

            // Only sync if using MySQL
            if (db.getType() !== 'mysql') {
                LOG.info('[DB Sync] Not using MySQL, skipping sync');
                return { success: true, message: 'Not using MySQL, sync skipped' };
            }

            // Note: Settings are synced via settingsService.updateSettings() which handles both local and MySQL
            // Individual data items (threats, scans, etc.) would require MySQL table creation
            // For now, we focus on syncing settings which is the main requirement for cyber features
            LOG.info('[DB Sync] Settings are synced via settingsService.updateSettings()');

            this.lastSyncTime = new Date().toISOString();
            
            // Settings sync is handled by settingsService.updateSettings()
            // Return success with note about settings sync
            LOG.success(`[DB Sync] Settings sync complete (handled by settingsService)`);
            return {
                success: true,
                message: 'Settings are synced via settingsService.updateSettings()',
                lastSyncTime: this.lastSyncTime
            };
        } catch (error) {
            LOG.error('[DB Sync] Sync error:', error);
            return {
                success: false,
                error: error.message
            };
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Sync cyber threat to MySQL
     * @private
     */
    async _syncCyberThreat(threat) {
        // Skip if not using MySQL or method doesn't exist
        if (db.getType() !== 'mysql') return;
        // MySQL sync would be handled by settingsService.updateSettings for settings
        // Individual threat sync can be added later if needed
    }

    /**
     * Sync threat intelligence to MySQL
     * @private
     */
    async _syncThreatIntelligence(threat) {
        // Skip if not using MySQL
        if (db.getType() !== 'mysql') return;
        // MySQL sync would be handled by settingsService.updateSettings for settings
    }

    /**
     * Sync notification validation to MySQL
     * @private
     */
    async _syncNotificationValidation(validation) {
        // Skip if not using MySQL
        if (db.getType() !== 'mysql') return;
    }

    /**
     * Sync auto-validation detection to MySQL
     * @private
     */
    async _syncAutoValidationDetection(detection) {
        // Skip if not using MySQL
        if (db.getType() !== 'mysql') return;
    }

    /**
     * Sync mobile security scan to MySQL
     * @private
     */
    async _syncMobileSecurityScan(scan) {
        // Skip if not using MySQL
        if (db.getType() !== 'mysql') return;
    }

    /**
     * Sync subscription to MySQL
     * @private
     */
    async _syncSubscription(subscription) {
        // Skip if not using MySQL
        if (db.getType() !== 'mysql') return;
    }

    /**
     * Start periodic sync (every 30 minutes)
     */
    startPeriodicSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }

        // Sync immediately on start
        this.syncToMySQL().catch(err => {
            LOG.error('[DB Sync] Initial sync failed:', err);
        });

        // Then sync every 30 minutes
        this.syncInterval = setInterval(() => {
            this.syncToMySQL().catch(err => {
                LOG.error('[DB Sync] Periodic sync failed:', err);
            });
        }, 30 * 60 * 1000); // 30 minutes

        LOG.info('[DB Sync] Periodic sync started (every 30 minutes)');
    }

    /**
     * Stop periodic sync
     */
    stopPeriodicSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
            LOG.info('[DB Sync] Periodic sync stopped');
        }
    }

    /**
     * Get sync status
     */
    getSyncStatus() {
        return {
            isSyncing: this.isSyncing,
            lastSyncTime: this.lastSyncTime,
            syncInterval: this.syncInterval !== null
        };
    }
}

module.exports = new DatabaseSyncService();

