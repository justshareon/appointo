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

    start() {
        if (!config.schedule?.enabled) {
            LOG.warning('[Corporate Actions Sync] Job is disabled');
            return;
        }

        corporateActionsDataService.initializeTables().catch(err => {
            LOG.error('[Corporate Actions Sync] DB init failed:', err.message);
        });

        const cronExpression = config.schedule?.corporateActionsCron || '0 6 * * *';
        LOG.info(`[Corporate Actions Sync] Scheduling with cron: ${cronExpression}`);

        this.cronJob = cron.schedule(cronExpression, async () => {
            await this.sync();
        }, {
            scheduled: true,
            timezone: "Asia/Kolkata"
        });

        LOG.success('[Corporate Actions Sync] Scheduled successfully');

        setTimeout(() => {
            LOG.info('[Corporate Actions Sync] Running initial sync...');
            this.sync(true).catch(err => {
                LOG.error('[Corporate Actions Sync] Initial sync failed:', err.message);
            });
        }, 5000);
    }

    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            LOG.info('[Corporate Actions Sync] Stopped');
        }
    }

    async sync(forceSync = false) {
        if (this.isRunning) {
            LOG.warning('[Corporate Actions Sync] Already running, skipping...');
            return;
        }

        this.isRunning = true;
        const syncStartTime = Date.now();

        LOG.info('[Corporate Actions Sync] ========================================');
        LOG.info(`[Corporate Actions Sync] Starting sync (force: ${forceSync})...`);
        LOG.info(`[Corporate Actions Sync] Time: ${new Date().toISOString()}`);

        try {
            let actionsData;
            try {
                actionsData = await corporateActionsCsvService.readCsvFile();
            } catch (fileError) {
                LOG.error(`[Corporate Actions Sync] CSV read failed: ${fileError.message}`);
                this.lastSyncStatus = 'error';
                this.lastSyncError = fileError.message;
                this.lastSyncTime = new Date();
                this.isRunning = false;
                return;
            }

            if (actionsData.length === 0) {
                LOG.warning('[Corporate Actions Sync] No data found in CSV file');
                this.lastSyncStatus = 'error';
                this.lastSyncError = 'No data found in CSV file';
                this.lastSyncTime = new Date();
                this.isRunning = false;
                return;
            }

            LOG.success(`[Corporate Actions Sync] Read ${actionsData.length} records from CSV`);

            // Clean data to prevent database errors
            const cleanedActionsData = actionsData.map(action => ({
                company_name: (action.company_name || '').substring(0, 255),
                symbol: (action.symbol || '').substring(0, 20),
                action_type: (action.action_type || '').substring(0, 100),
                ex_date: this.cleanDate(action.ex_date),
                record_date: this.cleanDate(action.record_date),
                payment_date: this.cleanDate(action.payment_date),
                ratio: this.cleanRatio(action.ratio),
                value: this.cleanDecimal(action.value),
                description: (action.description || '').substring(0, 1000),
                source_file: (action.source_file || '').substring(0, 255)
            }));

            await corporateActionsDataService.initializeTables();
            await corporateActionsDataService.truncateData();
            const inserted = await corporateActionsDataService.insertData(cleanedActionsData);

            const syncDuration = Date.now() - syncStartTime;
            this.lastSyncTime = new Date();
            this.lastSyncStatus = 'success';
            this.lastSyncError = null;

            LOG.success(`[Corporate Actions Sync] Done in ${(syncDuration / 1000).toFixed(2)}s | Inserted: ${inserted}`);
            LOG.info('[Corporate Actions Sync] ========================================');

        } catch (error) {
            const syncDuration = Date.now() - syncStartTime;
            this.lastSyncStatus = 'error';
            this.lastSyncError = error.message;
            this.lastSyncTime = new Date();

            LOG.error(`[Corporate Actions Sync] Failed after ${(syncDuration / 1000).toFixed(2)}s: ${error.message}`);
            LOG.info('[Corporate Actions Sync] ========================================');
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

    /**
     * Clean ratio value (e.g., "1:5", "2:1", "1-5")
     * Returns formatted ratio or null
     */
    cleanRatio(ratio) {
        if (!ratio) return null;
        
        const ratioStr = String(ratio).trim();
        // Check if it matches pattern like "1:5" or "2:1" or "1-5"
        const match = ratioStr.match(/(\d+)[:/-](\d+)/);
        if (match) {
            return `${match[1]}:${match[2]}`;
        }
        
        // If it's just a number, return as is
        if (!isNaN(parseFloat(ratioStr))) {
            return ratioStr;
        }
        
        return null;
    }

    /**
     * Clean decimal value (for dividends, percentages, etc.)
     */
    cleanDecimal(value) {
        if (!value) return null;
        
        const num = parseFloat(value);
        return isNaN(num) ? null : num;
    }

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