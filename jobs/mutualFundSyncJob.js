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

    /**
     * Start the scheduled job
     */
    start() {
        const cronExpression = process.env.MUTUAL_FUND_SYNC_CRON || '*/25 * * * *';
        const enabled = process.env.MUTUAL_FUND_SYNC_ENABLED !== 'false';
        
        if (!enabled) {
            LOG.warning('[Mutual Fund Sync] Job is disabled in configuration');
            return;
        }

        // Initialize database tables first
        mutualFundDataService.initializeTables().catch(err => {
            LOG.error('[Mutual Fund Sync] Failed to initialize tables:', err.message);
        });

        // Schedule the job
        LOG.info(`[Mutual Fund Sync] Scheduling job with cron: ${cronExpression}`);

        this.cronJob = cron.schedule(cronExpression, async () => {
            await this.sync();
        }, {
            scheduled: true,
            timezone: "Asia/Kolkata"
        });

        LOG.success('[Mutual Fund Sync] Job scheduled successfully');

        // Run initial sync after 5 seconds
        setTimeout(() => {
            LOG.info('[Mutual Fund Sync] Running initial sync...');
            this.sync().catch(err => {
                LOG.error('[Mutual Fund Sync] Initial sync failed:', err.message);
            });
        }, 5000);
    }

    /**
     * Stop the scheduled job
     */
    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            LOG.info('[Mutual Fund Sync] Job stopped');
        }
    }

    /**
     * Manually trigger sync
     */
    async sync() {
        if (this.isRunning) {
            LOG.warning('[Mutual Fund Sync] Sync already in progress, skipping...');
            return;
        }

        this.isRunning = true;
        const syncStartTime = Date.now();

        LOG.info('[Mutual Fund Sync] ========================================');
        LOG.info('[Mutual Fund Sync] Starting sync job...');
        LOG.info(`[Mutual Fund Sync] Time: ${new Date().toISOString()}`);

        try {
            // Step 1: Read all sheets from Excel file
            LOG.info('[Mutual Fund Sync] Step 1: Reading all sheets from Excel file...');
            let sheetsData;
            try {
                sheetsData = await mutualFundExcelService.readAllSheets();
            } catch (fileError) {
                LOG.error(`[Mutual Fund Sync] Cannot read Excel file: ${fileError.message}`);
                LOG.warning('[Mutual Fund Sync] Sync skipped - Excel file not available');
                this.lastSyncStatus = 'error';
                this.lastSyncError = fileError.message;
                return;
            }
            
            // Combine all sheets data
            const allFundData = [];
            for (const [sheetName, fundData] of Object.entries(sheetsData)) {
                if (Array.isArray(fundData) && fundData.length > 0) {
                    allFundData.push(...fundData);
                    LOG.info(`[Mutual Fund Sync]   - ${sheetName}: ${fundData.length} funds`);
                }
            }
            
            if (allFundData.length === 0) {
                LOG.warning('[Mutual Fund Sync] No data found in Excel file - sync skipped');
                LOG.warning(`[Mutual Fund Sync] Sheets processed: ${Object.keys(sheetsData).join(', ')}`);
                this.lastSyncStatus = 'error';
                this.lastSyncError = 'No data found in Excel file';
                return;
            }

            LOG.success(`[Mutual Fund Sync] Read ${allFundData.length} total funds from ${Object.keys(sheetsData).length} sheets`);

            // Step 2: Check database availability
            LOG.info('[Mutual Fund Sync] Step 2: Checking database availability...');
            const pool = require('../database').getPool();
            
            if (!pool) {
                LOG.warning('[Mutual Fund Sync] MySQL not available, using in-memory storage');
                await mutualFundDataService.archiveCurrentData();
                await mutualFundDataService.truncateLiveData();
                const inserted = await mutualFundDataService.insertLiveData(allFundData);
                
                this.lastSyncTime = new Date();
                this.lastSyncStatus = 'success';
                this.lastSyncError = null;
                
                LOG.success(`[Mutual Fund Sync] Sync completed using in-memory storage: ${inserted} records`);
                return;
            }

            // Step 3: Begin database transaction
            LOG.info('[Mutual Fund Sync] Step 3: Starting database transaction...');

            const connection = await pool.getConnection();
            await connection.beginTransaction();

            try {
                // Step 4: Archive current live data
                LOG.info('[Mutual Fund Sync] Step 4: Archiving current live data...');
                const archivedCount = await this.archiveWithConnection(connection);
                LOG.success(`[Mutual Fund Sync] Archived ${archivedCount} records`);

                // Step 5: Truncate live table
                LOG.info('[Mutual Fund Sync] Step 5: Truncating mutual_funds table...');
                await connection.query('TRUNCATE TABLE mutual_funds');
                LOG.success('[Mutual Fund Sync] Live table truncated');

                // Step 6: Insert new data
                LOG.info('[Mutual Fund Sync] Step 6: Inserting new data...');
                const insertedCount = await this.insertWithConnection(connection, allFundData);
                LOG.success(`[Mutual Fund Sync] Inserted ${insertedCount} records`);

                // Step 7: Commit transaction
                await connection.commit();
                LOG.success('[Mutual Fund Sync] Transaction committed successfully');

                const syncDuration = Date.now() - syncStartTime;
                this.lastSyncTime = new Date();
                this.lastSyncStatus = 'success';
                this.lastSyncError = null;

                LOG.success(`[Mutual Fund Sync] Sync completed successfully in ${syncDuration}ms`);
                LOG.info(`[Mutual Fund Sync] - Archived: ${archivedCount} records`);
                LOG.info(`[Mutual Fund Sync] - Inserted: ${insertedCount} records`);
                LOG.info(`[Mutual Fund Sync] - Sheets: ${Object.keys(sheetsData).join(', ')}`);
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

            LOG.error('[Mutual Fund Sync] ========================================');
            LOG.error(`[Mutual Fund Sync] Sync failed after ${syncDuration}ms`);
            LOG.error(`[Mutual Fund Sync] Error: ${error.message}`);
            LOG.error(`[Mutual Fund Sync] Stack: ${error.stack ? error.stack.split('\n').slice(0, 5).join('\n') : 'No stack'}`);
            LOG.error('[Mutual Fund Sync] ========================================');
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Archive current data using a database connection
     */
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
            LOG.error('[Mutual Fund Sync] Error archiving:', error.message);
            throw error;
        }
    }

    /**
     * Insert mutual fund data using a database connection
     */
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
            LOG.error('[Mutual Fund Sync] Error inserting data:', error.message);
            throw error;
        }
    }

    /**
     * Get sync status
     */
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

