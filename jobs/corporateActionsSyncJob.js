/**
 * Corporate Actions Sync Job
 * Scheduled job that runs periodically to:
 * 1. Read data from CSV file (CF-CA-equities-*.csv)
 * 2. Truncate corporate_actions table
 * 3. Insert fresh data from CSV file into corporate_actions
 */
const cron = require('node-cron');
const config = require('../config/tradingConfig');
const corporateActionsCsvService = require('../services/corporateActionsCsvService');
const corporateActionsDataService = require('../services/corporateActionsDataService');
const LOG = require('../utils/logger');

class CorporateActionsSyncJob {
    constructor() {
        this.isRunning = false;
        this.lastSyncTime = null;
        this.lastSyncStatus = null;
        this.lastSyncError = null;
        this.cronJob = null;
    }

    /**
     * Start the scheduled job
     */
    start() {
        if (!config.schedule?.enabled) {
            LOG.warning('[Corporate Actions Sync] Job is disabled in configuration');
            return;
        }

        // Initialize database tables first
        corporateActionsDataService.initializeTables().catch(err => {
            LOG.error('[Corporate Actions Sync] Failed to initialize tables:', err.message);
        });

        // Schedule the job - run daily at 6 AM IST
        const cronExpression = config.schedule?.corporateActionsCron || '0 6 * * *';
        LOG.info(`[Corporate Actions Sync] Scheduling job with cron: ${cronExpression}`);

        this.cronJob = cron.schedule(cronExpression, async () => {
            await this.sync();
        }, {
            scheduled: true,
            timezone: "Asia/Kolkata"
        });

        LOG.success('[Corporate Actions Sync] Job scheduled successfully');

        // Run initial sync after 5 seconds
        setTimeout(() => {
            LOG.info('[Corporate Actions Sync] Running initial sync...');
            this.sync().catch(err => {
                LOG.error('[Corporate Actions Sync] Initial sync failed:', err.message);
            });
        }, 5000);
    }

    /**
     * Stop the scheduled job
     */
    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            LOG.info('[Corporate Actions Sync] Job stopped');
        }
    }

    /**
     * Manually trigger sync
     */
    async sync() {
        if (this.isRunning) {
            LOG.warning('[Corporate Actions Sync] Sync already in progress, skipping...');
            return;
        }

        this.isRunning = true;
        const syncStartTime = Date.now();

        LOG.info('[Corporate Actions Sync] ========================================');
        LOG.info('[Corporate Actions Sync] Starting sync job...');
        LOG.info(`[Corporate Actions Sync] Time: ${new Date().toISOString()}`);

        try {
            // Step 1: Read CSV file
            LOG.info('[Corporate Actions Sync] Step 1: Reading CSV file...');
            let actionsData;
            try {
                actionsData = await corporateActionsCsvService.readCsvFile();
            } catch (fileError) {
                LOG.error(`[Corporate Actions Sync] Cannot read CSV file: ${fileError.message}`);
                LOG.warning('[Corporate Actions Sync] Sync skipped - CSV file not available');
                this.lastSyncStatus = 'error';
                this.lastSyncError = fileError.message;
                this.lastSyncTime = new Date();
                this.isRunning = false;
                return;
            }

            if (actionsData.length === 0) {
                LOG.warning('[Corporate Actions Sync] No data found in CSV file - sync skipped');
                this.lastSyncStatus = 'error';
                this.lastSyncError = 'No data found in CSV file';
                this.lastSyncTime = new Date();
                this.isRunning = false;
                return;
            }

            LOG.info(`[Corporate Actions Sync] Step 2: Processing ${actionsData.length} corporate actions...`);

            // Step 2: Initialize tables if needed
            await corporateActionsDataService.initializeTables();

            // Step 3: Truncate existing data
            LOG.info('[Corporate Actions Sync] Step 3: Truncating existing data...');
            await corporateActionsDataService.truncateData();

            // Step 4: Insert new data
            LOG.info('[Corporate Actions Sync] Step 4: Inserting new data...');
            const inserted = await corporateActionsDataService.insertData(actionsData);

            const syncDuration = Date.now() - syncStartTime;
            this.lastSyncTime = new Date();
            this.lastSyncStatus = 'success';
            this.lastSyncError = null;

            LOG.success(`[Corporate Actions Sync] ========================================`);
            LOG.success(`[Corporate Actions Sync] Sync completed successfully!`);
            LOG.success(`[Corporate Actions Sync] Duration: ${(syncDuration / 1000).toFixed(2)}s`);
            LOG.success(`[Corporate Actions Sync] Records inserted: ${inserted}`);
            LOG.success(`[Corporate Actions Sync] ========================================`);

        } catch (error) {
            const syncDuration = Date.now() - syncStartTime;
            this.lastSyncStatus = 'error';
            this.lastSyncError = error.message;
            this.lastSyncTime = new Date();

            LOG.error(`[Corporate Actions Sync] ========================================`);
            LOG.error(`[Corporate Actions Sync] Sync failed after ${(syncDuration / 1000).toFixed(2)}s`);
            LOG.error(`[Corporate Actions Sync] Error: ${error.message}`);
            LOG.error(`[Corporate Actions Sync] Stack: ${error.stack}`);
            LOG.error(`[Corporate Actions Sync] ========================================`);

            throw error;
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Get sync job status
     * @returns {Object}
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            lastSyncTime: this.lastSyncTime,
            lastSyncStatus: this.lastSyncStatus,
            lastSyncError: this.lastSyncError,
            csvFilePath: corporateActionsCsvService.getCsvFilePath()
        };
    }
}

module.exports = CorporateActionsSyncJob;

