/**
 * Yahoo Finance Service
 * Integrates with yahoo-finance2 package for stock market data
 * Supports Indian markets (NSE/BSE) and global markets
 * 
 * Features:
 * - Real-time quotes
 * - Historical data
 * - Stock search
 * - Trending symbols
 * - Analyst recommendations
 * - Options chains
 * - Stock screening
 * - Fundamentals
 * 
 * IMPORTANT: This service checks configuration before making any API calls.
 * If USE_YAHOO_FINANCE is disabled, all methods will throw an error.
 */
const LOG = require('../utils/logger');
const db = require('../database');
const config = require('../config/tradingConfig');

class YahooFinanceService {
    constructor() {
        this.cache = new Map(); // In-memory cache for recent data
        this.cacheTimeout = 300000; // 5 minute cache (increased to reduce API calls)
        this.historyCache = new Map(); // EOD history cache
        this.yahooFinance = null; // Will be loaded dynamically
        this.batchSize = 5; // Reduced to 5 symbols per request to avoid rate limits
        this.concurrency = 1; // Reduced to 1 to avoid concurrent requests
        this.batchDelay = 10000; // Increased to 10 seconds delay between batch groups
        this.rateLimitDelay = 30000; // 30 seconds delay when rate limited
        this.maxRetries = 3; // Maximum retry attempts for rate limit errors
        this.lastRequestTime = 0; // Track last request time for rate limiting
        this.minRequestInterval = 2000; // Minimum 2 seconds between any requests
    }

    // Manual rate limiting removed - library handles concurrency automatically

    /**
     * Check if Yahoo Finance is enabled
     * Throws error if disabled
     */
    checkYahooFinanceEnabled() {
        if (!config.dataSources.useYahooFinance) {
            const error = new Error('Yahoo Finance API is disabled. Use MySQL data source instead.');
            error.code = 'YAHOO_FINANCE_DISABLED';
            throw error;
        }
    }

    /**
     * Get yahoo-finance2 module (lazy load)
     */
    async getYahooFinance() {
        // Check if enabled before loading module
        this.checkYahooFinanceEnabled();
        if (!this.yahooFinance) {
            try {
                // Dynamic import for ES module - use the main export
                const yfModule = await import('yahoo-finance2');
                const YahooFinanceClass = yfModule.default || yfModule;
                
                // The module exports a CLASS, not an instance - we need to instantiate it
                let yfInstance;
                if (typeof YahooFinanceClass === 'function') {
                    // Create an instance
                    yfInstance = new YahooFinanceClass();
                } else if (YahooFinanceClass && typeof YahooFinanceClass.quote === 'function') {
                    // Already an instance
                    yfInstance = YahooFinanceClass;
                } else {
                    throw new Error(`Invalid yahoo-finance2 module: expected class or instance, got ${typeof YahooFinanceClass}`);
                }
                
                // Suppress survey notice
                if (yfInstance && typeof yfInstance.suppressNotices === 'function') {
                    yfInstance.suppressNotices(['yahooSurvey']);
                }
                
                this.yahooFinance = yfInstance;
                LOG.info('[Yahoo Finance] Module instantiated successfully');
            } catch (error) {
                LOG.error('[Yahoo Finance] Failed to load module:', error.message);
                // Fallback: try wrapper (ES module)
                try {
                    const yfModule = await import('./yahooFinanceWrapper.mjs');
                    const YahooFinanceClass = yfModule.default || yfModule;
                    
                    // The module exports a CLASS, not an instance - we need to instantiate it
                    let yfWrapperInstance;
                    if (typeof YahooFinanceClass === 'function') {
                        yfWrapperInstance = new YahooFinanceClass();
                    } else if (YahooFinanceClass && typeof YahooFinanceClass.quote === 'function') {
                        yfWrapperInstance = YahooFinanceClass;
                    } else {
                        throw new Error(`Invalid yahoo-finance2 module from wrapper: expected class or instance, got ${typeof YahooFinanceClass}`);
                    }
                    
                    // Suppress survey notice
                    if (yfWrapperInstance && typeof yfWrapperInstance.suppressNotices === 'function') {
                        yfWrapperInstance.suppressNotices(['yahooSurvey']);
                    }
                    
                    this.yahooFinance = yfWrapperInstance;
                    LOG.info('[Yahoo Finance] Module instantiated via wrapper');
                } catch (wrapperError) {
                    LOG.error('[Yahoo Finance] Wrapper also failed:', wrapperError.message);
                    throw new Error(`Failed to load yahoo-finance2: ${error.message}`);
                }
            }
        }
        return this.yahooFinance;
    }

    /**
     * Normalize symbol for Indian markets
     * @param {string} symbol - Stock symbol
     * @param {string} exchange - 'NSE' or 'BSE' (default: 'NSE')
     * @returns {string} Normalized symbol
     */
    normalizeSymbol(symbol, exchange = 'NSE') {
        if (!symbol) return symbol;
        
        // Don't normalize index symbols (those starting with ^)
        if (symbol.startsWith('^')) {
            return symbol;
        }
        
        // Remove existing suffix if present
        symbol = symbol.replace(/\.(NS|BO)$/i, '');
        
        // Add appropriate suffix
        if (exchange.toUpperCase() === 'BSE') {
            return `${symbol}.BO`;
        }
        return `${symbol}.NS`; // Default to NSE
    }

    /**
     * Batch symbols into groups for efficient fetching
     * @param {string[]} symbols - Array of symbols
     * @param {number} batchSize - Size of each batch
     * @returns {string[][]} Array of symbol batches
     */
    batchSymbols(symbols, batchSize = this.batchSize) {
        const batches = [];
        for (let i = 0; i < symbols.length; i += batchSize) {
            batches.push(symbols.slice(i, i + batchSize));
        }
        return batches;
    }

