/**
 * Google Sheets Sync Job
 * Scheduled job that runs every 25 minutes to:
 * 1. Fetch data from Google Sheets
 * 2. Archive current live_stock_data to stock_data_history
 * 3. Truncate live_stock_data
 * 4. Insert fresh data from Google Sheets into live_stock_data
 */
const cron = require('node-cron');
const config = require('../config/tradingConfig');
const googleSheetService = require('../services/googleSheetService');
const stockDataService = require('../services/stockDataService');
const LOG = require('../utils/logger');

class GoogleSheetSyncJob {
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
        if (!config.schedule.enabled) {
            LOG.warning('[Google Sheets Sync] Job is disabled in configuration');
            return;
        }

        // Initialize database tables first
        stockDataService.initializeTables().catch(err => {
            LOG.error('[Google Sheets Sync] Failed to initialize tables:', err.message);
        });

        // Schedule the job
        const cronExpression = config.schedule.cronExpression;
        LOG.info(`[Google Sheets Sync] Scheduling job with cron: ${cronExpression}`);

        this.cronJob = cron.schedule(cronExpression, async () => {
            await this.sync();
        }, {
            scheduled: true,
            timezone: "Asia/Kolkata" // Adjust to your timezone
        });

        LOG.success('[Google Sheets Sync] Job scheduled successfully');

        // Run initial sync after 5 seconds (to allow server to start)
        setTimeout(() => {
            LOG.info('[Google Sheets Sync] Running initial sync...');
            this.sync().catch(err => {
                LOG.error('[Google Sheets Sync] Initial sync failed:', err.message);
            });
        }, 5000);
    }

    /**
     * Stop the scheduled job
     */
    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            LOG.info('[Google Sheets Sync] Job stopped');
        }
    }

    /**
     * Manually trigger sync (for testing or manual refresh)
     */
    async sync() {
        if (this.isRunning) {
            LOG.warning('[Google Sheets Sync] Sync already in progress, skipping...');
            return;
        }

        this.isRunning = true;
        const syncStartTime = Date.now();

        LOG.info('[Google Sheets Sync] ========================================');
        LOG.info('[Google Sheets Sync] Starting sync job...');
        LOG.info(`[Google Sheets Sync] Time: ${new Date().toISOString()}`);

        try {
            // Step 1: Fetch data from Google Sheets
            LOG.info('[Google Sheets Sync] Step 1: Fetching data from Google Sheets...');
            const rows = await googleSheetService.fetchData();
            
            if (rows.length === 0) {
                throw new Error('No data received from Google Sheets');
            }

            LOG.success(`[Google Sheets Sync] Fetched ${rows.length} rows from Google Sheets`);

            // Step 2: Transform data
            LOG.info('[Google Sheets Sync] Step 2: Transforming data...');
            const stockData = googleSheetService.transformToStockData(rows);
            
            if (stockData.length === 0) {
                throw new Error('No valid stock data after transformation');
            }

            LOG.success(`[Google Sheets Sync] Transformed ${stockData.length} stock records`);

            // Step 3: Begin database transaction
            LOG.info('[Google Sheets Sync] Step 3: Starting database transaction...');
            const pool = require('../database').getPool();
            
            if (!pool) {
                throw new Error('MySQL connection not available');
            }

            const connection = await pool.getConnection();
            await connection.beginTransaction();

            try {
                // Step 4: Archive current live data
                LOG.info('[Google Sheets Sync] Step 4: Archiving current live data...');
                const archivedCount = await this.archiveWithConnection(connection);
                LOG.success(`[Google Sheets Sync] Archived ${archivedCount} records`);

                // Step 5: Truncate live table
                LOG.info('[Google Sheets Sync] Step 5: Truncating live_stock_data table...');
                await connection.query('TRUNCATE TABLE live_stock_data');
                LOG.success('[Google Sheets Sync] Live table truncated');

                // Step 6: Insert new data
                LOG.info('[Google Sheets Sync] Step 6: Inserting new data...');
                const insertedCount = await this.insertWithConnection(connection, stockData);
                LOG.success(`[Google Sheets Sync] Inserted ${insertedCount} records`);

                // Step 7: Commit transaction
                await connection.commit();
                LOG.success('[Google Sheets Sync] Transaction committed successfully');

                const syncDuration = Date.now() - syncStartTime;
                this.lastSyncTime = new Date();
                this.lastSyncStatus = 'success';
                this.lastSyncError = null;

                LOG.success(`[Google Sheets Sync] Sync completed successfully in ${syncDuration}ms`);
                LOG.info(`[Google Sheets Sync] - Archived: ${archivedCount} records`);
                LOG.info(`[Google Sheets Sync] - Inserted: ${insertedCount} records`);
                LOG.info('[Google Sheets Sync] ========================================');

            } catch (transactionError) {
                // Rollback on error
                await connection.rollback();
                throw transactionError;
            } finally {
                connection.release();
            }

        } catch (error) {
            const syncDuration = Date.now() - syncStartTime;
            this.lastSyncStatus = 'error';
            this.lastSyncError = error.message;

            LOG.error('[Google Sheets Sync] ========================================');
            LOG.error(`[Google Sheets Sync] Sync failed after ${syncDuration}ms`);
            LOG.error(`[Google Sheets Sync] Error: ${error.message}`);
            LOG.error(`[Google Sheets Sync] Stack: ${error.stack ? error.stack.split('\n').slice(0, 5).join('\n') : 'No stack'}`);
            LOG.error('[Google Sheets Sync] ========================================');
            
            // Don't throw - allow job to continue running
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Archive current data using a database connection
     */
    async archiveWithConnection(connection) {
        try {
            const [liveData] = await connection.query('SELECT * FROM live_stock_data');
            
            if (liveData.length === 0) {
                return 0;
            }

            const archiveValues = liveData.map(row => [
                row.symbol,
                row.company_name,
                row.last_price,
                row.change,
                row.percent_change,
                row.volume,
                row.market_cap
            ]);

            const placeholders = archiveValues.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
            const query = `
                INSERT INTO stock_data_history 
                (symbol, company_name, last_price, change, percent_change, volume, market_cap)
                VALUES ${placeholders}
            `;

            const flatValues = archiveValues.flat();
            await connection.query(query, flatValues);

            return liveData.length;
        } catch (error) {
            LOG.error('[Google Sheets Sync] Error archiving:', error.message);
            throw error;
        }
    }

    /**
     * Insert stock data using a database connection
     */
    async insertWithConnection(connection, stockData) {
        try {
            const values = stockData.map(stock => [
                stock.symbol,
                stock.company_name,
                stock.last_price,
                stock.change,
                stock.percent_change,
                stock.volume,
                stock.market_cap
            ]);

            const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
            const query = `
                INSERT INTO live_stock_data 
                (symbol, company_name, last_price, change, percent_change, volume, market_cap)
                VALUES ${placeholders}
            `;

            const flatValues = values.flat();
            const [result] = await connection.query(query, flatValues);

            return result.affectedRows || stockData.length;
        } catch (error) {
            LOG.error('[Google Sheets Sync] Error inserting data:', error.message);
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
            cronExpression: config.schedule.cronExpression,
            enabled: config.schedule.enabled
        };
    }
}

module.exports = GoogleSheetSyncJob;

