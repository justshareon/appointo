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
            LOG.warning('[Excel File Sync] Job is disabled');
            return;
        }

        stockDataService.initializeTables().catch(err => {
            LOG.error('[Excel File Sync] DB init failed:', err.message);
        });

        const cronExpression = config.schedule.cronExpression;
        LOG.info(`[Excel File Sync] Scheduled with cron: ${cronExpression}`);

        this.cronJob = cron.schedule(cronExpression, async () => {
            await this.sync();
        }, {
            scheduled: true,
            timezone: "Asia/Kolkata"
        });

        LOG.success('[Excel File Sync] Job scheduled');

        // Run initial sync immediately (force first load)
        setTimeout(() => {
            this.sync(true).catch(err => {
                LOG.error('[Excel File Sync] Initial sync failed:', err.message);
            });
        }, 5000);
    }

    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            LOG.info('[Excel File Sync] Stopped');
        }
    }

    async checkIfDataExistsForToday() {
        try {
            const pool = require('../database').getPool();
            if (!pool) return false;

            const connection = await pool.getConnection();
            try {
                const result = await connection.query(`
                    SELECT COUNT(*) as count, MAX(last_updated) as lastUpdate
                    FROM live_stock_data
                `);
                
                const connection2 = Array.isArray(result) ? result[0] : result;
                const count = connection2?.count || 0;
                const lastUpdate = connection2?.lastUpdate;
                
                if (count === 0) return false;
                
                const lastUpdateDate = new Date(lastUpdate);
                const today = new Date();
                
                const sameDay = lastUpdateDate.getDate() === today.getDate() &&
                                lastUpdateDate.getMonth() === today.getMonth() &&
                                lastUpdateDate.getFullYear() === today.getFullYear();
                
                return sameDay;
            } finally {
                connection.release();
            }
        } catch (err) {
            return false;
        }
    }

    async sync(forceSync = false) {
        if (this.isRunning) {
            LOG.warning('[Excel File Sync] Already running');
            return;
        }

        this.isRunning = true;
        const syncStartTime = Date.now();

        try {
            // Skip check if forced (first time)
            if (!forceSync) {
                const dataExists = await this.checkIfDataExistsForToday();
                if (dataExists) {
                    LOG.info('[Excel File Sync] Data exists - skipping');
                    this.isRunning = false;
                    return;
                }
            }

            // Read Excel
            let sheetsData;
            try {
                sheetsData = await excelFileService.readAllSheetsByType();
            } catch (fileError) {
                LOG.error(`[Excel File Sync] Excel read failed: ${fileError.message}`);
                this.lastSyncStatus = 'error';
                this.lastSyncError = fileError.message;
                this.isRunning = false;
                return;
            }
            
            const allStockData = [
                ...sheetsData.gainers,
                ...sheetsData.decliners,
                ...sheetsData.actives,
                ...sheetsData.data
            ];
            
            if (allStockData.length === 0) {
                LOG.warning('[Excel File Sync] No data in Excel');
                this.lastSyncStatus = 'error';
                this.lastSyncError = 'No data found';
                this.isRunning = false;
                return;
            }

            // Clean data to prevent "Data too long" errors
            const cleanedData = allStockData.map(stock => ({
                ...stock,
                symbol: (stock.symbol || '').substring(0, 20),
                company_name: (stock.company_name || '').substring(0, 255)
            }));

            const pool = require('../database').getPool();
            
            if (!pool) {
                await stockDataService.archiveCurrentData();
                await stockDataService.truncateLiveData();
                const inserted = await stockDataService.insertLiveData(cleanedData);
                this.lastSyncTime = new Date();
                this.lastSyncStatus = 'success';
                LOG.success(`[Excel File Sync] In-memory: ${inserted} records in ${Date.now() - syncStartTime}ms`);
                this.isRunning = false;
                return;
            }

            const connection = await pool.getConnection();
            await connection.beginTransaction();

            try {
                const archivedCount = await this.archiveWithConnection(connection);
                await connection.query('TRUNCATE TABLE live_stock_data');
                const insertedCount = await this.insertWithConnection(connection, cleanedData);
                await connection.commit();

                const syncDuration = Date.now() - syncStartTime;
                this.lastSyncTime = new Date();
                this.lastSyncStatus = 'success';

                // SINGLE LINE LOG - All info in one line
                LOG.success(`[Excel File Sync] Completed in ${syncDuration}ms | Archived: ${archivedCount} | Inserted: ${insertedCount}`);

                // Generate features (non-critical)
                try {
                    await featureEngineeringService.generateFeaturesForML();
                } catch (featureError) {
                    // Silent fail
                }

            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }

        } catch (error) {
            this.lastSyncStatus = 'error';
            this.lastSyncError = error.message;
            LOG.error(`[Excel File Sync] Failed after ${Date.now() - syncStartTime}ms: ${error.message}`);
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
            
            if (tables[0].count === 0) return 0;

            const [liveData] = await connection.query('SELECT * FROM live_stock_data');
            if (liveData.length === 0) return 0;

            const archiveValues = liveData.map(row => [
                row.symbol, row.company_name, row.last_price, row.change,
                row.percent_change, row.volume, row.market_cap,
                row.pe_ratio || null, row.week_52_low || null,
                row.week_52_high || null, row.data_type || 'data'
            ]);

            const placeholders = archiveValues.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
            const query = `
                INSERT INTO stock_data_history 
                (symbol, company_name, last_price, change, percent_change, volume, market_cap, pe_ratio, week_52_low, week_52_high, data_type)
                VALUES ${placeholders}
            `;

            await connection.query(query, archiveValues.flat());
            return liveData.length;
        } catch (error) {
            throw error;
        }
    }

    async insertWithConnection(connection, stockData) {
        try {
            const values = stockData.map(stock => [
                stock.symbol, stock.company_name, stock.last_price,
                stock.change || 0, stock.percent_change || 0, stock.volume || 0,
                stock.market_cap || null, stock.pe_ratio || null,
                stock.week_52_low || null, stock.week_52_high || null,
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

            const [result] = await connection.query(query, values.flat());
            return result.affectedRows || stockData.length;
        } catch (error) {
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