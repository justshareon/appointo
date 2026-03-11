/**
 * Trading Routes
 * API endpoints for stock trading functionality
 * Supports two data sources:
 * 1. Google Sheets -> MySQL (default, when USE_YAHOO_FINANCE=false)
 * 2. Yahoo Finance API (when USE_YAHOO_FINANCE=true)
 */
const express = require('express');
const router = express.Router();
const config = require('../config/tradingConfig');
const yahooFinanceService = require('../services/yahooFinanceService');
const tradingDataService = require('../services/tradingDataService');
const stockDataService = require('../services/stockDataService');
const mutualFundDataService = require('../services/mutualFundDataService');
const corporateActionsDataService = require('../services/corporateActionsDataService');
const boardMeetingsDataService = require('../services/boardMeetingsDataService');
const featureEngineeringService = require('../services/featureEngineeringService');
const LOG = require('../utils/logger');

/**
 * Middleware to disable ETags and caching for trading routes
 * This prevents 304 Not Modified responses and ensures fresh data
 */
const disableCaching = (req, res, next) => {
    res.set('ETag', false);
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
};

// Apply caching disable middleware to all trading routes
router.use(disableCaching);

/**
 * GET /api/trading/quote
 * Get current quote for stock(s) from local DB, fetch from API if not available
 * Query params: symbols (comma-separated), exchange (NSE/BSE)
 */
router.get('/quote', async (req, res) => {
    try {
        const { symbols, exchange = 'NSE' } = req.query;
        
        if (!symbols) {
            return res.status(400).json({ error: 'Symbols parameter is required' });
        }

        const symbolArray = symbols.split(',').map(s => s.trim());
        
        // Check data source configuration
        if (config.dataSources.useYahooFinance) {
            // Use Yahoo Finance API (legacy mode)
            LOG.info('[Trading Routes] Using Yahoo Finance API for quotes');
            const quotesFromDB = symbolArray.map(symbol => tradingDataService.getStockQuote(symbol)).filter(Boolean);
            
            if (quotesFromDB.length === symbolArray.length) {
                return res.json({ success: true, data: quotesFromDB });
            }
            
            const missingSymbols = symbolArray.filter(s => !quotesFromDB.find(q => q.symbol === s));
            if (missingSymbols.length > 0) {
                LOG.info(`[Trading Routes] Fetching ${missingSymbols.length} symbols from Yahoo Finance API...`);
                const quotesFromAPI = await tradingDataService.refreshStockQuotes(missingSymbols, exchange);
                const allQuotes = [...quotesFromDB, ...quotesFromAPI];
                return res.json({ success: true, data: allQuotes });
            }
            
            return res.json({ success: true, data: quotesFromDB });
        } else {
            // Use MySQL database (Google Sheets source)
            LOG.info('[Trading Routes] Using MySQL database for quotes');
            const quotes = await stockDataService.getStockQuotes(symbolArray);
            return res.json({ success: true, data: quotes });
        }
    } catch (error) {
        LOG.error('[Trading Routes] Error fetching quote:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch quote' });
    }
});

/**
 * GET /api/trading/historical
 * Get historical price data
 * Query params: symbol, period1, period2, interval, exchange
 */
router.get('/historical', async (req, res) => {
    try {
        const { symbol, period1, period2, interval, exchange = 'NSE' } = req.query;
        
        if (!symbol) {
            return res.status(400).json({ error: 'Symbol parameter is required' });
        }

        // Historical data only available from Yahoo Finance
        if (!config.dataSources.useYahooFinance) {
            return res.status(503).json({ 
                error: 'Historical data is only available when Yahoo Finance is enabled',
                suggestion: 'Set USE_YAHOO_FINANCE=true in environment variables to enable'
            });
        }

        const options = {};
        if (period1) options.period1 = parseInt(period1);
        if (period2) options.period2 = parseInt(period2);
        if (interval) options.interval = interval;

        const history = await yahooFinanceService.getHistorical(symbol, options, exchange);
        
        res.json({ success: true, data: history });
    } catch (error) {
        LOG.error('[Trading Routes] Error fetching historical data:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch historical data' });
    }
});

/**
 * GET /api/trading/search
 * Search for stocks
 * Query params: query
 */
router.get('/search', async (req, res) => {
    try {
        const { query } = req.query;
        
        if (!query) {
            return res.status(400).json({ error: 'Query parameter is required' });
        }

        // Search only available from Yahoo Finance
        if (!config.dataSources.useYahooFinance) {
            // Fallback: Search in MySQL database by symbol/name
            LOG.info('[Trading Routes] Searching in MySQL database');
            const allStocks = await stockDataService.getAllStocks();
            const queryLower = query.toLowerCase();
            const results = allStocks
                .filter(stock => 
                    stock.symbol.toLowerCase().includes(queryLower) ||
                    (stock.name && stock.name.toLowerCase().includes(queryLower))
                )
                .map(stock => ({
                    symbol: stock.symbol,
                    name: stock.name,
                    exchange: 'NSE',
                    type: 'EQUITY',
                    quoteType: 'EQUITY'
                }));
            
            return res.json({ success: true, data: results });
        }

        const results = await yahooFinanceService.search(query);
        
        res.json({ success: true, data: results });
    } catch (error) {
        LOG.error('[Trading Routes] Error searching:', error);
        res.status(500).json({ error: error.message || 'Failed to search stocks' });
    }
});

/**
 * GET /api/trading/trending
 * Get trending symbols
 */
router.get('/trending', async (req, res) => {
    try {
        const trending = await yahooFinanceService.getTrendingSymbols();
        
        res.json({ success: true, data: trending });
    } catch (error) {
        LOG.error('[Trading Routes] Error fetching trending symbols:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch trending symbols' });
    }
});

/**
 * GET /api/trading/recommendations
 * Get analyst recommendations
 * Query params: symbol, exchange
 */
router.get('/recommendations', async (req, res) => {
    try {
        const { symbol, exchange = 'NSE' } = req.query;
        
        if (!symbol) {
            return res.status(400).json({ error: 'Symbol parameter is required' });
        }

        const recommendations = await yahooFinanceService.getRecommendations(symbol, exchange);
        
        res.json({ success: true, data: recommendations });
    } catch (error) {
        LOG.error('[Trading Routes] Error fetching recommendations:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch recommendations' });
    }
});

/**
 * GET /api/trading/options
 * Get options chain
 * Query params: symbol, exchange
 */
router.get('/options', async (req, res) => {
    try {
        const { symbol, exchange = 'NSE' } = req.query;
        
        if (!symbol) {
            return res.status(400).json({ error: 'Symbol parameter is required' });
        }

        const options = await yahooFinanceService.getOptions(symbol, exchange);
        
        res.json({ success: true, data: options });
    } catch (error) {
        LOG.error('[Trading Routes] Error fetching options:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch options' });
    }
});

/**
 * GET /api/trading/top-gainers
 * Get top gainers from local DB
 * Query params: limit (default: 10)
 */