    /**
     * Get current quote for one or multiple symbols using batching
     * @param {string|string[]} symbols - Stock symbol(s)
     * @param {string} exchange - 'NSE' or 'BSE'
     * @returns {Promise<Object|Object[]>} Quote data
     */
    async getQuote(symbols, exchange = 'NSE') {
        // Check if Yahoo Finance is enabled
        this.checkYahooFinanceEnabled();
        
        try {
            const symbolArray = Array.isArray(symbols) ? symbols : [symbols];
            const normalizedSymbols = symbolArray.map(s => this.normalizeSymbol(s, exchange));
            
            // Check cache first
            const cacheKey = `quote_${normalizedSymbols.join('_')}`;
            const cached = this.getCached(cacheKey);
            if (cached) {
                LOG.info(`[Yahoo Finance] Using cached quote for ${normalizedSymbols.length} symbols`);
                return Array.isArray(symbols) ? cached : cached[0];
            }

            // Log API call details
            LOG.info(`[Yahoo Finance API] ========================================`);
            LOG.info(`[Yahoo Finance API] GET Quote (Batched)`);
            LOG.info(`[Yahoo Finance API] Base URL: https://query1.finance.yahoo.com/v8/finance/chart/`);
            LOG.info(`[Yahoo Finance API] Total Symbols: ${normalizedSymbols.length}`);
            LOG.info(`[Yahoo Finance API] Batch Size: ${this.batchSize}`);
            LOG.info(`[Yahoo Finance API] Concurrency: ${this.concurrency} (library managed)`);
            LOG.info(`[Yahoo Finance API] Exchange: ${exchange}`);
            LOG.info(`[Yahoo Finance API] API Key: Not required (public API)`);
            LOG.info(`[Yahoo Finance API] API Secret: Not required (public API)`);
            LOG.info(`[Yahoo Finance API] Package: yahoo-finance2`);
            LOG.info(`[Yahoo Finance API] ========================================`);
            
            const yf = await this.getYahooFinance();
            
            // Debug: Check if quote method exists
            if (!yf || typeof yf.quote !== 'function') {
                LOG.error(`[Yahoo Finance] Invalid yf object: ${typeof yf}, quote type: ${typeof yf?.quote}, keys: ${yf ? Object.keys(yf).join(', ') : 'null'}`);
                throw new Error('yahoo-finance2 quote method is not available');
            }
            
            // Batch symbols into groups of batchSize
            const batches = this.batchSymbols(normalizedSymbols, this.batchSize);
            LOG.info(`[Yahoo Finance] Processing ${batches.length} batches of up to ${this.batchSize} symbols each`);
            
            // Process batches with delays between groups
            const allQuotes = [];
            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];
                
                // Enforce minimum interval between requests
                const timeSinceLastRequest = Date.now() - this.lastRequestTime;
                if (timeSinceLastRequest < this.minRequestInterval) {
                    const waitTime = this.minRequestInterval - timeSinceLastRequest;
                    LOG.info(`[Yahoo Finance API] Rate limiting: waiting ${waitTime}ms before next request`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
                
                LOG.info(`[Yahoo Finance API] Batch ${i + 1}/${batches.length}: Fetching ${batch.length} symbols (${batch.join(', ')})`);
                
                // Retry logic for rate limit errors
                let retryCount = 0;
                let batchQuotes = null;
                let batchError = null;
                
                while (retryCount <= this.maxRetries) {
                    try {
                        // Library handles concurrency automatically - just call quote
                        const batchStartTime = Date.now();
                        this.lastRequestTime = Date.now();
                        
                        LOG.info(`[Yahoo Finance API] ========================================`);
                        LOG.info(`[Yahoo Finance API] REQUEST: Calling yf.quote() for batch ${i + 1}/${batches.length} (attempt ${retryCount + 1})`);
                        LOG.info(`[Yahoo Finance API] REQUEST URL: https://query1.finance.yahoo.com/v8/finance/chart/`);
                        LOG.info(`[Yahoo Finance API] REQUEST Symbols: ${batch.join(', ')}`);
                        LOG.info(`[Yahoo Finance API] REQUEST Method: GET`);
                        LOG.info(`[Yahoo Finance API] REQUEST Headers: { User-Agent: yahoo-finance2 }`);
                        
                        batchQuotes = await yf.quote(batch);
                        batchError = null;
                        
                        const batchDuration = Date.now() - batchStartTime;
                        const quotesArray = Array.isArray(batchQuotes) ? batchQuotes : [batchQuotes];
                        
                        // Log detailed response
                        LOG.info(`[Yahoo Finance API] RESPONSE: Batch ${i + 1} received in ${batchDuration}ms`);
                        LOG.info(`[Yahoo Finance API] RESPONSE Status: 200 OK`);
                        LOG.info(`[Yahoo Finance API] RESPONSE Type: ${Array.isArray(batchQuotes) ? 'Array' : typeof batchQuotes}`);
                        LOG.info(`[Yahoo Finance API] RESPONSE Length: ${quotesArray.length} quotes`);
                        
                        if (quotesArray.length > 0) {
                            const firstQuote = quotesArray[0];
                            LOG.info(`[Yahoo Finance API] RESPONSE Sample (first quote):`);
                            LOG.info(`[Yahoo Finance API]   - Symbol: ${firstQuote?.symbol || firstQuote?.fullSymbol || 'N/A'}`);
                            LOG.info(`[Yahoo Finance API]   - Full Symbol: ${firstQuote?.fullSymbol || firstQuote?.symbol || 'N/A'}`);
                            LOG.info(`[Yahoo Finance API]   - Price: ${firstQuote?.regularMarketPrice || firstQuote?.price || 'N/A'}`);
                            LOG.info(`[Yahoo Finance API]   - Change: ${firstQuote?.regularMarketChange || firstQuote?.change || 'N/A'}`);
                            LOG.info(`[Yahoo Finance API]   - Change %: ${firstQuote?.regularMarketChangePercent || firstQuote?.changePercent || 'N/A'}`);
                            LOG.info(`[Yahoo Finance API]   - Has Data: ${!!firstQuote}`);
                            
                            // Log all symbols received
                            const receivedSymbols = quotesArray.map(q => q?.symbol || q?.fullSymbol || 'N/A').filter(s => s !== 'N/A');
                            LOG.info(`[Yahoo Finance API] RESPONSE Symbols received: ${receivedSymbols.join(', ')}`);
                        } else {
                            LOG.warning(`[Yahoo Finance API] RESPONSE: ⚠ No quotes returned in batch ${i + 1}`);
                        }
                        
                        // Filter out null/undefined quotes
                        const validQuotes = quotesArray.filter(q => q !== null && q !== undefined);
                        LOG.info(`[Yahoo Finance API] RESPONSE Valid quotes: ${validQuotes.length} out of ${quotesArray.length}`);
                        
                        if (validQuotes.length > 0) {
                            allQuotes.push(...validQuotes);
                            LOG.success(`[Yahoo Finance API] ✓ Batch ${i + 1} completed: ${validQuotes.length} valid quotes added`);
                            
                            // Cache individual quotes for future use
                            validQuotes.forEach(quote => {
                                const symbol = quote.symbol || quote.fullSymbol;
                                if (symbol) {
                                    const cacheKey = `quote_${symbol}`;
                                    this.setCached(cacheKey, quote, this.cacheTimeout);
                                }
                            });
                        } else {
                            LOG.warning(`[Yahoo Finance API] ⚠ Batch ${i + 1} returned no valid quotes`);
                        }
                        LOG.info(`[Yahoo Finance API] ========================================`);
                        break; // Success, exit retry loop
                    } catch (error) {
                        batchError = error;
                        // Log detailed error information
                        LOG.error(`[Yahoo Finance API] ✗ Batch ${i + 1} failed with error (attempt ${retryCount + 1}/${this.maxRetries + 1}):`);
                        LOG.error(`[Yahoo Finance API]   - Error type: ${error.constructor.name}`);
                        LOG.error(`[Yahoo Finance API]   - Error message: ${error.message || 'No message'}`);
                        
                        if (error.response) {
                            LOG.error(`[Yahoo Finance API]   - HTTP Status: ${error.response.status}`);
                            LOG.error(`[Yahoo Finance API]   - HTTP Status Text: ${error.response.statusText}`);
                        }
                        
                        const isRateLimit = error.message && (
                            error.message.includes('429') || 
                            error.message.includes('Too Many Requests') ||
                            error.message.includes('Failed to get crumb')
                        );
                        
                        if (isRateLimit && retryCount < this.maxRetries) {
                            // Exponential backoff: wait longer with each retry
                            const backoffDelay = this.rateLimitDelay * Math.pow(2, retryCount);
                            LOG.warning(`[Yahoo Finance API] ⚠ Rate limited for batch ${i + 1}, waiting ${backoffDelay}ms before retry ${retryCount + 1}/${this.maxRetries}...`);
                            await new Promise(resolve => setTimeout(resolve, backoffDelay));
                            retryCount++;
                        } else {
                            // Not a rate limit error, or max retries reached
                            break;
                        }
                    }
                }
                
                // Handle final error state after retries
                if (batchError) {
                    const isRateLimit = batchError.message && (
                        batchError.message.includes('429') || 
                        batchError.message.includes('Too Many Requests') ||
                        batchError.message.includes('Failed to get crumb')
                    );
                    
                    if (isRateLimit) {
                        LOG.warning(`[Yahoo Finance API] ⚠ Rate limited for batch ${i + 1} after ${this.maxRetries} retries, trying cached data...`);
                        // Try to get from cache for each symbol in the batch
                        let cachedCount = 0;
                        for (const symbol of batch) {
                            const cacheKey = `quote_${symbol}`;
                            const cached = this.getCached(cacheKey);
                            if (cached) {
                                const cachedArray = Array.isArray(cached) ? cached : [cached];
                                allQuotes.push(...cachedArray);
                                cachedCount++;
                                LOG.info(`[Yahoo Finance API]   - Using cached data for ${symbol}`);
                            } else {
                                LOG.warning(`[Yahoo Finance API]   - No cached data for ${symbol}`);
                            }
                        }
                        
                        LOG.info(`[Yahoo Finance API]   - Cached quotes found: ${cachedCount} out of ${batch.length} symbols`);
                        
                        if (cachedCount === 0) {
                            LOG.warning(`[Yahoo Finance API] ⚠ No cached data available for batch ${i + 1}, skipping batch`);
                        }
                    } else {
                        LOG.error(`[Yahoo Finance API] ✗ Batch ${i + 1} failed with non-rate-limit error after retries`);
                    }
                }
                
                // Add delay between batch groups (except for last batch)
                if (i < batches.length - 1) {
                    LOG.info(`[Yahoo Finance API] Waiting ${this.batchDelay}ms before next batch...`);
                    await new Promise(resolve => setTimeout(resolve, this.batchDelay));
                }
            }
            
            const quotes = allQuotes;
            
            // Log final results
            LOG.info(`[Yahoo Finance API] ========================================`);
            LOG.info(`[Yahoo Finance API] Final Results Summary:`);
            LOG.info(`[Yahoo Finance API]   - Total symbols requested: ${normalizedSymbols.length}`);
            LOG.info(`[Yahoo Finance API]   - Total quotes fetched: ${quotes.length}`);
            LOG.info(`[Yahoo Finance API]   - Success rate: ${quotes.length > 0 ? ((quotes.length / normalizedSymbols.length) * 100).toFixed(1) : 0}%`);
            
            if (quotes.length === 0) {
                LOG.warning(`[Yahoo Finance API] ⚠ No quotes fetched from API, checking individual cache for all symbols...`);
                const cachedQuotes = [];
                for (const symbol of normalizedSymbols) {
                    const individualCacheKey = `quote_${symbol}`;
                    const cached = this.getCached(individualCacheKey);
                    if (cached) {
                        const cachedArray = Array.isArray(cached) ? cached : [cached];
                        cachedQuotes.push(...cachedArray);
                        LOG.info(`[Yahoo Finance API]   - Found cached data for ${symbol}`);
                    } else {
                        LOG.warning(`[Yahoo Finance API]   - No cached data for ${symbol}`);
                    }
                }
                if (cachedQuotes.length > 0) {
                    LOG.info(`[Yahoo Finance API] ✓ Using ${cachedQuotes.length} cached quotes as fallback`);
                    // Cached quotes are already in our format, just return them
                    return Array.isArray(symbols) ? cachedQuotes : cachedQuotes[0];
                } else {
                    LOG.error(`[Yahoo Finance API] ✗ No quotes available from API or cache for any symbols`);
                }
            } else {
                LOG.success(`[Yahoo Finance API] ✓ Successfully fetched ${quotes.length} quotes`);
            }
            LOG.info(`[Yahoo Finance API] ========================================`);

            // Transform to our format
            const transformed = normalizedSymbols.map(symbol => {
                const quote = Array.isArray(quotes) 
                    ? quotes.find(q => q.symbol === symbol || q.symbol === symbol.toUpperCase())
                    : quotes;
                
                if (!quote) return null;
                
                return {
                    symbol: symbol.replace(/\.(NS|BO)$/i, ''),
                    fullSymbol: symbol,
                    name: quote.longName || quote.shortName || quote.displayName || symbol,
                    price: quote.regularMarketPrice || quote.previousClose || 0,
                    change: quote.regularMarketChange || 0,
                    changePercent: quote.regularMarketChangePercent || 0,
                    previousClose: quote.previousClose || 0,
                    open: quote.regularMarketOpen || 0,
                    high: quote.regularMarketDayHigh || 0,
                    low: quote.regularMarketDayLow || 0,
                    volume: quote.regularMarketVolume || 0,
                    marketCap: quote.marketCap || 0,
                    currency: quote.currency || 'INR',
                    exchange: exchange,
                    timestamp: new Date().toISOString()
                };
            }).filter(q => q !== null);

            // Cache the result
            this.setCached(cacheKey, transformed, this.cacheTimeout);

            // Store in history (EOD)
            await this.storeEODHistory(transformed);

            return Array.isArray(symbols) ? transformed : transformed[0];
        } catch (error) {
            const symbolArray = Array.isArray(symbols) ? symbols : [symbols];
            const symbolStr = symbolArray.join(', ');
            LOG.error(`[Yahoo Finance] Error fetching quote for ${symbolStr}:`, error.message);
            LOG.error(`[Yahoo Finance] Error stack:`, error.stack);
            // Try to get from history cache
            const historyData = await this.getHistoryData(symbols, exchange);
            if (historyData) {
                LOG.info('[Yahoo Finance] Using history data as fallback');
                return historyData;
            }
            throw error;
        }
    }

