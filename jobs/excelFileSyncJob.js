/**
 * Excel File Sync Job
 * Scheduled job that runs every 35 minutes to:
 * 1. Read data directly from Google Sheets using published CSV URL
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
const fs = require('fs');
const path = require('path');
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
        this.SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID || '1nN02hZuHmc0KQJc0VrslvYO7RCr9A0fh';
        this.SHEET_NAMES = (process.env.GOOGLE_SHEET_NAMES || 'Gainers,Decliners,Actives,Data').split(',');
        this.CRON_EXPRESSION = process.env.SYNC_CRON || '*/35 * * * *';
        this.ENABLE_LOCAL_FALLBACK = process.env.ENABLE_LOCAL_FALLBACK === 'true';
        this.LOCAL_EXCEL_PATH = process.env.LOCAL_EXCEL_PATH || path.join(__dirname, '../data/stock_data.xlsx');
        
        // Published CSV URL (get from File → Share → Publish to web)
        this.PUBLISHED_CSV_URL = process.env.GOOGLE_PUBLISHED_CSV_URL || 
            `https://docs.google.com/spreadsheets/d/${this.SPREADSHEET_ID}/export?format=csv`;
        
        LOG.info('[Excel File Sync] Constructor called');
        LOG.info(`[Excel File Sync] SPREADSHEET_ID: ${this.SPREADSHEET_ID}`);
        LOG.info(`[Excel File Sync] SHEET_NAMES: ${this.SHEET_NAMES.join(', ')}`);
        LOG.info(`[Excel File Sync] CRON_EXPRESSION: ${this.CRON_EXPRESSION}`);
        LOG.info(`[Excel File Sync] Published CSV URL: ${this.PUBLISHED_CSV_URL.substring(0, 80)}...`);
        LOG.info(`[Excel File Sync] Local Fallback: ${this.ENABLE_LOCAL_FALLBACK ? 'ENABLED' : 'DISABLED'}`);
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
        
        // Debug endpoint for troubleshooting
        app.get('/g/debug', async (req, res) => {
            LOG.info('[Excel File Sync] 📍 Debug endpoint called');
            await this.debugEndpoint(req, res);
        });
        
        LOG.success('[Excel File Sync] ✅ Endpoints registered: /g/refresh, /g/sync-status, /g/force-sync, /g/debug');
    }

    /**
     * Debug endpoint to diagnose issues
     */
    async debugEndpoint(req, res) {
        const diagnostics = {
            timestamp: new Date().toISOString(),
            environment: {
                NODE_ENV: process.env.NODE_ENV || 'development',
                SYNC_TIMEZONE: process.env.SYNC_TIMEZONE || 'Asia/Kolkata',
                PORT: process.env.PORT || 5000
            },
            config: {
                GOOGLE_SHEETS_ID: this.SPREADSHEET_ID,
                PUBLISHED_CSV_URL: this.PUBLISHED_CSV_URL,
                SHEET_NAMES: this.SHEET_NAMES,
                CRON_EXPRESSION: this.CRON_EXPRESSION,
                ENABLE_LOCAL_FALLBACK: this.ENABLE_LOCAL_FALLBACK,
                LOCAL_EXCEL_PATH: this.LOCAL_EXCEL_PATH
            },
            status: this.getStatus(),
            csv_export_test: null,
            local_file_test: null,
            database_test: null
        };
        
        // Test CSV export
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(`${this.PUBLISHED_CSV_URL}&_=${Date.now()}`, { 
                signal: controller.signal,
                headers: { 'Accept': 'text/csv,text/plain,*/*' }
            });
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const csvText = await response.text();
                const lines = csvText.split('\n').filter(line => line.trim());
                diagnostics.csv_export_test = {
                    status: '✅ Success',
                    url: this.PUBLISHED_CSV_URL,
                    total_bytes: csvText.length,
                    total_lines: lines.length,
                    data_rows: lines.length > 1 ? lines.length - 1 : 0,
                    sample: lines.slice(0, 3).map(line => line.substring(0, 100))
                };
            } else {
                diagnostics.csv_export_test = {
                    status: '❌ Failed',
                    url: this.PUBLISHED_CSV_URL,
                    error: `HTTP ${response.status}: ${response.statusText}`
                };
            }
        } catch (csvError) {
            diagnostics.csv_export_test = {
                status: '❌ Failed',
                error: csvError.message,
                suggestion: 'Please publish your Google Sheet to web: File → Share → Publish to web → CSV format'
            };
        }
        
        // Test local file
        if (this.ENABLE_LOCAL_FALLBACK && fs.existsSync(this.LOCAL_EXCEL_PATH)) {
            diagnostics.local_file_test = {
                status: '✅ Exists',
                path: this.LOCAL_EXCEL_PATH,
                size: fs.statSync(this.LOCAL_EXCEL_PATH).size
            };
        } else if (this.ENABLE_LOCAL_FALLBACK) {
            diagnostics.local_file_test = {
                status: '⚠️ Not Found',
                path: this.LOCAL_EXCEL_PATH
            };
        } else {
            diagnostics.local_file_test = {
                status: '⏭️ Disabled',
                path: this.LOCAL_EXCEL_PATH
            };
        }
        
        // Test database
        try {
            const pool = require('../database').getPool();
            if (pool) {
                const connection = await pool.getConnection();
                await connection.ping();
                const [result] = await connection.query('SELECT COUNT(*) as count FROM live_stock_data');
                connection.release();
                diagnostics.database_test = {
                    status: '✅ Connected',
                    record_count: result[0].count,
                    host: process.env.DB_HOST,
                    database: process.env.DB_NAME
                };
            } else {
                diagnostics.database_test = {
                    status: '⚠️ No pool',
                    message: 'Database pool not initialized'
                };
            }
        } catch (dbError) {
            diagnostics.database_test = {
                status: '❌ Failed',
                error: dbError.message
            };
        }
        
        res.json(diagnostics);
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
            return;
        }

        LOG.info('[Excel File Sync] Config schedule enabled:', config.schedule.enabled);

        LOG.info('[Excel File Sync] ✅ All configurations validated');

        // Initialize database tables
        LOG.info('[Excel File Sync] Initializing database tables...');
        stockDataService.initializeTables()
            .then(() => LOG.success('[Excel File Sync] Database tables initialized'))
            .catch(err => LOG.error('[Excel File Sync] DB init failed:', err.message));

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
            LOG.info(`[Excel File Sync] Job scheduled to run every ${this.CRON_EXPRESSION}`);

        } catch (cronError) {
            LOG.error('[Excel File Sync] Failed to schedule cron job:', cronError.message);
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

    async manualTrigger(req, res) {
        LOG.info('[Excel File Sync] 📍 Manual trigger via API endpoint');
        
        try {
            if (this.isRunning) {
                return res.status(409).json({
                    success: false,
                    message: 'Sync already in progress',
                    status: this.getStatus()
                });
            }
            
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

    async forceSync(req, res) {
        LOG.info('[Excel File Sync] 💪 Force sync via API endpoint');
        
        try {
            if (this.isRunning) {
                return res.status(409).json({
                    success: false,
                    message: 'Sync already in progress',
                    status: this.getStatus()
                });
            }
            
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
     * Read data using published CSV URL (works for any Google Drive file published to web)
     */
    async readFromGoogleSheets(retries = 3) {
        LOG.info('[Excel File Sync] 📊 Reading data from published CSV...');
        
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                // Add cache-busting parameter
                const url = `${this.PUBLISHED_CSV_URL}&_=${Date.now()}`;
                
                LOG.info(`[Excel File Sync] Fetching CSV (Attempt ${attempt}/${retries})...`);
                
                const response = await fetch(url, {
                    headers: {
                        'Accept': 'text/csv,text/plain,*/*',
                        'Cache-Control': 'no-cache'
                    }
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const csvText = await response.text();
                LOG.info(`[Excel File Sync] Downloaded ${csvText.length} bytes of CSV data`);
                
                if (!csvText.trim() || csvText.length < 50) {
                    throw new Error('CSV file is empty or too small - please publish your sheet to web');
                }
                
                // Parse CSV
                const lines = csvText.split('\n').filter(line => line.trim());
                if (lines.length < 2) {
                    throw new Error('CSV has no data rows');
                }
                
                LOG.info(`[Excel File Sync] CSV has ${lines.length} total lines`);
                
                // Parse headers (first row)
                const headers = this.parseCSVLine(lines[0]);
                LOG.info(`[Excel File Sync] Found ${headers.length} columns: ${headers.slice(0, 8).join(', ')}...`);
                
                // Parse data rows
                const allData = {
                    gainers: [],
                    decliners: [],
                    actives: [],
                    data: []
                };
                
                let validRecords = 0;
                let processedRows = 0;
                
                for (let i = 1; i < lines.length; i++) {
                    if (!lines[i].trim()) continue;
                    
                    processedRows++;
                    const values = this.parseCSVLine(lines[i]);
                    const obj = {};
                    
                    headers.forEach((header, idx) => {
                        let value = values[idx] || '';
                        value = value.trim();
                        const headerLower = header.toLowerCase().replace(/\s/g, '_');
                        
                        // Try to detect numeric fields
                        if (!isNaN(value) && value !== '' && 
                            headerLower !== 'symbol' && 
                            headerLower !== 'company_name' &&
                            headerLower !== 'scrip_name' &&
                            headerLower !== 'name') {
                            obj[headerLower] = parseFloat(value);
                        } else {
                            obj[headerLower] = value;
                        }
                    });
                    
                    // Look for symbol in various possible field names
                    const symbol = obj.symbol || obj.Symbol || obj.ticker || obj.Ticker || 
                                  obj.scrip_name || obj.Scrip_Name || obj.name || obj.Name;
                    
                    if (symbol && symbol.toString().trim() !== '' && symbol.toString() !== 'null') {
                        obj.symbol = symbol.toString().trim();
                        validRecords++;
                        
                        // Determine which category based on available data
                        if (obj.change && obj.change > 0) {
                            allData.gainers.push(obj);
                        } else if (obj.change && obj.change < 0) {
                            allData.decliners.push(obj);
                        } else if (obj.volume && obj.volume > 100000) {
                            allData.actives.push(obj);
                        } else {
                            allData.data.push(obj);
                        }
                    }
                    
                    // Limit to reasonable number of records
                    if (validRecords >= 5000) break;
                }
                
                LOG.success(`[Excel File Sync] ✅ Processed ${processedRows} rows, found ${validRecords} valid records`);
                LOG.info(`[Excel File Sync] Gainers: ${allData.gainers.length}, Decliners: ${allData.decliners.length}, Actives: ${allData.actives.length}, Data: ${allData.data.length}`);
                
                if (validRecords === 0) {
                    throw new Error('No valid stock records found in CSV. Please check column headers (expected: Symbol, Last Price, Volume, etc.)');
                }
                
                return allData;
                
            } catch (error) {
                LOG.error(`[Excel File Sync] CSV read failed (Attempt ${attempt}/${retries}):`, error.message);
                if (attempt === retries) {
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            }
        }
    }
    
    /**
     * Simple CSV line parser (handles quoted fields)
     */
    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        
        // Remove quotes from fields
        return result.map(field => field.replace(/^"|"$/g, '').replace(/""/g, '"'));
    }

    async readFromLocalExcel() {
        LOG.warning('[Excel File Sync] Falling back to local Excel file');
        
        if (!this.ENABLE_LOCAL_FALLBACK) {
            throw new Error('Local file fallback is disabled');
        }
        
        try {
            if (!fs.existsSync(this.LOCAL_EXCEL_PATH)) {
                throw new Error(`Local Excel file not found at: ${this.LOCAL_EXCEL_PATH}`);
            }
            
            const data = await excelFileService.readAllSheetsByType();
            
            if (!data || (!data.gainers?.length && !data.decliners?.length && !data.actives?.length && !data.data?.length)) {
                throw new Error('No data found in local Excel file');
            }
            
            LOG.success(`[Excel File Sync] Local Excel fallback successful - Total records: ${(data.gainers?.length || 0) + (data.decliners?.length || 0) + (data.actives?.length || 0) + (data.data?.length || 0)}`);
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
                const [result] = await connection.query(`SELECT MAX(last_updated) as lastSyncTime FROM live_stock_data`);
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
                const [result] = await connection.query(`SELECT COUNT(*) as count, MAX(last_updated) as lastUpdate FROM live_stock_data`);
                const count = result[0]?.count || 0;
                const lastUpdate = result[0]?.lastUpdate;
                
                if (count === 0) {
                    LOG.info('[Excel File Sync] No data in database - first sync needed');
                    return false;
                }
                
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
            LOG.warning('[Excel File Sync] Error checking data existence:', err.message);
            return false;
        }
    }

    validateStockData(stock, index) {
        if (!stock.symbol || stock.symbol.toString().trim() === '') {
            if (index < 5) LOG.warning(`[Excel File Sync] Record ${index}: Missing symbol, skipping`);
            return false;
        }
        
        if (isNaN(stock.last_price) || stock.last_price < 0) stock.last_price = 0;
        if (isNaN(stock.pchange)) stock.pchange = 0;
        if (isNaN(stock.per_change)) stock.per_change = 0;
        if (isNaN(stock.volume) || stock.volume < 0) stock.volume = 0;
        
        return true;
    }

    async sync(forceSync = false) {
        if (this.isRunning) {
            LOG.warning('[Excel File Sync] Already running, skipping...');
            return;
        }

        this.isRunning = true;
        const syncStartTime = Date.now();
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

            let sheetsData;
            let dataSource = 'Google Sheets (Published CSV)';
            
            try {
                sheetsData = await this.readFromGoogleSheets();
                LOG.success('[Excel File Sync] ✅ Data loaded from published CSV');
            } catch (googleError) {
                LOG.warning(`[Excel File Sync] Published CSV failed: ${googleError.message}`);
                
                if (this.ENABLE_LOCAL_FALLBACK) {
                    LOG.info('[Excel File Sync] Attempting local file fallback...');
                    sheetsData = await this.readFromLocalExcel();
                    dataSource = 'Local Excel File';
                    LOG.success('[Excel File Sync] ✅ Data loaded from local file');
                } else {
                    throw googleError;
                }
            }
            
            const allStockData = [
                ...(sheetsData.gainers || []),
                ...(sheetsData.decliners || []),
                ...(sheetsData.actives || []),
                ...(sheetsData.data || [])
            ];
            
            if (allStockData.length === 0) {
                throw new Error('No data found in any source');
            }

            LOG.info(`[Excel File Sync] Processing ${allStockData.length} total records from ${dataSource}`);

            const cleanedData = [];
            for (let idx = 0; idx < allStockData.length; idx++) {
                const stock = allStockData[idx];
                
                const cleaned = {
                    symbol: (stock.symbol || stock.Symbol || stock.ticker || stock.Ticker || '').toString().trim().substring(0, 20),
                    company_name: (stock.company_name || stock.Company_Name || stock.company || stock.name || '').toString().substring(0, 255),
                    last_price: parseFloat(stock.last_price || stock.Last_Price || stock.price || stock.close || 0),
                    pchange: parseFloat(stock.pchange || stock.Change || stock.change || 0),
                    per_change: parseFloat(stock.per_change || stock.percent_change || stock.Percent_Change || 0),
                    volume: parseFloat(stock.volume || stock.Volume || stock.vol || 0),
                    market_cap: stock.market_cap || stock.Market_Cap || null,
                    pe_ratio: stock.pe_ratio || stock.PE_Ratio || null,
                    week_52_low: stock.week_52_low || stock.Week_52_Low || null,
                    week_52_high: stock.week_52_high || stock.Week_52_High || null,
                    data_type: (stock.data_type || stock.Data_Type || 'data').toString().substring(0, 50),
                    additional_data: null
                };
                
                if (this.validateStockData(cleaned, idx)) {
                    cleanedData.push(cleaned);
                }
            }
            
            if (cleanedData.length === 0) {
                throw new Error('No valid data after cleaning and validation');
            }
            
            LOG.info(`[Excel File Sync] Valid records after cleaning: ${cleanedData.length}`);
            
            if (cleanedData.length > 0) {
                LOG.info('[Excel File Sync] Sample record:', JSON.stringify(cleanedData[0]));
            }

            const pool = require('../database').getPool();
            
            if (!pool) {
                LOG.warning('[Excel File Sync] No database pool, using in-memory storage');
                await stockDataService.archiveCurrentData();
                await stockDataService.truncateLiveData();
                const inserted = await stockDataService.insertLiveData(cleanedData);
                this.lastSyncTime = new Date();
                this.lastSyncStatus = 'success';
                this.lastSyncError = null;
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
                this.lastSyncError = null;

                LOG.success(`[Excel File Sync] ✅✅✅ DONE: ${insertedCount} records inserted | ${syncDuration}ms | Archived: ${archivedCount} | Source: ${dataSource}`);

                try {
                    LOG.info('[Excel File Sync] Generating ML features...');
                    await featureEngineeringService.generateFeaturesForML();
                    LOG.success('[Excel File Sync] Features generated successfully');
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

            const batchSize = 1000;
            let archivedCount = 0;
            
            for (let i = 0; i < archiveValues.length; i += batchSize) {
                const batch = archiveValues.slice(i, i + batchSize);
                const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
                await connection.query(`
                    INSERT INTO stock_data_history 
                    (symbol, company_name, last_price, pchange, per_change, volume, market_cap, pe_ratio, week_52_low, week_52_high, data_type)
                    VALUES ${placeholders}
                `, batch.flat());
                archivedCount += batch.length;
            }
            
            return archivedCount;
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

            const batchSize = 1000;
            let totalInserted = 0;
            
            for (let i = 0; i < values.length; i += batchSize) {
                const batch = values.slice(i, i + batchSize);
                const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
                
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
                `, batch.flat());
                
                totalInserted += result.affectedRows;
                LOG.info(`[Excel File Sync] Inserted batch ${Math.floor(i/batchSize) + 1}: ${result.affectedRows} rows`);
            }
            
            LOG.info(`[Excel File Sync] Total inserted/updated: ${totalInserted} records`);
            return totalInserted;
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
            publishedCsvUrl: this.PUBLISHED_CSV_URL,
            localFallbackEnabled: this.ENABLE_LOCAL_FALLBACK,
            nextExecution: 'Scheduled - check cron pattern'
        };
    }
}

module.exports = ExcelFileSyncJob;