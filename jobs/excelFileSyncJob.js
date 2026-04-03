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
const fs = require('fs');

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
        LOG.info('[Excel File Sync] Job starting...');
        
        if (!config.schedule.enabled) {
            LOG.warning('[Excel File Sync] Job is disabled in configuration');
            return;
        }

        // Log configuration on startup
        LOG.info('[Excel File Sync] Config:', {
            cron: config.schedule.cronExpression,
            enabled: config.schedule.enabled,
            excelPath: excelFileService.getExcelFilePath ? excelFileService.getExcelFilePath() : 'unknown'
        });

        // Check if Excel file exists on startup
        try {
            const excelPath = excelFileService.getExcelFilePath ? excelFileService.getExcelFilePath() : null;
            if (excelPath && fs.existsSync(excelPath)) {
                const stats = fs.statSync(excelPath);
                LOG.success(`[Excel File Sync] Excel file found: ${excelPath} (${(stats.size/1024).toFixed(2)} KB)`);
            } else {
                LOG.error(`[Excel File Sync] Excel file NOT FOUND at: ${excelPath || 'path not configured'}`);
            }
        } catch (err) {
            LOG.error('[Excel File Sync] Error checking Excel file:', err.message);
        }

        // Initialize database tables first
        stockDataService.initializeTables().catch(err => {
            LOG.error('[Excel File Sync] Failed to initialize tables:', err.message);
        });

        // Schedule the job
        const cronExpression = config.schedule.cronExpression;
        LOG.info(`[Excel File Sync] Scheduling job with cron: ${cronExpression}`);

        this.cronJob = cron.schedule(cronExpression, async () => {
            LOG.info(`[Excel File Sync] Cron triggered at ${new Date().toISOString()}`);
            await this.sync();
        }, {
            scheduled: true,
            timezone: "Asia/Kolkata"
        });

        LOG.success('[Excel File Sync] Job scheduled successfully');

        // Run initial sync after 5 seconds
        setTimeout(() => {
            LOG.info('[Excel File Sync] Running initial sync (first-time load check)...');
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
     * Check if data already exists for the current date
     */
    async checkIfDataExistsForToday() {
        try {
            const pool = require('../database').getPool();
            if (!pool) {
                LOG.warning('[Excel File Sync] Database not available, cannot check for existing data');
                return false;
            }

            const connection = await pool.getConnection();
            try {
                const result = await connection.query(`
                    SELECT COUNT(*) as count, MAX(last_updated) as lastUpdate
                    FROM live_stock_data
                `);
                
                const connection2 = Array.isArray(result) ? result[0] : result;
                const count = connection2?.count || 0;
                const lastUpdate = connection2?.lastUpdate;
                
                if (count === 0) {
                    LOG.info('[Excel File Sync] No data exists in live_stock_data - first time sync needed');
                    return false;
                }
                
                const lastUpdateDate = new Date(lastUpdate);
                const today = new Date();
                
                const sameDay = lastUpdateDate.getDate() === today.getDate() &&
                                lastUpdateDate.getMonth() === today.getMonth() &&
                                lastUpdateDate.getFullYear() === today.getFullYear();
                
                if (sameDay) {
                    LOG.info(`[Excel File Sync] Data already exists for today (${count} records from ${lastUpdate}) - skipping sync`);
                    return true;
                } else {
                    LOG.info(`[Excel File Sync] Data needs refresh (last sync: ${lastUpdateDate.toDateString()}, today: ${today.toDateString()})`);
                    return false;
                }
            } finally {
                connection.release();
            }
        } catch (err) {
            LOG.warning('[Excel File Sync] Error checking for existing data:', err.message);
            LOG.warning('[Excel File Sync] Proceeding with sync anyway');
            return false;
        }
    }

    /**
     * Manually trigger sync
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
            // SMART SYNC CHECK
            const dataExistsForToday = await this.checkIfDataExistsForToday();
            if (dataExistsForToday) {
                LOG.info('[Excel File Sync] Data is fresh for today - archiving and exiting');
                
                try {
                    const pool = require('../database').getPool();
                    if (pool) {
                        const connection = await pool.getConnection();
                        try {
                            const [result] = await connection.query(`
                                DELETE FROM stock_data_history 
                                WHERE archived_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
                            `);
                            if (result.affectedRows > 0) {
                                LOG.info(`[Excel File Sync] Cleaned up ${result.affectedRows} old history records`);
                            }
                        } finally {
                            connection.release();
                        }
                    }
                } catch (cleanupErr) {
                    LOG.warning('[Excel File Sync] History cleanup skipped:', cleanupErr.message);
                }
                
                this.isRunning = false;
                this.lastSyncTime = new Date();
                this.lastSyncStatus = 'skipped';
                this.lastSyncError = null;
                LOG.success('[Excel File Sync] Sync skipped - data is up to date');
                LOG.info('[Excel File Sync] ========================================');
                return;
            }

            LOG.info('[Excel File Sync] Proceeding with fresh sync...');

            // Step 1: Read Excel file
            LOG.info('[Excel File Sync] Step 1: Reading Excel file...');
            let sheetsData;
            try {
                sheetsData = await excelFileService.readAllSheetsByType();
                LOG.success('[Excel File Sync] Excel file read successfully');
            } catch (fileError) {
                LOG.error(`[Excel File Sync] Cannot read Excel file: ${fileError.message}`);
                LOG.error(`[Excel File Sync] Make sure file exists at: ${excelFileService.getExcelFilePath ? excelFileService.getExcelFilePath() : 'unknown path'}`);
                this.lastSyncStatus = 'error';
                this.lastSyncError = fileError.message;
                return;
            }
            
            const allStockData = [
                ...sheetsData.gainers,
                ...sheetsData.decliners,
                ...sheetsData.actives,
                ...sheetsData.data
            ];
            
            LOG.info(`[Excel File Sync] Excel data summary: Gainers:${sheetsData.gainers.length} Decliners:${sheetsData.decliners.length} Actives:${sheetsData.actives.length} Data:${sheetsData.data.length} Total:${allStockData.length}`);
            
            if (allStockData.length === 0) {
                LOG.warning('[Excel File Sync] No data found in Excel file - sync skipped');
                LOG.warning(`[Excel File Sync] Breakdown: Gainers: ${sheetsData.gainers.length}, Decliners: ${sheetsData.decliners.length}, Actives: ${sheetsData.actives.length}, Data: ${sheetsData.data.length}`);
                this.lastSyncStatus = 'error';
                this.lastSyncError = 'No data found in Excel file';
                return;
            }
            
            // Log sample for debugging
            if (allStockData.length > 0) {
                LOG.info(`[Excel File Sync] Sample record: ${allStockData[0].symbol} | ${allStockData[0].company_name} | ${allStockData[0].last_price} | ${allStockData[0].percent_change}%`);
            }

            // Step 3: Check database
            LOG.info('[Excel File Sync] Step 3: Checking database availability...');
            const pool = require('../database').getPool();
            
            if (!pool) {
                LOG.warning('[Excel File Sync] MySQL not available, using in-memory storage');
                await stockDataService.archiveCurrentData();
                await stockDataService.truncateLiveData();
                const inserted = await stockDataService.insertLiveData(allStockData);
                
                this.lastSyncTime = new Date();
                this.lastSyncStatus = 'success';
                this.lastSyncError = null;
                
                LOG.success(`[Excel File Sync] Sync completed using in-memory storage: ${inserted} records`);
                LOG.info('[Excel File Sync] ========================================');
                return;
            }

            // Step 3.5: Ensure tables
            LOG.info('[Excel File Sync] Step 3.5: Ensuring database tables...');
            try {
                await stockDataService.initializeTables();
                LOG.success('[Excel File Sync] Database tables verified');
            } catch (initError) {
                LOG.error('[Excel File Sync] Failed to initialize tables:', initError.message);
                throw new Error(`Database initialization failed: ${initError.message}`);
            }

            // Step 4: Begin transaction
            LOG.info('[Excel File Sync] Step 4: Starting database transaction...');
            const connection = await pool.getConnection();
            await connection.beginTransaction();

            try {
                // Step 5: Archive
                LOG.info('[Excel File Sync] Step 5: Archiving current data...');
                const archivedCount = await this.archiveWithConnection(connection);
                LOG.success(`[Excel File Sync] Archived ${archivedCount} records`);

                // Step 6: Truncate
                LOG.info('[Excel File Sync] Step 6: Truncating live_stock_data...');
                await connection.query('TRUNCATE TABLE live_stock_data');
                LOG.success('[Excel File Sync] Live table truncated');

                // Step 7: Insert
                LOG.info(`[Excel File Sync] Step 7: Inserting ${allStockData.length} records...`);
                const insertedCount = await this.insertWithConnection(connection, allStockData);
                LOG.success(`[Excel File Sync] Inserted ${insertedCount} records`);
                
                // Verify
                const [verifyResult] = await connection.query('SELECT COUNT(*) as count FROM live_stock_data');
                LOG.info(`[Excel File Sync] Verification: ${verifyResult[0].count} total records in database (expected: ${allStockData.length})`);
                
                if (verifyResult[0].count !== allStockData.length) {
                    LOG.warning(`[Excel File Sync] Record count mismatch! Expected: ${allStockData.length}, Got: ${verifyResult[0].count}`);
                }

                // Step 8: Commit
                await connection.commit();
                LOG.success('[Excel File Sync] Transaction committed successfully');

                // Step 9: Generate features
                LOG.info('[Excel File Sync] Step 9: Generating technical indicators...');
                try {
                    const featureResult = await featureEngineeringService.generateFeaturesForML();
                    if (featureResult.success) {
                        LOG.success(`[Excel File Sync] Feature engineering completed: ${featureResult.success} stocks`);
                    } else {
                        LOG.warning('[Excel File Sync] Feature engineering issues:', featureResult.message);
                    }
                } catch (featureError) {
                    LOG.error('[Excel File Sync] Feature engineering failed (non-critical):', featureError.message);
                }

                const syncDuration = Date.now() - syncStartTime;
                this.lastSyncTime = new Date();
                this.lastSyncStatus = 'success';
                this.lastSyncError = null;

                LOG.success(`[Excel File Sync] Sync completed successfully in ${syncDuration}ms`);
                LOG.info(`[Excel File Sync] Summary: Archived ${archivedCount}, Inserted ${insertedCount}`);
                LOG.info('[Excel File Sync] ========================================');

            } catch (transactionError) {
                await connection.rollback();
                LOG.error('[Excel File Sync] Transaction failed, rolling back:', transactionError.message);
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
            LOG.error(`[Excel File Sync] Error type: ${error.code || 'unknown'}`);
            
            // Special error logging for common issues
            if (error.code === 'ENOENT') {
                LOG.error('[Excel File Sync] File not found error - check Excel file path');
            } else if (error.code === 'ECONNREFUSED') {
                LOG.error('[Excel File Sync] Database connection refused - check MySQL is running');
            } else if (error.message.includes('Duplicate entry')) {
                LOG.error('[Excel File Sync] Duplicate key error - check primary key constraints');
            }
            
            LOG.error('[Excel File Sync] ========================================');
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Archive current data using a database connection
     */
    async archiveWithConnection(connection) {
        try {
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
                (symbol, company_name, last_price, \`change\`, percent_change, volume, market_cap, pe_ratio, week_52_low, week_52_high, data_type, additional_data)
                VALUES ${placeholders}
                ON DUPLICATE KEY UPDATE
                    company_name = VALUES(company_name),
                    last_price = VALUES(last_price),
                    \`change\` = VALUES(\`change\`),
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