    /**
     * Get historical price data
     * @param {string} symbol - Stock symbol
     * @param {Object} options - { period1, period2, interval }
     * @param {string} exchange - 'NSE' or 'BSE'
     * @returns {Promise<Array>} Historical data
     */
    async getHistorical(symbol, options = {}, exchange = 'NSE') {
        // Check if Yahoo Finance is enabled
        this.checkYahooFinanceEnabled();
        
        try {
            const normalizedSymbol = this.normalizeSymbol(symbol, exchange);
            
            const defaultOptions = {
                period1: options.period1 || Math.floor((Date.now() - 365 * 24 * 60 * 60 * 1000) / 1000), // 1 year ago
                period2: options.period2 || Math.floor(Date.now() / 1000), // Now
                interval: options.interval || '1d' // 1 day
            };

            LOG.info(`[Yahoo Finance] Fetching historical data for ${normalizedSymbol}`);
            const yf = await this.getYahooFinance();
            
            // Library handles concurrency - direct call
            const history = await yf.historical(normalizedSymbol, {
                period1: new Date(defaultOptions.period1 * 1000),
                period2: new Date(defaultOptions.period2 * 1000),
                interval: defaultOptions.interval
            });

            return history.map(item => ({
                date: item.date,
                open: item.open,
                high: item.high,
                low: item.low,
                close: item.close,
                volume: item.volume,
                adjustedClose: item.adjClose
            }));
        } catch (error) {
            LOG.error('[Yahoo Finance] Error fetching historical data:', error.message);
            throw error;
        }
    }