router.get('/top-gainers', async (req, res) => {
    const routeStartTime = Date.now();
    try {
        const limit = parseInt(req.query.limit) || 10;
        
        LOG.info('[Trading Routes] ========================================');
        LOG.info(`[Trading Routes] GET /api/trading/top-gainers?limit=${limit}`);
        LOG.info(`[Trading Routes] Data Source: ${config.dataSources.useYahooFinance ? 'Yahoo Finance API' : 'MySQL/Excel File'}`);
        
        let gainers = [];
        
        if (config.dataSources.useYahooFinance) {
            // Use Yahoo Finance API
            LOG.info('[Trading Routes] Using Yahoo Finance API');
            gainers = tradingDataService.getTopGainers(limit);
            
            if (!gainers || gainers.length === 0) {
                LOG.info('[Trading Routes] No local data, fetching from Yahoo Finance API...');
                gainers = await tradingDataService.refreshTopGainers(limit);
            }
        } else {
            // Use MySQL database (populated from Excel file)
            LOG.info('[Trading Routes] Using MySQL/Excel database');
            
            // Check if MySQL is available
            const isMySQLAvailable = stockDataService.isMySQLAvailable();
            LOG.info(`[Trading Routes] MySQL available: ${isMySQLAvailable}`);
            
            // Check database record count before fetching
            let totalStocks = 0;
            try {
                const allStocks = await stockDataService.getAllStocks();
                totalStocks = allStocks.length;
                LOG.info(`[Trading Routes] Total stocks in database: ${totalStocks}`);
            } catch (err) {
                LOG.warning(`[Trading Routes] Could not count total stocks: ${err.message}`);
            }
            
            gainers = await stockDataService.getTopGainers(limit);
            
            LOG.info(`[Trading Routes] getTopGainers returned: ${gainers?.length || 0} records`);
            if (gainers && gainers.length > 0) {
                LOG.info(`[Trading Routes] Sample gainer:`, {
                    symbol: gainers[0].symbol,
                    name: gainers[0].name,
                    price: gainers[0].price,
                    changePercent: gainers[0].changePercent
                });
            }
            
            if (!gainers || gainers.length === 0) {
                LOG.warning('[Trading Routes] No gainers found in database');
                LOG.warning('[Trading Routes] Possible reasons:');
                LOG.warning('[Trading Routes]   1. Excel file sync has not run yet');
                LOG.warning('[Trading Routes]   2. Excel file is empty or has no data');
                LOG.warning('[Trading Routes]   3. No stocks with positive percent_change');
                LOG.warning('[Trading Routes]   4. Database connection issue');
                LOG.warning(`[Trading Routes]   5. Total stocks in DB: ${totalStocks}`);
                LOG.warning('[Trading Routes] Check Excel sync job status at /api/trading/sync-status');
                LOG.warning('[Trading Routes] Run diagnostics at /api/trading/diagnostics');
            } else {
                LOG.info(`[Trading Routes] Found ${gainers.length} gainers in database`);
            }
        }
        
        const routeDuration = Date.now() - routeStartTime;
        LOG.info(`[Trading Routes] Response: ${gainers?.length || 0} gainers, duration: ${routeDuration}ms`);
        LOG.info('[Trading Routes] ========================================');
        
        // Always return success with data array (even if empty)
        res.json({ success: true, data: gainers || [] });
    } catch (error) {
        const routeDuration = Date.now() - routeStartTime;
        LOG.error('[Trading Routes] ========================================');
        LOG.error('[Trading Routes] ERROR: Failed to fetch top gainers');
        LOG.error('[Trading Routes] ERROR Duration: ' + routeDuration + 'ms');
        LOG.error('[Trading Routes] ERROR Type: ' + error.constructor.name);
        LOG.error('[Trading Routes] ERROR Message: ' + (error.message || 'No message'));
        LOG.error('[Trading Routes] ERROR Stack: ' + (error.stack ? error.stack.split('\n').slice(0, 5).join('\n') : 'No stack'));
        LOG.error('[Trading Routes] ========================================');
        // Return empty array instead of error to prevent frontend crashes
        res.json({ success: true, data: [] });
    }
});

/**
 * GET /api/trading/top-losers
 * Get top losers from local DB
 * Query params: limit (default: 10)
 */
router.get('/top-losers', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        LOG.info(`[Trading Routes] GET /api/trading/top-losers?limit=${limit}`);
        LOG.info(`[Trading Routes] Data Source: ${config.dataSources.useYahooFinance ? 'Yahoo Finance API' : 'MySQL/Excel File'}`);
        
        let losers = [];
        
        if (config.dataSources.useYahooFinance) {
            // Use Yahoo Finance API
            losers = tradingDataService.getTopLosers(limit);
            if (!losers || losers.length === 0) {
                LOG.info('[Trading Routes] No local data, fetching from Yahoo Finance API...');
                losers = await tradingDataService.refreshTopLosers(limit);
            }
        } else {
            // Use MySQL database (populated from Excel file)
            LOG.info('[Trading Routes] Using MySQL/Excel database');
            losers = await stockDataService.getTopLosers(limit);
            
            if (!losers || losers.length === 0) {
                LOG.warning('[Trading Routes] No losers found in database');
                LOG.warning('[Trading Routes] Check Excel sync job status at /api/trading/sync-status');
            }
        }
        
        res.json({ success: true, data: losers || [] });
    } catch (error) {
        LOG.error('[Trading Routes] Error fetching top losers:', error);
        LOG.error('[Trading Routes] Error details:', error.message);
        // Return empty array instead of error to prevent frontend crashes
        res.json({ success: true, data: [] });
    }
});

/**
 * GET /api/trading/actives
 * Get most active stocks from local DB
 * Query params: limit (default: 10)
 */
router.get('/actives', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        LOG.info(`[Trading Routes] GET /api/trading/actives?limit=${limit}`);
        LOG.info(`[Trading Routes] Data Source: ${config.dataSources.useYahooFinance ? 'Yahoo Finance API' : 'MySQL/Excel File'}`);
        
        let actives = [];
        
        if (config.dataSources.useYahooFinance) {
            // Yahoo Finance doesn't have actives endpoint, use database
            LOG.info('[Trading Routes] Using MySQL/Excel database for actives');
            actives = await stockDataService.getActives(limit);
        } else {
            // Use MySQL database (populated from Excel file)
            LOG.info('[Trading Routes] Using MySQL/Excel database');
            actives = await stockDataService.getActives(limit);
            
            if (!actives || actives.length === 0) {
                LOG.warning('[Trading Routes] No actives found in database');
                LOG.warning('[Trading Routes] Check Excel sync job status at /api/trading/sync-status');
            }
        }
        
        res.json({ success: true, data: actives || [] });
    } catch (error) {
        LOG.error('[Trading Routes] Error fetching actives:', error);
        LOG.error('[Trading Routes] Error details:', error.message);
        // Return empty array instead of error to prevent frontend crashes
        res.json({ success: true, data: [] });
    }
});

/**
 * GET /api/trading/data
 * Get all stock data from local DB
 * Query params: limit (default: 100)
 */
router.get('/data', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        LOG.info(`[Trading Routes] GET /api/trading/data?limit=${limit}`);
        LOG.info(`[Trading Routes] Data Source: ${config.dataSources.useYahooFinance ? 'Yahoo Finance API' : 'MySQL/Excel File'}`);
        
        let stocks = [];
        
        if (config.dataSources.useYahooFinance) {
            // Use Yahoo Finance API
            LOG.info('[Trading Routes] Using Yahoo Finance API');
            stocks = await stockDataService.getAllStocks();
            stocks = stocks.slice(0, limit);
        } else {
            // Use MySQL database (populated from Excel file)
            LOG.info('[Trading Routes] Using MySQL/Excel database');
            // Get all stocks regardless of type for the DATA tab
            stocks = await stockDataService.getAllStocks();
            
            LOG.info(`[Trading Routes] getAllStocks returned ${stocks?.length || 0} stocks`);
            if (stocks && stocks.length > 0) {
                LOG.info(`[Trading Routes] Sample stock data:`, {
                    symbol: stocks[0].symbol,
                    name: stocks[0].name,
                    price: stocks[0].price,
                    change: stocks[0].change,
                    changePercent: stocks[0].changePercent,
                    hasValidData: !!(stocks[0].symbol && stocks[0].name && stocks[0].price !== undefined)
                });
            }
            
            stocks = stocks.slice(0, limit);
            
            if (!stocks || stocks.length === 0) {
                LOG.warning('[Trading Routes] No stocks found in database');
                LOG.warning('[Trading Routes] Check Excel sync job status at /api/trading/sync-status');
            } else {
                LOG.info(`[Trading Routes] Returning ${stocks.length} stocks (limited from ${stocks.length} total)`);
            }
        }
        
        res.json({ success: true, data: stocks || [] });
    } catch (error) {
        LOG.error('[Trading Routes] Error fetching data:', error);
        LOG.error('[Trading Routes] Error details:', error.message);
        // Return empty array instead of error to prevent frontend crashes
        res.json({ success: true, data: [] });
    }
});

/**
 * GET /api/trading/analytics
 * Get stock analytics with predictions based on 18 technical indicators
 * Response format: { stocks: [{ symbol, prediction, confidence }] }
 */
