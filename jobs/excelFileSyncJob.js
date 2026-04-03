/**
 * Excel File Sync Job
 * Scheduled job that runs every 35 minutes to:
 * 1. Read data directly from Google Sheets using .env credentials
 * 2. Archive current live_stock_data to stock_data_history
 * 3. Truncate live_stock_data
 * 4. Insert fresh data from Google Sheets into live_stock_data
 */
const cron = require('node-cron');
const config = require('../config/tradingConfig');
const excelFileService = require('../services/excelFileService');
const stockDataService = require('../services/stockDataService');
const featureEngineeringService = require('../services/featureEngineeringService');
const LOG = require('../utils/logger');
const { google } = require('googleapis');
require('dotenv').config();

class ExcelFileSyncJob {
    constructor() {
        this.isRunning = false;
        this.lastSyncTime = null;
        this.lastSyncStatus = null;
        this.lastSyncError = null;
        this.cronJob = null;
        
        // Google Sheets configuration from .env
        this.SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
        this.SHEET_NAMES = (process.env.GOOGLE_SHEET_NAMES || 'Gainers,Decliners,Actives,Data').split(',');
        this.CRON_EXPRESSION = process.env.SYNC_CRON || '*/35 * * * *';
    }

    /**
     * Get Google Auth credentials from .env
     */
    getGoogleAuth() {
        try {
            // Check if required credentials exist in .env
            if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
                LOG.error('[Excel File Sync] Missing Google credentials in .env');
                return null;
            }

            // Format private key (handle newlines)
            let privateKey = process.env.GOOGLE_PRIVATE_KEY;
            if (privateKey) {
                // Remove quotes if present
                privateKey = privateKey.replace(/^"|"$/g, '');
                // Replace literal \n with actual newlines
                privateKey = privateKey.replace(/\\n/g, '\n');
            }

            const auth = new google.auth.JWT(
                process.env.GOOGLE_CLIENT_EMAIL,
                null,
                privateKey,
                ['https://www.googleapis.com/auth/spreadsheets.readonly']
            );

            LOG.success('[Excel File Sync] Google Auth configured from .env');
            return auth;
        } catch (error) {
            LOG.error('[Excel File Sync] Failed to create Google Auth:', error.message);
            return null;
        }
    }

    start() {
        LOG.info('[Excel File Sync] ========================================');
        LOG.info('[Excel File Sync] Starting job initialization...');
        
        if (!config.schedule.enabled) {
            LOG.warning('[Excel File Sync] Job is disabled in configuration');
            return;
        }

        // Validate Google Sheets configuration
        if (!this.SPREADSHEET_ID) {
            LOG.error('[Excel File Sync] ❌ GOOGLE_SHEETS_ID not found in .env');
            return;
        }

        if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
            LOG.error('[Excel File Sync] ❌ Google credentials missing in .env');
            LOG.info('[Excel File Sync] Please add GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY to .env');
            return;
        }

        LOG.info('[Excel File Sync] Configuration loaded from .env:');
        LOG.info(`  - Cron: ${this.CRON_EXPRESSION}`);
        LOG.info(`  - Google Sheets ID: ${this.SPREADSHEET_ID}`);
        LOG.info(`  - Sheets to read: ${this.SHEET_NAMES.join(', ')}`);
        LOG.info(`  - Service Account Email: ${process.env.GOOGLE_CLIENT_EMAIL}`);

        stockDataService.initializeTables().catch(err => {
            LOG.error('[Excel File Sync] DB init failed:', err.message);
        });

        LOG.info(`[Excel File Sync] Scheduling job with cron: ${this.CRON_EXPRESSION}`);

        this.cronJob = cron.schedule(this.CRON_EXPRESSION, async () => {
            LOG.info(`[Excel File Sync] Cron triggered at ${new Date().toISOString()}`);
            await this.sync();
        }, {
            scheduled: true,
            timezone: process.env.SYNC_TIMEZONE || "Asia/Kolkata"
        });

        LOG.success('[Excel File Sync] Job scheduled successfully');

        // Run initial sync immediately
        LOG.info('[Excel File Sync] Running initial sync in 5 seconds...');
        setTimeout(() => {
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

    /**
     * Read data directly from Google Sheets using .env credentials
     */
    async readFromGoogleSheets() {
        LOG.info('[Excel File Sync] Reading data from Google Sheets...');
        
        try {
            // Get auth from .env
            const auth = this.getGoogleAuth();
            if (!auth) {
                throw new Error('Failed to create Google Auth from .env');
            }

            // Authorize
            LOG.info('[Excel File Sync] Authorizing with Google...');
            await auth.authorize();
            LOG.success('[Excel File Sync] Authorization successful');

            const sheets = google.sheets({ version: 'v4', auth });

            const allData = {
                gainers: [],
                decliners: [],
                actives: [],
                data: []
            };

            let totalRecords = 0;

            // Read each sheet/tab
            for (const sheetName of this.SHEET_NAMES) {
                try {
                    LOG.info(`[Excel File Sync] Reading sheet: "${sheetName}"`);
                    
                    const response = await sheets.spreadsheets.values.get({
                        spreadsheetId: this.SPREADSHEET_ID,
                        range: `${sheetName}!A1:Z`,
                    });

                    const rows = response.data.values;
                    if (!rows || rows.length === 0) {
                        LOG.warning(`[Excel File Sync] Sheet "${sheetName}" is empty`);
                        continue;
                    }

                    LOG.info(`[Excel File Sync] Sheet "${sheetName}" has ${rows.length} rows`);

                    // Assume first row is headers
                    const headers = rows[0];
                    const dataRows = rows.slice(1);

                    // Map data to objects
                    const mappedData = dataRows.map(row => {
                        const obj = {};
                        headers.forEach((header, index) => {
                            const key = header.toLowerCase().replace(/\s/g, '_').replace(/[()]/g, '');
                            obj[key] = row[index] || null;
                        });
                        return obj;
                    });

                    // Map to appropriate array based on sheet name
                    const sheetKey = sheetName.toLowerCase();
                    if (sheetKey === 'gainers') allData.gainers = mappedData;
                    else if (sheetKey === 'decliners') allData.decliners = mappedData;
                    else if (sheetKey === 'actives') allData.actives = mappedData;
                    else allData.data.push(...mappedData);

                    LOG.success(`[Excel File Sync] Read ${mappedData.length} records from "${sheetName}"`);
                    totalRecords += mappedData.length;

                } catch (sheetError) {
                    LOG.error(`[Excel File Sync] Failed to read sheet "${sheetName}": ${sheetError.message}`);
                }
            }

            LOG.success(`[Excel File Sync] Total records from Google Sheets: ${totalRecords}`);
            return allData;

        } catch (error) {
            LOG.error('[Excel File Sync] Google Sheets read failed:', error.message);
            throw error;
        }
    }

    /**
     * Fallback: Read from local Excel file if Google Sheets fails
     */
    async readFromLocalExcel() {
        LOG.warning('[Excel File Sync] Falling back to local Excel file');
        try {
            const data = await excelFileService.readAllSheetsByType();
            LOG.success('[Excel File Sync] Local Excel fallback successful');
            return data;
        } catch (error) {
            LOG.error('[Excel File Sync] Local Excel fallback failed:', error.message);
            throw error;
        }
    }

    async wasSyncedInCurrentMinute() {
        try {
            const pool = require('../database').getPool();
            if (!pool) return false;

            const connection = await pool.getConnection();
            try {
                const [result] = await connection.query(`
                    SELECT MAX(last_updated) as lastSyncTime 
                    FROM live_stock_data
                `);
                
                const lastSyncTime = result[0]?.lastSyncTime;
                if (!lastSyncTime) return false;
                
                const lastSyncDate = new Date(lastSyncTime);
                const now = new Date();
                
                const sameMinute = lastSyncDate.getFullYear() === now.getFullYear() &&
                                   lastSyncDate.getMonth() === now.getMonth() &&
                                   lastSyncDate.getDate() === now.getDate() &&
                                   lastSyncDate.getHours() === now.getHours() &&
                                   lastSyncDate.getMinutes() === now.getMinutes();
                
                return sameMinute;
            } finally {
                connection.release();
            }
        } catch (err) {
            return false;
        }
    }

    async checkIfDataExistsForToday() {
        try {
            const pool = require('../database').getPool();
            if (!pool) return false;

            const connection = await pool.getConnection();
            try {
                const [result] = await connection.query(`
                    SELECT COUNT(*) as count, MAX(last_updated) as lastUpdate
                    FROM live_stock_data
                `);
                
                const count = result?.count || 0;
                const lastUpdate = result?.lastUpdate;
                
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
        LOG.info(`[Excel File Sync] Starting sync (force: ${forceSync})`);

        try {
            if (!forceSync) {
                const syncedInCurrentMinute = await this.wasSyncedInCurrentMinute();
                if (syncedInCurrentMinute) {
                    LOG.info('[Excel File Sync] Skipped - already synced in current minute');
                    this.isRunning = false;
                    return;
                }
            }

            if (!forceSync) {
                const dataExists = await this.checkIfDataExistsForToday();
                if (dataExists) {
                    LOG.info('[Excel File Sync] Skipped - data exists for today');
                    this.isRunning = false;
                    return;
                }
            }

            // Read data from Google Sheets (with fallback to local file)
            let sheetsData;
            try {
                sheetsData = await this.readFromGoogleSheets();
            } catch (googleError) {
                LOG.warning(`[Excel File Sync] Google Sheets failed: ${googleError.message}`);
                sheetsData = await this.readFromLocalExcel();
            }
            
            const allStockData = [
                ...sheetsData.gainers,
                ...sheetsData.decliners,
                ...sheetsData.actives,
                ...sheetsData.data
            ];
            
            if (allStockData.length === 0) {
                LOG.warning('[Excel File Sync] No data found');
                this.lastSyncStatus = 'error';
                this.lastSyncError = 'No data found';
                this.isRunning = false;
                return;
            }

            // Clean data
            const cleanedData = allStockData.map(stock => ({
                symbol: (stock.symbol || stock.Symbol || '').toString().substring(0, 20),
                company_name: (stock.company_name || stock.Company_Name || '').toString().substring(0, 255),
                last_price: parseFloat(stock.last_price || stock.Last_Price || 0),
                change: parseFloat(stock.change || stock.Change || 0),
                percent_change: parseFloat(stock.percent_change || stock.Percent_Change || 0),
                volume: parseFloat(stock.volume || stock.Volume || 0),
                market_cap: parseFloat(stock.market_cap || stock.Market_Cap || null),
                pe_ratio: parseFloat(stock.pe_ratio || stock.PE_Ratio || null),
                week_52_low: parseFloat(stock.week_52_low || stock.Week_52_Low || null),
                week_52_high: parseFloat(stock.week_52_high || stock.Week_52_High || null),
                data_type: (stock.data_type || stock.Data_Type || 'data').toString().substring(0, 50),
                additional_data: null
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

                LOG.success(`[Excel File Sync] Done: ${insertedCount} records | ${syncDuration}ms | Archived: ${archivedCount}`);

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
            LOG.error(`[Excel File Sync] Failed: ${error.message}`);
        } finally {
            this.isRunning = false;
        }
    }

    async archiveWithConnection(connection) {
        try {
            const [liveData] = await connection.query('SELECT * FROM live_stock_data');
            if (liveData.length === 0) return 0;

            const archiveValues = liveData.map(row => [
                row.symbol, row.company_name, row.last_price, row.change,
                row.percent_change, row.volume, row.market_cap,
                row.pe_ratio || null, row.week_52_low || null,
                row.week_52_high || null, row.data_type || 'data'
            ]);

            const placeholders = archiveValues.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
            await connection.query(`
                INSERT INTO stock_data_history 
                (symbol, company_name, last_price, change, percent_change, volume, market_cap, pe_ratio, week_52_low, week_52_high, data_type)
                VALUES ${placeholders}
            `, archiveValues.flat());
            
            return liveData.length;
        } catch (error) {
            throw error;
        }
    }

    async insertWithConnection(connection, stockData) {
        try {
            const values = stockData.map(stock => [
                stock.symbol, stock.company_name, stock.last_price,
                stock.change, stock.percent_change, stock.volume,
                stock.market_cap, stock.pe_ratio,
                stock.week_52_low, stock.week_52_high,
                stock.data_type, stock.additional_data
            ]);

            const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
            const [result] = await connection.query(`
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
            `, values.flat());
            
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
            cronExpression: this.CRON_EXPRESSION,
            enabled: config.schedule.enabled,
            googleSheetsId: this.SPREADSHEET_ID,
            serviceAccount: process.env.GOOGLE_CLIENT_EMAIL
        };
    }
}

module.exports = ExcelFileSyncJob;