    /**
     * Search for stocks
     * @param {string} query - Search query
     * @returns {Promise<Array>} Search results
     */
    async search(query) {
        // Check if Yahoo Finance is enabled
        this.checkYahooFinanceEnabled();
        
        try {
            const searchStartTime = Date.now();
            LOG.info(`[Yahoo Finance API] ========================================`);
            LOG.info(`[Yahoo Finance API] REQUEST: Search`);
            LOG.info(`[Yahoo Finance API] REQUEST URL: https://query1.finance.yahoo.com/v1/finance/search`);
            LOG.info(`[Yahoo Finance API] REQUEST Query: "${query}"`);
            LOG.info(`[Yahoo Finance API] REQUEST Method: GET`);
            LOG.info(`[Yahoo Finance API] REQUEST Headers: { User-Agent: yahoo-finance2 }`);
            
            const yf = await this.getYahooFinance();
            
            // Library handles concurrency - direct call
            const results = await yf.search(query);
            const searchDuration = Date.now() - searchStartTime;
            
            const resultsArray = Array.isArray(results) ? results : (results?.quotes || []);
            LOG.info(`[Yahoo Finance API] RESPONSE: Search completed in ${searchDuration}ms`);
            LOG.info(`[Yahoo Finance API] RESPONSE Status: 200 OK`);
            LOG.info(`[Yahoo Finance API] RESPONSE Results: ${resultsArray.length} items`);
            
            if (resultsArray.length > 0) {
                LOG.info(`[Yahoo Finance API] RESPONSE Sample (first result):`);
                LOG.info(`[Yahoo Finance API]   - Symbol: ${resultsArray[0]?.symbol || resultsArray[0]?.shortname || 'N/A'}`);
                LOG.info(`[Yahoo Finance API]   - Name: ${resultsArray[0]?.longname || resultsArray[0]?.shortname || 'N/A'}`);
                LOG.info(`[Yahoo Finance API]   - Type: ${resultsArray[0]?.quoteType || 'N/A'}`);
                LOG.info(`[Yahoo Finance API]   - Exchange: ${resultsArray[0]?.exchange || 'N/A'}`);
            } else {
                LOG.warning(`[Yahoo Finance API] RESPONSE: ⚠ No results found for "${query}"`);
            }
            LOG.info(`[Yahoo Finance API] ========================================`);

            return resultsArray.map(item => ({
                symbol: item.symbol,
                name: item.longname || item.shortname || item.name,
                exchange: item.exchange,
                type: item.quoteType,
                quoteType: item.quoteType
            }));
        } catch (error) {
            LOG.error(`[Yahoo Finance API] ========================================`);
            LOG.error(`[Yahoo Finance API] ERROR: Search failed for "${query}"`);
            LOG.error(`[Yahoo Finance API] ERROR Type: ${error.constructor.name}`);
            LOG.error(`[Yahoo Finance API] ERROR Message: ${error.message || 'No message'}`);
            if (error.response) {
                LOG.error(`[Yahoo Finance API] ERROR HTTP Status: ${error.response.status}`);
                LOG.error(`[Yahoo Finance API] ERROR HTTP Status Text: ${error.response.statusText}`);
            }
            LOG.error(`[Yahoo Finance API] ========================================`);
            throw error;
        }
    }

