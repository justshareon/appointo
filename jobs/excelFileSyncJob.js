/**
 * Excel File Sync Job
 * Reads 4 Google Drive CSV files and syncs to live_stock_data
 */
const config = require('../config/tradingConfig');
const featureEngineeringService = require('../services/featureEngineeringService');
const LOG = require('../utils/logger');
require('dotenv').config();

class ExcelFileSyncJob {
    constructor() {
        this.isRunning = false;
        this.lastSyncTime = null;
        this.lastSyncStatus = null;
        this.lastSyncError = null;
        this.cronJob = null;
        this.initialized = false;
        
        // Your 4 public Google Drive file IDs
        this.fileIds = {
            data: '1pAUr1ipvh78rzkJlbi9KW7ZaJTimDAeg',
            actives: '1q7aT9YET-QdaZZjQ6DSJe8scVZaD0WiE',
            gainers: '12v7T5qEbAO98TJQV8qV-C0oRrBOlav4k',
            decliners: '1vRj6ms73Qnc1sFgnNcdldW3YXBkNkgJz'
        };
        
        this.CRON_EXPRESSION = process.env.SYNC_CRON || '*/35 * * * *';
        this.ENABLE_LOCAL_FALLBACK = process.env.ENABLE_LOCAL_FALLBACK === 'true';
        
        LOG.info('[Excel File Sync] Initialized with 4 Google Drive files');
    }

