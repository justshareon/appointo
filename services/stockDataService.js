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
        // Avoid N+1 hammering stock_data_history (was 20–85s per symbol)
        this._volumeCache = new Map(); // symbol -> { vol, at }
        this._volumeCacheTtlMs = 5 * 60 * 1000;
        this._volumeInflight = new Map(); // symbol -> Promise
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
                    INDEX idx_archived_at (archived_at),
                    INDEX idx_symbol_archived (symbol, archived_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            // Composite index critical for volume-ratio lookups (symbol + time)
            try {
                await pool.query(`
                    CREATE INDEX idx_symbol_archived ON stock_data_history (symbol, archived_at)
                `);
            } catch (err) {
                const msg = String(err.message || '');
                if (!msg.includes('Duplicate') && !msg.includes('exists') && !/1061|42000/i.test(msg)) {
                    LOG.warning('[Stock Data] idx_symbol_archived note:', err.message);
                }
            }
            
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
            const [countRows] = await pool.query('SELECT COUNT(*) AS n FROM live_stock_data');
            const n = Number(countRows?.[0]?.n || 0);
            if (!n) {
                LOG.info('[Stock Data] No live data to archive');
                return 0;
            }

            await pool.query(`
                INSERT INTO stock_data_history
                (symbol, company_name, last_price, pchange, per_change, volume, market_cap, pe_ratio, week_52_low, week_52_high, data_type, additional_data)
                SELECT symbol, company_name, last_price, pchange, per_change, volume, market_cap, pe_ratio, week_52_low, week_52_high, COALESCE(data_type, 'data'), additional_data
                FROM live_stock_data
            `);

            LOG.success(`[Stock Data] Archived ${n} records to history table`);
            return n;
        } catch (error) {
            LOG.error('[Stock Data] Error archiving data:', error.message);
            throw error;
        }
    }

    /**
     * Truncate live_stock_data table
     */
    async truncateLiveData() {
        const inMemoryDb = this.getInMemoryDb();
        inMemoryDb.live_stock_data = [];

        if (!this.isMySQLAvailable()) {
            LOG.info('[Stock Data] Live stock data truncated in memory');
            return;
        }

        const pool = db.getPool();
        try {
            await pool.query('TRUNCATE TABLE live_stock_data');
            LOG.info('[Stock Data] Live stock data table truncated (memory cleared too)');
        } catch (error) {
            LOG.error('[Stock Data] Error truncating live data:', error.message);
            throw error;
        }
    }

    /** Row count in MySQL live_stock_data (0 when pool missing or empty). */
    async getMysqlLiveCount() {
        if (!this.isMySQLAvailable()) return 0;
        try {
            const [rows] = await db.getPool().query('SELECT COUNT(*) AS c FROM live_stock_data');
            return rows[0]?.c || 0;
        } catch (e) {
            LOG.warning('[Stock Data] getMysqlLiveCount failed:', e.message);
            return 0;
        }
    }

    /** Mirror rows to in-memory for fast bootstrap reads. */
    mirrorLiveDataToMemory(stockData) {
        const inMemoryDb = this.getInMemoryDb();
        inMemoryDb.live_stock_data = (stockData || []).map((stock) => ({
            ...stock,
            id: stock.id || Date.now() + Math.random(),
            last_updated: stock.last_updated || new Date(),
        }));
        return inMemoryDb.live_stock_data.length;
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

        // Always mirror to in-memory first (instant UI bootstrap).
        this.mirrorLiveDataToMemory(stockData);

        if (!this.isMySQLAvailable()) {
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
            const inMemoryDb = this.getInMemoryDb();
            const upperSymbols = symbols.map(s => s.toUpperCase());
            const stocks = inMemoryDb.live_stock_data.filter(s =>
                upperSymbols.includes(s.symbol)
            );
            const volumeMap = await this.getLastWeekVolumesBatch(stocks.map((s) => s.symbol));
            return this.formatStocksWithVolumes(stocks, volumeMap);
        }

        const pool = db.getPool();
        try {
            const placeholders = symbols.map(() => '?').join(', ');
            const [rows] = await pool.query(
                `SELECT * FROM live_stock_data WHERE symbol IN (${placeholders})`,
                symbols.map(s => s.toUpperCase())
            );
            const volumeMap = await this.getLastWeekVolumesBatch(rows.map((r) => r.symbol));
            return this.formatStocksWithVolumes(rows, volumeMap);
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
        const memoryStocks = async () => {
            LOG.info('[Stock Data] getAllStocks from memory');
            const inMemoryDb = this.getInMemoryDb();
            const stocks = (inMemoryDb.live_stock_data || [])
                .sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''));
            const volumeMap = await this.getLastWeekVolumesBatch(stocks.map((s) => s.symbol));
            return this.formatStocksWithVolumes(stocks, volumeMap);
        };

        if (!this.isMySQLAvailable()) {
            return memoryStocks();
        }

        const mysqlCount = await this.getMysqlLiveCount();
        if (mysqlCount === 0) {
            return memoryStocks();
        }

        const pool = db.getPool();
        try {
            const [rows] = await pool.query('SELECT * FROM live_stock_data ORDER BY symbol');
            LOG.info(`[Stock Data] getAllStocks: Found ${rows.length} rows from database`);
            const volumeMap = await this.getLastWeekVolumesBatch(rows.map((r) => r.symbol));
            const validStocks = await this.formatStocksWithVolumes(rows, volumeMap);
            if (validStocks.length > 0) {
                LOG.info(`[Stock Data] getAllStocks sample:`, {
                    symbol: validStocks[0].symbol,
                    name: validStocks[0].name,
                    price: validStocks[0].price,
                    volumeRatio: validStocks[0].volumeRatio,
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
     * Paginated live stocks — SQL LIMIT/OFFSET, volume optional (default off for fast UI).
     */
    async getLiveStocksPage({
        dataType = null,
        limit = 30,
        offset = 0,
        includeVolume = false,
        sort = 'auto',
    } = {}) {
        const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 200);
        const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

        let orderBy = 'symbol ASC';
        if (sort === 'auto') {
            if (dataType === 'gainers') orderBy = 'per_change DESC';
            else if (dataType === 'decliners') orderBy = 'per_change ASC';
            else if (dataType === 'actives') orderBy = 'volume DESC';
            else orderBy = 'symbol ASC';
        } else if (sort === 'gainers') orderBy = 'per_change DESC';
        else if (sort === 'losers' || sort === 'decliners') orderBy = 'per_change ASC';
        else if (sort === 'volume') orderBy = 'volume DESC';

        const mysqlCount = this.isMySQLAvailable() ? await this.getMysqlLiveCount() : 0;
        if (!this.isMySQLAvailable() || mysqlCount === 0) {
            const all = this.getInMemoryDb().live_stock_data || [];
            let filtered = dataType ? all.filter((s) => s.data_type === dataType) : all;
            // Fallback: typed sheet empty → derive from all rows
            if (dataType && filtered.length === 0 && all.length > 0) {
                filtered = [...all];
                if (dataType === 'gainers') {
                    filtered = filtered.filter((s) => (s.per_change || 0) > 0)
                        .sort((a, b) => (b.per_change || 0) - (a.per_change || 0));
                } else if (dataType === 'decliners') {
                    filtered = filtered.filter((s) => (s.per_change || 0) < 0)
                        .sort((a, b) => (a.per_change || 0) - (b.per_change || 0));
                } else if (dataType === 'actives') {
                    filtered = filtered.sort((a, b) => (b.volume || 0) - (a.volume || 0));
                }
            } else {
                filtered = [...filtered].sort((a, b) => {
                    if (orderBy.includes('per_change DESC')) return (b.per_change || 0) - (a.per_change || 0);
                    if (orderBy.includes('per_change ASC')) return (a.per_change || 0) - (b.per_change || 0);
                    if (orderBy.includes('volume')) return (b.volume || 0) - (a.volume || 0);
                    return String(a.symbol || '').localeCompare(String(b.symbol || ''));
                });
            }
            const slice = filtered.slice(safeOffset, safeOffset + safeLimit);
            const volumeMap = includeVolume
                ? await this.getLastWeekVolumesBatch(slice.map((s) => s.symbol))
                : new Map(slice.map((s) => [String(s.symbol || '').toUpperCase(), null]));
            const data = await this.formatStocksWithVolumes(slice, volumeMap);
            return {
                data,
                limit: safeLimit,
                offset: safeOffset,
                hasMore: safeOffset + data.length < filtered.length,
                total: filtered.length,
            };
        }

        const pool = db.getPool();
        try {
            let rows = [];
            let total = 0;

            if (dataType) {
                const [countRows] = await pool.query(
                    'SELECT COUNT(*) AS c FROM live_stock_data WHERE data_type = ?',
                    [dataType]
                );
                total = countRows[0]?.c || 0;

                if (total > 0) {
                    const [typed] = await pool.query(
                        `SELECT * FROM live_stock_data WHERE data_type = ? ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
                        [dataType, safeLimit, safeOffset]
                    );
                    rows = typed;
                } else {
                    // Fallback when Excel sync stored everything as data_type='data'
                    let where = '1=1';
                    if (dataType === 'gainers') {
                        where = 'per_change > 0';
                        orderBy = 'per_change DESC';
                    } else if (dataType === 'decliners') {
                        where = 'per_change < 0';
                        orderBy = 'per_change ASC';
                    } else if (dataType === 'actives') {
                        orderBy = 'volume DESC';
                    }
                    const [countAll] = await pool.query(
                        `SELECT COUNT(*) AS c FROM live_stock_data WHERE ${where}`
                    );
                    total = countAll[0]?.c || 0;
                    const [fallback] = await pool.query(
                        `SELECT * FROM live_stock_data WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
                        [safeLimit, safeOffset]
                    );
                    rows = fallback;
                }
            } else {
                const [countRows] = await pool.query('SELECT COUNT(*) AS c FROM live_stock_data');
                total = countRows[0]?.c || 0;
                const [all] = await pool.query(
                    `SELECT * FROM live_stock_data ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
                    [safeLimit, safeOffset]
                );
                rows = all;
            }

            const volumeMap = includeVolume
                ? await this.getLastWeekVolumesBatch(rows.map((r) => r.symbol))
                : new Map(rows.map((r) => [String(r.symbol || '').toUpperCase(), null]));
            const data = await this.formatStocksWithVolumes(rows, volumeMap);
            return {
                data,
                limit: safeLimit,
                offset: safeOffset,
                hasMore: safeOffset + rows.length < total,
                total,
            };
        } catch (error) {
            LOG.error('[Stock Data] getLiveStocksPage error:', error.message);
            return { data: [], limit: safeLimit, offset: safeOffset, hasMore: false, total: 0 };
        }
    }

    /**
     * Get stocks by data type
     * @param {string} dataType - Type: 'gainers', 'decliners', 'actives', 'data'
     * @param {number} limit - Number of stocks to return
     * @param {object} [opts]
     * @returns {Promise<Array>} Array of stocks
     */
    async getStocksByType(dataType, limit = 10, opts = {}) {
        const includeVolume = opts.includeVolume === true;
        const page = await this.getLiveStocksPage({
            dataType: dataType === 'data' ? null : dataType,
            limit,
            offset: opts.offset || 0,
            includeVolume,
        });
        return page.data;
    }


    /**
     * Get last week's (or recent) volume for many symbols in ONE query.
     * Stops the N+1 pattern that was firing 1–3 slow SELECTs per symbol.
     * @param {string[]} symbols
     * @returns {Promise<Map<string, number|null>>}
     */
    async getLastWeekVolumesBatch(symbols = []) {
        const result = new Map();
        const unique = [...new Set(
            (symbols || [])
                .map((s) => String(s || '').trim().toUpperCase())
                .filter(Boolean)
        )];
        if (!unique.length) return result;

        const now = Date.now();
        const needFetch = [];
        for (const sym of unique) {
            const cached = this._volumeCache.get(sym);
            if (cached && (now - cached.at) < this._volumeCacheTtlMs) {
                result.set(sym, cached.vol);
            } else {
                needFetch.push(sym);
            }
        }
        if (!needFetch.length) return result;

        const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

        if (!this.isMySQLAvailable()) {
            const history = this.getInMemoryDb().stock_data_history || [];
            for (const sym of needFetch) {
                const rows = history
                    .filter((h) => {
                        if (h.symbol !== sym || !h.archived_at) return false;
                        return new Date(h.archived_at) >= thirtyDaysAgo;
                    })
                    .sort((a, b) => new Date(b.archived_at) - new Date(a.archived_at));
                const vol = rows[0]?.volume != null ? parseInt(rows[0].volume, 10) : null;
                const value = Number.isFinite(vol) ? vol : null;
                result.set(sym, value);
                this._volumeCache.set(sym, { vol: value, at: now });
            }
            return result;
        }

        const pool = db.getPool();
        try {
            const placeholders = needFetch.map(() => '?').join(', ');
            // One indexed lookup: latest volume per symbol in the last 30 days.
            // Skip "oldest ever" full-table scans (were ~85s each on TiDB).
            const [rows] = await pool.query(
                `
                SELECT h.symbol, h.volume
                FROM stock_data_history h
                INNER JOIN (
                    SELECT symbol, MAX(archived_at) AS max_at
                    FROM stock_data_history
                    WHERE symbol IN (${placeholders})
                      AND archived_at >= ?
                    GROUP BY symbol
                ) latest
                  ON h.symbol = latest.symbol
                 AND h.archived_at = latest.max_at
                `,
                [...needFetch, thirtyDaysAgo]
            );

            const found = new Set();
            for (const row of rows || []) {
                const sym = String(row.symbol || '').toUpperCase();
                if (!sym) continue;
                const vol = row.volume != null ? parseInt(row.volume, 10) : null;
                const value = Number.isFinite(vol) ? vol : null;
                result.set(sym, value);
                this._volumeCache.set(sym, { vol: value, at: now });
                found.add(sym);
            }
            for (const sym of needFetch) {
                if (!found.has(sym)) {
                    result.set(sym, null);
                    this._volumeCache.set(sym, { vol: null, at: now });
                }
            }
            LOG.info(`[Stock Data] Batch volume lookup: ${needFetch.length} symbols, ${found.size} with history`);
        } catch (error) {
            LOG.warning('[Stock Data] Batch volume lookup failed:', error.message);
            for (const sym of needFetch) {
                if (!result.has(sym)) {
                    result.set(sym, null);
                    this._volumeCache.set(sym, { vol: null, at: now });
                }
            }
        }
        return result;
    }

    /**
     * Format rows using a pre-fetched volume map (no per-row history queries).
     */
    async formatStocksWithVolumes(rows = [], volumeMap = new Map()) {
        return (
            await Promise.all(
                (rows || []).map((row) => {
                    const sym = row?.symbol ? String(row.symbol).toUpperCase() : '';
                    // null = looked up, none — must NOT re-query (undefined would)
                    const vol = volumeMap.has(sym) ? volumeMap.get(sym) : null;
                    return this.formatStockData(row, vol);
                })
            )
        ).filter(Boolean);
    }

    /**
     * Get last week's volume for a symbol from history.
     * Uses cache + a single 30-day lookup (no oldest-ever full scan).
     * @param {string} symbol - Stock symbol
     * @returns {Promise<number|null>} Last week's volume or null
     */
    async getLastWeekVolume(symbol) {
        if (!symbol) return null;
        const sym = String(symbol).toUpperCase();
        const now = Date.now();
        const cached = this._volumeCache.get(sym);
        if (cached && (now - cached.at) < this._volumeCacheTtlMs) {
            return cached.vol;
        }
        if (this._volumeInflight.has(sym)) {
            return this._volumeInflight.get(sym);
        }

        const pending = (async () => {
            const map = await this.getLastWeekVolumesBatch([sym]);
            return map.has(sym) ? map.get(sym) : null;
        })();

        this._volumeInflight.set(sym, pending);
        try {
            return await pending;
        } finally {
            this._volumeInflight.delete(sym);
        }
    }

    /**
     * Format database row to application format
     * @param {Object} row - Database row or in-memory object
     * @param {number|null|undefined} lastWeekVolume - undefined = fetch; null/number = already resolved
     * @returns {Promise<Object>} Formatted stock data
     */
    async formatStockData(row, lastWeekVolume = undefined) {
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
        
        // Fetch last week's volume only when caller did not resolve it (undefined).
        // null means "looked up, none" — do not hit MySQL again.
        let lastWeekVol = lastWeekVolume;
        if (lastWeekVol === undefined && row.symbol) {
            try {
                lastWeekVol = await this.getLastWeekVolume(row.symbol);
                if (lastWeekVol === null && row.symbol) {
                    if (Math.random() < 0.05) {
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
            lastUpdated: row.last_updated || row.lastUpdated || null,
            last_updated: row.last_updated || row.lastUpdated || null,
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