router.get('/analytics', async (req, res) => {
    try {
        // Force immediate log to verify new code is running
        console.log('🔍 [ANALYTICS DEBUG] New analytics endpoint code is running!');
        LOG.info('[Trading Routes] ========================================');
        LOG.info('[Trading Routes] GET /api/trading/analytics');
        LOG.info('[Trading Routes] Starting analytics fetch...');
        
        const startTime = Date.now();
        const analytics = await featureEngineeringService.getLatestIndicators();
        const duration = Date.now() - startTime;
        
        LOG.info(`[Trading Routes] getLatestIndicators completed in ${duration}ms`);
        LOG.info(`[Trading Routes] Analytics array length: ${analytics?.length || 0}`);
        
        const positiveCount = analytics.filter(a => a.prediction === true).length;
        const negativeCount = analytics.filter(a => a.prediction === false).length;
        
        LOG.info(`[Trading Routes] Analytics breakdown:`, {
            total: analytics.length,
            positive: positiveCount,
            negative: negativeCount,
            withConfidence: analytics.filter(a => a.confidence > 0).length
        });
        
        if (analytics.length === 0) {
            LOG.warning('[Trading Routes] ========================================');
            LOG.warning('[Trading Routes] ⚠️  No analytics data found!');
            LOG.warning('[Trading Routes] Possible reasons:');
            LOG.warning('[Trading Routes]   1. Feature engineering has not run yet');
            LOG.warning('[Trading Routes]   2. No historical data in stock_data_history');
            LOG.warning('[Trading Routes]   3. stock_indicators table is empty');
            LOG.warning('[Trading Routes]   4. Feature engineering failed during last run');
            LOG.warning('[Trading Routes] Solution: Trigger feature engineering manually:');
            LOG.warning('[Trading Routes]   POST /api/trading/generate-analytics');
            LOG.warning('[Trading Routes] ========================================');
        } else {
            LOG.info(`[Trading Routes] ✅ Successfully returning ${analytics.length} analytics records`);
            if (positiveCount > 0) {
                LOG.info(`[Trading Routes] ✅ ${positiveCount} stocks with positive predictions`);
            } else {
                LOG.warning(`[Trading Routes] ⚠️  No positive predictions found (${negativeCount} negative)`);
            }
        }
        
        LOG.info('[Trading Routes] ========================================');
        
        res.json({ 
            success: true, 
            stocks: analytics 
        });
    } catch (error) {
        LOG.error('[Trading Routes] ========================================');
        LOG.error('[Trading Routes] ❌ Error fetching analytics:', error);
        LOG.error('[Trading Routes] Error message:', error.message);
        LOG.error('[Trading Routes] Error stack:', error.stack);
        LOG.error('[Trading Routes] ========================================');
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to fetch analytics' 
        });
    }
});

/**
 * GET /api/trading/analytics-status
 * Check the status of analytics/indicators without generating them
 * Useful for debugging why analytics endpoint returns empty
 */
