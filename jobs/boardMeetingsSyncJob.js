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

    start() {
        if (!config.schedule?.enabled) {
            LOG.warning('[Board Meetings Sync] Job is disabled');
            return;
        }

        boardMeetingsDataService.initializeTables().catch(err => {
            LOG.error('[Board Meetings Sync] DB init failed:', err.message);
        });

        const cronExpression = config.schedule?.boardMeetingsCron || '30 6 * * *';
        LOG.info(`[Board Meetings Sync] Scheduling with cron: ${cronExpression}`);

        this.cronJob = cron.schedule(cronExpression, async () => {
            await this.sync();
        }, {
            scheduled: true,
            timezone: "Asia/Kolkata"
        });

        LOG.success('[Board Meetings Sync] Scheduled successfully (lazy-load on first /trade use)');
    }

    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            LOG.info('[Board Meetings Sync] Stopped');
        }
    }

    async sync(forceSync = false) {
        if (this.isRunning) {
            LOG.warning('[Board Meetings Sync] Already running, skipping...');
            return;
        }

        this.isRunning = true;
        const syncStartTime = Date.now();

        LOG.info('[Board Meetings Sync] ========================================');
        LOG.info(`[Board Meetings Sync] Starting sync (force: ${forceSync})...`);
        LOG.info(`[Board Meetings Sync] Time: ${new Date().toISOString()}`);

        try {
            let meetingsData;
            try {
                meetingsData = await boardMeetingsCsvService.readCsvFile();
            } catch (fileError) {
                LOG.error(`[Board Meetings Sync] CSV read failed: ${fileError.message}`);
                this.lastSyncStatus = 'error';
                this.lastSyncError = fileError.message;
                this.lastSyncTime = new Date();
                this.isRunning = false;
                return;
            }

            if (meetingsData.length === 0) {
                LOG.warning('[Board Meetings Sync] No data found in CSV file');
                this.lastSyncStatus = 'error';
                this.lastSyncError = 'No data found in CSV file';
                this.lastSyncTime = new Date();
                this.isRunning = false;
                return;
            }

            LOG.success(`[Board Meetings Sync] Read ${meetingsData.length} records from CSV`);

            // Clean data to prevent database errors
            const cleanedMeetingsData = meetingsData.map(meeting => ({
                company_name: (meeting.company_name || '').substring(0, 255),
                symbol: (meeting.symbol || '').substring(0, 20),
                meeting_date: this.cleanDate(meeting.meeting_date),
                meeting_time: (meeting.meeting_time || '').substring(0, 50),
                meeting_type: (meeting.meeting_type || '').substring(0, 100),
                purpose: (meeting.purpose || '').substring(0, 500),
                venue: (meeting.venue || '').substring(0, 500),
                outcome: (meeting.outcome || '').substring(0, 500),
                source_file: (meeting.source_file || '').substring(0, 255)
            }));

            await boardMeetingsDataService.initializeTables();
            await boardMeetingsDataService.truncateData();
            const inserted = await boardMeetingsDataService.insertData(cleanedMeetingsData);

            const syncDuration = Date.now() - syncStartTime;
            this.lastSyncTime = new Date();
            this.lastSyncStatus = 'success';
            this.lastSyncError = null;

            LOG.success(`[Board Meetings Sync] Done in ${(syncDuration / 1000).toFixed(2)}s | Inserted: ${inserted}`);
            LOG.info('[Board Meetings Sync] ========================================');

        } catch (error) {
            const syncDuration = Date.now() - syncStartTime;
            this.lastSyncStatus = 'error';
            this.lastSyncError = error.message;
            this.lastSyncTime = new Date();

            LOG.error(`[Board Meetings Sync] Failed after ${(syncDuration / 1000).toFixed(2)}s: ${error.message}`);
            LOG.info('[Board Meetings Sync] ========================================');
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Clean date to ensure valid MySQL date format
     */
    cleanDate(date) {
        if (!date) return null;
        
        try {
            // If already a Date object
            if (date instanceof Date) {
                return date.toISOString().split('T')[0];
            }
            
            // Try to parse string date
            const parsedDate = new Date(date);
            if (!isNaN(parsedDate.getTime())) {
                return parsedDate.toISOString().split('T')[0];
            }
            
            // Try common Indian date formats (DD/MM/YYYY)
            const parts = String(date).split(/[/-]/);
            if (parts.length === 3) {
                let day, month, year;
                
                // Check if first part is day (DD/MM/YYYY)
                if (parts[0].length <= 2 && parts[1].length <= 2) {
                    day = parseInt(parts[0]);
                    month = parseInt(parts[1]) - 1;
                    year = parseInt(parts[2]);
                } else {
                    // Assume YYYY-MM-DD
                    year = parseInt(parts[0]);
                    month = parseInt(parts[1]) - 1;
                    day = parseInt(parts[2]);
                }
                
                const formattedDate = new Date(year, month, day);
                if (!isNaN(formattedDate.getTime())) {
                    return formattedDate.toISOString().split('T')[0];
                }
            }
            
            return null;
        } catch (err) {
            return null;
        }
    }

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