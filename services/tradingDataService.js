/**
 * Trading Data Service
 * Manages stock market data storage in local DB and MySQL
 * - Fetches from Yahoo Finance API (only if enabled)
 * - Stores in local in-memory DB
 * - Refreshes every 10 minutes (configurable)
 * - Saves BOD/EOD to MySQL
 * - Falls back to MySQL when Yahoo Finance is disabled
 */
const yahooFinanceService = require('./yahooFinanceService');
const stockDataService = require('./stockDataService');
const config = require('../config/tradingConfig');
const db = require('../database');
const LOG = require('../utils/logger');

// Get in-memory DB reference
const getInMemoryDb = () => {
    return db.inMemoryDb || {};
};

class TradingDataService {
    constructor() {
        this.refreshInterval = null;
        this.refreshIntervalMs = (process.env.TRADING_REFRESH_INTERVAL_MINUTES || 10) * 60 * 1000; // Default 10 minutes
        this.isRefreshing = false;
        this.lastRefreshTime = null;
    }

    /**
     * Initialize trading data tables in MySQL
     */
    async initializeTables() {
        const pool = db.getPool();
        if (!pool) {
            LOG.warning('[Trading Data] MySQL not available, using in-memory only');
            return;
        }

        try {
            // Stock quotes table
            await pool.query(`
                CREATE TABLE IF NOT EXISTS trading_stock_quotes (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    symbol VARCHAR(50) NOT NULL,
                    full_symbol VARCHAR(50) NOT NULL,
                    name VARCHAR(255),
                    price DECIMAL(15, 2),
                    change_amount DECIMAL(15, 2),
                    change_percent DECIMAL(10, 4),
                    previous_close DECIMAL(15, 2),
                    open_price DECIMAL(15, 2),
                    high_price DECIMAL(15, 2),
                    low_price DECIMAL(15, 2),
                    volume BIGINT,
                    market_cap BIGINT,
                    currency VARCHAR(10) DEFAULT 'INR',
                    exchange VARCHAR(10) DEFAULT 'NSE',
                    quote_date DATE NOT NULL,
                    quote_time TIME NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_symbol (symbol),
                    INDEX idx_quote_date (quote_date),
                    INDEX idx_full_symbol (full_symbol)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            // Market indices table
            await pool.query(`
                CREATE TABLE IF NOT EXISTS trading_market_indices (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    index_name VARCHAR(50) NOT NULL,
                    value DECIMAL(15, 2),
                    change_amount DECIMAL(15, 2),
                    change_percent DECIMAL(10, 4),
                    expiry_date VARCHAR(50),
                    quote_date DATE NOT NULL,
                    quote_time TIME NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_index_name (index_name),
                    INDEX idx_quote_date (quote_date)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            // Top gainers/losers table
            await pool.query(`
                CREATE TABLE IF NOT EXISTS trading_top_stocks (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    symbol VARCHAR(50) NOT NULL,
                    name VARCHAR(255),
                    price DECIMAL(15, 2),
                    change_amount DECIMAL(15, 2),
                    change_percent DECIMAL(10, 4),
                    volume BIGINT,
                    category ENUM('gainers', 'losers', 'market_high', 'most_bought') NOT NULL,
                    rank INT,
                    quote_date DATE NOT NULL,
                    quote_time TIME NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_category (category),
                    INDEX idx_quote_date (quote_date),
                    INDEX idx_symbol (symbol)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            LOG.success('[Trading Data] Tables initialized');
        } catch (error) {
            LOG.error('[Trading Data] Failed to initialize tables:', error.message);
        }
    }

    /**
     * Get refresh interval from settings or env
     */
    getRefreshInterval() {
        // Check environment variable first
        const envInterval = process.env.TRADING_REFRESH_INTERVAL_MINUTES;
        if (envInterval) {
            return parseInt(envInterval) * 60 * 1000;
        }
        // Default 10 minutes
        return 10 * 60 * 1000;
    }

    /**
     * Fetch and store market indices
     */
    async refreshMarketIndices() {
        try {
            // Check if Yahoo Finance is enabled
            if (!config.dataSources.useYahooFinance) {
                LOG.info('[Trading Data] Yahoo Finance disabled, skipping market indices refresh');
                return [];
            }
            
            LOG.info('[Trading Data] Refreshing market indices...');
            const indices = await yahooFinanceService.getMarketIndices();
            
            const now = new Date();
            const quoteDate = now.toISOString().split('T')[0];
            const quoteTime = now.toTimeString().slice(0, 8);

            // Store in local DB (tradingData is initialized in database.js)
            const inMemoryDb = getInMemoryDb();
            if (!inMemoryDb.tradingData) {
                inMemoryDb.tradingData = {
                    marketIndices: [],
                    stockQuotes: [],
                    topGainers: [],
                    topLosers: [],
                    marketHigh: [],
                    mostBought: []
                };
            }

            // Update local DB
            inMemoryDb.tradingData.marketIndices = indices.map(index => ({
                ...index,
                quoteDate,
                quoteTime,
                updatedAt: now.toISOString()
            }));

            // Store in MySQL (for BOD/EOD)
            const pool = db.getPool();
            if (pool) {
                for (const index of indices) {
                    await pool.query(`
                        INSERT INTO trading_market_indices 
                        (index_name, value, change_amount, change_percent, expiry_date, quote_date, quote_time)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE
                        value = VALUES(value),
                        change_amount = VALUES(change_amount),
                        change_percent = VALUES(change_percent),
                        expiry_date = VALUES(expiry_date),
                        quote_time = VALUES(quote_time)
                    `, [
                        index.name,
                        index.value,
                        index.change,
                        index.changePercent,
                        index.expiry,
                        quoteDate,
                        quoteTime
                    ]);
                }
            }

            LOG.success(`[Trading Data] Market indices refreshed: ${indices.length} indices`);
            return indices;
        } catch (error) {
            LOG.error('[Trading Data] Error refreshing market indices:', error.message);
            throw error;
        }
    }

    /**
     * Fetch and store top gainers
     */
    async refreshTopGainers(limit = 20) {
        try {
            // Check if Yahoo Finance is enabled
            if (!config.dataSources.useYahooFinance) {
                LOG.info('[Trading Data] Yahoo Finance disabled, skipping top gainers refresh');
                return [];
            }
            
            LOG.info('[Trading Data] ========================================');
            LOG.info(`[Trading Data] Refreshing top ${limit} gainers...`);
            LOG.info('[Trading Data] Calling yahooFinanceService.getTopGainers()...');
            
            const apiStartTime = Date.now();
            const gainers = await yahooFinanceService.getTopGainers(limit);
            const apiDuration = Date.now() - apiStartTime;
            
            LOG.info(`[Trading Data] API call completed in ${apiDuration}ms`);
            LOG.info(`[Trading Data] Received ${gainers?.length || 0} gainers from API`);
            
            if (!gainers || gainers.length === 0) {
                LOG.warning('[Trading Data] ⚠ No gainers returned from API!');
                LOG.warning('[Trading Data] This could mean:');
                LOG.warning('[Trading Data]   1. Yahoo Finance API returned no data');
                LOG.warning('[Trading Data]   2. All stocks filtered out (no price changes)');
                LOG.warning('[Trading Data]   3. getPopularStocks returned no symbols');
                LOG.warning('[Trading Data]   4. Rate limiting or API errors');
                return [];
            }
            
            LOG.info(`[Trading Data] Sample gainer: ${gainers[0]?.symbol || 'N/A'} - ${gainers[0]?.name || 'N/A'} - Price: ₹${gainers[0]?.price || 0} - Change: ${gainers[0]?.changePercent || 0}%`);
            
            const now = new Date();
            const quoteDate = now.toISOString().split('T')[0];
            const quoteTime = now.toTimeString().slice(0, 8);

            // Store in local DB
            const inMemoryDb = getInMemoryDb();
            if (!inMemoryDb.tradingData) inMemoryDb.tradingData = { topGainers: [] };
            inMemoryDb.tradingData.topGainers = gainers.map((stock, idx) => ({
                ...stock,
                category: 'gainers',
                rank: idx + 1,
                quoteDate,
                quoteTime,
                updatedAt: now.toISOString()
            }));

            LOG.info(`[Trading Data] Stored ${inMemoryDb.tradingData.topGainers.length} gainers in local DB`);

            // Store in MySQL
            await this.saveTopStocksToMySQL(gainers, 'gainers', quoteDate, quoteTime);

            LOG.success(`[Trading Data] ✓ Top gainers refreshed: ${gainers.length} stocks`);
            LOG.info('[Trading Data] ========================================');
            return gainers;
        } catch (error) {
            LOG.error('[Trading Data] ========================================');
            LOG.error('[Trading Data] ✗ Error refreshing top gainers');
            LOG.error(`[Trading Data] Error Type: ${error.constructor.name}`);
            LOG.error(`[Trading Data] Error Message: ${error.message || 'No message'}`);
            LOG.error(`[Trading Data] Error Stack: ${error.stack ? error.stack.split('\n').slice(0, 5).join('\n') : 'No stack'}`);
            LOG.error('[Trading Data] ========================================');
            throw error;
        }
    }

    /**
     * Fetch and store top losers
     */
    async refreshTopLosers(limit = 20) {
        try {
            // Check if Yahoo Finance is enabled
            if (!config.dataSources.useYahooFinance) {
                LOG.info('[Trading Data] Yahoo Finance disabled, skipping top losers refresh');
                return [];
            }
            
            LOG.info('[Trading Data] Refreshing top losers...');
            const losers = await yahooFinanceService.getTopLosers(limit);
            
            const now = new Date();
            const quoteDate = now.toISOString().split('T')[0];
            const quoteTime = now.toTimeString().slice(0, 8);

            // Store in local DB
            const inMemoryDb = getInMemoryDb();
            if (!inMemoryDb.tradingData) inMemoryDb.tradingData = { topLosers: [] };
            inMemoryDb.tradingData.topLosers = losers.map((stock, idx) => ({
                ...stock,
                category: 'losers',
                rank: idx + 1,
                quoteDate,
                quoteTime,
                updatedAt: now.toISOString()
            }));

            // Store in MySQL
            await this.saveTopStocksToMySQL(losers, 'losers', quoteDate, quoteTime);

            LOG.success(`[Trading Data] Top losers refreshed: ${losers.length} stocks`);
            return losers;
        } catch (error) {
            LOG.error('[Trading Data] Error refreshing top losers:', error.message);
            throw error;
        }
    }

    /**
     * Save top stocks to MySQL
     */
    async saveTopStocksToMySQL(stocks, category, quoteDate, quoteTime) {
        const pool = db.getPool();
        if (!pool) return;

        try {
            // Delete old data for this category and date
            await pool.query(`
                DELETE FROM trading_top_stocks 
                WHERE category = ? AND quote_date = ?
            `, [category, quoteDate]);

            // Insert new data
            for (const [idx, stock] of stocks.entries()) {
                await pool.query(`
                    INSERT INTO trading_top_stocks 
                    (symbol, name, price, change_amount, change_percent, volume, category, rank, quote_date, quote_time)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    stock.symbol || stock.fullSymbol?.replace(/\.(NS|BO)$/i, ''),
                    stock.name,
                    stock.price,
                    stock.change,
                    stock.changePercent,
                    stock.volume || 0,
                    category,
                    idx + 1,
                    quoteDate,
                    quoteTime
                ]);
            }
        } catch (error) {
            LOG.error(`[Trading Data] Error saving ${category} to MySQL:`, error.message);
        }
    }

