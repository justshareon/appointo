/**
 * Excel File Sync Job
 * Scheduled job that runs every 35 minutes to:
 * 1. Read data directly from 4 Google Drive CSV files
 * 2. Archive current live_stock_data to stock_data_history
 * 3. Truncate live_stock_data
 * 4. Insert fresh data from CSV files into live_stock_data
 */
const config = require('../config/tradingConfig');
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
        
        // 4 Google Drive public CSV files
        this.csvFiles = [
            { id: '1pAUr1ipvh78rzkJlbi9KW7ZaJTimDAeg', type: 'data', name: 'DATA' },
            { id: '1q7aT9YET-QdaZZjQ6DSJe8scVZaD0WiE', type: 'actives', name: 'ACTIVES' },
            { id: '12v7T5qEbAO98TJQV8qV-C0oRrBOlav4k', type: 'gainers', name: 'GAINERS' },
            { id: '1vRj6ms73Qnc1sFgnNcdldW3YXBkNkgJz', type: 'decliners', name: 'DECLINERS' }
        ];
        
        this.CRON_EXPRESSION = process.env.SYNC_CRON || '*/35 * * * *';
        this.ENABLE_LOCAL_FALLBACK = process.env.ENABLE_LOCAL_FALLBACK === 'true';
        this.LOCAL_EXCEL_PATH = process.env.LOCAL_EXCEL_PATH || path.join(__dirname, '../data/stock_data.xlsx');
        
        LOG.info('[Excel File Sync] Initialized with 4 CSV files');
    }

    registerEndpoints(app) {
        this.app = app;
        
        app.get('/g/refresh', async (req, res) => {
            await this.manualTrigger(req, res);
        });

        app.get('/g/sync-status', (req, res) => {
            res.json(this.getStatus());
        });
        
        app.get('/g/force-sync', async (req, res) => {
            await this.forceSync(req, res);
        });
        
        LOG.success('[Excel File Sync] Endpoints registered: /g/refresh, /g/sync-status, /g/force-sync');
    }

    start() {
        LOG.info('[Excel File Sync] Starting...');
        
        if (this.initialized) {
            LOG.warning('[Excel File Sync] Already initialized');
            return;
        }
        
        if (!config.schedule || !config.schedule.enabled) {
            LOG.warning('[Excel File Sync] Job is disabled');
            return;
        }

        // Initialize database tables
        stockDataService.initializeTables()
            .then(() => LOG.success('[Excel File Sync] Database tables initialized'))
            .catch(err => LOG.error('[Excel File Sync] DB init failed:', err.message));

        // Schedule cron job
        const cron = require('node-cron');
        this.cronJob = cron.schedule(this.CRON_EXPRESSION, async () => {
            LOG.info(`[Excel File Sync] Cron triggered at ${new Date().toISOString()}`);
            await this.sync();
        }, {
            scheduled: true,
            timezone: process.env.SYNC_TIMEZONE || "Asia/Kolkata"
        });

        LOG.success(`[Excel File Sync] Scheduled: ${this.CRON_EXPRESSION}`);
        this.initialized = true;

        // Run initial sync after 5 seconds
        setTimeout(async () => {
            LOG.info('[Excel File Sync] Running initial sync...');
            await this.sync(true);
        }, 5000);
    }

    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            LOG.info('[Excel File Sync] Stopped');
        }
        this.initialized = false;
    }

    async manualTrigger(req, res) {
        if (this.isRunning) {
            return res.status(409).json({ success: false, message: 'Sync already in progress' });
        }
        await this.sync(true);
        res.json({ success: true, status: this.getStatus() });
    }

    async forceSync(req, res) {
        if (this.isRunning) {
            return res.status(409).json({ success: false, message: 'Sync already in progress' });
        }
        await this.sync(true);
        res.json({ success: true, status: this.getStatus() });
    }

    /**
     * Fetch CSV from Google Drive using direct download URL
     */
    async fetchCSV(fileId) {
        const url = `https://drive.google.com/uc?export=download&id=${fileId}`;
        
        const response = await fetch(url, {
            timeout: 30000,
            headers: {
                'Accept': 'text/csv,text/plain,*/*',
                'Cache-Control': 'no-cache'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const csvText = await response.text();
        if (!csvText.trim() || csvText.length < 50) {
            throw new Error('CSV file is empty or too small');
        }
        
        return csvText;
    }

    /**
     * Parse CSV line handling quotes
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
        
        return result.map(field => field.replace(/^"|"$/g, '').replace(/""/g, '"'));
    }

    /**
     * Parse CSV data to stock objects
     */
    parseCSVToStocks(csvText, fileType) {
        const lines = csvText.split('\n').filter(line => line.trim());
        if (lines.length < 2) return [];
        
        // Parse headers (first row)
        const headers = this.parseCSVLine(lines[0]);
        
        const stocks = [];
        
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            
            const values = this.parseCSVLine(lines[i]);
            const row = {};
            headers.forEach((header, idx) => {
                let value = values[idx] || '';
                value = value.trim();
                const headerKey = header.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
                row[headerKey] = value;
            });
            
            // Extract symbol (remove NSE:/BOM: prefix)
            let symbol = row.symbol || row.ticker || '';
            if (symbol.startsWith('NSE:')) symbol = symbol.substring(4);
            if (symbol.startsWith('BOM:')) symbol = symbol.substring(4);
            if (!symbol || symbol === '%') continue;
            
            // Parse price (remove commas)
            const price = parseFloat(String(row.price || row.last_price || 0).replace(/,/g, ''));
            const change = parseFloat(row.change || 0);
            const changePercent = parseFloat(row.change_ || row.change_percent || 0);
            const volume = parseInt(String(row.volume || 0).replace(/,/g, ''));
            
            // Market cap and PE ratio (from ACTIVES/GAINERS/DECLINERS files)
            let marketCap = null;
            let peRatio = null;
            let week52Low = null;
            let week52High = null;
            
            if (row.market_cap) {
                marketCap = parseFloat(String(row.market_cap).replace(/,/g, ''));
            }
            if (row.pe_ratio) {
                peRatio = parseFloat(row.pe_ratio);
            }
            if (row.week_52_low) {
                week52Low = parseFloat(row.week_52_low);
            }
            if (row.week_52_high) {
                week52High = parseFloat(row.week_52_high);
            }
            
            const stock = {
                symbol: symbol,
                company_name: row.name || row.company_name || null,
                last_price: isNaN(price) ? 0 : price,
                pchange: isNaN(change) ? 0 : change,
                per_change: isNaN(changePercent) ? 0 : changePercent,
                volume: isNaN(volume) ? 0 : volume,
                market_cap: marketCap,
                pe_ratio: peRatio,
                week_52_low: week52Low,
                week_52_high: week52High,
                data_type: fileType,
                additional_data: null
            };
            
            // Only add if symbol is valid
            if (stock.symbol && stock.symbol.length > 0) {
                stocks.push(stock);
            }
        }
        
        return stocks;
    }

    /**
     * Read all 4 CSV files from Google Drive
     */
    async readFromGoogleSheets() {
        LOG.info('[Excel File Sync] Reading 4 CSV files from Google Drive...');
        
        const allStocks = [];
        
        for (const file of this.csvFiles) {
            try {
                LOG.info(`[Excel File Sync] Fetching ${file.name}...`);
                const csvText = await this.fetchCSV(file.id);
                const stocks = this.parseCSVToStocks(csvText, file.type);
                LOG.success(`[Excel File Sync] ${file.name}: ${stocks.length} records`);
                allStocks.push(...stocks);
            } catch (error) {
                LOG.error(`[Excel File Sync] Failed to fetch ${file.name}:`, error.message);
            }
        }
        
        if (allStocks.length === 0) {
            throw new Error('No data found in any CSV file');
        }
        
        LOG.success(`[Excel File Sync] Total: ${allStocks.length} records from 4 files`);
        return allStocks;
    }

    async readFromLocalExcel() {
        LOG.warning('[Excel File Sync] Falling back to local Excel file');
        
        if (!this.ENABLE_LOCAL_FALLBACK) {
            throw new Error('Local file fallback is disabled');
        }
        
        const excelFileService = require('../services/excelFileService');
        const data = await excelFileService.readAllSheetsByType();
        
        const allStocks = [
            ...(data.gainers || []),
            ...(data.decliners || []),
            ...(data.actives || []),
            ...(data.data || [])
        ];
        
        if (allStocks.length === 0) {
            throw new Error('No data found in local Excel file');
        }
        
        LOG.success(`[Excel File Sync] Local fallback: ${allStocks.length} records`);
        return allStocks;
    }

    async wasSyncedInCurrentMinute() {
        try {
            const pool = require('../database').getPool();
            if (!pool) return false;

            const connection = await pool.getConnection();
            const [result] = await connection.query(`SELECT MAX(last_updated) as lastSyncTime FROM live_stock_data`);
            connection.release();
            
            const lastSyncTime = result[0]?.lastSyncTime;
            if (!lastSyncTime) return false;
            
            const lastSyncDate = new Date(lastSyncTime);
            const now = new Date();
            
            return lastSyncDate.getFullYear() === now.getFullYear() &&
                   lastSyncDate.getMonth() === now.getMonth() &&
                   lastSyncDate.getDate() === now.getDate() &&
                   lastSyncDate.getHours() === now.getHours() &&
                   lastSyncDate.getMinutes() === now.getMinutes();
        } catch (err) {
            return false;
        }
    }

    async checkIfDataExistsForToday() {
        try {
            const pool = require('../database').getPool();
            if (!pool) return false;

            const connection = await pool.getConnection();
            const [result] = await connection.query(`SELECT COUNT(*) as count, MAX(last_updated) as lastUpdate FROM live_stock_data`);
            connection.release();
            
            const count = result[0]?.count || 0;
            if (count === 0) return false;
            
            const lastUpdateDate = new Date(result[0]?.lastUpdate);
            const today = new Date();
            
            return lastUpdateDate.getDate() === today.getDate() &&
                   lastUpdateDate.getMonth() === today.getMonth() &&
                   lastUpdateDate.getFullYear() === today.getFullYear();
        } catch (err) {
            return false;
        }
    }

    validateStockData(stock) {
        if (!stock.symbol || stock.symbol.trim() === '') return false;
        if (isNaN(stock.last_price)) stock.last_price = 0;
        if (isNaN(stock.pchange)) stock.pchange = 0;
        if (isNaN(stock.per_change)) stock.per_change = 0;
        if (isNaN(stock.volume)) stock.volume = 0;
        return true;
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
            // Skip checks if force sync
            if (!forceSync) {
                const syncedRecently = await this.wasSyncedInCurrentMinute();
                if (syncedRecently) {
                    LOG.info('[Excel File Sync] Skipped - already synced in current minute');
                    this.isRunning = false;
                    return;
                }

                const dataExists = await this.checkIfDataExistsForToday();
                if (dataExists) {
                    LOG.info('[Excel File Sync] Skipped - data exists for today');
                    this.isRunning = false;
                    return;
                }
            }

            // Read data from Google Drive
            let allStocks;
            let dataSource = 'Google Drive CSV';
            
            try {
                allStocks = await this.readFromGoogleSheets();
                LOG.success('[Excel File Sync] Data loaded from Google Drive');
            } catch (googleError) {
                LOG.warning(`Google Drive failed: ${googleError.message}`);
                
                if (this.ENABLE_LOCAL_FALLBACK) {
                    allStocks = await this.readFromLocalExcel();
                    dataSource = 'Local Excel';
                    LOG.success('[Excel File Sync] Data loaded from local file');
                } else {
                    throw googleError;
                }
            }
            
            // Validate and clean data
            const validStocks = allStocks.filter(s => this.validateStockData(s));
            LOG.info(`[Excel File Sync] Valid records: ${validStocks.length}`);
            
            if (validStocks.length === 0) {
                throw new Error('No valid data after validation');
            }
            
            // Show sample
            if (validStocks.length > 0) {
                LOG.info(`[Excel File Sync] Sample: ${validStocks[0].symbol} @ ₹${validStocks[0].last_price}`);
            }

            // Database operations
            const pool = require('../database').getPool();
            if (!pool) {
                LOG.warning('No database pool, using in-memory');
                await stockDataService.archiveCurrentData();
                await stockDataService.truncateLiveData();
                await stockDataService.insertLiveData(validStocks);
                this.lastSyncTime = new Date();
                this.lastSyncStatus = 'success';
                LOG.success(`[Excel File Sync] In-memory: ${validStocks.length} records`);
                this.isRunning = false;
                return;
            }

            const connection = await pool.getConnection();
            await connection.beginTransaction();

            try {
                // Archive existing data
                const [liveData] = await connection.query('SELECT * FROM live_stock_data');
                if (liveData.length > 0) {
                    await this.archiveWithConnection(connection, liveData);
                    LOG.info(`[Excel File Sync] Archived ${liveData.length} records`);
                }
                
                // Truncate and insert
                await connection.query('TRUNCATE TABLE live_stock_data');
                const insertedCount = await this.insertWithConnection(connection, validStocks);
                
                await connection.commit();
                
                const syncDuration = Date.now() - syncStartTime;
                this.lastSyncTime = new Date();
                this.lastSyncStatus = 'success';
                this.lastSyncError = null;

                LOG.success(`[Excel File Sync] DONE: ${insertedCount} records | ${syncDuration}ms | Source: ${dataSource}`);

                // Generate ML features (non-critical)
                try {
                    await featureEngineeringService.generateFeaturesForML();
                    LOG.success('[Excel File Sync] Features generated');
                } catch (featureError) {
                    LOG.warning('Feature generation failed:', featureError.message);
                }

            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }

        } catch (error) {
            const syncDuration = Date.now() - syncStartTime;
            this.lastSyncStatus = 'error';
            this.lastSyncError = error.message;
            LOG.error(`[Excel File Sync] FAILED after ${syncDuration}ms: ${error.message}`);
        } finally {
            this.isRunning = false;
        }
    }

    async archiveWithConnection(connection, liveData) {
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
        
        return archiveValues.length;
    }

    async insertWithConnection(connection, stockData) {
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
        
        return result.affectedRows;
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
            csvFilesCount: this.csvFiles.length
        };
    }
}

module.exports = ExcelFileSyncJob;