    /**
     * Get popular/trending stocks dynamically from API
     * Uses search to find popular Indian stocks, then fetches their quotes
     * @param {number} limit - Number of stocks to return (default: 50)
     * @returns {Promise<Array>} Popular stocks with quotes
     */
    async getPopularStocks(limit = 50) {
        // Check if Yahoo Finance is enabled
        this.checkYahooFinanceEnabled();
        
        try {
            LOG.info(`[Yahoo Finance] Fetching ${limit} popular stocks dynamically from API...`);
            const yf = await this.getYahooFinance();
            
            // Check cache first
            const cacheKey = `popular_stocks_${limit}`;
            const cached = this.getCached(cacheKey);
            if (cached) {
                LOG.info(`[Yahoo Finance] Using cached popular stocks (${cached.length} stocks)`);
                return cached;
            }
            
            // First, try using a hardcoded list of popular Indian stocks directly
            // This is more reliable than search which may fail due to rate limits
            const popularIndianStocks = [
                'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS',
                'HINDUNILVR.NS', 'SBIN.NS', 'BHARTIARTL.NS', 'ITC.NS', 'KOTAKBANK.NS',
                'LT.NS', 'AXISBANK.NS', 'ASIANPAINT.NS', 'MARUTI.NS', 'TITAN.NS',
                'NESTLEIND.NS', 'ULTRACEMCO.NS', 'WIPRO.NS', 'SUNPHARMA.NS', 'ONGC.NS',
                'NTPC.NS', 'POWERGRID.NS', 'TECHM.NS', 'HCLTECH.NS', 'BAJFINANCE.NS',
                'ADANIENT.NS', 'JSWSTEEL.NS', 'TATAMOTORS.NS', 'TATASTEEL.NS', 'HDFCLIFE.NS',
                'GRASIM.NS', 'M&M.NS', 'DIVISLAB.NS', 'SBILIFE.NS', 'BAJAJFINSV.NS',
                'CIPLA.NS', 'COALINDIA.NS', 'DRREDDY.NS', 'EICHERMOT.NS', 'HEROMOTOCO.NS',
                'INDUSINDBK.NS', 'APOLLOHOSP.NS', 'BAJAJ-AUTO.NS', 'BPCL.NS',
                'BRITANNIA.NS', 'HDFCAMC.NS', 'MARICO.NS', 'PIDILITIND.NS', 'SIEMENS.NS'
            ];
            
            // Use hardcoded list as primary source (more reliable)
            const allSymbols = new Set(popularIndianStocks.slice(0, limit));
            LOG.info(`[Yahoo Finance] Using ${allSymbols.size} popular Indian stocks from hardcoded list`);
            
            // Optionally try to supplement with search results (but don't fail if search fails)
            const searchTerms = ['NIFTY', 'SENSEX'];
            let searchAttempts = 0;
            const maxSearchAttempts = 2; // Limit search attempts to avoid rate limits
            
            for (const term of searchTerms) {
                if (searchAttempts >= maxSearchAttempts) break;
                try {
                    LOG.info(`[Yahoo Finance] Attempting search for: ${term}`);
                    const searchResults = await yf.search(term);
                    
                    // yahoo-finance2 search returns an array of results
                    const results = Array.isArray(searchResults) ? searchResults : (searchResults?.quotes || []);
                    
                    if (results && results.length > 0) {
                        let addedCount = 0;
                        results.forEach(quote => {
                            // Only include NSE/BSE stocks
                            const symbol = quote.symbol || quote.shortname || quote.longname;
                            if (symbol && (symbol.endsWith('.NS') || symbol.endsWith('.BO'))) {
                                if (allSymbols.size < limit) {
                                    allSymbols.add(symbol);
                                    addedCount++;
                                }
                            }
                        });
                        if (addedCount > 0) {
                            LOG.info(`[Yahoo Finance] Added ${addedCount} symbols from search for "${term}", total: ${allSymbols.size}`);
                        }
                    } else {
                        LOG.warning(`[Yahoo Finance] No results found for "${term}"`);
                    }
                    
                    searchAttempts++;
                    // Small delay between searches to avoid rate limits
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    LOG.warning(`[Yahoo Finance] Search for "${term}" failed: ${error.message}`);
                    searchAttempts++;
                    // Continue with next search term, but don't fail completely
                }
            }
            
            // Convert to array and limit
            let symbolsArray = Array.from(allSymbols).slice(0, limit);
            LOG.info(`[Yahoo Finance] Final symbol list: ${symbolsArray.length} symbols ready for quote fetching`);
            
            LOG.info(`[Yahoo Finance] Final symbol list: ${symbolsArray.length} symbols, fetching quotes...`);
            
            // Fetch quotes for all symbols
            const quotes = await this.getQuote(symbolsArray, 'NSE');
            const quotesArray = Array.isArray(quotes) ? quotes : [quotes].filter(Boolean);
            
            LOG.info(`[Yahoo Finance] Quotes fetched: ${quotesArray.length} out of ${symbolsArray.length} requested`);
            
            if (quotesArray.length === 0) {
                LOG.error(`[Yahoo Finance] ✗ No quotes returned for ${symbolsArray.length} symbols`);
                return [];
            }
            
            // Cache the result for 5 minutes
            this.setCached(cacheKey, quotesArray, 300000);
            
            LOG.success(`[Yahoo Finance] ✓ Successfully fetched ${quotesArray.length} popular stocks from API`);
            return quotesArray;
        } catch (error) {
            LOG.error('[Yahoo Finance] Error fetching popular stocks:', error.message);
            throw error;
        }
    }