    /**
     * Fetch and store stock quotes
     */
    async refreshStockQuotes(symbols, exchange = 'NSE') {
        try {
            // Check if Yahoo Finance is enabled
            if (!config.dataSources.useYahooFinance) {
                LOG.info('[Trading Data] Yahoo Finance disabled, skipping stock quotes refresh');
                // Return empty array or try to get from MySQL
                return [];
            }
            
            LOG.info(`[Trading Data] Refreshing stock quotes for ${symbols.length} symbols...`);
            const quotes = await yahooFinanceService.getQuote(symbols, exchange);
            const quoteArray = Array.isArray(quotes) ? quotes : [quotes];
            
            const now = new Date();
            const quoteDate = now.toISOString().split('T')[0];
            const quoteTime = now.toTimeString().slice(0, 8);

            // Store in local DB
            const inMemoryDb = getInMemoryDb();
            if (!inMemoryDb.tradingData) inMemoryDb.tradingData = { stockQuotes: [] };
            
            for (const quote of quoteArray) {
                if (!quote) continue;
                
                // Update or add to local DB
                const existingIndex = inMemoryDb.tradingData.stockQuotes.findIndex(
                    q => q.symbol === quote.symbol
                );
                const quoteData = {
                    ...quote,
                    quoteDate,
                    quoteTime,
                    updatedAt: now.toISOString()
                };
                
                if (existingIndex >= 0) {
                    inMemoryDb.tradingData.stockQuotes[existingIndex] = quoteData;
                } else {
                    inMemoryDb.tradingData.stockQuotes.push(quoteData);
                }
            }

            // Store in MySQL
            await this.saveStockQuotesToMySQL(quoteArray, quoteDate, quoteTime);

            LOG.success(`[Trading Data] Stock quotes refreshed: ${quoteArray.length} stocks`);
            return quoteArray;
        } catch (error) {
            LOG.error('[Trading Data] Error refreshing stock quotes:', error.message);
            throw error;
        }
    }