router.get('/analytics-status', async (req, res) => {
    try {
        const pool = require('../database').getPool();
        if (!pool) {
            return res.json({ 
                success: false, 
                message: 'MySQL not available',
                mysqlAvailable: false
            });
        }

        const status = {
            mysqlAvailable: true,
            tableExists: false,
            totalRecords: 0,
            uniqueSymbols: 0,
            sampleRecords: [],
            historicalDataCheck: {
                totalRecords: 0,
                uniqueSymbols: 0,
                oldestRecord: null,
                newestRecord: null
            }
        };

        // Check if stock_indicators table exists
        try {
            const [tableCheck] = await pool.query(`
                SELECT COUNT(*) as count 
                FROM information_schema.tables 
                WHERE table_schema = DATABASE() 
                AND table_name = 'stock_indicators'
            `);
            status.tableExists = tableCheck[0]?.count > 0;
        } catch (e) {
            status.tableError = e.message;
        }

        if (status.tableExists) {
            // Get count of records
            try {
                const [countResult] = await pool.query(`SELECT COUNT(*) as count FROM stock_indicators`);
                status.totalRecords = countResult[0]?.count || 0;
            } catch (e) {
                status.countError = e.message;
            }

            // Get unique symbols
            try {
                const [symbolCount] = await pool.query(`SELECT COUNT(DISTINCT symbol) as count FROM stock_indicators`);
                status.uniqueSymbols = symbolCount[0]?.count || 0;
            } catch (e) {
                status.symbolCountError = e.message;
            }

            // Get sample records
            try {
                const [samples] = await pool.query(`
                    SELECT symbol, computed_at, rsi14, macd, sma20, sma50
                    FROM stock_indicators
                    ORDER BY computed_at DESC
                    LIMIT 5
                `);
                status.sampleRecords = samples;
            } catch (e) {
                status.sampleError = e.message;
            }
        }

        // Check historical data
        try {
            const [historyCheck] = await pool.query(`
                SELECT COUNT(DISTINCT symbol) as symbol_count, 
                       COUNT(*) as total_records,
                       MIN(archived_at) as oldest_record,
                       MAX(archived_at) as newest_record
                FROM stock_data_history
            `);
            status.historicalDataCheck = {
                totalRecords: historyCheck[0]?.total_records || 0,
                uniqueSymbols: historyCheck[0]?.symbol_count || 0,
                oldestRecord: historyCheck[0]?.oldest_record,
                newestRecord: historyCheck[0]?.newest_record
            };
        } catch (e) {
            status.historicalDataError = e.message;
        }

        res.json({ success: true, status });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * POST /api/trading/generate-analytics
 * Manually trigger feature engineering to generate indicators
 * Useful for testing or if sync hasn't run yet
 */
router.post('/generate-analytics', async (req, res) => {
    try {
        LOG.info('[Trading Routes] POST /api/trading/generate-analytics - Manual trigger');
        
        const result = await featureEngineeringService.generateFeaturesForML();
        
        if (result.success) {
            LOG.success(`[Trading Routes] Feature engineering completed: ${result.success} stocks processed, ${result.failed} failed`);
            res.json({ 
                success: true, 
                message: `Feature engineering completed: ${result.success} stocks processed`,
                ...result
            });
        } else {
            res.status(500).json({ 
                success: false, 
                error: result.error || result.message || 'Feature engineering failed' 
            });
        }
    } catch (error) {
        LOG.error('[Trading Routes] Error generating analytics:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to generate analytics' 
        });
    }
});

/**
 * GET /api/trading/market-indices
 * Get market indices (NIFTY, SENSEX) from local DB
 */
router.get('/market-indices', async (req, res) => {
    try {
        LOG.info('[Trading Routes] GET /api/trading/market-indices');
        LOG.info(`[Trading Routes] Data Source: ${config.dataSources.useYahooFinance ? 'Yahoo Finance API' : 'MySQL (Google Sheets)'}`);
        
        let indices = [];
        
        if (config.dataSources.useYahooFinance) {
            // Use Yahoo Finance API
            indices = tradingDataService.getMarketIndices();
            if (!indices || indices.length === 0) {
                LOG.info('[Trading Routes] No local data, fetching from Yahoo Finance API...');
                indices = await tradingDataService.refreshMarketIndices();
            }
        } else {
            // Market indices not available from Google Sheets by default
            // Return empty array or fetch from Yahoo Finance if needed
            LOG.warning('[Trading Routes] Market indices not available from Google Sheets source');
            indices = [];
        }
        
        res.json({ success: true, data: indices });
    } catch (error) {
        LOG.error('[Trading Routes] Error fetching market indices:', error);
        LOG.error('[Trading Routes] Error details:', error.message);
        res.status(500).json({ error: error.message || 'Failed to fetch market indices' });
    }
});

/**
 * GET /api/trading/screen
 * Screen stocks with filters
 * Query params: filters (JSON string)
 */
router.get('/screen', async (req, res) => {
    try {
        const filters = req.query.filters ? JSON.parse(req.query.filters) : {};
        
        if (!config.dataSources.useYahooFinance) {
            // Screen from MySQL database
            LOG.info('[Trading Routes] Screening stocks from MySQL database');
            const allStocks = await stockDataService.getAllStocks();
            
            // Apply filters
            let filtered = allStocks;
            
            if (filters.sortField === 'changePercent') {
                filtered = filtered.sort((a, b) => {
                    return filters.sortType === 'DESC' 
                        ? b.changePercent - a.changePercent 
                        : a.changePercent - b.changePercent;
                });
            }
            
            const count = filters.count || 10;
            const results = filtered.slice(0, count);
            
            return res.json({ success: true, data: results });
        }
        
        const results = await yahooFinanceService.screenStocks(filters);
        
        res.json({ success: true, data: results });
    } catch (error) {
        LOG.error('[Trading Routes] Error screening stocks:', error);
        res.status(500).json({ error: error.message || 'Failed to screen stocks' });
    }
});

/**
 * POST /api/trading/refresh
 * Manually trigger data refresh (admin only)
 */
/**
 * GET /api/trading/sync-status
 * Get Excel file sync job status
 */
router.get('/sync-status', async (req, res) => {
    try {
        if (config.dataSources.useYahooFinance) {
            return res.json({ 
                success: true, 
                message: 'Yahoo Finance is enabled - Excel sync is not active',
                dataSource: 'yahoo_finance'
            });
        }
        
        const syncJob = global.excelFileSyncJob;
        if (!syncJob) {
            return res.status(503).json({ 
                success: false,
                error: 'Excel file sync job not initialized',
                message: 'The Excel sync job has not been started. Check server logs for initialization errors.'
            });
        }
        
        const status = syncJob.getStatus();
        res.json({ 
            success: true, 
            data: status
        });
    } catch (error) {
        LOG.error('[Trading Routes] Error getting sync status:', error);
        res.status(500).json({ error: error.message || 'Failed to get sync status' });
    }
});

router.post('/refresh', async (req, res) => {
    try {
        LOG.info('[Trading Routes] ========================================');
        LOG.info('[Trading Routes] POST /api/trading/refresh - Full refresh triggered');
        LOG.info('[Trading Routes] ========================================');
        
        const refreshStartTime = Date.now();
        const results = {
            excelSync: { success: false, message: '' },
            analytics: { success: false, message: '' },
            mutualFunds: { success: false, message: '' },
            corporateActions: { success: false, message: '' },
            boardMeetings: { success: false, message: '' }
        };
        
        if (config.dataSources.useYahooFinance) {
            LOG.info('[Trading Routes] Manual Yahoo Finance refresh triggered');
            await tradingDataService.refreshAll();
            
            // Generate analytics after refresh
            try {
                LOG.info('[Trading Routes] Generating analytics after Yahoo Finance refresh...');
                const analyticsResult = await featureEngineeringService.generateFeaturesForML();
                results.analytics = {
                    success: analyticsResult.success,
                    message: `Analytics: ${analyticsResult.success} stocks processed`,
                    ...analyticsResult
                };
            } catch (analyticsError) {
                LOG.error('[Trading Routes] Error generating analytics:', analyticsError);
                results.analytics = { success: false, message: analyticsError.message };
            }
            
            res.json({ 
                success: true, 
                message: 'Yahoo Finance data refresh completed',
                lastRefreshTime: tradingDataService.lastRefreshTime,
                results: results,
                duration: Date.now() - refreshStartTime
            });
        } else {
            LOG.info('[Trading Routes] Manual Excel file sync triggered');
            const syncJob = global.excelFileSyncJob;
            if (!syncJob) {
                return res.status(503).json({ error: 'Excel file sync job not initialized' });
            }
            
            // Step 1: Excel Sync
            try {
                LOG.info('[Trading Routes] Step 1: Syncing Excel file to database...');
                const beforeCount = await stockDataService.getAllStocks();
                LOG.info(`[Trading Routes] Records before sync: ${beforeCount.length}`);
                
                await syncJob.sync();
                
                const afterCount = await stockDataService.getAllStocks();
                LOG.info(`[Trading Routes] Records after sync: ${afterCount.length}`);
                
                results.excelSync = {
                    success: true,
                    message: `Excel sync completed: ${afterCount.length} records`,
                    recordsBefore: beforeCount.length,
                    recordsAfter: afterCount.length,
                    lastSyncTime: syncJob.lastSyncTime,
                    status: syncJob.lastSyncStatus
                };
            } catch (syncError) {
                LOG.error('[Trading Routes] Error in Excel sync:', syncError);
                results.excelSync = { success: false, message: syncError.message };
            }
            
            // Step 2: Generate Analytics
            try {
                LOG.info('[Trading Routes] Step 2: Generating analytics...');
                const analyticsResult = await featureEngineeringService.generateFeaturesForML();
                results.analytics = {
                    success: analyticsResult.success,
                    message: `Analytics: ${analyticsResult.success} stocks processed, ${analyticsResult.failed} failed`,
                    ...analyticsResult
                };
            } catch (analyticsError) {
                LOG.error('[Trading Routes] Error generating analytics:', analyticsError);
                results.analytics = { success: false, message: analyticsError.message };
            }
            
            // Step 3: Sync Mutual Funds (if available)
            try {
                const mfSyncJob = global.mutualFundSyncJob;
                if (mfSyncJob) {
                    LOG.info('[Trading Routes] Step 3: Syncing Mutual Funds...');
                    await mfSyncJob.sync();
                    results.mutualFunds = { success: true, message: 'Mutual funds sync completed' };
                }
            } catch (mfError) {
                LOG.error('[Trading Routes] Error syncing mutual funds:', mfError);
                results.mutualFunds = { success: false, message: mfError.message };
            }
            
            // Step 4: Sync Corporate Actions (if available)
            try {
                const caSyncJob = global.corporateActionsSyncJob;
                if (caSyncJob) {
                    LOG.info('[Trading Routes] Step 4: Syncing Corporate Actions...');
                    await caSyncJob.sync();
                    results.corporateActions = { success: true, message: 'Corporate actions sync completed' };
                }
            } catch (caError) {
                LOG.error('[Trading Routes] Error syncing corporate actions:', caError);
                results.corporateActions = { success: false, message: caError.message };
            }
            
            // Step 5: Sync Board Meetings (if available)
            try {
                const bmSyncJob = global.boardMeetingsSyncJob;
                if (bmSyncJob) {
                    LOG.info('[Trading Routes] Step 5: Syncing Board Meetings...');
                    await bmSyncJob.sync();
                    results.boardMeetings = { success: true, message: 'Board meetings sync completed' };
                }
            } catch (bmError) {
                LOG.error('[Trading Routes] Error syncing board meetings:', bmError);
                results.boardMeetings = { success: false, message: bmError.message };
            }
            
            const totalDuration = Date.now() - refreshStartTime;
            LOG.info(`[Trading Routes] Full refresh completed in ${totalDuration}ms`);
            LOG.info('[Trading Routes] ========================================');
            
            res.json({ 
                success: true, 
                message: 'Full refresh completed',
                results: results,
                duration: totalDuration
            });
        }
    } catch (error) {
        LOG.error('[Trading Routes] Error in manual refresh:', error);
        res.status(500).json({ 
            success: false,
            error: error.message || 'Failed to refresh data',
            results: results
        });
    }
});

/**
 * GET /api/trading/market-high
 * Get market high stocks (highest price)
 * Query params: limit (default: 10)
 */
router.get('/market-high', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        
        // Get popular stocks and sort by price
        const popularSymbols = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'BHARTIARTL', 'SBIN', 'BAJFINANCE', 'WIPRO', 'LT', 'HINDUNILVR', 'AXISBANK', 'MARUTI', 'TITAN', 'NESTLEIND'];
        const quotes = await tradingDataService.refreshStockQuotes(popularSymbols.slice(0, limit * 2), 'NSE');
        
        // Sort by price (highest first) and return top N
        const marketHigh = quotes
            .sort((a, b) => b.price - a.price)
            .slice(0, limit)
            .map(stock => ({
                symbol: stock.symbol,
                name: stock.name,
                price: stock.price,
                change: stock.change,
                changePercent: stock.changePercent,
                volume: stock.volume
            }));
        
        res.json({ success: true, data: marketHigh });
    } catch (error) {
        LOG.error('[Trading Routes] Error fetching market high:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch market high' });
    }
});

/**
 * GET /api/trading/most-bought
 * Get most bought stocks (highest volume)
 * Query params: limit (default: 10)
 */
router.get('/most-bought', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        
        // Get popular stocks and sort by volume
        const popularSymbols = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'BHARTIARTL', 'SBIN', 'BAJFINANCE', 'WIPRO', 'LT', 'HINDUNILVR', 'AXISBANK', 'MARUTI', 'TITAN', 'NESTLEIND'];
        const quotes = await tradingDataService.refreshStockQuotes(popularSymbols.slice(0, limit * 2), 'NSE');
        
        // Sort by volume (highest first) and return top N
        const mostBought = quotes
            .sort((a, b) => b.volume - a.volume)
            .slice(0, limit)
            .map(stock => ({
                symbol: stock.symbol,
                name: stock.name,
                price: stock.price,
                change: stock.change,
                changePercent: stock.changePercent,
                volume: stock.volume
            }));
        
        res.json({ success: true, data: mostBought });
    } catch (error) {
        LOG.error('[Trading Routes] Error fetching most bought:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch most bought' });
    }
});

/**
 * GET /api/trading/news
 * Get stock news (mock for now, can integrate with news API later)
 * Query params: limit (default: 10)
 */
router.get('/news', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        
        // For now, return empty array (can integrate with news API later)
        // This prevents showing wrong/mock data
        res.json({ success: true, data: [] });
    } catch (error) {
        LOG.error('[Trading Routes] Error fetching news:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch news' });
    }
});

