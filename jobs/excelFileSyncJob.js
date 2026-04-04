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
        this.initialized = false;
        this.app = null;
        
        // Google Sheets configuration from .env
        this.SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
        this.SHEET_NAMES = (process.env.GOOGLE_SHEET_NAMES || 'Gainers,Decliners,Actives,Data').split(',');
        this.CRON_EXPRESSION = process.env.SYNC_CRON || '*/35 * * * *';
        
        LOG.info('[Excel File Sync] Constructor called');
        LOG.info(`[Excel File Sync] SPREADSHEET_ID: ${this.SPREADSHEET_ID ? 'SET' : 'MISSING'}`);
        LOG.info(`[Excel File Sync] CRON_EXPRESSION: ${this.CRON_EXPRESSION}`);
    }

    /**
     * Register endpoints with Express app
     */
    registerEndpoints(app) {
        this.app = app;
        LOG.info('[Excel File Sync] Registering API endpoints...');
        
        // Manual trigger endpoint
        app.get('/g/refresh', async (req, res) => {
            LOG.info('[Excel File Sync] 📍 Manual refresh endpoint called');
            await this.manualTrigger(req, res);
        });

        // Status endpoint to check job health
        app.get('/g/sync-status', (req, res) => {
            LOG.info('[Excel File Sync] 📍 Status endpoint called');
            res.json(this.getStatus());
        });
        
        // Force sync endpoint (bypasses all checks)
        app.get('/g/force-sync', async (req, res) => {
            LOG.info('[Excel File Sync] 📍 Force sync endpoint called');
            await this.forceSync(req, res);
        });
        
        LOG.success('[Excel File Syncm] ✅ Endpoints registered: /g/refresh, /g/sync-status, /g/force-sync');
    }

    /**
     * Get Google Auth credentials from .env
     */
    getGoogleAuth() {
        try {
            LOG.info('[Excel File Sync] Creating Google Auth from .env...');
            
            // Check if required credentials exist in .env
            if (!process.env.GOOGLE_CLIENT_EMAIL) {
                LOG.error('[Excel File Sync] ❌ GOOGLE_CLIENT_EMAIL missing in .env');
                return null;
            }
            
            if (!process.env.GOOGLE_PRIVATE_KEY) {
                LOG.error('[Excel File Sync] ❌ GOOGLE_PRIVATE_KEY missing in .env');
                return null;
            }

            LOG.info(`[Excel File Sync] Using service account: ${process.env.GOOGLE_CLIENT_EMAIL}`);

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

            LOG.success('[Excel File Sync] ✅ Google Auth created successfully');
            return auth;
        } catch (error) {
            LOG.error('[Excel File Sync] Failed to create Google Auth:', error.message);
            LOG.error('[Excel File Sync] Error stack:', error.stack);
            return null;
        }
    }

    start() {
        LOG.info('[Excel File Sync] ========================================');
        LOG.info('[Excel File Sync] START METHOD CALLED');
        LOG.info('[Excel File Sync] ========================================');
        
        if (this.initialized) {
            LOG.warning('[Excel File Sync] Already initialized, skipping...');
            return;
        }
        
        if (!config.schedule || !config.schedule.enabled) {
            LOG.warning('[Excel File Sync] Job is disabled in configuration');
            LOG.info('[Excel File Sync] Check config.schedule.enabled in tradingConfig.js');
            return;
        }

        LOG.info('[Excel File Sync] Config schedule enabled:', config.schedule.enabled);

        // Validate Google Sheets configuration
        if (!this.SPREADSHEET_ID) {
            LOG.error('[Excel File Sync] ❌ GOOGLE_SHEETS_ID not found in .env');
            LOG.info('[Excel File Sync] Please add GOOGLE_SHEETS_ID to your .env file');
            return;
        }

        if (!process.env.GOOGLE_CLIENT_EMAIL) {
            LOG.error('[Excel File Sync] ❌ GOOGLE_CLIENT_EMAIL not found in .env');
            return;
        }

        if (!process.env.GOOGLE_PRIVATE_KEY) {
            LOG.error('[Excel File Sync] ❌ GOOGLE_PRIVATE_KEY not found in .env');
            return;
        }

        LOG.info('[Excel File Sync] ✅ All configurations validated');

        // Initialize database tables
        LOG.info('[Excel File Sync] Initializing database tables...');
        stockDataService.initializeTables()
            .then(() => {
                LOG.success('[Excel File Sync] Database tables initialized');
            })
            .catch(err => {
                LOG.error('[Excel File Sync] DB init failed:', err.message);
            });

        // Schedule the cron job
        LOG.info(`[Excel File Sync] Scheduling job with cron: ${this.CRON_EXPRESSION}`);
        LOG.info(`[Excel File Sync] Timezone: ${process.env.SYNC_TIMEZONE || 'Asia/Kolkata'}`);

        try {
            this.cronJob = cron.schedule(this.CRON_EXPRESSION, async () => {
                LOG.info(`[Excel File Sync] ⏰ Cron triggered at ${new Date().toISOString()}`);
                await this.sync();
            }, {
                scheduled: true,
                timezone: process.env.SYNC_TIMEZONE || "Asia/Kolkata"
            });

            LOG.success('[Excel File Sync] ✅ Cron job scheduled successfully');
            this.initialized = true;
            
            // Log next execution time
            const nextDates = this.cronJob.nextDates();
            LOG.info(`[Excel File Sync] Next execution: ${nextDates instanceof Date ? nextDates.toISOString() : 'Unknown'}`);

        } catch (cronError) {
            LOG.error('[Excel File Sync] Failed to schedule cron job:', cronError.message);
            LOG.error('[Excel File Sync] Cron error stack:', cronError.stack);
            return;
        }

        // Run initial sync after 5 seconds
        LOG.info('[Excel File Sync] Scheduling initial sync in 5 seconds...');
        setTimeout(async () => {
            LOG.info('[Excel File Sync] 🚀 Running initial sync (forced)...');
            try {
                await this.sync(true);
            } catch (err) {
                LOG.error('[Excel File Sync] Initial sync failed:', err.message);
            }
        }, 5000);
        
        LOG.info('[Excel File Sync] ========================================');
    }

    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            LOG.info('[Excel File Sync] Cron job stopped');
        }
        this.initialized = false;
    }

    /**
     * Manual trigger endpoint handler
     */
    async manualTrigger(req, res) {
        LOG.info('[Excel File Sync] 📍 Manual trigger via API endpoint');
        
        try {
            // Check if already running
            if (this.isRunning) {
                LOG.warning('[Excel File Sync] Sync already in progress');
                return res.status(409).json({
                    success: false,
                    message: 'Sync already in progress',
                    status: this.getStatus()
                });
            }
            
            // Start sync with force=true on manual trigger
            await this.sync(true);
            
            return res.status(200).json({
                success: true,
                message: 'Sync completed successfully',
                status: this.getStatus()
            });
            
        } catch (error) {
            LOG.error('[Excel File Sync] Manual trigger failed:', error.message);
            return res.status(500).json({
                success: false,
                message: 'Sync failed',
                error: error.message,
                status: this.getStatus()
            });
        }
    }

    /**
     * Force sync endpoint - bypasses all checks
     */
    async forceSync(req, res) {
        LOG.info('[Excel File Sync] 💪 Force sync via API endpoint');
        
        try {
            if (this.isRunning) {
                LOG.warning('[Excel File Sync] Sync already in progress');
                return res.status(409).json({
                    success: false,
                    message: 'Sync already in progress',
                    status: this.getStatus()
                });
            }
            
            // Force sync with force=true
            await this.sync(true);
            
            return res.status(200).json({
                success: true,
                message: 'Force sync completed successfully',
                status: this.getStatus()
            });
            
        } catch (error) {
            LOG.error('[Excel File Sync] Force sync failed:', error.message);
            return res.status(500).json({
                success: false,
                message: 'Force sync failed',
                error: error.message,
                status: this.getStatus()
            });
        }
    }

    /**
     * Read data directly from Google Sheets using .env credentials
     */
    async readFromGoogleSheets() {
        LOG.info('[Excel File Sync] 📊 Reading data from Google Sheets...');
        
        try {
            // Get auth from .env
            const auth = this.getGoogleAuth();
            if (!auth) {
                throw new Error('Failed to create Google Auth from .env');
            }

            // Authorize
            LOG.info('[Excel File Sync] Authorizing with Google...');
            await auth.authorize();
            LOG.success('[Excel File Sync] ✅ Authorization successful');

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

            LOG.success(`[Excel File Sync] ✅ Total records from Google Sheets: ${totalRecords}`);
            return allData;

        } catch (error) {
            LOG.error('[Excel File Sync] Google Sheets read failed:', error.message);
            LOG.error('[Excel File Sync] Error details:', error.stack);
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
                
                if (sameMinute) {
                    LOG.info(`[Excel File Sync] Last sync was at ${lastSyncTime} (same minute)`);
                }
                
                return sameMinute;
            } finally {
                connection.release();
            }
        } catch (err) {
            LOG.warning('[Excel File Sync] Error checking last sync time:', err.message);
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
                
                if (count === 0) {
                    LOG.info('[Excel File Sync] No data in database - first sync needed');
                    return false;
                }
                
                const lastUpdateDate = new Date(lastUpdate);
                const today = new Date();
                
                const sameDay = lastUpdateDate.getDate() === today.getDate() &&
                                lastUpdateDate.getMonth() === today.getMonth() &&
                                lastUpdateDate.getFullYear() === today.getFullYear();
                
                if (sameDay) {
                    LOG.info(`[Excel File Sync] Data exists for today (${count} records)`);
                } else {
                    LOG.info(`[Excel File Sync] Last data from ${lastUpdateDate.toDateString()}, refreshing`);
                }
                
                return sameDay;
            } finally {
                connection.release();
            }
        } catch (err) {
            LOG.warning('[Excel File Sync] Error checking data existence:', err.message);
            return false;
        }
    }

    async sync(forceSync = false) {
        if (this.isRunning) {
            LOG.warning('[Excel File Sync] Already running, skipping...');
            return;
        }

        this.isRunning = true;
        const syncStartTime = Date.now();
        LOG.info(`[Excel File Sync] ========================================`);
        LOG.info(`[Excel File Sync] 🔄 Starting sync (force: ${forceSync}) at ${new Date().toISOString()}`);

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
                LOG.info('[Excel File Sync] Attempting local file fallback...');
                sheetsData = await this.readFromLocalExcel();
            }
            
            const allStockData = [
                ...sheetsData.gainers,
                ...sheetsData.decliners,
                ...sheetsData.actives,
                ...sheetsData.data
            ];
            
            if (allStockData.length === 0) {
                LOG.warning('[Excel File Sync] No data found in any source');
                this.lastSyncStatus = 'error';
                this.lastSyncError = 'No data found';
                this.isRunning = false;
                return;
            }

            LOG.info(`[Excel File Sync] Processing ${allStockData.length} total records`);

            // Clean data
            const cleanedData = allStockData.map((stock, idx) => {
                const cleaned = {
                    symbol: (stock.symbol || stock.Symbol || '').toString().substring(0, 20),
                    company_name: (stock.company_name || stock.Company_Name || '').toString().substring(0, 255),
                    last_price: parseFloat(stock.last_price || stock.Last_Price || 0),
                    pchange: parseFloat(stock.pchange || stock.Change || 0),
                    per_change: parseFloat(stock.per_change || stock.Percent_Change || 0),
                    volume: parseFloat(stock.volume || stock.Volume || 0),
                    market_cap: parseFloat(stock.market_cap || stock.Market_Cap || null),
                    pe_ratio: parseFloat(stock.pe_ratio || stock.PE_Ratio || null),
                    week_52_low: parseFloat(stock.week_52_low || stock.Week_52_Low || null),
                    week_52_high: parseFloat(stock.week_52_high || stock.Week_52_High || null),
                    data_type: (stock.data_type || stock.Data_Type || 'data').toString().substring(0, 50),
                    additional_data: null
                };
                
                if (idx === 0) {
                    LOG.info('[Excel File Sync] Sample cleaned record:', JSON.stringify(cleaned));
                }
                
                return cleaned;
            });

            const pool = require('../database').getPool();
            
            if (!pool) {
                LOG.warning('[Excel File Sync] No database pool, using in-memory');
                await stockDataService.archiveCurrentData();
                await stockDataService.truncateLiveData();
                const inserted = await stockDataService.insertLiveData(cleanedData);
                this.lastSyncTime = new Date();
                this.lastSyncStatus = 'success';
                LOG.success(`[Excel File Sync] In-memory: ${inserted} records in ${Date.now() - syncStartTime}ms`);
                this.isRunning = false;
                return;
            }

            LOG.info('[Excel File Sync] Connecting to database...');
            const connection = await pool.getConnection();
            await connection.beginTransaction();

            try {
                LOG.info('[Excel File Sync] Archiving existing data...');
                const archivedCount = await this.archiveWithConnection(connection);
                LOG.info(`[Excel File Sync] Archived ${archivedCount} records`);
                
                LOG.info('[Excel File Sync] Truncating live_stock_data...');
                await connection.query('TRUNCATE TABLE live_stock_data');
                
                LOG.info(`[Excel File Sync] Inserting ${cleanedData.length} records...`);
                const insertedCount = await this.insertWithConnection(connection, cleanedData);
                
                await connection.commit();
                LOG.success(`[Excel File Sync] ✅ Transaction committed`);

                const syncDuration = Date.now() - syncStartTime;
                this.lastSyncTime = new Date();
                this.lastSyncStatus = 'success';

                LOG.success(`[Excel File Sync] ✅✅✅ DONE: ${insertedCount} records | ${syncDuration}ms | Archived: ${archivedCount}`);

                // Generate features (non-critical)
                try {
                    LOG.info('[Excel File Sync] Generating features...');
                    await featureEngineeringService.generateFeaturesForML();
                    LOG.success('[Excel File Sync] Features generated');
                } catch (featureError) {
                    LOG.warning('[Excel File Sync] Feature generation failed (non-critical):', featureError.message);
                }

            } catch (error) {
                await connection.rollback();
                LOG.error('[Excel File Sync] Transaction failed, rolling back:', error.message);
                throw error;
            } finally {
                connection.release();
            }

        } catch (error) {
            const syncDuration = Date.now() - syncStartTime;
            this.lastSyncStatus = 'error';
            this.lastSyncError = error.message;
            LOG.error(`[Excel File Sync] ❌ FAILED after ${syncDuration}ms: ${error.message}`);
            LOG.error('[Excel File Sync] Error stack:', error.stack);
        } finally {
            this.isRunning = false;
            LOG.info('[Excel File Sync] ========================================');
        }
    }

    async archiveWithConnection(connection) {
        try {
            const [liveData] = await connection.query('SELECT * FROM live_stock_data');
            if (liveData.length === 0) return 0;

            const archiveValues = liveData.map(row => [
                row.symbol, row.company_name, row.last_price, row.pchange,
                row.per_change, row.volume, row.market_cap,
                row.pe_ratio || null, row.week_52_low || null,
                row.week_52_high || null, row.data_type || 'data'
            ]);

            const placeholders = archiveValues.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
            await connection.query(`
                INSERT INTO stock_data_history 
                (symbol, company_name, last_price, pchange, per_change, volume, market_cap, pe_ratio, week_52_low, week_52_high, data_type)
                VALUES ${placeholders}
            `, archiveValues.flat());
            
            return liveData.length;
        } catch (error) {
            LOG.error('[Excel File Sync] Archive error:', error.message);
            throw error;
        }
    }

    async insertWithConnection(connection, stockData) {
        try {
            const values = stockData.map(stock => [
                stock.symbol, stock.company_name, stock.last_price,
                stock.pchange, stock.per_change, stock.volume,
                stock.market_cap, stock.pe_ratio,
                stock.week_52_low, stock.week_52_high,
                stock.data_type, stock.additional_data
            ]);

            const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
            const [result] = await connection.query(`
                INSERT INTO live_stock_data 
                (symbol, company_name, last_price, pchange, per_change, volume, market_cap, pe_ratio, week_52_low, week_52_high, data_type, additional_data)
                VALUES ${placeholders}
                ON DUPLICATE KEY UPDATE
                    company_name = VALUES(company_name),
                    last_price = VALUES(last_price),
                    pchange = VALUES(pchange),
                    per_change = VALUES(per_change),
                    volume = VALUES(volume),
                    market_cap = VALUES(market_cap),
                    pe_ratio = VALUES(pe_ratio),
                    week_52_low = VALUES(week_52_low),
                    week_52_high = VALUES(week_52_high),
                    data_type = VALUES(data_type),
                    additional_data = VALUES(additional_data),
                    last_updated = CURRENT_TIMESTAMP
            `, values.flat());
            
            LOG.info(`[Excel File Sync] Insert result: ${result.affectedRows} rows affected`);
            return result.affectedRows || stockData.length;
        } catch (error) {
            LOG.error('[Excel File Sync] Insert error:', error.message);
            throw error;
        }
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            initialized: this.initialized,
            lastSyncTime: this.lastSyncTime,
            lastSyncStatus: this.lastSyncStatus,
            lastSyncError: this.lastSyncError,
            cronExpression: this.CRON_EXPRESSION,
            enabled: config.schedule?.enabled || false,
            googleSheetsId: this.SPREADSHEET_ID,
            serviceAccount: process.env.GOOGLE_CLIENT_EMAIL,
            nextExecution: this.cronJob ? (this.cronJob.nextDates() instanceof Date ? this.cronJob.nextDates().toISOString() : 'Unknown') : 'Not scheduled'
        };
    }
}

module.exports = ExcelFileSyncJob;