    /**
     * Save stock quotes to MySQL
     */
    async saveStockQuotesToMySQL(quotes, quoteDate, quoteTime) {
        const pool = db.getPool();
        if (!pool) return;

        try {
            for (const quote of quotes) {
                if (!quote) continue;
                
                await pool.query(`
                    INSERT INTO trading_stock_quotes 
                    (symbol, full_symbol, name, price, change_amount, change_percent, previous_close, 
                     open_price, high_price, low_price, volume, market_cap, currency, exchange, quote_date, quote_time)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                    price = VALUES(price),
                    change_amount = VALUES(change_amount),
                    change_percent = VALUES(change_percent),
                    previous_close = VALUES(previous_close),
                    open_price = VALUES(open_price),
                    high_price = VALUES(high_price),
                    low_price = VALUES(low_price),
                    volume = VALUES(volume),
                    market_cap = VALUES(market_cap),
                    quote_time = VALUES(quote_time)
                `, [
                    quote.symbol,
                    quote.fullSymbol || quote.symbol,
                    quote.name,
                    quote.price,
                    quote.change,
                    quote.changePercent,
                    quote.previousClose,
                    quote.open,
                    quote.high,
                    quote.low,
                    quote.volume || 0,
                    quote.marketCap || 0,
                    quote.currency || 'INR',
                    quote.exchange || 'NSE',
                    quoteDate,
                    quoteTime
                ]);
            }
        } catch (error) {
            LOG.error('[Trading Data] Error saving stock quotes to MySQL:', error.message);
        }
    }

