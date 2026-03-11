/**
 * Board Meetings Sync Job
 * Scheduled job that runs periodically to:
 * 1. Read data from CSV file (CF-BM-equities-*.csv)
 * 2. Truncate board_meetings table
 * 3. Insert fresh data from CSV file into board_meetings
 */
const cron = require('node-cron');
const config = require('../config/tradingConfig');
const boardMeetingsCsvService = require('../services/boardMeetingsCsvService');
const boardMeetingsDataService = require('../services/boardMeetingsDataService');
const LOG = require('../utils/logger');

class BoardMeetingsSyncJob {
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
            LOG.warning('[Board Meetings Sync] Job is disabled in configuration');
            return;
        }

        // Initialize database tables first
        boardMeetingsDataService.initializeTables().catch(err => {
            LOG.error('[Board Meetings Sync] Failed to initialize tables:', err.message);
        });

        // Schedule the job - run daily at 6:30 AM IST (30 min after corporate actions)
        const cronExpression = config.schedule?.boardMeetingsCron || '30 6 * * *';
        LOG.info(`[Board Meetings Sync] Scheduling job with cron: ${cronExpression}`);

        this.cronJob = cron.schedule(cronExpression, async () => {
            await this.sync();
        }, {
            scheduled: true,
            timezone: "Asia/Kolkata"
        });

        LOG.success('[Board Meetings Sync] Job scheduled successfully');

        // Run initial sync after 5 seconds
        setTimeout(() => {
            LOG.info('[Board Meetings Sync] Running initial sync...');
            this.sync().catch(err => {
                LOG.error('[Board Meetings Sync] Initial sync failed:', err.message);
            });
        }, 5000);
    }

    /**
     * Stop the scheduled job
     */
    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            LOG.info('[Board Meetings Sync] Job stopped');
        }
    }

    /**
     * Manually trigger sync
     */
    async sync() {
        if (this.isRunning) {
            LOG.warning('[Board Meetings Sync] Sync already in progress, skipping...');
            return;
        }

        this.isRunning = true;
        const syncStartTime = Date.now();

        LOG.info('[Board Meetings Sync] ========================================');
        LOG.info('[Board Meetings Sync] Starting sync job...');
        LOG.info(`[Board Meetings Sync] Time: ${new Date().toISOString()}`);

        try {
            // Step 1: Read CSV file
            LOG.info('[Board Meetings Sync] Step 1: Reading CSV file...');
            let meetingsData;
            try {
                meetingsData = await boardMeetingsCsvService.readCsvFile();
            } catch (fileError) {
                LOG.error(`[Board Meetings Sync] Cannot read CSV file: ${fileError.message}`);
                LOG.warning('[Board Meetings Sync] Sync skipped - CSV file not available');
                this.lastSyncStatus = 'error';
                this.lastSyncError = fileError.message;
                this.lastSyncTime = new Date();
                this.isRunning = false;
                return;
            }

            if (meetingsData.length === 0) {
                LOG.warning('[Board Meetings Sync] No data found in CSV file - sync skipped');
                this.lastSyncStatus = 'error';
                this.lastSyncError = 'No data found in CSV file';
                this.lastSyncTime = new Date();
                this.isRunning = false;
                return;
            }

            LOG.info(`[Board Meetings Sync] Step 2: Processing ${meetingsData.length} board meetings...`);

            // Step 2: Initialize tables if needed
            await boardMeetingsDataService.initializeTables();

            // Step 3: Truncate existing data
            LOG.info('[Board Meetings Sync] Step 3: Truncating existing data...');
            await boardMeetingsDataService.truncateData();

            // Step 4: Insert new data
            LOG.info('[Board Meetings Sync] Step 4: Inserting new data...');
            const inserted = await boardMeetingsDataService.insertData(meetingsData);

            const syncDuration = Date.now() - syncStartTime;
            this.lastSyncTime = new Date();
            this.lastSyncStatus = 'success';
            this.lastSyncError = null;

            LOG.success(`[Board Meetings Sync] ========================================`);
            LOG.success(`[Board Meetings Sync] Sync completed successfully!`);
            LOG.success(`[Board Meetings Sync] Duration: ${(syncDuration / 1000).toFixed(2)}s`);
            LOG.success(`[Board Meetings Sync] Records inserted: ${inserted}`);
            LOG.success(`[Board Meetings Sync] ========================================`);

        } catch (error) {
            const syncDuration = Date.now() - syncStartTime;
            this.lastSyncStatus = 'error';
            this.lastSyncError = error.message;
            this.lastSyncTime = new Date();

            LOG.error(`[Board Meetings Sync] ========================================`);
            LOG.error(`[Board Meetings Sync] Sync failed after ${(syncDuration / 1000).toFixed(2)}s`);
            LOG.error(`[Board Meetings Sync] Error: ${error.message}`);
            LOG.error(`[Board Meetings Sync] Stack: ${error.stack}`);
            LOG.error(`[Board Meetings Sync] ========================================`);

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
            csvFilePath: boardMeetingsCsvService.getCsvFilePath()
        };
    }
}

module.exports = BoardMeetingsSyncJob;