/**
 * GET /api/trading/refresh-status
 * Get refresh status and configuration
 */
router.get('/refresh-status', async (req, res) => {
    try {
        const status = {
            dataSource: config.dataSources.useYahooFinance ? 'Yahoo Finance API' : 'MySQL (Google Sheets)',
            useYahooFinance: config.dataSources.useYahooFinance,
        };

        if (config.dataSources.useYahooFinance) {
            // Yahoo Finance status
            const refreshInterval = tradingDataService.getRefreshInterval ? tradingDataService.getRefreshInterval() / 60000 : 10;
            status.refreshIntervalMinutes = refreshInterval;
            status.lastRefreshTime = tradingDataService.lastRefreshTime;
            status.isRefreshing = tradingDataService.isRefreshing;
            status.hasData = {
                marketIndices: tradingDataService.getMarketIndices().length > 0,
                topGainers: tradingDataService.getTopGainers().length > 0,
                topLosers: tradingDataService.getTopLosers().length > 0
            };
        } else {
            // Excel File sync status
            const syncJob = global.excelFileSyncJob;
            if (syncJob) {
                const syncStatus = syncJob.getStatus();
                status.syncStatus = syncStatus;
                status.syncCronExpression = config.schedule.cronExpression;
            }
            
            // Check MySQL data
            const allStocks = await stockDataService.getAllStocks();
            status.hasData = {
                totalStocks: allStocks.length,
                topGainers: (await stockDataService.getTopGainers(10)).length,
                topLosers: (await stockDataService.getTopLosers(10)).length
            };
        }
        
        res.json({ success: true, data: status });
    } catch (error) {
        LOG.error('[Trading Routes] Error getting refresh status:', error);
        res.status(500).json({ error: error.message || 'Failed to get refresh status' });
    }
});

/**
 * GET /api/trading/watchlist
 * Get user's watchlist with current quotes
 * Query params: userId (required)
 */
router.get('/watchlist', async (req, res) => {
    try {
        const { userId } = req.query;
        
        if (!userId) {
            return res.status(400).json({ error: 'userId parameter is required' });
        }

        LOG.info(`[Trading Routes] GET /api/trading/watchlist?userId=${userId}`);
        
        // Get watchlist from in-memory DB or MySQL
        const db = require('../database');
        const inMemoryDb = db.inMemoryDb || {};
        if (!inMemoryDb.tradingWatchlists) {
            inMemoryDb.tradingWatchlists = {};
        }
        
        // Get user's watchlist
        const userWatchlist = inMemoryDb.tradingWatchlists[userId] || [];
        
        // If watchlist has symbols, fetch their current quotes
        if (userWatchlist.length > 0) {
            const symbols = userWatchlist.map(w => w.symbol || w).filter(Boolean);
            if (symbols.length > 0) {
                try {
                    const quotes = await tradingDataService.refreshStockQuotes(symbols, 'NSE');
                    LOG.info(`[Trading Routes] Fetched ${quotes.length} quotes for watchlist`);
                    return res.json({ success: true, data: quotes });
                } catch (error) {
                    LOG.error('[Trading Routes] Error fetching watchlist quotes:', error.message);
                    // Return watchlist symbols even if quotes fail
                    return res.json({ success: true, data: userWatchlist });
                }
            }
        }
        
        res.json({ success: true, data: userWatchlist });
    } catch (error) {
        LOG.error('[Trading Routes] Error fetching watchlist:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch watchlist' });
    }
});

/**
 * POST /api/trading/watchlist
 * Add symbol to user's watchlist
 * Body: { userId, symbol }
 */
router.post('/watchlist', async (req, res) => {
    try {
        const { userId, symbol } = req.body;
        
        if (!userId || !symbol) {
            return res.status(400).json({ error: 'userId and symbol are required' });
        }

        LOG.info(`[Trading Routes] POST /api/trading/watchlist - Adding ${symbol} for user ${userId}`);
        
        const db = require('../database');
        const inMemoryDb = db.inMemoryDb || {};
        if (!inMemoryDb.tradingWatchlists) {
            inMemoryDb.tradingWatchlists = {};
        }
        
        if (!inMemoryDb.tradingWatchlists[userId]) {
            inMemoryDb.tradingWatchlists[userId] = [];
        }
        
        // Check if already in watchlist
        const exists = inMemoryDb.tradingWatchlists[userId].some(
            w => (w.symbol || w) === symbol
        );
        
        if (!exists) {
            inMemoryDb.tradingWatchlists[userId].push({ symbol, addedAt: new Date().toISOString() });
            LOG.success(`[Trading Routes] Added ${symbol} to watchlist for user ${userId}`);
        }
        
        res.json({ success: true, data: inMemoryDb.tradingWatchlists[userId] });
    } catch (error) {
        LOG.error('[Trading Routes] Error adding to watchlist:', error);
        res.status(500).json({ error: error.message || 'Failed to add to watchlist' });
    }
});

/**
 * DELETE /api/trading/watchlist
 * Remove symbol from user's watchlist
 * Query params: userId, symbol
 */
router.delete('/watchlist', async (req, res) => {
    try {
        const { userId, symbol } = req.query;
        
        if (!userId || !symbol) {
            return res.status(400).json({ error: 'userId and symbol are required' });
        }

        LOG.info(`[Trading Routes] DELETE /api/trading/watchlist - Removing ${symbol} for user ${userId}`);
        
        const db = require('../database');
        const inMemoryDb = db.inMemoryDb || {};
        if (!inMemoryDb.tradingWatchlists) {
            inMemoryDb.tradingWatchlists = {};
        }
        
        if (inMemoryDb.tradingWatchlists[userId]) {
            inMemoryDb.tradingWatchlists[userId] = inMemoryDb.tradingWatchlists[userId].filter(
                w => (w.symbol || w) !== symbol
            );
            LOG.success(`[Trading Routes] Removed ${symbol} from watchlist for user ${userId}`);
        }
        
        res.json({ success: true, data: inMemoryDb.tradingWatchlists[userId] || [] });
    } catch (error) {
        LOG.error('[Trading Routes] Error removing from watchlist:', error);
        res.status(500).json({ error: error.message || 'Failed to remove from watchlist' });
    }
});

/**
 * GET /api/trading/portfolio
 * Get user's portfolio (holdings, positions, P&L)
 * Query params: userId (required)
 */
router.get('/portfolio', async (req, res) => {
    try {
        const { userId } = req.query;
        
        if (!userId) {
            return res.status(400).json({ error: 'userId parameter is required' });
        }

        LOG.info(`[Trading Routes] GET /api/trading/portfolio?userId=${userId}`);
        
        // Get portfolio from in-memory DB
        const db = require('../database');
        const inMemoryDb = db.inMemoryDb || {};
        if (!inMemoryDb.tradingPortfolios) {
            inMemoryDb.tradingPortfolios = {};
        }
        
        // Get user's portfolio
        let portfolio = inMemoryDb.tradingPortfolios[userId] || {
            holdings: [],
            positions: [],
            overallReturns: {
                amount: 0,
                percent: 0
            },
            currentValue: 0,
            totalInvestment: 0
        };
        
        // Ensure overallReturns has correct structure
        if (!portfolio.overallReturns) {
            portfolio.overallReturns = { amount: 0, percent: 0 };
        }
        if (typeof portfolio.overallReturns.amount === 'undefined') {
            portfolio.overallReturns.amount = portfolio.overallReturns.totalReturns || 0;
        }
        if (typeof portfolio.overallReturns.percent === 'undefined') {
            portfolio.overallReturns.percent = portfolio.overallReturns.totalReturnsPercent || 0;
        }
        if (typeof portfolio.currentValue === 'undefined') {
            portfolio.currentValue = portfolio.overallReturns.currentValue || 0;
        }
        if (typeof portfolio.totalInvestment === 'undefined') {
            portfolio.totalInvestment = portfolio.overallReturns.totalInvestment || 0;
        }
        
        // If portfolio has holdings, fetch their current quotes
        if (portfolio.holdings && portfolio.holdings.length > 0) {
            const symbols = portfolio.holdings.map(h => h.symbol).filter(Boolean);
            if (symbols.length > 0) {
                try {
                    const quotes = await tradingDataService.refreshStockQuotes(symbols, 'NSE');
                    // Update holdings with current prices
                    portfolio.holdings = portfolio.holdings.map(holding => {
                        const quote = quotes.find(q => q.symbol === holding.symbol);
                        if (quote) {
                            const currentValue = holding.quantity * quote.price;
                            const pnl = currentValue - (holding.quantity * holding.avgPrice);
                            const pnlPercent = holding.avgPrice > 0 ? ((quote.price - holding.avgPrice) / holding.avgPrice) * 100 : 0;
                            return {
                                ...holding,
                                ltp: quote.price,
                                currentValue,
                                pnl,
                                pnlPercent
                            };
                        }
                        return holding;
                    });
                    
                    // Recalculate overall returns
                    portfolio.currentValue = portfolio.holdings.reduce((sum, h) => sum + (h.currentValue || 0), 0);
                    portfolio.totalInvestment = portfolio.holdings.reduce((sum, h) => sum + (h.quantity * h.avgPrice), 0);
                    const totalReturns = portfolio.currentValue - portfolio.totalInvestment;
                    const totalReturnsPercent = portfolio.totalInvestment > 0 
                        ? (totalReturns / portfolio.totalInvestment) * 100 
                        : 0;
                    
                    // Ensure overallReturns exists and has correct structure
                    if (!portfolio.overallReturns) {
                        portfolio.overallReturns = { amount: 0, percent: 0 };
                    }
                    portfolio.overallReturns.amount = totalReturns;
                    portfolio.overallReturns.percent = totalReturnsPercent;
                } catch (error) {
                    LOG.error('[Trading Routes] Error fetching portfolio quotes:', error.message);
                }
            }
        }
        
        res.json({ success: true, data: portfolio });
    } catch (error) {
        LOG.error('[Trading Routes] Error fetching portfolio:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch portfolio' });
    }
});