    /**
     * Full data refresh (all categories)
     */
    async refreshAll() {
        // Check if Yahoo Finance is enabled
        if (!config.dataSources.useYahooFinance) {
            LOG.info('[Trading Data] Yahoo Finance disabled, skipping full refresh');
            return { message: 'Yahoo Finance is disabled. Use MySQL data source.' };
        }
        
        if (this.isRefreshing) {
            LOG.warning('[Trading Data] Refresh already in progress, skipping...');
            return;
        }

        try {
            this.isRefreshing = true;
            LOG.info('[Trading Data] Starting full data refresh...');

            // Refresh data (library handles concurrency, batches automatically)
            await this.refreshMarketIndices();

            // Wait 1 second between batch groups
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Refresh top gainers
            await this.refreshTopGainers(20);

            // Wait 1 second between batch groups
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Refresh top losers
            await this.refreshTopLosers(20);

            // Wait 1 second before refreshing quotes
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Refresh popular stocks dynamically from API - do this last and less frequently
            LOG.info('[Trading Data] Fetching popular stocks dynamically from API...');
            try {
                // This will throw if Yahoo Finance is disabled (already checked at start)
                const popularStocks = await yahooFinanceService.getPopularStocks(20);
                const popularSymbols = popularStocks
                    .map(stock => stock.symbol || stock.fullSymbol?.replace(/\.(NS|BO)$/i, '') || stock)
                    .filter(symbol => symbol && !symbol.includes('.'))
                    .slice(0, 20);
                
                if (popularSymbols.length > 0) {
                    LOG.info(`[Trading Data] Refreshing ${popularSymbols.length} popular stocks from API`);
                    await this.refreshStockQuotes(popularSymbols, 'NSE');
                } else {
                    LOG.warning('[Trading Data] No popular stocks found from API');
                }
            } catch (error) {
                LOG.error('[Trading Data] Error fetching popular stocks from API:', error.message);
                // Continue without failing the entire refresh
            }

            this.lastRefreshTime = new Date();
            LOG.success('[Trading Data] Full refresh completed');
        } catch (error) {
            LOG.error('[Trading Data] Error in full refresh:', error.message);
        } finally {
            this.isRefreshing = false;
        }
    }

    /**
     * Start periodic refresh
     */
    startPeriodicRefresh() {
        if (this.refreshInterval) {
            LOG.warning('[Trading Data] Refresh already started');
            return;
        }

        const interval = this.getRefreshInterval();
        LOG.info(`[Trading Data] Starting periodic refresh (every ${interval / 60000} minutes)`);

        // Initial refresh
        this.refreshAll();

        // Periodic refresh
        this.refreshInterval = setInterval(() => {
            this.refreshAll();
        }, interval);

        LOG.success('[Trading Data] Periodic refresh started');
    }