    /**
     * Get trending symbols (legacy method - now uses getPopularStocks)
     * @returns {Promise<Array>} Trending stocks
     */
    async getTrendingSymbols() {
        try {
            LOG.info('[Yahoo Finance] Fetching trending symbols');
            // Use getPopularStocks instead of hardcoded list
            const popularStocks = await this.getPopularStocks(20);
            LOG.info(`[Yahoo Finance] Returning ${popularStocks.length} trending symbols`);
            return popularStocks;
        } catch (error) {
            LOG.error('[Yahoo Finance] Error fetching trending symbols:', error.message);
            throw error;
        }
    }

    /**
     * Get analyst recommendations
     * @param {string} symbol - Stock symbol
     * @param {string} exchange - 'NSE' or 'BSE'
     * @returns {Promise<Object>} Recommendations
     */
    async getRecommendations(symbol, exchange = 'NSE') {
        // Check if Yahoo Finance is enabled
        this.checkYahooFinanceEnabled();
        
        try {
            const normalizedSymbol = this.normalizeSymbol(symbol, exchange);
            
            LOG.info(`[Yahoo Finance] Fetching recommendations for ${normalizedSymbol}`);
            // yahoo-finance2 uses quoteSummary for recommendations
            const yf = await this.getYahooFinance();
            
            // Library handles concurrency - direct call
            const quoteSummary = await yf.quoteSummary(normalizedSymbol, {
                modules: ['recommendationTrend']
            });
            
            const recommendationTrend = quoteSummary.recommendationTrend?.trend || [];
            const summary = quoteSummary.recommendationTrend?.trend?.[0] || {};

            return {
                symbol: symbol,
                recommendations: recommendationTrend,
                summary: {
                    buy: summary.buy || 0,
                    hold: summary.hold || 0,
                    sell: summary.sell || 0,
                    strongBuy: summary.strongBuy || 0,
                    strongSell: summary.strongSell || 0
                }
            };
        } catch (error) {
            LOG.error('[Yahoo Finance] Error fetching recommendations:', error.message);
            throw error;
        }
    }

    /**
     * Get options chain
     * @param {string} symbol - Stock symbol
     * @param {string} exchange - 'NSE' or 'BSE'
     * @returns {Promise<Object>} Options chain
     */
    async getOptions(symbol, exchange = 'NSE') {
        // Check if Yahoo Finance is enabled
        this.checkYahooFinanceEnabled();
        
        try {
            const normalizedSymbol = this.normalizeSymbol(symbol, exchange);
            
            LOG.info(`[Yahoo Finance] Fetching options for ${normalizedSymbol}`);
            // yahoo-finance2 uses quoteSummary for options
            const yf = await this.getYahooFinance();
            
            // Use retry logic for rate limiting
            // Library handles concurrency - direct call
            const quoteSummary = await yf.quoteSummary(normalizedSymbol, {
                modules: ['options']
            });
            
            const optionsData = quoteSummary.options || {};
            const expirationDates = optionsData.expirationDates || [];
            const strikes = optionsData.strikes || [];

            return {
                symbol: symbol,
                calls: optionsData.calls || [],
                puts: optionsData.puts || [],
                expirationDates: expirationDates,
                strikes: strikes
            };
        } catch (error) {
            LOG.error('[Yahoo Finance] Error fetching options:', error.message);
            throw error;
        }
    }

    /**
     * Screen stocks with filters
     * @param {Object} filters - Screening filters
     * @param {boolean} bypassCache - Force fresh data fetch
     * @returns {Promise<Array>} Screened stocks
     */
    async screenStocks(filters = {}, bypassCache = false) {
        // Check if Yahoo Finance is enabled
        this.checkYahooFinanceEnabled();
        
        try {
            LOG.info('[Yahoo Finance] Screening stocks with filters:', filters);
            // Fetch popular stocks dynamically from API instead of hardcoded list
            const count = filters.count || 10;
            const requiredSymbols = Math.max(count * 3, 30);
            
            LOG.info(`[Yahoo Finance] Fetching ${requiredSymbols} popular stocks dynamically from API...`);
            const popularStocks = await this.getPopularStocks(requiredSymbols);
            
            // Extract symbols from popular stocks
            let symbolsToFetch = popularStocks
                .map(stock => {
                    // Handle different response formats
                    if (typeof stock === 'string') return stock;
                    return stock.fullSymbol || stock.symbol || stock.shortname || stock.longname;
                })
                .filter(symbol => {
                    if (!symbol) return false;
                    const sym = symbol.toString();
                    return sym.endsWith('.NS') || sym.endsWith('.BO') || !sym.includes('.');
                })
                .map(symbol => {
                    // Ensure .NS suffix if not present
                    const sym = symbol.toString();
                    if (!sym.includes('.')) {
                        return this.normalizeSymbol(sym, 'NSE');
                    }
                    return sym;
                })
                .slice(0, requiredSymbols);
            
            LOG.info(`[Yahoo Finance API] Extracted ${symbolsToFetch.length} symbols from ${popularStocks.length} popular stocks (bypassCache: ${bypassCache})...`);
            
            // If no symbols extracted, log detailed error
            if (symbolsToFetch.length === 0) {
                LOG.error(`[Yahoo Finance] ========================================`);
                LOG.error(`[Yahoo Finance] ✗ CRITICAL: No valid symbols extracted from popular stocks!`);
                LOG.error(`[Yahoo Finance] Popular stocks array length: ${popularStocks.length}`);
                if (popularStocks.length > 0) {
                    LOG.error(`[Yahoo Finance] Sample popular stock structure:`, JSON.stringify(popularStocks[0], null, 2));
                    LOG.error(`[Yahoo Finance] Available keys in first item:`, Object.keys(popularStocks[0] || {}));
                } else {
                    LOG.error(`[Yahoo Finance] Popular stocks array is EMPTY - getPopularStocks returned no results!`);
                    LOG.error(`[Yahoo Finance] This means: getPopularStocks() failed or returned empty array`);
                }
                LOG.error(`[Yahoo Finance] ========================================`);
                return [];
            }
            
            // If bypassing cache, clear cache for these symbols first
            if (bypassCache) {
                for (const symbol of symbolsToFetch) {
                    const cacheKey = `quote_${symbol}`;
                    this.cache.delete(cacheKey);
                }
                // Also clear batch cache
                const batchCacheKey = `quote_${symbolsToFetch.join('_')}`;
                this.cache.delete(batchCacheKey);
            }
            
            LOG.info(`[Yahoo Finance API] Fetching quotes for ${symbolsToFetch.length} symbols: ${symbolsToFetch.slice(0, 5).join(', ')}...`);
            const quotes = await this.getQuote(symbolsToFetch, 'NSE');
            const quotesArray = Array.isArray(quotes) ? quotes : [quotes].filter(Boolean);

            const stocks = quotesArray
                .filter(q => q && (q.price || q.regularMarketPrice) && (q.price || q.regularMarketPrice) > 0) // Filter out invalid quotes
                .map(item => {
                    // Handle both transformed format (from getQuote) and raw format
                    const price = item.price || item.regularMarketPrice || 0;
                    const change = item.change || item.regularMarketChange || 0;
                    const changePercent = item.changePercent || item.regularMarketChangePercent || 0;
                    
                    return {
                        symbol: item.symbol || item.fullSymbol?.replace(/\.(NS|BO)$/i, '') || 'N/A',
                        name: item.name || item.longName || item.shortName || item.displayName || item.symbol,
                        price: price,
                        change: change,
                        changePercent: changePercent,
                        volume: item.volume || item.regularMarketVolume || 0,
                        marketCap: item.marketCap || 0
                    };
                })
                .filter(stock => stock.price > 0 && stock.changePercent !== 0) // Only stocks with valid price and price changes
                .sort((a, b) => {
                    // Sort based on filters
                    if (filters.sortField === 'changePercent') {
                        return filters.sortType === 'DESC' 
                            ? b.changePercent - a.changePercent 
                            : a.changePercent - b.changePercent;
                    }
                    return 0;
                })
                .slice(0, count);

            LOG.info(`[Yahoo Finance] Screened ${stocks.length} stocks from ${quotesArray.length} quotes`);
            return stocks;
        } catch (error) {
            LOG.error('[Yahoo Finance] Error screening stocks:', error.message);
            throw error;
        }
    }