/**
 * GET /api/trading/orders
 * Get user's orders (today, past, all)
 * Query params: userId (required), type (today/past/all, default: all)
 */
router.get('/orders', async (req, res) => {
    try {
        const { userId, type = 'all' } = req.query;
        
        if (!userId) {
            return res.status(400).json({ error: 'userId parameter is required' });
        }

        LOG.info(`[Trading Routes] GET /api/trading/orders?userId=${userId}&type=${type}`);
        
        // Get orders from in-memory DB
        const db = require('../database');
        const inMemoryDb = db.inMemoryDb || {};
        if (!inMemoryDb.tradingOrders) {
            inMemoryDb.tradingOrders = {};
        }
        
        // Get user's orders
        let orders = inMemoryDb.tradingOrders[userId] || [];
        
        // Filter by type
        const today = new Date().toISOString().split('T')[0];
        if (type === 'today') {
            orders = orders.filter(order => {
                const orderDate = new Date(order.createdAt || order.timestamp).toISOString().split('T')[0];
                return orderDate === today;
            });
        } else if (type === 'past') {
            orders = orders.filter(order => {
                const orderDate = new Date(order.createdAt || order.timestamp).toISOString().split('T')[0];
                return orderDate < today;
            });
        }
        
        // Sort by most recent first
        orders.sort((a, b) => {
            const dateA = new Date(a.createdAt || a.timestamp || 0);
            const dateB = new Date(b.createdAt || b.timestamp || 0);
            return dateB - dateA;
        });
        
        res.json({ success: true, data: orders });
    } catch (error) {
        LOG.error('[Trading Routes] Error fetching orders:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch orders' });
    }
});

/**
 * POST /api/trading/orders
 * Place a new order (buy/sell)
 * Body: { userId, symbol, quantity, type (LIMIT/MARKET), price (for LIMIT), side (BUY/SELL), apiProvider, validity }
 */
