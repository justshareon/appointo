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

    start() {
        if (!config.schedule.enabled) {
            LOG.warning('[Excel File Sync] Job is disabled in configuration');
            return;
        }

        stockDataService.initializeTables().catch(err => {
            LOG.error('[Excel File Sync] Failed to initialize tables:', err.message);
        });

        const cronExpression = config.schedule.cronExpression;
        LOG.info(`[Excel File Sync] Scheduling job with cron: ${cronExpression}`);

        this.cronJob = cron.schedule(cronExpression, async () => {
            await this.sync();
        }, {
            scheduled: true,
            timezone: "Asia/Kolkata"
        });

        LOG.success('[Excel File Sync] Job scheduled successfully');

        setTimeout(() => {
            LOG.info('[Excel File Sync] Running initial sync...');
            this.sync(true).catch(err => {
                LOG.error('[Excel File Sync] Initial sync failed:', err.message);
            });
        }, 5000);
    }

    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            LOG.info('[Excel File Sync] Job stopped');
        }
    }

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
                    LOG.info('[Excel File Sync] No data exists in live_stock_data - need to sync');
                    return false;
                }
                
                const lastUpdateDate = new Date(lastUpdate);
                const today = new Date();
                
                const sameDay = lastUpdateDate.getDate() === today.getDate() &&
                                lastUpdateDate.getMonth() === today.getMonth() &&
                                lastUpdateDate.getFullYear() === today.getFullYear();
                
                if (sameDay) {
                    LOG.info(`[Excel File Sync] Data already exists for today (${count} records) - skipping sync`);
                    return true;
                } else {
                    LOG.info(`[Excel File Sync] Data from ${lastUpdateDate.toDateString()} needs refresh`);
                    return false;
                }
            } finally {
                connection.release();
            }
        } catch (err) {
            LOG.warning('[Excel File Sync] Error checking for existing data:', err.message);
            return false;
        }
    }

    async sync(forceSync = false) {
        if (this.isRunning) {
            LOG.warning('[Excel File Sync] Sync already in progress, skipping...');
            return;
        }

        this.isRunning = true;
        const syncStartTime = Date.now();

        LOG.info('[Excel File Sync] ========================================');
        LOG.info(`[Excel File Sync] Starting sync job (force: ${forceSync})...`);
        LOG.info(`[Excel File Sync] Time: ${new Date().toISOString()}`);

        try {
            if (!forceSync) {
                const dataExistsForToday = await this.checkIfDataExistsForToday();
                if (dataExistsForToday) {
                    LOG.info('[Excel File Sync] Data is fresh - skipping sync');
                    this.isRunning = false;
                    this.lastSyncTime = new Date();
                    this.lastSyncStatus = 'skipped';
                    LOG.info('[Excel File Sync] ========================================');
                    return;
                }
            }

            LOG.info('[Excel File Sync] Proceeding with fresh sync...');

            let sheetsData;
            try {
                sheetsData = await excelFileService.readAllSheetsByType();
            } catch (fileError) {
                LOG.error(`[Excel File Sync] Excel read failed: ${fileError.message}`);
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
            
            if (allStockData.length === 0) {
                LOG.warning('[Excel File Sync] No data found in Excel file');
                this.lastSyncStatus = 'error';
                this.lastSyncError = 'No data found in Excel file';
                return;
            }

            LOG.success(`[Excel File Sync] Read ${allStockData.length} records from Excel`);

            // Clean data to prevent database errors
            const cleanedStockData = allStockData.map(stock => ({
                symbol: (stock.symbol || '').substring(0, 20),
                company_name: (stock.company_name || '').substring(0, 255),
                last_price: stock.last_price || 0,
                change: stock.change || 0,
                percent_change: stock.percent_change || 0,
                volume: stock.volume || 0,
                market_cap: stock.market_cap || null,
                pe_ratio: stock.pe_ratio || null,
                week_52_low: stock.week_52_low || null,
                week_52_high: stock.week_52_high || null,
                data_type: stock.data_type || 'data',
                additional_data: stock.additional_data || null
            }));

            const pool = require('../database').getPool();
            
            if (!pool) {
                LOG.warning('[Excel File Sync] Using in-memory storage');
                await stockDataService.archiveCurrentData();
                await stockDataService.truncateLiveData();
                const inserted = await stockDataService.insertLiveData(cleanedStockData);
                this.lastSyncTime = new Date();
                this.lastSyncStatus = 'success';
                LOG.success(`[Excel File Sync] In-memory sync: ${inserted} records`);
                return;
            }

            try {
                await stockDataService.initializeTables();
            } catch (initError) {
                throw new Error(`DB init failed: ${initError.message}`);
            }

            const connection = await pool.getConnection();
            await connection.beginTransaction();

            try {
                const archivedCount = await this.archiveWithConnection(connection);
                await connection.query('TRUNCATE TABLE live_stock_data');
                const insertedCount = await this.insertWithConnection(connection, cleanedStockData);
                const [verifyResult] = await connection.query('SELECT COUNT(*) as count FROM live_stock_data');
                await connection.commit();

                try {
                    const featureResult = await featureEngineeringService.generateFeaturesForML();
                    if (!featureResult.success) {
                        LOG.warning('[Excel File Sync] Feature issues:', featureResult.message);
                    }
                } catch (featureError) {
                    // Non-critical
                }

                const syncDuration = Date.now() - syncStartTime;
                this.lastSyncTime = new Date();
                this.lastSyncStatus = 'success';

                LOG.success(`[Excel File Sync] Done in ${syncDuration}ms | Archived: ${archivedCount} | Inserted: ${insertedCount} | DB: ${verifyResult[0].count}`);
                LOG.info('[Excel File Sync] ========================================');

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
            LOG.error(`[Excel File Sync] Failed after ${syncDuration}ms: ${error.message}`);
            LOG.info('[Excel File Sync] ========================================');
        } finally {
            this.isRunning = false;
        }
    }

    async archiveWithConnection(connection) {
        try {
            const [tables] = await connection.query(`
                SELECT COUNT(*) as count 
                FROM information_schema.tables 
                WHERE table_schema = DATABASE() 
                AND table_name = 'live_stock_data'
            `);
            
            if (tables[0].count === 0) {
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
            LOG.error('[Excel File Sync] Archive error:', error.message);
            throw error;
        }
    }

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
                stock.pe_ratio,
                stock.week_52_low,
                stock.week_52_high,
                stock.data_type,
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
            LOG.error(`[Excel File Sync] Insert error: ${error.message}`);
            throw error;
        }
    }

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