    /**
     * Get top gainers (Indian market)
     * @returns {Promise<Array>} Top gainers
     */
    async getTopGainers(limit = 10) {
        // Check if Yahoo Finance is enabled
        this.checkYahooFinanceEnabled();
        
        try {
            LOG.info(`[Yahoo Finance] ========================================`);
            LOG.info(`[Yahoo Finance] Fetching top ${limit} gainers (bypassing cache for fresh data)...`);
            
            // Use screener to get top gainers, bypass cache to get fresh data
            const screener = await this.screenStocks({
                sortField: 'changePercent',
                sortType: 'DESC',
                count: limit * 2 // Fetch more to account for filtering
            }, true); // bypassCache = true

            // Filter to only positive changes (gainers)
            const gainers = screener.filter(stock => stock.changePercent > 0);
            
            // If no gainers with positive change, return top stocks by price (market might be closed)
            let result = gainers.slice(0, limit);
            
            if (result.length === 0 && screener.length > 0) {
                LOG.warning(`[Yahoo Finance] ⚠ No stocks with positive change found. Market might be closed.`);
                LOG.warning(`[Yahoo Finance] Returning top ${limit} stocks by price instead...`);
                result = screener
                    .sort((a, b) => b.price - a.price)
                    .slice(0, limit);
            }

            LOG.info(`[Yahoo Finance] Found ${result.length} top gainers (from ${screener.length} screened stocks)`);
            if (result.length > 0) {
                LOG.info(`[Yahoo Finance] Top gainer: ${result[0]?.symbol} - ${result[0]?.name} - Change: ${result[0]?.changePercent}%`);
            }
            LOG.info(`[Yahoo Finance] ========================================`);
            
            return result;
        } catch (error) {
            LOG.error('[Yahoo Finance] ========================================');
            LOG.error(`[Yahoo Finance] ✗ Error fetching top gainers: ${error.message}`);
            LOG.error(`[Yahoo Finance] Error Stack: ${error.stack ? error.stack.split('\n').slice(0, 3).join('\n') : 'No stack'}`);
            LOG.error('[Yahoo Finance] ========================================');
            throw error;
        }
    }

    /**
     * Get top losers (Indian market)
     * @returns {Promise<Array>} Top losers
     */
    async getTopLosers(limit = 10) {
        // Check if Yahoo Finance is enabled
        this.checkYahooFinanceEnabled();
        
        try {
            LOG.info(`[Yahoo Finance] Fetching top ${limit} losers (bypassing cache for fresh data)...`);
            // Use screener to get top losers, bypass cache to get fresh data
            const screener = await this.screenStocks({
                sortField: 'changePercent',
                sortType: 'ASC',
                count: limit
            }, true); // bypassCache = true

            const result = screener.slice(0, limit);
            LOG.info(`[Yahoo Finance] Found ${result.length} top losers`);
            return result;
        } catch (error) {
            LOG.error('[Yahoo Finance] Error fetching top losers:', error.message);
            throw error;
        }
    }