    registerEndpoints(app) {
        app.get('/g/refresh', async (req, res) => {
            if (this.isRunning) {
                return res.status(409).json({ success: false, message: 'Sync in progress' });
            }
            await this.sync(true);
            res.json({ success: true, status: this.getStatus() });
        });

        app.get('/g/sync-status', (req, res) => {
            res.json(this.getStatus());
        });
        
        app.get('/g/force-sync', async (req, res) => {
            if (this.isRunning) {
                return res.status(409).json({ success: false, message: 'Sync in progress' });
            }
            await this.sync(true);
            res.json({ success: true, status: this.getStatus() });
        });
        
        LOG.success('[Excel File Sync] Endpoints registered');
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

    /**
     * Fetch raw CSV content from Google Drive
     */
    async fetchCSV(fileId) {
        const url = `https://drive.google.com/uc?export=download&id=${fileId}`;
        
        const response = await fetch(url, {
            timeout: 30000,
            headers: { 'Accept': 'text/csv,text/plain,*/*' }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const text = await response.text();
        if (!text || text.length < 50) {
            throw new Error('File empty or too small');
        }
        
        return text;
    }

    /**
     * Parse DATA.csv format (has SYMBOL, Name, Price, Volume, Change, etc.)
     */
    parseDataCSV(csvText, fileType) {
        const lines = csvText.split('\n').filter(line => line.trim() && !line.includes('ENTER SYMBOL'));
        if (lines.length < 2) return [];
        
        // Find header row (contains SYMBOL)
        let headerLine = null;
        let startRow = 0;
        for (let i = 0; i < Math.min(5, lines.length); i++) {
            if (lines[i].toUpperCase().includes('SYMBOL') && lines[i].includes('NAME')) {
                headerLine = lines[i];
                startRow = i + 1;
                break;
            }
        }
        
        if (!headerLine) {
            headerLine = lines[0];
            startRow = 1;
        }
        
        const headers = this.parseCSVLine(headerLine);
        const stocks = [];
        
        for (let i = startRow; i < lines.length; i++) {
            const values = this.parseCSVLine(lines[i]);
            if (values.length < 3) continue;
            
            const row = {};
            headers.forEach((h, idx) => {
                if (idx < values.length) {
                    row[h.toLowerCase().replace(/\s+/g, '_')] = values[idx];
                }
            });
            
            let symbol = row.symbol || '';
            if (symbol.startsWith('NSE:')) symbol = symbol.substring(4);
            if (symbol.startsWith('BOM:')) symbol = symbol.substring(4);
            if (!symbol || symbol === '%' || symbol === 'SYMBOL') continue;
            
            // Parse values
            const price = parseFloat(String(row.price || row.last_price || 0).replace(/,/g, ''));
            const change = parseFloat(row.change || 0);
            const changePercent = parseFloat(row.change_ || row.change_percent || 0);
            const volume = parseInt(String(row.volume || 0).replace(/,/g, ''), 10);
            
            if (isNaN(price) && isNaN(volume)) continue;
            
            stocks.push({
                symbol: symbol.trim(),
                company_name: row.name || row.company_name || null,
                last_price: isNaN(price) ? 0 : price,
                pchange: isNaN(change) ? 0 : change,
                per_change: isNaN(changePercent) ? 0 : changePercent,
                volume: isNaN(volume) ? 0 : volume,
                market_cap: null,
                pe_ratio: null,
                week_52_low: null,
                week_52_high: null,
                data_type: fileType,
                additional_data: JSON.stringify({ source: fileType })
            });
        }
        
        return stocks;
    }

    /**
     * Parse ACTIVES/GAINERS/DECLINERS CSV format (has Ticker, Name, Volume, Price, Change %)
     */
    parseRankingsCSV(csvText, fileType) {
        const lines = csvText.split('\n').filter(line => line.trim() && !line.includes('No.'));
        if (lines.length < 2) return [];
        
        // Find header row
        let headerLine = null;
        let startRow = 0;
        for (let i = 0; i < Math.min(5, lines.length); i++) {
            if (lines[i].toUpperCase().includes('TICKER') || 
                (lines[i].toUpperCase().includes('NAME') && lines[i].toUpperCase().includes('VOLUME'))) {
                headerLine = lines[i];
                startRow = i + 1;
                break;
            }
        }
        
        if (!headerLine) {
            headerLine = lines[0];
            startRow = 1;
        }
        
        const headers = this.parseCSVLine(headerLine);
        const stocks = [];
        
        for (let i = startRow; i < lines.length; i++) {
            const values = this.parseCSVLine(lines[i]);
            if (values.length < 3) continue;
            
            const row = {};
            headers.forEach((h, idx) => {
                if (idx < values.length) {
                    row[h.toLowerCase().replace(/\s+/g, '_')] = values[idx];
                }
            });
            
            let symbol = row.ticker || row.symbol || '';
            if (symbol.startsWith('NSE:')) symbol = symbol.substring(4);
            if (symbol.startsWith('BOM:')) symbol = symbol.substring(4);
            if (!symbol || symbol === '%' || symbol === 'TICKER') continue;
            
            // Parse values (handle arrow symbols in change)
            let changePercent = parseFloat(row.change_ || row.change_percent || row['change_%'] || 0);
            if (isNaN(changePercent)) {
                const changeStr = String(row.change_ || '');
                const match = changeStr.match(/(\d+(?:\.\d+)?)/);
                if (match) changePercent = parseFloat(match[1]);
            }
            
            const price = parseFloat(String(row.price || 0).replace(/,/g, ''));
            const volume = parseInt(String(row.volume || 0).replace(/,/g, ''), 10);
            const marketCap = this.parseMarketCap(row.market_cap);
            const peRatio = parseFloat(row.pe_ratio);
            const weekLow = parseFloat(row.week_52_low);
            const weekHigh = parseFloat(row.week_52_high);
            
            if (isNaN(price) && isNaN(volume)) continue;
            
            stocks.push({
                symbol: symbol.trim(),
                company_name: row.name || null,
                last_price: isNaN(price) ? 0 : price,
                pchange: 0,
                per_change: isNaN(changePercent) ? 0 : changePercent,
                volume: isNaN(volume) ? 0 : volume,
                market_cap: marketCap,
                pe_ratio: isNaN(peRatio) ? null : peRatio,
                week_52_low: isNaN(weekLow) ? null : weekLow,
                week_52_high: isNaN(weekHigh) ? null : weekHigh,
                data_type: fileType,
                additional_data: JSON.stringify({ source: fileType })
            });
        }
        
        return stocks;
    }

    /**
     * Parse market cap string like "₹931,749,841,329.00" to number
     */
    parseMarketCap(value) {
        if (!value) return null;
        const str = String(value);
        const match = str.match(/(\d+(?:,\d+)*(?:\.\d+)?)/);
        if (match) {
            return parseFloat(match[1].replace(/,/g, ''));
        }
        return null;
    }

    /**
     * Parse CSV line respecting quotes
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
        
        return result.map(f => f.replace(/^"|"$/g, '').replace(/""/g, '"'));
    }

    /**
     * Read all 4 CSV files
     */
    async readFromGoogleSheets() {
        LOG.info('[Excel File Sync] Reading 4 CSV files...');
        
        const allStocks = [];
        
        // Process DATA.csv
        try {
            LOG.info('[Excel File Sync] Fetching DATA...');
            const csvText = await this.fetchCSV(this.fileIds.data);
            const stocks = this.parseDataCSV(csvText, 'data');
            LOG.success(`[Excel File Sync] DATA: ${stocks.length} records`);
            allStocks.push(...stocks);
        } catch (err) {
            LOG.error('[Excel File Sync] DATA failed:', err.message);
        }
        
        // Process ACTIVES.csv
        try {
            LOG.info('[Excel File Sync] Fetching ACTIVES...');
            const csvText = await this.fetchCSV(this.fileIds.actives);
            const stocks = this.parseRankingsCSV(csvText, 'actives');
            LOG.success(`[Excel File Sync] ACTIVES: ${stocks.length} records`);
            allStocks.push(...stocks);
        } catch (err) {
            LOG.error('[Excel File Sync] ACTIVES failed:', err.message);
        }
        
        // Process GAINERS.csv
        try {
            LOG.info('[Excel File Sync] Fetching GAINERS...');
            const csvText = await this.fetchCSV(this.fileIds.gainers);
            const stocks = this.parseRankingsCSV(csvText, 'gainers');
            LOG.success(`[Excel File Sync] GAINERS: ${stocks.length} records`);
            allStocks.push(...stocks);
        } catch (err) {
            LOG.error('[Excel File Sync] GAINERS failed:', err.message);
        }
        
        // Process DECLINERS.csv
        try {
            LOG.info('[Excel File Sync] Fetching DECLINERS...');
            const csvText = await this.fetchCSV(this.fileIds.decliners);
            const stocks = this.parseRankingsCSV(csvText, 'decliners');
            LOG.success(`[Excel File Sync] DECLINERS: ${stocks.length} records`);
            allStocks.push(...stocks);
        } catch (err) {
            LOG.error('[Excel File Sync] DECLINERS failed:', err.message);
        }
        
        if (allStocks.length === 0) {
            throw new Error('No data found in any CSV file');
        }
        
        // Remove duplicates by symbol (keep first occurrence)
        const uniqueStocks = [];
        const seenSymbols = new Set();
        for (const stock of allStocks) {
            if (!seenSymbols.has(stock.symbol)) {
                seenSymbols.add(stock.symbol);
                uniqueStocks.push(stock);
            }
        }
        
        LOG.success(`[Excel File Sync] Total: ${uniqueStocks.length} unique records (from ${allStocks.length} raw)`);
        return uniqueStocks;
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
            // Read all CSV files
            const stocks = await this.readFromGoogleSheets();
            
            if (stocks.length === 0) {
                throw new Error('No valid stocks found');
            }
            
            // Show sample
            LOG.info(`[Excel File Sync] Sample: ${stocks[0].symbol} @ ₹${stocks[0].last_price} (${stocks[0].data_type})`);
            
            // Database operations
            const pool = require('../database').getPool();
            if (!pool) {
                LOG.error('[Excel File Sync] No database pool');
                this.isRunning = false;
                return;
            }

            const connection = await pool.getConnection();
            
            try {
                // Get current count
                const [countResult] = await connection.query('SELECT COUNT(*) as count FROM live_stock_data');
                LOG.info(`[Excel File Sync] Current records in DB: ${countResult[0].count}`);
                
                // Clear existing data
                await connection.query('TRUNCATE TABLE live_stock_data');
                LOG.info('[Excel File Sync] Truncated live_stock_data');
                
                // Insert new data in batches
                const batchSize = 500;
                let inserted = 0;
                
                for (let i = 0; i < stocks.length; i += batchSize) {
                    const batch = stocks.slice(i, i + batchSize);
                    const values = batch.map(s => [
                        s.symbol, s.company_name, s.last_price,
                        s.pchange, s.per_change, s.volume,
                        s.market_cap, s.pe_ratio,
                        s.week_52_low, s.week_52_high,
                        s.data_type, s.additional_data
                    ]);
                    
                    const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
                    
                    const [result] = await connection.query(`
                        INSERT INTO live_stock_data 
                        (symbol, company_name, last_price, pchange, per_change, volume, 
                         market_cap, pe_ratio, week_52_low, week_52_high, data_type, additional_data)
                        VALUES ${placeholders}
                    `, values.flat());
                    
                    inserted += result.affectedRows;
                    LOG.info(`[Excel File Sync] Inserted batch ${Math.floor(i/batchSize)+1}: ${result.affectedRows} rows`);
                }
                
                const syncDuration = Date.now() - syncStartTime;
                this.lastSyncTime = new Date();
                this.lastSyncStatus = 'success';
                this.lastSyncError = null;

                LOG.success(`[Excel File Sync] ✅ COMPLETE: ${inserted} records inserted in ${syncDuration}ms`);

                // Generate ML features (optional)
                try {
                    await featureEngineeringService.generateFeaturesForML();
                    LOG.success('[Excel File Sync] Features generated');
                } catch (featureError) {
                    LOG.warning('Feature generation failed:', featureError.message);
                }

            } finally {
                connection.release();
            }

        } catch (error) {
            const syncDuration = Date.now() - syncStartTime;
            this.lastSyncStatus = 'error';
            this.lastSyncError = error.message;
            LOG.error(`[Excel File Sync] ❌ FAILED after ${syncDuration}ms: ${error.message}`);
        } finally {
            this.isRunning = false;
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
            enabled: config.schedule?.enabled || false
        };
    }
}

module.exports = ExcelFileSyncJob;