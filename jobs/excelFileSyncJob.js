/**
 * Excel File Sync Job
 * Reads 4 Google Drive CSV files and syncs to live_stock_data
 * Runs every 35 minutes
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
            LOG.warning('[Excel File Sync] Job is disabled in config');
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

        // Run initial sync after 3 seconds
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
     * Fetch and parse CSV from Google Drive
     */
    async fetchAndParseCSV(url, type) {
        try {
            LOG.info(`[Excel File Sync] Fetching ${type}...`);
            
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
            const allLines = csvText.split('\n');
            const lines = allLines.filter(line => line.trim().length > 0);
            LOG.info(`[Excel File Sync] ${type}: ${lines.length} total lines`);
            
            if (lines.length < 3) return [];
            
            // Find header row based on file type
            let headerLine = null;
            let startRow = 0;
            
            if (type === 'data') {
                // DATA.csv format: Row 0 has "ENTER SYMBOL IN THIS COLUMN", Row 1 has actual headers
                for (let i = 0; i < Math.min(10, lines.length); i++) {
                    const line = lines[i].toUpperCase();
                    if (line.includes('SYMBOL') && (line.includes('NAME') || line.includes('PRICE'))) {
                        headerLine = lines[i];
                        startRow = i + 1;
                        LOG.info(`[Excel File Sync] ${type}: Found DATA header at row ${i}`);
                        break;
                    }
                }
                // If still not found, try row 1 (skip title row)
                if (!headerLine && lines.length > 1) {
                    headerLine = lines[1];
                    startRow = 2;
                    LOG.info(`[Excel File Sync] ${type}: Using row 1 as header`);
                }
            } else {
                // ACTIVES/GAINERS/DECLINERS format: Has title row then header row
                for (let i = 0; i < Math.min(10, lines.length); i++) {
                    const line = lines[i].toLowerCase();
                    if (line.includes('ticker') || 
                        line.includes('symbol') || 
                        (line.includes('name') && line.includes('volume')) ||
                        (line.includes('no.') && line.includes('row'))) {
                        headerLine = lines[i];
                        startRow = i + 1;
                        LOG.info(`[Excel File Sync] ${type}: Found header at row ${i}`);
                        break;
                    }
                }
            }
            
            if (!headerLine) {
                LOG.warning(`[Excel File Sync] ${type}: Could not find header row, using first line`);
                headerLine = lines[0];
                startRow = 1;
            }
            
            const headers = this.parseCSVLine(headerLine);
            // Clean headers: remove special chars, convert to lowercase
            const cleanHeaders = headers.map(h => 
                h.toLowerCase().replace(/[^a-z0-9_]/g, '').replace(/^_+|_+$/g, '')
            );
            LOG.info(`[Excel File Sync] ${type}: Headers: ${cleanHeaders.slice(0, 6).join(', ')}`);
            
            const stocks = [];
            
            // Process data rows
            for (let i = startRow; i < lines.length; i++) {
                if (!lines[i].trim()) continue;
                
                const values = this.parseCSVLine(lines[i]);
                if (values.length < 2) continue;
                
                const row = {};
                cleanHeaders.forEach((header, idx) => {
                    if (idx < values.length && values[idx] && values[idx].trim()) {
                        row[header] = values[idx].trim();
                    }
                });
                
                // Extract symbol - try multiple possible column names
                let symbol = row.symbol || row.ticker || row.scripname || '';
                
                // If symbol contains NSE: or BOM:, clean it
                if (symbol && symbol.includes(':')) {
                    symbol = symbol.split(':')[1];
                }
                
                // Skip invalid symbols
                if (!symbol || symbol === '%' || symbol === 'symbol' || symbol === 'ticker' || symbol.length < 2) {
                    continue;
                }
                
                // Clean symbol - remove special characters, keep only alphanumeric and dots
                symbol = symbol.replace(/[^A-Za-z0-9.]/g, '').toUpperCase().trim();
                if (symbol.length === 0) continue;
                
                // Extract name
                const name = row.name || row.companyname || '';
                
                // Extract price - handle various formats
                let price = 0;
                const priceValue = row.price || row.lastprice || row.last_price || '';
                if (priceValue) {
                    const cleaned = String(priceValue).replace(/[^0-9.-]/g, '');
                    price = parseFloat(cleaned);
                }
                if (isNaN(price)) price = 0;
                
                // Extract volume
                let volume = 0;
                const volumeValue = row.volume || '';
                if (volumeValue) {
                    const cleaned = String(volumeValue).replace(/[^0-9]/g, '');
                    volume = parseInt(cleaned, 10);
                }
                if (isNaN(volume)) volume = 0;
                
                // Extract change percent
                let changePercent = 0;
                const changeStr = row.change || row.changepercent || row.change_percent || row.change_;
                if (changeStr) {
                    const match = String(changeStr).match(/(\d+(?:\.\d+)?)/);
                    if (match) changePercent = parseFloat(match[1]);
                }
                if (isNaN(changePercent)) changePercent = 0;
                
                // Extract market cap (for ACTIVES/GAINERS/DECLINERS)
                let marketCap = null;
                const marketCapValue = row.marketcap || row.market_cap || '';
                if (marketCapValue) {
                    const cleaned = String(marketCapValue).replace(/[^0-9]/g, '');
                    marketCap = parseInt(cleaned, 10);
                    if (isNaN(marketCap)) marketCap = null;
                }
                
                // Extract PE ratio
                let peRatio = null;
                const peValue = row.peratio || row.pe_ratio || '';
                if (peValue) {
                    peRatio = parseFloat(peValue);
                    if (isNaN(peRatio)) peRatio = null;
                }
                
                // Skip if no meaningful data
                if (price === 0 && volume === 0 && marketCap === null) {
                    continue;
                }
                
                stocks.push({
                    symbol: symbol,
                    company_name: name || null,
                    last_price: price,
                    pchange: 0,
                    per_change: changePercent,
                    volume: volume,
                    market_cap: marketCap,
                    pe_ratio: peRatio,
                    week_52_low: null,
                    week_52_high: null,
                    data_type: type,
                    additional_data: JSON.stringify({ source: type, original_symbol: row.symbol || '' })
                });
            }
            
            if (stocks.length > 0) {
                LOG.success(`[Excel File Sync] ${type.toUpperCase()}: ${stocks.length} records parsed`);
                LOG.info(`[Excel File Sync] ${type} sample: ${stocks[0].symbol} - ₹${stocks[0].last_price}`);
            } else {
                LOG.warning(`[Excel File Sync] ${type.toUpperCase()}: 0 records parsed`);
            }
            
            return stocks;
            
        } catch (error) {
            LOG.error(`[Excel File Sync] ${type} failed:`, error.message);
            return [];
        }
    }

    /**
     * Main sync method
     */
    async sync(forceSync = false) {
        if (this.isRunning) {
            LOG.warning('[Excel File Sync] Already running, skipping...');
            return;
        }

        this.isRunning = true;
        const syncStartTime = Date.now();
        LOG.info(`[Excel File Sync] ========================================`);
        LOG.info(`[Excel File Sync] Starting sync (force: ${forceSync})`);

        try {
            // Fetch all 4 CSV files in parallel
            LOG.info('[Excel File Sync] Fetching all 4 CSV files...');
            
            const [dataStocks, activesStocks, gainersStocks, declinersStocks] = await Promise.all([
                this.fetchAndParseCSV(this.csvUrls.data, 'data'),
                this.fetchAndParseCSV(this.csvUrls.actives, 'actives'),
                this.fetchAndParseCSV(this.csvUrls.gainers, 'gainers'),
                this.fetchAndParseCSV(this.csvUrls.decliners, 'decliners')
            ]);
            
            LOG.info(`[Excel File Sync] Parse results:`);
            LOG.info(`  - DATA: ${dataStocks.length} records`);
            LOG.info(`  - ACTIVES: ${activesStocks.length} records`);
            LOG.info(`  - GAINERS: ${gainersStocks.length} records`);
            LOG.info(`  - DECLINERS: ${declinersStocks.length} records`);
            
            // Combine all stocks
            const allStocks = [...dataStocks, ...activesStocks, ...gainersStocks, ...declinersStocks];
            
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
            
            LOG.info(`[Excel File Sync] Total unique stocks: ${uniqueStocks.length} (from ${allStocks.length} raw)`);
            
            // Show sample of first few stocks
            if (uniqueStocks.length > 0) {
                LOG.info(`[Excel File Sync] Sample stocks:`);
                for (let i = 0; i < Math.min(3, uniqueStocks.length); i++) {
                    const s = uniqueStocks[i];
                    LOG.info(`  ${i+1}. ${s.symbol} - ₹${s.last_price} (${s.data_type})`);
                }
            }
            
            // Database operations
            const pool = require('../database').getPool();
            if (!pool) {
                LOG.error('[Excel File Sync] No database pool available');
                this.isRunning = false;
                return;
            }

            const connection = await pool.getConnection();
            
            try {
                // Get current count
                const [countResult] = await connection.query('SELECT COUNT(*) as count FROM live_stock_data');
                LOG.info(`[Excel File Sync] Current records in DB: ${countResult[0].count}`);
                
                // Clear existing data
                LOG.info('[Excel File Sync] Truncating live_stock_data...');
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
                    LOG.info(`[Excel File Sync] Inserted batch ${Math.floor(i/batchSize)+1}: ${result.affectedRows} rows`);
                }
                
                const syncDuration = Date.now() - syncStartTime;
                this.lastSyncTime = new Date();
                this.lastSyncStatus = 'success';
                this.lastSyncError = null;

                LOG.success(`[Excel File Sync] ✅ COMPLETE: ${inserted} records inserted in ${syncDuration}ms ✅`);

                // Verify insertion
                const [verify] = await connection.query('SELECT COUNT(*) as count FROM live_stock_data');
                LOG.info(`[Excel File Sync] Verification: ${verify[0].count} records in database`);
                
                // Show data type breakdown
                const [typeBreakdown] = await connection.query(`
                    SELECT data_type, COUNT(*) as count FROM live_stock_data GROUP BY data_type
                `);
                LOG.info(`[Excel File Sync] Data type breakdown:`);
                typeBreakdown.forEach(t => {
                    LOG.info(`  - ${t.data_type}: ${t.count} records`);
                });

                // Generate ML features with error handling (non-critical)
                try {
                    LOG.info('[Excel File Sync] Generating ML features...');
                    await featureEngineeringService.generateFeaturesForML();
                    LOG.success('[Excel File Sync] ML features generated successfully');
                } catch (featureError) {
                    // Log as warning, not error - feature generation is optional
                    LOG.warning('[Excel File Sync] Feature generation skipped (non-critical):', featureError.message);
                }

            } catch (dbError) {
                LOG.error('[Excel File Sync] Database error:', dbError.message);
                throw dbError;
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
            LOG.info(`[Excel File Sync] ========================================`);
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
            csvUrls: Object.keys(this.csvUrls)
        };
    }
}

module.exports = ExcelFileSyncJob;