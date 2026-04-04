/**
 * Excel File Sync Job - Reads 4 Google Drive CSV files
 */
const config = require('../config/tradingConfig');
const featureEngineeringService = require('../services/featureEngineeringService');
const LOG = require('../utils/logger');
const axios = require('axios');
require('dotenv').config();

class ExcelFileSyncJob {
    constructor() {
        this.isRunning = false;
        this.lastSyncTime = null;
        this.lastSyncStatus = null;
        this.lastSyncError = null;
        this.cronJob = null;
        this.initialized = false;
        
        // Direct download URLs for your 4 public files
        this.csvUrls = {
            data: 'https://drive.google.com/uc?export=download&id=1pAUr1ipvh78rzkJlbi9KW7ZaJTimDAeg',
            actives: 'https://drive.google.com/uc?export=download&id=1q7aT9YET-QdaZZjQ6DSJe8scVZaD0WiE',
            gainers: 'https://drive.google.com/uc?export=download&id=12v7T5qEbAO98TJQV8qV-C0oRrBOlav4k',
            decliners: 'https://drive.google.com/uc?export=download&id=1vRj6ms73Qnc1sFgnNcdldW3YXBkNkgJz'
        };
        
        this.CRON_EXPRESSION = process.env.SYNC_CRON || '*/35 * * * *';
        
        LOG.info('[Excel File Sync] Initialized with 4 CSV URLs');
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

        const cron = require('node-cron');
        this.cronJob = cron.schedule(this.CRON_EXPRESSION, async () => {
            LOG.info(`[Excel File Sync] Cron triggered`);
            await this.sync();
        }, {
            scheduled: true,
            timezone: process.env.SYNC_TIMEZONE || "Asia/Kolkata"
        });

        LOG.success(`[Excel File Sync] Scheduled: ${this.CRON_EXPRESSION}`);
        this.initialized = true;

        // Run initial sync immediately
        setTimeout(async () => {
            LOG.info('[Excel File Sync] Running initial sync...');
            await this.sync(true);
        }, 3000);
    }

    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            LOG.info('[Excel File Sync] Stopped');
        }
        this.initialized = false;
    }

    /**
     * Simple method to fetch and parse CSV from Google Drive
     */
    async fetchAndParseCSV(url, type) {
        try {
            LOG.info(`[Excel File Sync] Fetching ${type} from URL...`);
            
            const response = await axios.get(url, {
                timeout: 30000,
                responseType: 'text',
                headers: { 'Accept': 'text/csv,text/plain,*/*' }
            });
            
            const csvText = response.data;
            if (!csvText || csvText.length < 100) {
                LOG.warning(`[Excel File Sync] ${type}: CSV too small (${csvText?.length || 0} bytes)`);
                return [];
            }
            
            // Split into lines
            const lines = csvText.split('\n').filter(line => line.trim().length > 0);
            LOG.info(`[Excel File Sync] ${type}: ${lines.length} total lines`);
            
            if (lines.length < 2) return [];
            
            // Parse headers from first line
            const headers = this.parseCSVLine(lines[0]);
            LOG.info(`[Excel File Sync] ${type}: Headers: ${headers.slice(0, 5).join(', ')}...`);
            
            const stocks = [];
            
            // Process each data row
            for (let i = 1; i < lines.length; i++) {
                const values = this.parseCSVLine(lines[i]);
                if (values.length < 2) continue;
                
                const row = {};
                headers.forEach((header, idx) => {
                    if (idx < values.length) {
                        row[header.toLowerCase()] = values[idx];
                    }
                });
                
                // Extract symbol (handle NSE: prefix)
                let symbol = row.symbol || row.ticker || '';
                if (symbol.startsWith('nse:')) symbol = symbol.substring(4);
                if (symbol.startsWith('bom:')) symbol = symbol.substring(4);
                if (!symbol || symbol === '%' || symbol === 'symbol') continue;
                
                // Extract price and volume
                let price = parseFloat(String(row.price || row.last_price || 0).replace(/,/g, ''));
                let volume = parseInt(String(row.volume || 0).replace(/,/g, ''), 10);
                let changePercent = parseFloat(row.change_ || row['change (%)'] || row.change_percent || 0);
                
                // For ACTIVES/GAINERS/DECLINERS, price might be in different column
                if (isNaN(price) && row.price) {
                    price = parseFloat(String(row.price).replace(/[^0-9.-]/g, ''));
                }
                
                if (isNaN(volume) && row.volume) {
                    volume = parseInt(String(row.volume).replace(/[^0-9]/g, ''), 10);
                }
                
                // Skip if no valid data
                if (isNaN(price) && isNaN(volume)) continue;
                
                stocks.push({
                    symbol: symbol.toUpperCase().trim(),
                    company_name: row.name || row.company_name || null,
                    last_price: isNaN(price) ? 0 : price,
                    pchange: 0,
                    per_change: isNaN(changePercent) ? 0 : changePercent,
                    volume: isNaN(volume) ? 0 : volume,
                    market_cap: null,
                    pe_ratio: null,
                    week_52_low: null,
                    week_52_high: null,
                    data_type: type,
                    additional_data: null
                });
            }
            
            LOG.success(`[Excel File Sync] ${type.toUpperCase()}: ${stocks.length} records parsed`);
            return stocks;
            
        } catch (error) {
            LOG.error(`[Excel File Sync] ${type} failed:`, error.message);
            return [];
        }
    }

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

    async sync(forceSync = false) {
        if (this.isRunning) {
            LOG.warning('[Excel File Sync] Already running');
            return;
        }

        this.isRunning = true;
        const syncStartTime = Date.now();
        LOG.info(`[Excel File Sync] Starting sync (force: ${forceSync})`);

        try {
            // Fetch all 4 CSV files
            const [dataStocks, activesStocks, gainersStocks, declinersStocks] = await Promise.all([
                this.fetchAndParseCSV(this.csvUrls.data, 'data'),
                this.fetchAndParseCSV(this.csvUrls.actives, 'actives'),
                this.fetchAndParseCSV(this.csvUrls.gainers, 'gainers'),
                this.fetchAndParseCSV(this.csvUrls.decliners, 'decliners')
            ]);
            
            // Combine all stocks
            const allStocks = [...dataStocks, ...activesStocks, ...gainersStocks, ...declinersStocks];
            
            if (allStocks.length === 0) {
                throw new Error('No data found in any CSV file');
            }
            
            // Remove duplicates (keep first by symbol)
            const uniqueStocks = [];
            const seen = new Set();
            for (const stock of allStocks) {
                if (!seen.has(stock.symbol)) {
                    seen.add(stock.symbol);
                    uniqueStocks.push(stock);
                }
            }
            
            LOG.info(`[Excel File Sync] Total unique stocks: ${uniqueStocks.length}`);
            
            if (uniqueStocks.length > 0) {
                LOG.info(`[Excel File Sync] Sample: ${uniqueStocks[0].symbol} - ₹${uniqueStocks[0].last_price} (${uniqueStocks[0].data_type})`);
            }
            
            // Database operations
            const pool = require('../database').getPool();
            if (!pool) {
                LOG.error('[Excel File Sync] No database pool');
                this.isRunning = false;
                return;
            }

            const connection = await pool.getConnection();
            
            try {
                // Clear existing data
                const [oldCount] = await connection.query('SELECT COUNT(*) as count FROM live_stock_data');
                LOG.info(`[Excel File Sync] Clearing ${oldCount[0].count} existing records`);
                
                await connection.query('TRUNCATE TABLE live_stock_data');
                
                // Insert new data in batches
                const batchSize = 500;
                let inserted = 0;
                
                for (let i = 0; i < uniqueStocks.length; i += batchSize) {
                    const batch = uniqueStocks.slice(i, i + batchSize);
                    const values = batch.map(s => [
                        s.symbol, 
                        s.company_name, 
                        s.last_price,
                        s.pchange, 
                        s.per_change, 
                        s.volume,
                        s.market_cap, 
                        s.pe_ratio,
                        s.week_52_low, 
                        s.week_52_high,
                        s.data_type, 
                        s.additional_data
                    ]);
                    
                    const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
                    
                    const [result] = await connection.query(`
                        INSERT INTO live_stock_data 
                        (symbol, company_name, last_price, pchange, per_change, volume, 
                         market_cap, pe_ratio, week_52_low, week_52_high, data_type, additional_data)
                        VALUES ${placeholders}
                    `, values.flat());
                    
                    inserted += result.affectedRows;
                }
                
                const syncDuration = Date.now() - syncStartTime;
                this.lastSyncTime = new Date();
                this.lastSyncStatus = 'success';
                this.lastSyncError = null;

                LOG.success(`[Excel File Sync] ✅ COMPLETE: ${inserted} records in ${syncDuration}ms`);

                // Verify insertion
                const [verify] = await connection.query('SELECT COUNT(*) as count FROM live_stock_data');
                LOG.info(`[Excel File Sync] Verification: ${verify[0].count} records in database`);

                // Generate ML features (optional)
                try {
                    await featureEngineeringService.generateFeaturesForML();
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
            LOG.error(error.stack);
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