    /**
     * Get market indices (NIFTY, SENSEX)
     * @returns {Promise<Array>} Market indices
     */
    async getMarketIndices() {
        // Check if Yahoo Finance is enabled
        this.checkYahooFinanceEnabled();
        
        try {
            const indices = [
                { symbol: '^NSEI', name: 'NIFTY 50', exchange: 'NSE' },
                { symbol: '^BSESN', name: 'SENSEX', exchange: 'BSE' },
                { symbol: '^NSEBANK', name: 'NIFTY BANK', exchange: 'NSE' }
            ];

            // Log API call details
            LOG.info(`[Yahoo Finance API] ========================================`);
            LOG.info(`[Yahoo Finance API] GET Market Indices`);
            LOG.info(`[Yahoo Finance API] Base URL: https://query1.finance.yahoo.com/v8/finance/chart/`);
            LOG.info(`[Yahoo Finance API] Symbols: ${indices.map(i => i.symbol).join(', ')}`);
            LOG.info(`[Yahoo Finance API] Exchange: NSE/BSE`);
            LOG.info(`[Yahoo Finance API] API Key: Not required (public API)`);
            LOG.info(`[Yahoo Finance API] API Secret: Not required (public API)`);
            LOG.info(`[Yahoo Finance API] Package: yahoo-finance2`);
            LOG.info(`[Yahoo Finance API] ========================================`);

            // Check cache first
            const cacheKey = 'market_indices';
            const cached = this.getCached(cacheKey);
            if (cached) {
                LOG.info('[Yahoo Finance] Using cached market indices');
                return cached;
            }

            // Fetch all indices in one batch (library handles concurrency)
            const indexSymbols = indices.map(i => ({ symbol: i.symbol, exchange: i.exchange }));
            const allSymbols = indexSymbols.map(i => this.normalizeSymbol(i.symbol, i.exchange));
            
            LOG.info(`[Yahoo Finance API] Fetching ${allSymbols.length} indices in one batch (library manages concurrency)...`);
            const quotes = await this.getQuote(allSymbols, 'NSE');
            const quotesArray = Array.isArray(quotes) ? quotes : [quotes];

            // Log what quotes we received
            LOG.info(`[Yahoo Finance] Received ${quotesArray.length} quotes for indices`);
            if (quotesArray.length > 0) {
                LOG.info(`[Yahoo Finance] Sample quote:`, {
                    symbol: quotesArray[0]?.symbol,
                    fullSymbol: quotesArray[0]?.fullSymbol,
                    price: quotesArray[0]?.price,
                    hasData: !!quotesArray[0]
                });
            } else {
                LOG.error(`[Yahoo Finance] ✗ No quotes received for indices!`);
            }
            
            // Map quotes to indices (find by symbol match)
            const result = indices.map((index) => {
                const normalizedSymbol = this.normalizeSymbol(index.symbol, index.exchange);
                LOG.info(`[Yahoo Finance] Looking for quote for ${index.name} (${index.symbol} -> ${normalizedSymbol})`);
                
                const quote = quotesArray.find(q => {
                    if (!q) return false;
                    
                    // Try multiple matching strategies
                    const qSymbol = q.symbol || '';
                    const qFullSymbol = q.fullSymbol || '';
                    
                    // Match by full symbol
                    const match1 = qFullSymbol === normalizedSymbol || qFullSymbol === index.symbol;
                    // Match by symbol without suffix
                    const match2 = qSymbol === normalizedSymbol.replace(/\.(NS|BO)$/i, '') || 
                                   qSymbol === index.symbol.replace(/^[\^]/, '');
                    // Match by exact symbol
                    const match3 = qSymbol === normalizedSymbol || qSymbol === index.symbol;
                    // Match by fullSymbol without suffix
                    const match4 = qFullSymbol.replace(/\.(NS|BO)$/i, '') === index.symbol.replace(/^[\^]/, '');
                    
                    return match1 || match2 || match3 || match4;
                });
                
                if (quote) {
                    LOG.info(`[Yahoo Finance] ✓ Found quote for ${index.name}:`, {
                        price: quote.price,
                        change: quote.change,
                        changePercent: quote.changePercent
                    });
                } else {
                    LOG.warning(`[Yahoo Finance] ✗ No quote found for ${index.name} (${index.symbol})`);
                    LOG.warning(`[Yahoo Finance] Available quote symbols: ${quotesArray.map(q => q?.symbol || q?.fullSymbol || 'N/A').join(', ')}`);
                }
                
                return {
                    name: index.name,
                    value: quote?.price || 0,
                    change: quote?.change || 0,
                    changePercent: quote?.changePercent || 0,
                    expiry: this.getExpiryDate()
                };
            });
            
            LOG.info(`[Yahoo Finance] Final indices result:`, result.map(r => `${r.name}: ₹${r.value} (${r.changePercent >= 0 ? '+' : ''}${r.changePercent}%)`).join(', '));

            // Cache the result
            this.setCached(cacheKey, result, this.cacheTimeout * 2); // Cache for 2 minutes

            return result;
        } catch (error) {
            LOG.error('[Yahoo Finance] Error fetching market indices:', error.message);
            
            // Try to get from cache
            const cached = this.getCached('market_indices');
            if (cached) {
                LOG.info('[Yahoo Finance] Using cached market indices after error');
                return cached;
            }
            
            // Return empty array instead of mock data (let frontend handle empty state)
            return [];
        }
    }

    /**
     * Get expiry date for futures/options
     * @returns {string} Expiry date
     */
    getExpiryDate() {
        const now = new Date();
        const lastThursday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (4 - now.getDay() + 7) % 7);
        if (lastThursday < now) {
            lastThursday.setDate(lastThursday.getDate() + 7);
        }
        return lastThursday.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    /**
     * Cache management
     */
    getCached(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < cached.timeout) {
            return cached.data;
        }
        this.cache.delete(key);
        return null;
    }

    setCached(key, data, timeout = this.cacheTimeout) {
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            timeout
        });
    }

    /**
     * Store EOD (End of Day) history
     */
    async storeEODHistory(quotes) {
        try {
            const today = new Date().toISOString().split('T')[0];
            const historyKey = `eod_${today}`;
            
            if (!this.historyCache.has(historyKey)) {
                this.historyCache.set(historyKey, []);
            }
            
            const history = this.historyCache.get(historyKey);
            quotes.forEach(quote => {
                const existing = history.find(h => h.symbol === quote.symbol);
                if (existing) {
                    Object.assign(existing, quote);
                } else {
                    history.push(quote);
                }
            });
            
            // Store in database if available
            const pool = db.getPool();
            if (pool) {
                // TODO: Implement database storage for EOD history
                // CREATE TABLE IF NOT EXISTS stock_history (symbol, date, price, change, ...)
            }
        } catch (error) {
            LOG.error('[Yahoo Finance] Error storing EOD history:', error.message);
        }
    }

    /**
     * Get history data as fallback
     */
    async getHistoryData(symbols, exchange) {
        try {
            const today = new Date().toISOString().split('T')[0];
            const historyKey = `eod_${today}`;
            const history = this.historyCache.get(historyKey);
            
            if (!history) return null;
            
            const symbolArray = Array.isArray(symbols) ? symbols : [symbols];
            const normalizedSymbols = symbolArray.map(s => this.normalizeSymbol(s, exchange));
            
            return history.filter(h => 
                normalizedSymbols.some(ns => h.fullSymbol === ns || h.symbol === ns.replace(/\.(NS|BO)$/i, ''))
            );
        } catch (error) {
            LOG.error('[Yahoo Finance] Error getting history data:', error.message);
            return null;
        }
    }
}

module.exports = new YahooFinanceService();

