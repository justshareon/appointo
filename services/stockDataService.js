/**
 * Stock Data Service
 * Manages stock data in MySQL database (live_stock_data and stock_data_history)
 * Falls back to in-memory storage when MySQL is not available
 * Provides methods to query, insert, archive, and truncate stock data
 */
const db = require('../database');
const LOG = require('../utils/logger');

class StockDataService {
    constructor() {
        this.initialized = false;
        // In-memory storage when MySQL is not available
        this.inMemoryData = {
            live_stock_data: [],
            stock_data_history: []
        };
    }

    /**
     * Check if MySQL is available
     */
    isMySQLAvailable() {
        return !!db.getPool();
    }

    /**
     * Get in-memory database
     */
    getInMemoryDb() {
        const inMemoryDb = db.inMemoryDb || {};
        if (!inMemoryDb.stockData) {
            inMemoryDb.stockData = {
                live_stock_data: [],
                stock_data_history: []
            };
        }
        return inMemoryDb.stockData;
    }

    /**
     * Initialize database tables
     * Creates live_stock_data and stock_data_history tables if they don't exist
     */
    async initializeTables() {
        const pool = db.getPool();
        if (!pool) {
            LOG.warning('[Stock Data] MySQL not available, tables cannot be created');
            return false;
        }

        try {
            // Create live_stock_data table with data_type support and additional fields
            await pool.query(`
                CREATE TABLE IF NOT EXISTS live_stock_data (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    symbol VARCHAR(20) NOT NULL,
                    company_name VARCHAR(255),
                    last_price DECIMAL(10, 2),
                    pchange DECIMAL(10, 2),
                    per_change DECIMAL(5, 2),
                    volume BIGINT,
                    market_cap BIGINT,
                    pe_ratio DECIMAL(10, 2),
                    week_52_low DECIMAL(10, 2),
                    week_52_high DECIMAL(10, 2),
                    data_type ENUM('gainers', 'decliners', 'actives', 'data') DEFAULT 'data',
                    additional_data JSON,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY unique_symbol_type (symbol, data_type),
                    INDEX idx_symbol (symbol),
                    INDEX idx_data_type (data_type),
                    INDEX idx_last_updated (last_updated)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
            
            // Add data_type column if table exists but column doesn't (migration)
            try {
                await pool.query(`
                    ALTER TABLE live_stock_data 
                    ADD COLUMN IF NOT EXISTS data_type ENUM('gainers', 'decliners', 'actives', 'data') DEFAULT 'data' AFTER market_cap
                `);
            } catch (err) {
                // Column might already exist, ignore
                if (!err.message.includes('Duplicate column name')) {
                    LOG.warning('[Stock Data] Migration note:', err.message);
                }
            }
            
            // Update unique constraint if needed
            try {
                await pool.query(`
                    ALTER TABLE live_stock_data 
                    DROP INDEX IF EXISTS symbol
                `);
            } catch (err) {
                // Index might not exist, ignore
            }
            
            try {
                await pool.query(`
                    ALTER TABLE live_stock_data 
                    ADD UNIQUE KEY IF NOT EXISTS unique_symbol_type (symbol, data_type)
                `);
            } catch (err) {
                // Constraint might already exist, ignore
                if (!err.message.includes('Duplicate key name')) {
                    LOG.warning('[Stock Data] Unique constraint note:', err.message);
                }
            }

            // Create stock_data_history table with data_type support
            await pool.query(`
                CREATE TABLE IF NOT EXISTS stock_data_history (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    symbol VARCHAR(20) NOT NULL,
                    company_name VARCHAR(255),
                    last_price DECIMAL(10, 2),
                    pchange DECIMAL(10, 2),
                    per_change DECIMAL(5, 2),
                    volume BIGINT,
                    market_cap BIGINT,
                    data_type ENUM('gainers', 'decliners', 'actives', 'data') DEFAULT 'data',
                    archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_symbol (symbol),
                    INDEX idx_data_type (data_type),
                    INDEX idx_archived_at (archived_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
            
            // Add data_type column if table exists but column doesn't (migration)
            try {
                await pool.query(`
                    ALTER TABLE stock_data_history 
                    ADD COLUMN IF NOT EXISTS data_type ENUM('gainers', 'decliners', 'actives', 'data') DEFAULT 'data' AFTER market_cap
                `);
            } catch (err) {
                // Column might already exist, ignore
                if (!err.message.includes('Duplicate column name')) {
                    LOG.warning('[Stock Data] History migration note:', err.message);
                }
            }
            
            // Add pe_ratio, week_52_low, week_52_high columns if they don't exist (migration)
            try {
                await pool.query(`
                    ALTER TABLE stock_data_history 
                    ADD COLUMN IF NOT EXISTS pe_ratio DECIMAL(10, 2) AFTER market_cap,
                    ADD COLUMN IF NOT EXISTS week_52_low DECIMAL(10, 2) AFTER pe_ratio,
                    ADD COLUMN IF NOT EXISTS week_52_high DECIMAL(10, 2) AFTER week_52_low
                `);
            } catch (err) {
                // Columns might already exist, ignore
                if (!err.message.includes('Duplicate column name')) {
                    LOG.warning('[Stock Data] History migration note (additional fields):', err.message);
                }
            }
            
            // Add additional_data JSON column if it doesn't exist (migration)
            try {
                await pool.query(`
                    ALTER TABLE live_stock_data 
                    ADD COLUMN IF NOT EXISTS additional_data JSON AFTER week_52_high
                `);
            } catch (err) {
                if (!err.message.includes('Duplicate column name')) {
                    LOG.warning('[Stock Data] Migration note (additional_data):', err.message);
                }
            }
            
            try {
                await pool.query(`
                    ALTER TABLE stock_data_history 
                    ADD COLUMN IF NOT EXISTS additional_data JSON AFTER week_52_high
                `);
            } catch (err) {
                if (!err.message.includes('Duplicate column name')) {
                    LOG.warning('[Stock Data] History migration note (additional_data):', err.message);
                }
            }

            this.initialized = true;
            LOG.success('[Stock Data] Database tables initialized successfully');
            return true;
        } catch (error) {
            LOG.error('[Stock Data] Error initializing tables:', error.message);
            throw error;
        }
    }

    /**
     * Archive current live_stock_data to stock_data_history
     * @returns {Promise<number>} Number of records archived
     */
    async archiveCurrentData() {
        if (!this.isMySQLAvailable()) {
            // Use in-memory storage
            const inMemoryDb = this.getInMemoryDb();
            const liveData = [...inMemoryDb.live_stock_data];
            inMemoryDb.stock_data_history.push(...liveData.map(item => ({
                ...item,
                archived_at: new Date()
            })));
            const { HISTORY_CAP, capArray } = require('../database/featureMemoryManager');
            capArray(inMemoryDb.stock_data_history, HISTORY_CAP * Math.max(liveData.length, 1));
            LOG.info(`[Stock Data] Archived ${liveData.length} records to in-memory history (capped)`);
            return liveData.length;
        }

        const pool = db.getPool();

        try {
            // Get all current live data
            const [liveData] = await pool.query('SELECT * FROM live_stock_data');
            
            if (liveData.length === 0) {
                LOG.info('[Stock Data] No live data to archive');
                return 0;
            }

            // Insert into history table (include all fields)
            const archiveValues = liveData.map(row => [
                row.symbol,
                row.company_name,
                row.last_price,
                row.pchange,
                row.per_change,
                row.volume,
                row.market_cap,
                row.pe_ratio || null,
                row.week_52_low || null,
                row.week_52_high || null,
                row.data_type || 'data',
                row.additional_data ? (typeof row.additional_data === 'string' ? row.additional_data : JSON.stringify(row.additional_data)) : null
            ]);

            const placeholders = archiveValues.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
            const query = `
                INSERT INTO stock_data_history 
                (symbol, company_name, last_price, pchange, per_change, volume, market_cap, pe_ratio, week_52_low, week_52_high, data_type, additional_data)
                VALUES ${placeholders}
            `;

            const flatValues = archiveValues.flat();
            await pool.query(query, flatValues);

            LOG.success(`[Stock Data] Archived ${liveData.length} records to history table`);
            return liveData.length;
        } catch (error) {
            LOG.error('[Stock Data] Error archiving data:', error.message);
            throw error;
        }
    }

    /**
     * Truncate live_stock_data table
     */
    async truncateLiveData() {
        if (!this.isMySQLAvailable()) {
            // Use in-memory storage
            const inMemoryDb = this.getInMemoryDb();
            inMemoryDb.live_stock_data = [];
            LOG.info('[Stock Data] Live stock data truncated in memory');
            return;
        }

        const pool = db.getPool();
        try {
            await pool.query('TRUNCATE TABLE live_stock_data');
            LOG.info('[Stock Data] Live stock data table truncated');
        } catch (error) {
            LOG.error('[Stock Data] Error truncating live data:', error.message);
            throw error;
        }
    }

    /**
     * Insert stock data into live_stock_data table
     * @param {Array} stockData - Array of stock data objects
     * @returns {Promise<number>} Number of records inserted
     */
    async insertLiveData(stockData) {
        if (!stockData || stockData.length === 0) {
            LOG.warning('[Stock Data] No stock data to insert');
            return 0;
        }

        if (!this.isMySQLAvailable()) {
            // Use in-memory storage
            const inMemoryDb = this.getInMemoryDb();
            // Clear existing and insert new
            inMemoryDb.live_stock_data = stockData.map(stock => ({
                ...stock,
                id: Date.now() + Math.random(), // Simple ID generation
                last_updated: new Date()
            }));
            LOG.success(`[Stock Data] Inserted ${stockData.length} records in memory`);
            return stockData.length;
        }

        const pool = db.getPool();

        try {
            // Prepare values for bulk insert (include all fields)
            const values = stockData.map(stock => [
                stock.symbol,
                stock.company_name,
                stock.last_price,
                stock.pchange,
                stock.per_change,
                stock.volume,
                stock.market_cap,
                stock.pe_ratio || null,
                stock.week_52_low || null,
                stock.week_52_high || null,
                stock.data_type || 'data'
            ]);

            const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
            const query = `
                INSERT INTO live_stock_data 
                (symbol, company_name, last_price, pchange, per_change, volume, market_cap, pe_ratio, week_52_low, week_52_high, data_type)
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
                    last_updated = CURRENT_TIMESTAMP
            `;

            const flatValues = values.flat();
            const [result] = await pool.query(query, flatValues);

            LOG.success(`[Stock Data] Inserted/updated ${stockData.length} records in live_stock_data`);
            return result.affectedRows || stockData.length;
        } catch (error) {
            LOG.error('[Stock Data] Error inserting live data:', error.message);
            throw error;
        }
    }

    /**
     * Get stock quote by symbol
     * @param {string} symbol - Stock symbol
     * @returns {Promise<Object|null>} Stock data or null
     */
    async getStockQuote(symbol) {
        if (!this.isMySQLAvailable()) {
            // Use in-memory storage
            const inMemoryDb = this.getInMemoryDb();
            const stock = inMemoryDb.live_stock_data.find(s => s.symbol === symbol.toUpperCase());
            if (!stock) return null;
            const lastWeekVol = await this.getLastWeekVolume(symbol);
            return await this.formatStockData(stock, lastWeekVol);
        }

        const pool = db.getPool();
        try {
            const [rows] = await pool.query(
                'SELECT * FROM live_stock_data WHERE symbol = ?',
                [symbol.toUpperCase()]
            );

            if (rows.length === 0) return null;
            const lastWeekVol = await this.getLastWeekVolume(symbol);
            return await this.formatStockData(rows[0], lastWeekVol);
        } catch (error) {
            LOG.error(`[Stock Data] Error getting quote for ${symbol}:`, error.message);
            return null;
        }
    }

    /**
     * Get multiple stock quotes by symbols
     * @param {Array} symbols - Array of stock symbols
     * @returns {Promise<Array>} Array of stock data
     */
    async getStockQuotes(symbols) {
        if (!symbols || symbols.length === 0) {
            return [];
        }

        if (!this.isMySQLAvailable()) {
            // Use in-memory storage
            const inMemoryDb = this.getInMemoryDb();
            const upperSymbols = symbols.map(s => s.toUpperCase());
            const stocks = inMemoryDb.live_stock_data.filter(s => 
                upperSymbols.includes(s.symbol)
            );
            // Fetch volumes in batch
            const volumeMap = new Map();
            const volumePromises = stocks.map(async (stock) => {
                if (stock.symbol) {
                    const vol = await this.getLastWeekVolume(stock.symbol);
                    return [stock.symbol.toUpperCase(), vol];
                }
                return null;
            });
            const volumes = await Promise.all(volumePromises);
            volumes.forEach(result => {
                if (result) volumeMap.set(result[0], result[1]);
            });
            
            return await Promise.all(
                stocks.map(stock => this.formatStockData(stock, volumeMap.get(stock.symbol?.toUpperCase()) || null))
            );
        }

        const pool = db.getPool();
        try {
            const placeholders = symbols.map(() => '?').join(', ');
            const [rows] = await pool.query(
                `SELECT * FROM live_stock_data WHERE symbol IN (${placeholders})`,
                symbols.map(s => s.toUpperCase())
            );

            // Fetch volumes in batch
            const volumeMap = new Map();
            if (rows.length > 0) {
                const symbols = rows.map(r => r.symbol).filter(Boolean);
                const volumePromises = symbols.map(async (symbol) => {
                    const vol = await this.getLastWeekVolume(symbol);
                    return [symbol.toUpperCase(), vol];
                });
                const volumes = await Promise.all(volumePromises);
                volumes.forEach(([symbol, vol]) => {
                    if (symbol) volumeMap.set(symbol, vol);
                });
            }
            
            return await Promise.all(
                rows.map(row => this.formatStockData(row, volumeMap.get(row.symbol?.toUpperCase()) || null))
            );
        } catch (error) {
            LOG.error('[Stock Data] Error getting quotes:', error.message);
            return [];
        }
    }

    /**
     * Get all live stock data
     * @returns {Promise<Array>} Array of all stock data
     */
    async getAllStocks() {
        if (!this.isMySQLAvailable()) {
            LOG.info(`[Stock Data] getAllStocks in memory anuj`);

            // Use in-memory storage
            const inMemoryDb = this.getInMemoryDb();
            const stocks = inMemoryDb.live_stock_data
                .sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''));
            
            // Fetch volumes in batch for in-memory data too
            const volumeMap = new Map();
            if (stocks.length > 0) {
                const symbols = stocks.map(s => s.symbol).filter(Boolean);
                const volumePromises = symbols.map(async (symbol) => {
                    const vol = await this.getLastWeekVolume(symbol);
                    return [symbol.toUpperCase(), vol];
                });
                const volumes = await Promise.all(volumePromises);
                volumes.forEach(([symbol, vol]) => {
                    if (symbol) volumeMap.set(symbol, vol);
                });
            }
            
            // Format all stocks with their volumes
            const formatted = await Promise.all(
                stocks.map(stock => this.formatStockData(stock, volumeMap.get(stock.symbol?.toUpperCase()) || null))
            );
            
            // Filter out null values (invalid stocks)
            return formatted.filter(stock => stock !== null);
        }

        const pool = db.getPool();
        try {
            const [rows] = await pool.query('SELECT * FROM live_stock_data ORDER BY symbol');
            LOG.info(`[Stock Data] getAllStocksanuj: Found ${rows.length} rows from database`);
            
            // Fetch volumes in batch
            const volumeMap = new Map();
            if (rows.length > 0) {
                const symbols = rows.map(r => r.symbol).filter(Boolean);
                LOG.info(`[Stock Data] getAllStocksanuj1: Fetching volumes for ${symbols.length} symbols`);
                const volumePromises = symbols.map(async (symbol) => {
                    const vol = await this.getLastWeekVolume(symbol);
                    return [symbol.toUpperCase(), vol];
                });
                const volumes = await Promise.all(volumePromises);
                volumes.forEach(([symbol, vol]) => {
                    if (symbol) volumeMap.set(symbol, vol);
                });
            }
            
            // Format all rows with their volumes
            const formatted = await Promise.all(
                rows.map(row => this.formatStockData(row, volumeMap.get(row.symbol?.toUpperCase()) || null))
            );
            
            // Filter out null values and log sample
            const validStocks = formatted.filter(stock => stock !== null);
            if (validStocks.length > 0) {
                LOG.info(`[Stock Data] getAllStocksanuj2: Sample stock (first):`, {
                    symbol: validStocks[0].symbol,
                    name: validStocks[0].name,
                    price: validStocks[0].price,
                    pchange: validStocks[0].pchange,
                    changePercent: validStocks[0].changePercent
                });
            }
            
            return validStocks;
        } catch (error) {
            LOG.error('[Stock Data] Error getting all stocks:', error.message);
            return [];
        }
    }

    /**
     * Get top gainers
     * @param {number} limit - Number of top gainers to return
     * @returns {Promise<Array>} Array of top gainers
     */
    async getTopGainers(limit = 10) {
        return this.getStocksByType('gainers', limit);
    }
    
    /**
     * Get top losers/decliners
     * @param {number} limit - Number of top losers to return
     * @returns {Promise<Array>} Array of top losers
     */
    async getTopLosers(limit = 10) {
        return this.getStocksByType('decliners', limit);
    }
    
    /**
     * Get active stocks
     * @param {number} limit - Number of active stocks to return
     * @returns {Promise<Array>} Array of active stocks
     */
    async getActives(limit = 10) {
        return this.getStocksByType('actives', limit);
    }
    
    /**
     * Get all data stocks
     * @param {number} limit - Number of stocks to return
     * @returns {Promise<Array>} Array of stocks
     */
    async getDataStocks(limit = 100) {
        return this.getStocksByType('data', limit);
    }
    
    /**
     * Get stocks by data type
     * @param {string} dataType - Type: 'gainers', 'decliners', 'actives', 'data'
     * @param {number} limit - Number of stocks to return
     * @returns {Promise<Array>} Array of stocks
     */
    async getStocksByType(dataType, limit = 10) {
        LOG.info(`[Stock Data] getStocksByType called: dataType=${dataType}, limit=${limit}`);
        
        if (!this.isMySQLAvailable()) {
            // Use in-memory storage
            LOG.info('[Stock Data] Using in-memory storage');
            const inMemoryDb = this.getInMemoryDb();
            const allStocks = inMemoryDb.live_stock_data || [];
            LOG.info(`[Stock Data] In-memory total stocks: ${allStocks.length}`);
            
            const filtered = allStocks.filter(s => s.data_type === dataType);
            LOG.info(`[Stock Data] Filtered by type '${dataType}': ${filtered.length} stocks`);
            
            const sorted = filtered.sort((a, b) => {
                // For gainers/decliners, sort by per_change
                if (dataType === 'gainers' || dataType === 'decliners') {
                    const aChange = a.per_change || 0;
                    const bChange = b.per_change || 0;
                    return dataType === 'gainers' 
                        ? bChange - aChange 
                        : aChange - bChange;
                }
                // For actives, sort by volume
                if (dataType === 'actives') {
                    return (b.volume || 0) - (a.volume || 0);
                }
                // For data, sort by symbol
                return (a.symbol || '').localeCompare(b.symbol || '');
            });
            
            const limited = sorted.slice(0, limit);
            LOG.info(`[Stock Data] Returning ${limited.length} stocks after sorting and limiting`);
            
            if (limited.length > 0) {
                LOG.info(`[Stock Data] Sample stock:`, {
                    symbol: limited[0].symbol,
                    data_type: limited[0].data_type,
                    per_change: limited[0].per_change
                });
            }
            
            // Fetch volumes in batch
            const volumeMap = new Map();
            const volumePromises = limited.map(async (stock) => {
                if (stock.symbol) {
                    const vol = await this.getLastWeekVolume(stock.symbol);
                    return [stock.symbol.toUpperCase(), vol];
                }
                return null;
            });
            const volumes = await Promise.all(volumePromises);
            volumes.forEach(result => {
                if (result) volumeMap.set(result[0], result[1]);
            });
            
            return await Promise.all(
                limited.map(stock => this.formatStockData(stock, volumeMap.get(stock.symbol?.toUpperCase()) || null))
            );
        }

        const pool = db.getPool();
        try {
            // First check total count
            const [countResult] = await pool.query('SELECT COUNT(*) as total FROM live_stock_data');
            const totalCount = countResult[0].total;
            LOG.info(`[Stock Data] MySQL total stocks: ${totalCount}`);
            
            // Check count by type
            const [typeCountResult] = await pool.query(
                'SELECT COUNT(*) as count FROM live_stock_data WHERE data_type = ?',
                [dataType]
            );
            const typeCount = typeCountResult[0].count;
            LOG.info(`[Stock Data] Stocks with data_type='${dataType}': ${typeCount}`);
            
            let orderBy = 'symbol';
            if (dataType === 'gainers' || dataType === 'decliners') {
                orderBy = dataType === 'gainers' 
                    ? 'per_change DESC' 
                    : 'per_change ASC';
            } else if (dataType === 'actives') {
                orderBy = 'volume DESC';
            }
            
            const [rows] = await pool.query(
                `SELECT * FROM live_stock_data 
                 WHERE data_type = ? 
                 ORDER BY ${orderBy} 
                 LIMIT ?`,
                [dataType, limit]
            );

            LOG.info(`[Stock Data] Query returned ${rows.length} rows`);
            if (rows.length > 0) {
                LOG.info(`[Stock Data] Sample row:`, {
                    symbol: rows[0].symbol,
                    data_type: rows[0].data_type,
                    per_change: rows[0].per_change,
                    company_name: rows[0].company_name
                });
            }

            // Fetch last week volumes in batch for all symbols
            const volumeMap = new Map();
            if (rows.length > 0) {
                const symbols = rows.map(r => r.symbol).filter(Boolean);
                const volumePromises = symbols.map(async (symbol) => {
                    const vol = await this.getLastWeekVolume(symbol);
                    return [symbol, vol];
                });
                const volumes = await Promise.all(volumePromises);
                volumes.forEach(([symbol, vol]) => {
                    if (symbol) volumeMap.set(symbol.toUpperCase(), vol);
                });
            }
            
            // Format rows with last week volumes
            const formatted = await Promise.all(
                rows.map(row => this.formatStockData(row, volumeMap.get(row.symbol?.toUpperCase()) || null))
            );
            LOG.info(`[Stock Data] Formatted ${formatted.length} stocks`);
            
            return formatted;
        } catch (error) {
            LOG.error(`[Stock Data] Error getting ${dataType}:`, error.message);
            LOG.error(`[Stock Data] Error stack:`, error.stack);
            return [];
        }
    }


    /**
     * Get last week's volume for a symbol from history
     * Looks for archived records from approximately 7 days ago (last week)
     * @param {string} symbol - Stock symbol
     * @returns {Promise<number|null>} Last week's volume or null
     */
    async getLastWeekVolume(symbol) {
        if (!this.isMySQLAvailable()) {
            // Use in-memory storage
            const inMemoryDb = this.getInMemoryDb();
            const history = inMemoryDb.stock_data_history || [];
            
            // Calculate date range: 6-8 days ago (approximately last week)
            const now = new Date();
            const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
            const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
            
            // Get records for this symbol within the date range (6-8 days ago)
            const symbolHistory = history
                .filter(h => {
                    if (h.symbol !== symbol.toUpperCase()) return false;
                    if (!h.archived_at) return false;
                    const archivedDate = new Date(h.archived_at);
                    return archivedDate >= eightDaysAgo && archivedDate <= sixDaysAgo;
                })
                .sort((a, b) => new Date(b.archived_at) - new Date(a.archived_at));
            
            // If found in ideal range, use it
            if (symbolHistory.length > 0) {
                return symbolHistory[0].volume || null;
            }
            
            // Fallback 1: Try any record from last 30 days
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            const recentHistory = history
                .filter(h => {
                    if (h.symbol !== symbol.toUpperCase()) return false;
                    if (!h.archived_at) return false;
                    const archivedDate = new Date(h.archived_at);
                    return archivedDate >= thirtyDaysAgo;
                })
                .sort((a, b) => new Date(b.archived_at) - new Date(a.archived_at));
            
            if (recentHistory.length > 0) {
                return recentHistory[0].volume || null;
            }
            
            // Fallback 2: Get the oldest available record (any historical data is better than none)
            const allSymbolHistory = history
                .filter(h => h.symbol === symbol.toUpperCase() && h.archived_at)
                .sort((a, b) => new Date(a.archived_at) - new Date(b.archived_at));
            
            if (allSymbolHistory.length > 0) {
                return allSymbolHistory[0].volume || null;
            }
            
            return null;
        }

        const pool = db.getPool();
        try {
            // Calculate date range: 6-8 days ago (approximately last week)
            const now = new Date();
            const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
            const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
            
            // First try to get a record from 6-8 days ago (last week) - ideal case
            const [rows] = await pool.query(`
                SELECT volume, archived_at
                FROM stock_data_history 
                WHERE symbol = ? 
                  AND archived_at >= ? 
                  AND archived_at <= ?
                ORDER BY archived_at DESC 
                LIMIT 1
            `, [symbol.toUpperCase(), eightDaysAgo, sixDaysAgo]);
            
            if (rows.length > 0 && rows[0].volume) {
                return parseInt(rows[0].volume);
            }
            
            // Fallback 1: If no record in the ideal date range, try any record from last 30 days
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            const [recentRows] = await pool.query(`
                SELECT volume, archived_at
                FROM stock_data_history 
                WHERE symbol = ? 
                  AND archived_at >= ?
                ORDER BY archived_at DESC 
                LIMIT 1
            `, [symbol.toUpperCase(), thirtyDaysAgo]);
            
            if (recentRows.length > 0 && recentRows[0].volume) {
                LOG.info(`[Stock Data] Using recent historical volume for ${symbol} from ${recentRows[0].archived_at} (not exactly last week, but best available)`);
                return parseInt(recentRows[0].volume);
            }
            
            // Fallback 2: If no recent record, get the oldest available record (any historical data is better than none)
            const [fallbackRows] = await pool.query(`
                SELECT volume, archived_at
                FROM stock_data_history 
                WHERE symbol = ? 
                ORDER BY archived_at ASC 
                LIMIT 1
            `, [symbol.toUpperCase()]);
            
            if (fallbackRows.length > 0 && fallbackRows[0].volume) {
                LOG.info(`[Stock Data] Using oldest available volume for ${symbol} from ${fallbackRows[0].archived_at} (no recent data available)`);
                return parseInt(fallbackRows[0].volume);
            }
            
            // No historical data at all
            return null;
        } catch (error) {
            LOG.warning(`[Stock Data] Error getting last week volume for ${symbol}:`, error.message);
            return null;
        }
    }

    /**
     * Format database row to application format
     * @param {Object} row - Database row or in-memory object
     * @param {number|null} lastWeekVolume - Last week's volume (optional, will be fetched if not provided)
     * @returns {Promise<Object>} Formatted stock data
     */
    async formatStockData(row, lastWeekVolume = null) {
        if (!row) return null;
        
        // Ensure we have a name - prioritize company_name, then name, then symbol
        const companyName = row.company_name || row.name || null;
        const stockName = companyName || row.symbol || 'N/A';
        
        // Parse additional_data if it's a string (JSON)
        let additionalData = null;
        if (row.additional_data) {
            try {
                additionalData = typeof row.additional_data === 'string' 
                    ? JSON.parse(row.additional_data) 
                    : row.additional_data;
            } catch (e) {
                LOG.warning('[Stock Data] Error parsing additional_data:', e.message);
                additionalData = {};
            }
        }
        
        // Normalize column name for comparison
        const normalizeKey = (key) => {
            return String(key || '').toLowerCase().replace(/[_\s\-]/g, '').trim();
        };
        
        // Standard field mappings - map variations to canonical names
        const standardFieldMap = {
            'symbol': ['ticker', 'code', 'scrip', 'stock symbol'],
            'name': ['companyname', 'company_name', 'company', 'stockname'],
            'price': ['lastprice', 'last_price', 'ltp', 'currentprice'],
            'pchange': ['changeamount', 'pricechange'],
            'changePercent': ['percentchange', 'pchange%', '%pchange', 'pctchange', 'per_change'],
            'volume': ['tradedvolume', 'qty', 'quantity'],
            'marketCap': ['market_cap', 'mcap', 'marketcapitalization'],
            'pe_ratio': ['peratio', 'pe', 'p/e', 'priceearnings'],
            'week_52_low': ['week52low', '52weeklow', '52wlow', 'weeklow'],
            'week_52_high': ['week52high', '52weekhigh', '52whigh', 'weekhigh'],
            'data_type': ['datatype', 'type'],
            'last_updated': ['lastupdated', 'updated', 'timestamp']
        };
        
        // Create reverse mapping: normalized key -> canonical name
        const normalizedToCanonical = {};
        for (const [canonical, variations] of Object.entries(standardFieldMap)) {
            const normCanonical = normalizeKey(canonical);
            normalizedToCanonical[normCanonical] = canonical;
            for (const variation of variations) {
                normalizedToCanonical[normalizeKey(variation)] = canonical;
            }
        }
        
        // Filter additional_data to remove duplicates of standard fields
        const filteredAdditionalData = {};
        if (additionalData) {
            for (const [key, value] of Object.entries(additionalData)) {
                const normKey = normalizeKey(key);
                
                // Skip if this is a standard field or its variation
                if (normalizedToCanonical[normKey]) {
                    continue; // Skip - we already have this in baseData
                }
                
                // Skip Excel row number columns
                if (normKey === 'no' || normKey === 'number' || normKey === 'row' || 
                    normKey === 'rownumber' || normKey.startsWith('column_') || 
                    normKey === 'index' || normKey === 'id') {
                    continue;
                }
                
                // Only include if value is not empty
                if (value !== null && value !== undefined && value !== '') {
                    filteredAdditionalData[key] = value;
                }
            }
        }
        
        // Get current volume
        const currentVolume = parseInt(row.volume || 0) || 0;
        
        // Fetch last week's volume if not provided
        let lastWeekVol = lastWeekVolume;
        if (lastWeekVol === null && row.symbol) {
            try {
                lastWeekVol = await this.getLastWeekVolume(row.symbol);
                if (lastWeekVol === null && row.symbol) {
                    // Log when no historical data found (only for first few to avoid spam)
                    if (Math.random() < 0.05) { // Log 5% of cases
                        LOG.info(`[Stock Data] No historical volume found for ${row.symbol} - volume ratio will not be calculated`);
                    }
                }
            } catch (error) {
                LOG.warning(`[Stock Data] Error fetching last week volume for ${row.symbol}: ${error.message}`);
                lastWeekVol = null;
            }
        }
        
        // Calculate volume ratio (current / last week)
        let volumeRatio = null;
        let volumeStatus = null; // 'high' (>7x in Cr), 'low' (<=1x for gainers only), 'normal' (other)
        
        // Determine if stock is a gainer or loser
        const changePercent = parseFloat(row.per_change || row.changePercent || 0) || 0;
        const isGainer = changePercent > 0;
        
        if (lastWeekVol !== null && lastWeekVol > 0 && currentVolume > 0) {
            volumeRatio = currentVolume / lastWeekVol;
            
            // Check if volume is in Cr (Crores) - if current volume >= 1 Cr (10,000,000)
            const isVolumeInCr = currentVolume >= 10000000;
            
            // Log for debugging - log first 5 records to ensure we see volume ratios
            if (row.symbol) {
                const shouldLog = Math.random() < 0.2 || volumeRatio < 2 || volumeRatio > 5; // Log 20% or interesting ratios
                if (shouldLog) {
                    LOG.info(`[Stock Data] Volume ratio calculated for ${row.symbol}:`, {
                        currentVolume,
                        lastWeekVol,
                        volumeRatio: volumeRatio.toFixed(2),
                        isVolumeInCr,
                        changePercent,
                        isGainer,
                        willBeHigh: isVolumeInCr && volumeRatio > 7,
                        willBeLow: isGainer && volumeRatio <= 1,
                        willShowRatio: true // Always show ratio when calculated
                    });
                }
            }
            
            // Red background: Volume in Cr AND more than 7x of last week (applies to both gainers and losers)
            if (isVolumeInCr && volumeRatio > 7) {
                volumeStatus = 'high'; // More than 7x in Cr - red background
            }
            // Green background: ONLY for GAINERS with volume 1x or less from last week
            // Losers should NOT get green background even if volume ratio is low
            else if (isGainer && volumeRatio <= 1) {
                volumeStatus = 'low'; // 1x or less AND gainer - green background
            } else {
                volumeStatus = 'normal'; // Between 1x and 7x (or not in Cr), or loser with low volume - no special color
            }
        }
        
        // Validate symbol - ensure it's not "SYMBOL" or empty
        let validSymbol = row.symbol;
        if (!validSymbol || validSymbol === 'SYMBOL' || validSymbol === 'symbol' || validSymbol.trim() === '') {
            // Try to get symbol from additional_data if main symbol is invalid
            if (additionalData && additionalData.Symbol) {
                validSymbol = additionalData.Symbol;
            } else if (additionalData && additionalData.Ticker) {
                validSymbol = additionalData.Ticker;
            } else {
                LOG.warning(`[Stock Data] Invalid symbol for row:`, {
                    symbol: row.symbol,
                    company_name: row.company_name,
                    hasAdditionalData: !!additionalData
                });
                return null; // Skip invalid rows
            }
        }
        
        // Base data with only ONE version of each field (prefer standard names)
        const baseData = {
            symbol: String(validSymbol).trim().toUpperCase() || 'N/A',
            name: stockName, // Only 'name', not both 'name' and 'company_name'
            price: parseFloat(row.last_price || row.price || 0) || 0,
            pchange: parseFloat(row.pchange || 0) || 0,
            changePercent: parseFloat(row.per_change || row.changePercent || 0) || 0,
            volume: currentVolume,
            lastWeekVolume: lastWeekVol,
            volumeRatio: volumeRatio,
            volumeStatus: volumeStatus, // 'high', 'normal', 'low', or null
            marketCap: parseInt(row.market_cap || row.marketCap || 0) || 0,
            pe_ratio: row.pe_ratio !== null && row.pe_ratio !== undefined ? parseFloat(row.pe_ratio) : null,
            week_52_low: row.week_52_low !== null && row.week_52_low !== undefined ? parseFloat(row.week_52_low) : null,
            week_52_high: row.week_52_high !== null && row.week_52_high !== undefined ? parseFloat(row.week_52_high) : null,
            data_type: row.data_type || 'data',
            // Include filtered additional columns from Excel (no duplicates)
            ...filteredAdditionalData
        };
        
        // Log first few records for debugging
        if (Math.random() < 0.1) { // Log 10% of records
            LOG.info(`[Stock Data] Formatted stock:`, {
                symbol: baseData.symbol,
                name: baseData.name,
                price: baseData.price,
                pchange: baseData.pchange,
                changePercent: baseData.changePercent,
                hasValidData: !!(baseData.symbol && baseData.symbol !== 'N/A' && baseData.symbol !== 'SYMBOL')
            });
        }
        
        return baseData;
    }
}

module.exports = new StockDataService();