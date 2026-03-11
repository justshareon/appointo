/**
 * Excel File Sync Job
 * Scheduled job that runs every 25 minutes to:
 * 1. Read data from local Excel file (India_Stock_Market_Tracker_v1.0.xlsx)
 * 2. Archive current live_stock_data to stock_data_history
 * 3. Truncate live_stock_data
 * 4. Insert fresh data from Excel file into live_stock_data
 */
const cron = require('node-cron');
const config = require('../config/tradingConfig');
const excelFileService = require('../services/excelFileService');
const stockDataService = require('../services/stockDataService');
const featureEngineeringService = require('../services/featureEngineeringService');
const LOG = require('../utils/logger');

class ExcelFileSyncJob {
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
            LOG.warning('[Excel File Sync] Job is disabled in configuration');
            return;
        }

        // Initialize database tables first
        stockDataService.initializeTables().catch(err => {
            LOG.error('[Excel File Sync] Failed to initialize tables:', err.message);
        });

        // Schedule the job
        const cronExpression = config.schedule.cronExpression;
        LOG.info(`[Excel File Sync] Scheduling job with cron: ${cronExpression}`);

        this.cronJob = cron.schedule(cronExpression, async () => {
            await this.sync();
        }, {
            scheduled: true,
            timezone: "Asia/Kolkata" // Adjust to your timezone
        });

        LOG.success('[Excel File Sync] Job scheduled successfully');

        // Run initial sync after 5 seconds (to allow server to start)
        setTimeout(() => {
            LOG.info('[Excel File Sync] Running initial sync...');
            this.sync().catch(err => {
                LOG.error('[Excel File Sync] Initial sync failed:', err.message);
            });
        }, 5000);
    }

    /**
     * Stop the scheduled job
     */
    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            LOG.info('[Excel File Sync] Job stopped');
        }
    }

    /**
     * Manually trigger sync (for testing or manual refresh)
     */
    async sync() {
        if (this.isRunning) {
            LOG.warning('[Excel File Sync] Sync already in progress, skipping...');
            return;
        }

        this.isRunning = true;
        const syncStartTime = Date.now();

        LOG.info('[Excel File Sync] ========================================');
        LOG.info('[Excel File Sync] Starting sync job...');
        LOG.info(`[Excel File Sync] Time: ${new Date().toISOString()}`);

        try {
            // Step 1: Read all sheets by type from Excel file
            LOG.info('[Excel File Sync] Step 1: Reading all sheets from Excel file...');
            let sheetsData;
            try {
                sheetsData = await excelFileService.readAllSheetsByType();
            } catch (fileError) {
                // File doesn't exist or can't be read - log error but don't crash
                LOG.error(`[Excel File Sync] Cannot read Excel file: ${fileError.message}`);
                LOG.warning('[Excel File Sync] Sync skipped - Excel file not available');
                this.lastSyncStatus = 'error';
                this.lastSyncError = fileError.message;
                return; // Exit gracefully
            }
            
            // Combine all data types
            const allStockData = [
                ...sheetsData.gainers,
                ...sheetsData.decliners,
                ...sheetsData.actives,
                ...sheetsData.data
            ];
            
            if (allStockData.length === 0) {
                LOG.warning('[Excel File Sync] No data found in Excel file - sync skipped');
                LOG.warning(`[Excel File Sync] Gainers: ${sheetsData.gainers.length}, Decliners: ${sheetsData.decliners.length}, Actives: ${sheetsData.actives.length}, Data: ${sheetsData.data.length}`);
                this.lastSyncStatus = 'error';
                this.lastSyncError = 'No data found in Excel file';
                return; // Exit gracefully
            }

            LOG.success(`[Excel File Sync] Read data from Excel:`);
            LOG.info(`[Excel File Sync]   - Gainers: ${sheetsData.gainers.length} records`);
            LOG.info(`[Excel File Sync]   - Decliners: ${sheetsData.decliners.length} records`);
            LOG.info(`[Excel File Sync]   - Actives: ${sheetsData.actives.length} records`);
            LOG.info(`[Excel File Sync]   - Data: ${sheetsData.data.length} records`);
            LOG.info(`[Excel File Sync]   - Total: ${allStockData.length} records`);
            
            // Log sample data for validation
            if (sheetsData.gainers.length > 0) {
                LOG.info(`[Excel File Sync] Sample gainer:`, {
                    symbol: sheetsData.gainers[0].symbol,
                    company_name: sheetsData.gainers[0].company_name,
                    last_price: sheetsData.gainers[0].last_price,
                    percent_change: sheetsData.gainers[0].percent_change,
                    data_type: sheetsData.gainers[0].data_type
                });
            }
            if (sheetsData.decliners.length > 0) {
                LOG.info(`[Excel File Sync] Sample decliner:`, {
                    symbol: sheetsData.decliners[0].symbol,
                    company_name: sheetsData.decliners[0].company_name,
                    last_price: sheetsData.decliners[0].last_price,
                    percent_change: sheetsData.decliners[0].percent_change,
                    data_type: sheetsData.decliners[0].data_type
                });
            }

            // Step 3: Check database availability
            LOG.info('[Excel File Sync] Step 3: Checking database availability...');
            const pool = require('../database').getPool();
            
            if (!pool) {
                LOG.warning('[Excel File Sync] MySQL not available, using in-memory storage');
                // Use in-memory storage instead
                await stockDataService.archiveCurrentData();
                await stockDataService.truncateLiveData();
                const inserted = await stockDataService.insertLiveData(allStockData);
                
                this.lastSyncTime = new Date();
                this.lastSyncStatus = 'success';
                this.lastSyncError = null;
                
                LOG.success(`[Excel File Sync] Sync completed using in-memory storage: ${inserted} records`);
                return;
            }

            // Step 3.5: Ensure tables are initialized
            LOG.info('[Excel File Sync] Step 3.5: Ensuring database tables are initialized...');
            try {
                await stockDataService.initializeTables();
                LOG.success('[Excel File Sync] Database tables initialized/verified');
            } catch (initError) {
                LOG.error('[Excel File Sync] Failed to initialize tables:', initError.message);
                throw new Error(`Database initialization failed: ${initError.message}`);
            }

            // Step 4: Begin database transaction
            LOG.info('[Excel File Sync] Step 4: Starting database transaction...');

            const connection = await pool.getConnection();
            await connection.beginTransaction();

            try {
                // Step 5: Archive current live data
                LOG.info('[Excel File Sync] Step 5: Archiving current live data...');
                const archivedCount = await this.archiveWithConnection(connection);
                LOG.success(`[Excel File Sync] Archived ${archivedCount} records`);

                // Step 6: Truncate live table
                LOG.info('[Excel File Sync] Step 6: Truncating live_stock_data table...');
                await connection.query('TRUNCATE TABLE live_stock_data');
                LOG.success('[Excel File Sync] Live table truncated');

                // Step 7: Insert new data
                LOG.info('[Excel File Sync] Step 7: Inserting new data...');
                LOG.info(`[Excel File Sync] Preparing to insert ${allStockData.length} records`);
                
                // Log data type distribution
                const typeDistribution = {};
                allStockData.forEach(stock => {
                    const type = stock.data_type || 'unknown';
                    typeDistribution[type] = (typeDistribution[type] || 0) + 1;
                });
                LOG.info(`[Excel File Sync] Data type distribution:`, typeDistribution);
                
                // Log sample data before insertion
                if (allStockData.length > 0) {
                    LOG.info(`[Excel File Sync] Sample data to insert (first 3):`);
                    allStockData.slice(0, 3).forEach((stock, idx) => {
                        LOG.info(`[Excel File Sync]   Stock ${idx + 1}:`, {
                            symbol: stock.symbol,
                            company_name: stock.company_name,
                            last_price: stock.last_price,
                            percent_change: stock.percent_change,
                            data_type: stock.data_type,
                            volume: stock.volume,
                            market_cap: stock.market_cap
                        });
                    });
                }
                
                const insertedCount = await this.insertWithConnection(connection, allStockData);
                LOG.success(`[Excel File Sync] Inserted ${insertedCount} records`);
                
                // Verify insertion
                const [verifyResult] = await connection.query('SELECT COUNT(*) as count FROM live_stock_data');
                LOG.info(`[Excel File Sync] Verification: ${verifyResult[0].count} total records in database`);
                
                // Verify by type and show sample
                for (const [type, count] of Object.entries(typeDistribution)) {
                    const [typeResult] = await connection.query(
                        'SELECT COUNT(*) as count FROM live_stock_data WHERE data_type = ?',
                        [type]
                    );
                    LOG.info(`[Excel File Sync] Verification: ${typeResult[0].count} records with data_type='${type}' (expected: ${count})`);
                    
                    // Show sample from database
                    const [sampleRows] = await connection.query(
                        'SELECT * FROM live_stock_data WHERE data_type = ? LIMIT 3',
                        [type]
                    );
                    if (sampleRows.length > 0) {
                        LOG.info(`[Excel File Sync] Sample from database (type: ${type}):`);
                        sampleRows.forEach((row, idx) => {
                            LOG.info(`[Excel File Sync]   DB Row ${idx + 1}:`, {
                                symbol: row.symbol,
                                company_name: row.company_name,
                                last_price: row.last_price,
                                percent_change: row.percent_change,
                                data_type: row.data_type
                            });
                        });
                    }
                }

                // Step 8: Commit transaction
                await connection.commit();
                LOG.success('[Excel File Sync] Transaction committed successfully');

                // Step 9: Generate features for ML (after successful sync)
                LOG.info('[Excel File Sync] Step 9: Generating technical indicators...');
                try {
                    const featureResult = await featureEngineeringService.generateFeaturesForML();
                    if (featureResult.success) {
                        LOG.success(`[Excel File Sync] Feature engineering completed: ${featureResult.success} stocks processed`);
                    } else {
                        LOG.warning('[Excel File Sync] Feature engineering had issues:', featureResult.message || featureResult.error);
                    }
                } catch (featureError) {
                    LOG.error('[Excel File Sync] Feature engineering failed (non-critical):', featureError.message);
                    // Don't fail the sync if feature engineering fails
                }

                const syncDuration = Date.now() - syncStartTime;
                this.lastSyncTime = new Date();
                this.lastSyncStatus = 'success';
                this.lastSyncError = null;

                LOG.success(`[Excel File Sync] Sync completed successfully in ${syncDuration}ms`);
                LOG.info(`[Excel File Sync] - Archived: ${archivedCount} records`);
                LOG.info(`[Excel File Sync] - Inserted: ${insertedCount} records`);
                LOG.info('[Excel File Sync] ========================================');

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

            LOG.error('[Excel File Sync] ========================================');
            LOG.error(`[Excel File Sync] Sync failed after ${syncDuration}ms`);
            LOG.error(`[Excel File Sync] Error: ${error.message}`);
            LOG.error(`[Excel File Sync] Stack: ${error.stack ? error.stack.split('\n').slice(0, 5).join('\n') : 'No stack'}`);
            LOG.error('[Excel File Sync] ========================================');
            
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
            // Check if table exists first
            const [tables] = await connection.query(`
                SELECT COUNT(*) as count 
                FROM information_schema.tables 
                WHERE table_schema = DATABASE() 
                AND table_name = 'live_stock_data'
            `);
            
            if (tables[0].count === 0) {
                LOG.warning('[Excel File Sync] live_stock_data table does not exist, nothing to archive');
                return 0;
            }

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
                row.market_cap,
                row.pe_ratio || null,
                row.week_52_low || null,
                row.week_52_high || null,
                row.data_type || 'data'
            ]);

            const placeholders = archiveValues.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
            const query = `
                INSERT INTO stock_data_history 
                (symbol, company_name, last_price, change, percent_change, volume, market_cap, pe_ratio, week_52_low, week_52_high, data_type)
                VALUES ${placeholders}
            `;

            const flatValues = archiveValues.flat();
            await connection.query(query, flatValues);

            return liveData.length;
        } catch (error) {
            LOG.error('[Excel File Sync] Error archiving:', error.message);
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
                stock.market_cap,
                stock.pe_ratio || null,
                stock.week_52_low || null,
                stock.week_52_high || null,
                stock.data_type || 'data',
                stock.additional_data ? JSON.stringify(stock.additional_data) : null
            ]);

            const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
            const query = `
                INSERT INTO live_stock_data 
                (symbol, company_name, last_price, change, percent_change, volume, market_cap, pe_ratio, week_52_low, week_52_high, data_type, additional_data)
                VALUES ${placeholders}
                ON DUPLICATE KEY UPDATE
                    company_name = VALUES(company_name),
                    last_price = VALUES(last_price),
                    change = VALUES(change),
                    percent_change = VALUES(percent_change),
                    volume = VALUES(volume),
                    market_cap = VALUES(market_cap),
                    pe_ratio = VALUES(pe_ratio),
                    week_52_low = VALUES(week_52_low),
                    week_52_high = VALUES(week_52_high),
                    data_type = VALUES(data_type),
                    additional_data = VALUES(additional_data),
                    last_updated = CURRENT_TIMESTAMP
            `;

            const flatValues = values.flat();
            const [result] = await connection.query(query, flatValues);

            return result.affectedRows || stockData.length;
        } catch (error) {
            LOG.error('[Excel File Sync] Error inserting data:', error.message);
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
            enabled: config.schedule.enabled,
            excelFilePath: excelFileService.getExcelFilePath()
        };
    }
}

module.exports = ExcelFileSyncJob;