    /**
     * Stop periodic refresh
     */
    stopPeriodicRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
            LOG.info('[Trading Data] Periodic refresh stopped');
        }
    }

    /**
     * Get data from local DB
     */
    getMarketIndices() {
        const inMemoryDb = getInMemoryDb();
        if (!inMemoryDb.tradingData || !inMemoryDb.tradingData.marketIndices) {
            return [];
        }
        return inMemoryDb.tradingData.marketIndices;
    }

    getTopGainers(limit = 10) {
        const inMemoryDb = getInMemoryDb();
        LOG.info(`[Trading Data] getTopGainers called with limit=${limit}`);
        
        if (!inMemoryDb.tradingData) {
            LOG.warning('[Trading Data] ⚠ tradingData not initialized in local DB');
            return [];
        }
        
        if (!inMemoryDb.tradingData.topGainers) {
            LOG.warning('[Trading Data] ⚠ topGainers array not found in local DB');
            return [];
        }
        
        const gainers = inMemoryDb.tradingData.topGainers.slice(0, limit);
        LOG.info(`[Trading Data] Retrieved ${gainers.length} gainers from local DB (total available: ${inMemoryDb.tradingData.topGainers.length})`);
        
        if (gainers.length > 0) {
            LOG.info(`[Trading Data] Sample gainer from DB: ${gainers[0]?.symbol || 'N/A'} - ${gainers[0]?.name || 'N/A'}`);
        }
        
        return gainers;
    }

    getTopLosers(limit = 10) {
        const inMemoryDb = getInMemoryDb();
        if (!inMemoryDb.tradingData || !inMemoryDb.tradingData.topLosers) {
            return [];
        }
        return inMemoryDb.tradingData.topLosers.slice(0, limit);
    }

    getStockQuote(symbol) {
        const inMemoryDb = getInMemoryDb();
        if (!inMemoryDb.tradingData || !inMemoryDb.tradingData.stockQuotes) {
            return null;
        }
        return inMemoryDb.tradingData.stockQuotes.find(q => q.symbol === symbol);
    }

    /**
     * BOD (Beginning of Day) - Save snapshot to MySQL
     */
    async saveBODSnapshot() {
        try {
            LOG.info('[Trading Data] Saving BOD snapshot...');
            const now = new Date();
            const quoteDate = now.toISOString().split('T')[0];
            const quoteTime = '09:15:00'; // Market open time

            // Get current data
            const indices = this.getMarketIndices();
            const gainers = this.getTopGainers(50);
            const losers = this.getTopLosers(50);

            // Save to MySQL with BOD timestamp
            const pool = db.getPool();
            if (pool) {
                // Save indices
                for (const index of indices) {
                    await pool.query(`
                        INSERT INTO trading_market_indices 
                        (index_name, value, change_amount, change_percent, expiry_date, quote_date, quote_time)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `, [
                        index.name,
                        index.value,
                        index.change,
                        index.changePercent,
                        index.expiry,
                        quoteDate,
                        quoteTime
                    ]);
                }

                // Save top stocks
                await this.saveTopStocksToMySQL(gainers, 'gainers', quoteDate, quoteTime);
                await this.saveTopStocksToMySQL(losers, 'losers', quoteDate, quoteTime);
            }

            LOG.success('[Trading Data] BOD snapshot saved');
        } catch (error) {
            LOG.error('[Trading Data] Error saving BOD snapshot:', error.message);
        }
    }

    /**
     * EOD (End of Day) - Save final snapshot to MySQL
     */
    async saveEODSnapshot() {
        try {
            LOG.info('[Trading Data] Saving EOD snapshot...');
            const now = new Date();
            const quoteDate = now.toISOString().split('T')[0];
            const quoteTime = '15:30:00'; // Market close time

            // Refresh all data first
            await this.refreshAll();

            // Get final data
            const indices = this.getMarketIndices();
            const gainers = this.getTopGainers(50);
            const losers = this.getTopLosers(50);
            const inMemoryDb = getInMemoryDb();
            const quotes = inMemoryDb.tradingData?.stockQuotes || [];

            // Save to MySQL with EOD timestamp
            const pool = db.getPool();
            if (pool) {
                // Save indices
                for (const index of indices) {
                    await pool.query(`
                        INSERT INTO trading_market_indices 
                        (index_name, value, change_amount, change_percent, expiry_date, quote_date, quote_time)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `, [
                        index.name,
                        index.value,
                        index.change,
                        index.changePercent,
                        index.expiry,
                        quoteDate,
                        quoteTime
                    ]);
                }

                // Save top stocks
                await this.saveTopStocksToMySQL(gainers, 'gainers', quoteDate, quoteTime);
                await this.saveTopStocksToMySQL(losers, 'losers', quoteDate, quoteTime);

                // Save all stock quotes
                await this.saveStockQuotesToMySQL(quotes, quoteDate, quoteTime);
            }

            LOG.success('[Trading Data] EOD snapshot saved');
        } catch (error) {
            LOG.error('[Trading Data] Error saving EOD snapshot:', error.message);
        }
    }
}

module.exports = new TradingDataService();