router.post('/orders', async (req, res) => {
    try {
        const { userId, symbol, quantity, type, price, side = 'BUY', apiProvider = 'Zerodha', validity = 'Day' } = req.body;
        
        // Validation
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }
        if (!symbol || !symbol.trim()) {
            return res.status(400).json({ error: 'symbol is required' });
        }
        if (!quantity || quantity <= 0) {
            return res.status(400).json({ error: 'Valid quantity is required' });
        }
        if (!type || !['LIMIT', 'MARKET'].includes(type.toUpperCase())) {
            return res.status(400).json({ error: 'Order type must be LIMIT or MARKET' });
        }
        if (type.toUpperCase() === 'LIMIT' && (!price || price <= 0)) {
            return res.status(400).json({ error: 'Price is required for LIMIT orders' });
        }
        if (!side || !['BUY', 'SELL'].includes(side.toUpperCase())) {
            return res.status(400).json({ error: 'Side must be BUY or SELL' });
        }

        LOG.info(`[Trading Routes] POST /api/trading/orders: userId=${userId}, symbol=${symbol}, side=${side}, quantity=${quantity}, type=${type}, price=${price || 'MARKET'}`);
        
        const db = require('../database');
        const pool = db.getPool();
        const orderId = `${apiProvider.substring(0, 2).toUpperCase()}${Date.now().toString().substring(6)}`;
        const now = new Date();
        
        // Calculate order value
        const orderPrice = type.toUpperCase() === 'MARKET' ? (price || 0) : parseFloat(price);
        const orderValue = orderPrice * quantity;
        
        // Get current wallet balance
        let currentBalance = 0;
        if (pool) {
            try {
                const [balanceRows] = await pool.query(
                    `SELECT COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 0) as availableBalance
                     FROM trading_fund_transactions 
                     WHERE user_id = ?`,
                    [userId]
                );
                currentBalance = parseFloat(balanceRows[0]?.availableBalance || 0);
            } catch (mysqlError) {
                LOG.warning('[Trading Routes] MySQL balance query failed, using in-memory:', mysqlError.message);
                const inMemoryDb = db.inMemoryDb || {};
                if (inMemoryDb.tradingFunds && inMemoryDb.tradingFunds[userId]) {
                    currentBalance = inMemoryDb.tradingFunds[userId].availableBalance || 0;
                }
            }
        } else {
            const inMemoryDb = db.inMemoryDb || {};
            if (inMemoryDb.tradingFunds && inMemoryDb.tradingFunds[userId]) {
                currentBalance = inMemoryDb.tradingFunds[userId].availableBalance || 0;
            }
        }
        
        // Check sufficient balance for BUY orders
        if (side.toUpperCase() === 'BUY' && currentBalance < orderValue) {
            return res.status(400).json({ 
                error: 'Insufficient funds', 
                availableBalance: currentBalance,
                requiredAmount: orderValue,
                shortfall: orderValue - currentBalance
            });
        }
        
        // Create order object
        const order = {
            id: orderId,
            userId,
            symbol: symbol.toUpperCase().trim(),
            quantity: parseInt(quantity),
            type: type.toUpperCase(),
            price: orderPrice,
            side: side.toUpperCase(),
            apiProvider,
            validity,
            status: 'executed', // For now, orders are executed immediately
            value: orderValue,
            createdAt: now.toISOString(),
            timestamp: now.toLocaleString('en-IN')
        };
        
        // Store order
        if (pool) {
            try {
                // Store in MySQL if table exists
                await pool.query(
                    `INSERT INTO trading_orders 
                     (order_id, user_id, symbol, quantity, order_type, price, side, api_provider, validity, status, order_value, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                    [orderId, userId, order.symbol, order.quantity, order.type, order.price, order.side, apiProvider, validity, order.status, orderValue]
                );
                LOG.success(`[Trading Routes] Order stored in MySQL: ${orderId}`);
            } catch (mysqlError) {
                // Table might not exist, use in-memory
                LOG.warning('[Trading Routes] MySQL order insert failed, using in-memory:', mysqlError.message);
                const inMemoryDb = db.inMemoryDb || {};
                if (!inMemoryDb.tradingOrders) {
                    inMemoryDb.tradingOrders = {};
                }
                if (!inMemoryDb.tradingOrders[userId]) {
                    inMemoryDb.tradingOrders[userId] = [];
                }
                inMemoryDb.tradingOrders[userId].unshift(order);
            }
        } else {
            // Use in-memory DB
            const inMemoryDb = db.inMemoryDb || {};
            if (!inMemoryDb.tradingOrders) {
                inMemoryDb.tradingOrders = {};
            }
            if (!inMemoryDb.tradingOrders[userId]) {
                inMemoryDb.tradingOrders[userId] = [];
            }
            inMemoryDb.tradingOrders[userId].unshift(order);
        }
        
        // Update wallet balance
        const transactionAmount = side.toUpperCase() === 'BUY' ? -orderValue : orderValue;
        const transactionType = side.toUpperCase() === 'BUY' ? 'debit' : 'credit';
        const transactionDescription = side.toUpperCase() === 'BUY' 
            ? `Bought ${quantity} ${order.symbol} @ ₹${orderPrice.toFixed(2)}`
            : `Sold ${quantity} ${order.symbol} @ ₹${orderPrice.toFixed(2)}`;
        
        const transaction = {
            id: Date.now(),
            type: transactionType,
            amount: Math.abs(orderValue),
            method: 'TRADING',
            description: transactionDescription,
            status: 'completed',
            timestamp: now.toLocaleString('en-IN')
        };
        
        if (pool) {
            try {
                await pool.query(
                    `INSERT INTO trading_fund_transactions 
                     (user_id, type, amount, payment_method, description, status, created_at)
                     VALUES (?, ?, ?, 'TRADING', ?, 'completed', NOW())`,
                    [userId, transactionType, Math.abs(orderValue), transactionDescription]
                );
                LOG.success(`[Trading Routes] Transaction recorded in MySQL: ${transactionType} ₹${Math.abs(orderValue)}`);
            } catch (mysqlError) {
                LOG.warning('[Trading Routes] MySQL transaction insert failed, using in-memory:', mysqlError.message);
                const inMemoryDb = db.inMemoryDb || {};
                if (!inMemoryDb.tradingFunds) {
                    inMemoryDb.tradingFunds = {};
                }
                if (!inMemoryDb.tradingFunds[userId]) {
                    inMemoryDb.tradingFunds[userId] = {
                        availableBalance: 0,
                        investedAmount: 0,
                        totalDeposits: 0,
                        totalWithdrawals: 0,
                        transactions: []
                    };
                }
                inMemoryDb.tradingFunds[userId].availableBalance += transactionAmount;
                if (transactionType === 'credit') {
                    inMemoryDb.tradingFunds[userId].totalDeposits += Math.abs(orderValue);
                } else {
                    inMemoryDb.tradingFunds[userId].totalWithdrawals += Math.abs(orderValue);
                }
                inMemoryDb.tradingFunds[userId].transactions.unshift(transaction);
            }
        } else {
            const inMemoryDb = db.inMemoryDb || {};
            if (!inMemoryDb.tradingFunds) {
                inMemoryDb.tradingFunds = {};
            }
            if (!inMemoryDb.tradingFunds[userId]) {
                inMemoryDb.tradingFunds[userId] = {
                    availableBalance: 0,
                    investedAmount: 0,
                    totalDeposits: 0,
                    totalWithdrawals: 0,
                    transactions: []
                };
            }
            inMemoryDb.tradingFunds[userId].availableBalance += transactionAmount;
            if (transactionType === 'credit') {
                inMemoryDb.tradingFunds[userId].totalDeposits += Math.abs(orderValue);
            } else {
                inMemoryDb.tradingFunds[userId].totalWithdrawals += Math.abs(orderValue);
            }
            inMemoryDb.tradingFunds[userId].transactions.unshift(transaction);
        }
        
        res.json({ 
            success: true, 
            orderId,
            order,
            newBalance: currentBalance + transactionAmount
        });
    } catch (error) {
        LOG.error('[Trading Routes] Error placing order:', error);
        res.status(500).json({ error: error.message || 'Failed to place order' });
    }
});

/**
 * GET /api/trading/funds
 * Get user's funds (balance, transactions)
 * Query params: userId (required)
 */
router.get('/funds', async (req, res) => {
    try {
        const { userId } = req.query;
        
        if (!userId) {
            return res.status(400).json({ error: 'userId parameter is required' });
        }

        LOG.info(`[Trading Routes] GET /api/trading/funds?userId=${userId}`);
        
        const db = require('../database');
        const pool = db.getPool();
        
        let funds = {
            availableBalance: 0,
            investedAmount: 0,
            totalDeposits: 0,
            totalWithdrawals: 0,
            transactions: []
        };
        
        // Try MySQL first
        if (pool) {
            try {
                // Get balance and transactions from MySQL
                const [balanceRows] = await pool.query(
                    `SELECT 
                        COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) as totalDeposits,
                        COALESCE(SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END), 0) as totalWithdrawals,
                        COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 0) as availableBalance
                     FROM trading_fund_transactions 
                     WHERE user_id = ?`,
                    [userId]
                );
                
                if (balanceRows && balanceRows.length > 0) {
                    funds.totalDeposits = parseFloat(balanceRows[0].totalDeposits || 0);
                    funds.totalWithdrawals = parseFloat(balanceRows[0].totalWithdrawals || 0);
                    funds.availableBalance = parseFloat(balanceRows[0].availableBalance || 0);
                }
                
                // Get transactions
                const [transactionRows] = await pool.query(
                    `SELECT * FROM trading_fund_transactions 
                     WHERE user_id = ? 
                     ORDER BY created_at DESC 
                     LIMIT 50`,
                    [userId]
                );
                
                funds.transactions = (transactionRows || []).map(row => ({
                    id: row.id,
                    type: row.type,
                    amount: parseFloat(row.amount || 0),
                    method: row.payment_method || 'UPI',
                    description: row.description || '',
                    status: row.status || 'completed',
                    timestamp: row.created_at ? new Date(row.created_at).toLocaleString('en-IN') : 'Recently'
                }));
                
                LOG.info(`[Trading Routes] Loaded funds from MySQL: Balance=${funds.availableBalance}, Transactions=${funds.transactions.length}`);
            } catch (mysqlError) {
                LOG.warning('[Trading Routes] MySQL query failed, using in-memory:', mysqlError.message);
                // Fallback to in-memory
                const inMemoryDb = db.inMemoryDb || {};
                if (!inMemoryDb.tradingFunds) {
                    inMemoryDb.tradingFunds = {};
                }
                funds = inMemoryDb.tradingFunds[userId] || funds;
            }
        } else {
            // Use in-memory DB
            const inMemoryDb = db.inMemoryDb || {};
            if (!inMemoryDb.tradingFunds) {
                inMemoryDb.tradingFunds = {};
            }
            funds = inMemoryDb.tradingFunds[userId] || funds;
        }
        
        res.json({ success: true, data: funds });
    } catch (error) {
        LOG.error('[Trading Routes] Error fetching funds:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch funds' });
    }
});

/**
 * POST /api/trading/funds/add
 * Add funds to user's wallet
 * Body: { userId, amount, paymentMethod (optional) }
 */
router.post('/funds/add', async (req, res) => {
    try {
        const { userId, amount, paymentMethod = 'UPI' } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Valid amount is required' });
        }

        LOG.info(`[Trading Routes] POST /api/trading/funds/add: userId=${userId}, amount=${amount}`);
        
        const db = require('../database');
        const pool = db.getPool();
        const transactionId = Date.now();
        const now = new Date();
        
        const transaction = {
            id: transactionId,
            type: 'credit',
            amount: parseFloat(amount),
            method: paymentMethod,
            description: `Added ₹${parseFloat(amount).toLocaleString('en-IN')} via ${paymentMethod}`,
            status: 'completed',
            timestamp: now.toLocaleString('en-IN')
        };
        
        // Try MySQL first
        if (pool) {
            try {
                await pool.query(
                    `INSERT INTO trading_fund_transactions 
                     (user_id, type, amount, payment_method, description, status, created_at)
                     VALUES (?, 'credit', ?, ?, ?, 'completed', NOW())`,
                    [userId, amount, paymentMethod, transaction.description]
                );
                LOG.success(`[Trading Routes] Added funds to MySQL: userId=${userId}, amount=${amount}`);
            } catch (mysqlError) {
                LOG.warning('[Trading Routes] MySQL insert failed, using in-memory:', mysqlError.message);
                // Fallback to in-memory
                const inMemoryDb = db.inMemoryDb || {};
                if (!inMemoryDb.tradingFunds) {
                    inMemoryDb.tradingFunds = {};
                }
                if (!inMemoryDb.tradingFunds[userId]) {
                    inMemoryDb.tradingFunds[userId] = {
                        availableBalance: 0,
                        investedAmount: 0,
                        totalDeposits: 0,
                        totalWithdrawals: 0,
                        transactions: []
                    };
                }
                inMemoryDb.tradingFunds[userId].availableBalance += amount;
                inMemoryDb.tradingFunds[userId].totalDeposits += amount;
                inMemoryDb.tradingFunds[userId].transactions.unshift(transaction);
            }
        } else {
            // Use in-memory DB
            const inMemoryDb = db.inMemoryDb || {};
            if (!inMemoryDb.tradingFunds) {
                inMemoryDb.tradingFunds = {};
            }
            if (!inMemoryDb.tradingFunds[userId]) {
                inMemoryDb.tradingFunds[userId] = {
                    availableBalance: 0,
                    investedAmount: 0,
                    totalDeposits: 0,
                    totalWithdrawals: 0,
                    transactions: []
                };
            }
            inMemoryDb.tradingFunds[userId].availableBalance += amount;
            inMemoryDb.tradingFunds[userId].totalDeposits += amount;
            inMemoryDb.tradingFunds[userId].transactions.unshift(transaction);
        }
        
        res.json({ 
            success: true, 
            transactionId: transactionId.toString(),
            transaction: transaction
        });
    } catch (error) {
        LOG.error('[Trading Routes] Error adding funds:', error);
        res.status(500).json({ error: error.message || 'Failed to add funds' });
    }
});

/**
 * GET /api/trading/mutual-funds
 * Get all mutual funds from database
 * Query params: category, sheetName, limit (default: 100)
 */
router.get('/mutual-funds', async (req, res) => {
    try {
        const { category, sheetName, limit = 100 } = req.query;
        LOG.info(`[Trading Routes] GET /api/trading/mutual-funds?category=${category || 'all'}&sheetName=${sheetName || 'all'}&limit=${limit}`);
        
        let funds = [];
        
        if (sheetName) {
            funds = await mutualFundDataService.getFundsBySheet(sheetName, parseInt(limit));
        } else if (category) {
            funds = await mutualFundDataService.getFundsByCategory(category, parseInt(limit));
        } else {
            funds = await mutualFundDataService.getAllFunds(parseInt(limit));
        }
        
        if (!funds || funds.length === 0) {
            LOG.warning('[Trading Routes] No mutual funds found in database');
            LOG.warning('[Trading Routes] Check mutual fund sync job status');
        }
        
        res.json({ success: true, data: funds || [] });
    } catch (error) {
        LOG.error('[Trading Routes] Error fetching mutual funds:', error);
        res.json({ success: true, data: [] });
    }
});

/**
 * GET /api/trading/mutual-funds/categories
 * Get all unique categories
 */
router.get('/mutual-funds/categories', async (req, res) => {
    try {
        const categories = await mutualFundDataService.getCategories();
        res.json({ success: true, data: categories });
    } catch (error) {
        LOG.error('[Trading Routes] Error fetching categories:', error);
        res.json({ success: true, data: [] });
    }
});

/**
 * GET /api/trading/mutual-funds/sheets
 * Get all unique sheet names
 */
router.get('/mutual-funds/sheets', async (req, res) => {
    try {
        const sheets = await mutualFundDataService.getSheetNames();
        res.json({ success: true, data: sheets });
    } catch (error) {
        LOG.error('[Trading Routes] Error fetching sheet names:', error);
        res.json({ success: true, data: [] });
    }
});

/**
 * GET /api/trading/corporate-actions
 * Get all corporate actions from database
 * Query params: symbol, limit (default: 100), offset (default: 0)
 */
router.get('/corporate-actions', async (req, res) => {
    try {
        const { symbol, limit = 100, offset = 0 } = req.query;
        LOG.info(`[Trading Routes] GET /api/trading/corporate-actions?symbol=${symbol || 'all'}&limit=${limit}&offset=${offset}`);
        
        const options = {
            limit: parseInt(limit),
            offset: parseInt(offset),
            symbol: symbol || null
        };
        
        const actions = await corporateActionsDataService.getAllActions(options);
        
        if (!actions || actions.length === 0) {
            LOG.warning('[Trading Routes] No corporate actions found in database');
            LOG.warning('[Trading Routes] Check corporate actions sync job status');
        }
        
        res.json({ success: true, data: actions || [] });
    } catch (error) {
        LOG.error('[Trading Routes] Error fetching corporate actions:', error);
        res.json({ success: true, data: [] });
    }
});

/**
 * GET /api/trading/corporate-actions/:symbol
 * Get corporate actions for a specific symbol
 */
router.get('/corporate-actions/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        LOG.info(`[Trading Routes] GET /api/trading/corporate-actions/${symbol}`);
        
        const actions = await corporateActionsDataService.getActionsBySymbol(symbol);
        
        res.json({ success: true, data: actions || [] });
    } catch (error) {
        LOG.error(`[Trading Routes] Error fetching corporate actions for ${req.params.symbol}:`, error);
        res.json({ success: true, data: [] });
    }
});

/**
 * GET /api/trading/board-meetings
 * Get all board meetings from database
 * Query params: symbol, limit (default: 100), offset (default: 0)
 */
router.get('/board-meetings', async (req, res) => {
    try {
        const { symbol, limit = 100, offset = 0 } = req.query;
        LOG.info(`[Trading Routes] GET /api/trading/board-meetings?symbol=${symbol || 'all'}&limit=${limit}&offset=${offset}`);
        
        const options = {
            limit: parseInt(limit),
            offset: parseInt(offset),
            symbol: symbol || null
        };
        
        const meetings = await boardMeetingsDataService.getAllMeetings(options);
        
        if (!meetings || meetings.length === 0) {
            LOG.warning('[Trading Routes] No board meetings found in database');
            LOG.warning('[Trading Routes] Check board meetings sync job status');
        }
        
        res.json({ success: true, data: meetings || [] });
    } catch (error) {
        LOG.error('[Trading Routes] Error fetching board meetings:', error);
        res.json({ success: true, data: [] });
    }
});

/**
 * GET /api/trading/board-meetings/:symbol
 * Get board meetings for a specific symbol
 */
router.get('/board-meetings/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        LOG.info(`[Trading Routes] GET /api/trading/board-meetings/${symbol}`);
        
        const meetings = await boardMeetingsDataService.getMeetingsBySymbol(symbol);
        
        res.json({ success: true, data: meetings || [] });
    } catch (error) {
        LOG.error(`[Trading Routes] Error fetching board meetings for ${req.params.symbol}:`, error);
        res.json({ success: true, data: [] });
    }
});

/**
 * GET /api/trading/test-data
 * Test endpoint to check all data in database
 */
router.get('/test-data', async (req, res) => {
    try {
        LOG.info('[Trading Routes] ========================================');
        LOG.info('[Trading Routes] GET /api/trading/test-data');
        
        const result = {
            timestamp: new Date().toISOString(),
            database: {
                mysqlAvailable: stockDataService.isMySQLAvailable(),
                totalStocks: 0,
                byType: {},
                sampleRecords: {}
            },
            queries: {
                allStocks: [],
                gainers: [],
                losers: [],
                actives: [],
                data: []
            }
        };

        // Get all stocks
        const allStocks = await stockDataService.getAllStocks();
        result.database.totalStocks = allStocks.length;
        result.queries.allStocks = allStocks.slice(0, 5);

        // Get by type
        result.queries.gainers = await stockDataService.getTopGainers(5);
        result.queries.losers = await stockDataService.getTopLosers(5);
        result.queries.actives = await stockDataService.getActives(5);
        result.queries.data = await stockDataService.getDataStocks(5);

        // Count by type
        if (stockDataService.isMySQLAvailable()) {
            const pool = require('../database').getPool();
            const [typeCounts] = await pool.query(`
                SELECT data_type, COUNT(*) as count 
                FROM live_stock_data 
                GROUP BY data_type
            `);
            typeCounts.forEach(row => {
                result.database.byType[row.data_type] = row.count;
            });

            // Get sample records by type
            for (const type of ['gainers', 'decliners', 'actives', 'data']) {
                const [samples] = await pool.query(
                    'SELECT * FROM live_stock_data WHERE data_type = ? LIMIT 2',
                    [type]
                );
                result.database.sampleRecords[type] = samples;
            }
        } else {
            const inMemoryDb = stockDataService.getInMemoryDb();
            const stocks = inMemoryDb.live_stock_data || [];
            stocks.forEach(stock => {
                const type = stock.data_type || 'unknown';
                result.database.byType[type] = (result.database.byType[type] || 0) + 1;
            });
        }

        LOG.info('[Trading Routes] Test data result:', JSON.stringify(result, null, 2));
        LOG.info('[Trading Routes] ========================================');

        res.json({ success: true, data: result });
    } catch (error) {
        LOG.error('[Trading Routes] Error in test-data:', error);
        res.status(500).json({ error: error.message || 'Failed to get test data' });
    }
});

module.exports = router;

