/**
 * Mutual Fund Excel Sync Job
 * Scheduled job that runs every 25 minutes to:
 * 1. Read data from local Excel file (Equity & Mutual Fund Investment Tracker.xlsx)
 * 2. Archive current mutual_funds to mutual_fund_history
 * 3. Truncate mutual_funds
 * 4. Insert fresh data from Excel file into mutual_funds
 */
const cron = require('node-cron');
const mutualFundExcelService = require('../services/mutualFundExcelService');
const mutualFundDataService = require('../services/mutualFundDataService');
const LOG = require('../utils/logger');

class MutualFundSyncJob {
    constructor() {
        this.isRunning = false;
        this.lastSyncTime = null;
        this.lastSyncStatus = null;
        this.lastSyncError = null;
        this.cronJob = null;
    }

    start() {
        const cronExpression = process.env.MUTUAL_FUND_SYNC_CRON || '*/25 * * * *';
        const enabled = process.env.MUTUAL_FUND_SYNC_ENABLED !== 'false';
        
        if (!enabled) {
            LOG.warning('[Mutual Fund Sync] Job is disabled');
            return;
        }

        mutualFundDataService.initializeTables().catch(err => {
            LOG.error('[Mutual Fund Sync] DB init failed:', err.message);
        });

        LOG.info(`[Mutual Fund Sync] Scheduling with cron: ${cronExpression}`);

        this.cronJob = cron.schedule(cronExpression, async () => {
            await this.sync();
        }, {
            scheduled: true,
            timezone: "Asia/Kolkata"
        });

        LOG.success('[Mutual Fund Sync] Scheduled successfully (lazy-load on first /trade use)');
    }

    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            LOG.info('[Mutual Fund Sync] Stopped');
        }
    }

    async sync(forceSync = false) {
        if (this.isRunning) {
            LOG.warning('[Mutual Fund Sync] Already running, skipping...');
            return;
        }

        this.isRunning = true;
        const syncStartTime = Date.now();

        LOG.info('[Mutual Fund Sync] ========================================');
        LOG.info(`[Mutual Fund Sync] Starting sync (force: ${forceSync})...`);
        LOG.info(`[Mutual Fund Sync] Time: ${new Date().toISOString()}`);

        try {
            // Read Excel file
            let sheetsData;
            try {
                sheetsData = await mutualFundExcelService.readAllSheets();
            } catch (fileError) {
                LOG.error(`[Mutual Fund Sync] Excel read failed: ${fileError.message}`);
                this.lastSyncStatus = 'error';
                this.lastSyncError = fileError.message;
                return;
            }
            
            // Combine all sheets data
            const allFundData = [];
            for (const [sheetName, fundData] of Object.entries(sheetsData)) {
                if (Array.isArray(fundData) && fundData.length > 0) {
                    allFundData.push(...fundData);
                }
            }
            
            if (allFundData.length === 0) {
                LOG.warning('[Mutual Fund Sync] No data found in Excel file');
                this.lastSyncStatus = 'error';
                this.lastSyncError = 'No data found in Excel file';
                return;
            }

            LOG.success(`[Mutual Fund Sync] Read ${allFundData.length} records`);

            // Clean data to prevent database errors
            const cleanedFundData = allFundData.map(fund => ({
                fund_name: (fund.fund_name || '').substring(0, 255),
                category: (fund.category || '').substring(0, 100),
                nav: parseFloat(fund.nav) || 0,
                returns: parseFloat(fund.returns) || 0,
                aum: parseFloat(fund.aum) || 0,
                expense_ratio: parseFloat(fund.expense_ratio) || 0,
                rating: this.cleanRating(fund.rating), // Fix for rating column
                risk: (fund.risk || '').substring(0, 50),
                sheet_name: (fund.sheet_name || '').substring(0, 100)
            }));

            const pool = require('../database').getPool();
            
            if (!pool) {
                LOG.warning('[Mutual Fund Sync] Using in-memory storage');
                await mutualFundDataService.archiveCurrentData();
                await mutualFundDataService.truncateLiveData();
                const inserted = await mutualFundDataService.insertLiveData(cleanedFundData);
                this.lastSyncTime = new Date();
                this.lastSyncStatus = 'success';
                LOG.success(`[Mutual Fund Sync] In-memory sync: ${inserted} records`);
                return;
            }

            const connection = await pool.getConnection();
            await connection.beginTransaction();

            try {
                const archivedCount = await this.archiveWithConnection(connection);
                await connection.query('TRUNCATE TABLE mutual_funds');
                const insertedCount = await this.insertWithConnection(connection, cleanedFundData);
                const [verifyResult] = await connection.query('SELECT COUNT(*) as count FROM mutual_funds');
                await connection.commit();

                const syncDuration = Date.now() - syncStartTime;
                this.lastSyncTime = new Date();
                this.lastSyncStatus = 'success';

                LOG.success(`[Mutual Fund Sync] Done in ${syncDuration}ms | Archived: ${archivedCount} | Inserted: ${insertedCount} | DB: ${verifyResult[0].count}`);
                LOG.info('[Mutual Fund Sync] ========================================');

            } catch (transactionError) {
                await connection.rollback();
                throw transactionError;
            } finally {
                connection.release();
            }

        } catch (error) {
            const syncDuration = Date.now() - syncStartTime;
            this.lastSyncStatus = 'error';
            this.lastSyncError = error.message;
            LOG.error(`[Mutual Fund Sync] Failed after ${syncDuration}ms: ${error.message}`);
            LOG.info('[Mutual Fund Sync] ========================================');
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Clean rating value to prevent "Out of range" error
     * Rating should be integer between 1-5 or NULL
     */
    cleanRating(rating) {
        if (!rating) return null;
        
        // Try to extract number from rating (e.g., "4 Stars" -> 4)
        const match = String(rating).match(/(\d+)/);
        if (match) {
            let num = parseInt(match[1]);
            // Ensure rating is between 1-5
            if (num >= 1 && num <= 5) {
                return num;
            }
        }
        
        // Handle text ratings
        const ratingMap = {
            'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
            '1 star': 1, '2 star': 2, '3 star': 3, '4 star': 4, '5 star': 5,
            '★': 1, '★★': 2, '★★★': 3, '★★★★': 4, '★★★★★': 5
        };
        
        const lowerRating = String(rating).toLowerCase();
        for (const [key, value] of Object.entries(ratingMap)) {
            if (lowerRating.includes(key)) {
                return value;
            }
        }
        
        return null;
    }

    async archiveWithConnection(connection) {
        try {
            const [liveData] = await connection.query('SELECT * FROM mutual_funds');
            
            if (liveData.length === 0) {
                return 0;
            }

            const archiveValues = liveData.map(row => [
                row.fund_name,
                row.category,
                row.nav,
                row.returns,
                row.aum,
                row.expense_ratio,
                row.rating,
                row.risk,
                row.sheet_name
            ]);

            const placeholders = archiveValues.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
            const query = `
                INSERT INTO mutual_fund_history 
                (fund_name, category, nav, returns, aum, expense_ratio, rating, risk, sheet_name)
                VALUES ${placeholders}
            `;

            const flatValues = archiveValues.flat();
            await connection.query(query, flatValues);
            return liveData.length;
        } catch (error) {
            LOG.error('[Mutual Fund Sync] Archive error:', error.message);
            throw error;
        }
    }

    async insertWithConnection(connection, fundData) {
        try {
            const values = fundData.map(fund => [
                fund.fund_name,
                fund.category,
                fund.nav,
                fund.returns,
                fund.aum,
                fund.expense_ratio,
                fund.rating,
                fund.risk,
                fund.sheet_name
            ]);

            const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
            const query = `
                INSERT INTO mutual_funds 
                (fund_name, category, nav, returns, aum, expense_ratio, rating, risk, sheet_name)
                VALUES ${placeholders}
            `;

            const flatValues = values.flat();
            const [result] = await connection.query(query, flatValues);
            return result.affectedRows || fundData.length;
        } catch (error) {
            LOG.error(`[Mutual Fund Sync] Insert error: ${error.message}`);
            throw error;
        }
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            lastSyncTime: this.lastSyncTime,
            lastSyncStatus: this.lastSyncStatus,
            lastSyncError: this.lastSyncError,
            cronExpression: process.env.MUTUAL_FUND_SYNC_CRON || '*/25 * * * *',
            enabled: process.env.MUTUAL_FUND_SYNC_ENABLED !== 'false',
            excelFilePath: mutualFundExcelService.getExcelFilePath()
        };
    }
}

module.exports = MutualFundSyncJob;