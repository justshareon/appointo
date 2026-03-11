/**
 * Sample Stock Data Service
 * Generates and seeds sample stock data for testing
 */
const stockDataService = require('./stockDataService');
const LOG = require('../utils/logger');

class SampleStockDataService {
    constructor() {
        // Popular Indian stocks with realistic data
        this.sampleStocks = [
            { symbol: 'RELIANCE', name: 'Reliance Industries Ltd', basePrice: 2456.50 },
            { symbol: 'TCS', name: 'Tata Consultancy Services', basePrice: 3456.20 },
            { symbol: 'HDFCBANK', name: 'HDFC Bank Ltd', basePrice: 1654.80 },
            { symbol: 'INFY', name: 'Infosys Ltd', basePrice: 1456.30 },
            { symbol: 'ICICIBANK', name: 'ICICI Bank Ltd', basePrice: 987.50 },
            { symbol: 'HINDUNILVR', name: 'Hindustan Unilever Ltd', basePrice: 2456.90 },
            { symbol: 'SBIN', name: 'State Bank of India', basePrice: 654.20 },
            { symbol: 'BHARTIARTL', name: 'Bharti Airtel Ltd', basePrice: 1234.50 },
            { symbol: 'ITC', name: 'ITC Ltd', basePrice: 456.30 },
            { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank', basePrice: 1876.40 },
            { symbol: 'LT', name: 'Larsen & Toubro Ltd', basePrice: 3456.70 },
            { symbol: 'AXISBANK', name: 'Axis Bank Ltd', basePrice: 1123.80 },
            { symbol: 'ASIANPAINT', name: 'Asian Paints Ltd', basePrice: 3456.90 },
            { symbol: 'MARUTI', name: 'Maruti Suzuki India Ltd', basePrice: 9876.50 },
            { symbol: 'TITAN', name: 'Titan Company Ltd', basePrice: 3456.20 },
            { symbol: 'NESTLEIND', name: 'Nestle India Ltd', basePrice: 23456.80 },
            { symbol: 'ULTRACEMCO', name: 'UltraTech Cement Ltd', basePrice: 8765.40 },
            { symbol: 'WIPRO', name: 'Wipro Ltd', basePrice: 456.70 },
            { symbol: 'SUNPHARMA', name: 'Sun Pharmaceutical Industries', basePrice: 1234.60 },
            { symbol: 'ONGC', name: 'Oil and Natural Gas Corporation', basePrice: 234.50 },
            { symbol: 'NTPC', name: 'NTPC Ltd', basePrice: 345.60 },
            { symbol: 'POWERGRID', name: 'Power Grid Corporation of India', basePrice: 234.80 },
            { symbol: 'TECHM', name: 'Tech Mahindra Ltd', basePrice: 1234.50 },
            { symbol: 'HCLTECH', name: 'HCL Technologies Ltd', basePrice: 1456.70 },
            { symbol: 'BAJFINANCE', name: 'Bajaj Finance Ltd', basePrice: 7654.30 },
            { symbol: 'ADANIENT', name: 'Adani Enterprises Ltd', basePrice: 3456.80 },
            { symbol: 'JSWSTEEL', name: 'JSW Steel Ltd', basePrice: 876.50 },
            { symbol: 'TATAMOTORS', name: 'Tata Motors Ltd', basePrice: 654.30 },
            { symbol: 'TATASTEEL', name: 'Tata Steel Ltd', basePrice: 145.60 },
            { symbol: 'HDFCLIFE', name: 'HDFC Life Insurance Company', basePrice: 654.20 },
            { symbol: 'GRASIM', name: 'Grasim Industries Ltd', basePrice: 2345.60 },
            { symbol: 'M&M', name: 'Mahindra & Mahindra Ltd', basePrice: 1876.40 },
            { symbol: 'DIVISLAB', name: 'Dr. Reddys Laboratories Ltd', basePrice: 5678.90 },
            { symbol: 'SBILIFE', name: 'SBI Life Insurance Company', basePrice: 1234.50 },
            { symbol: 'BAJAJFINSV', name: 'Bajaj Finserv Ltd', basePrice: 1876.30 },
            { symbol: 'CIPLA', name: 'Cipla Ltd', basePrice: 1234.80 },
            { symbol: 'COALINDIA', name: 'Coal India Ltd', basePrice: 234.50 },
            { symbol: 'DRREDDY', name: 'Dr. Reddys Laboratories', basePrice: 5678.40 },
            { symbol: 'EICHERMOT', name: 'Eicher Motors Ltd', basePrice: 3456.70 },
            { symbol: 'HEROMOTOCO', name: 'Hero MotoCorp Ltd', basePrice: 3456.20 },
            { symbol: 'INDUSINDBK', name: 'IndusInd Bank Ltd', basePrice: 1456.80 },
            { symbol: 'APOLLOHOSP', name: 'Apollo Hospitals Enterprise', basePrice: 5678.50 },
            { symbol: 'BAJAJ-AUTO', name: 'Bajaj Auto Ltd', basePrice: 5678.30 },
            { symbol: 'BPCL', name: 'Bharat Petroleum Corporation', basePrice: 456.70 },
            { symbol: 'BRITANNIA', name: 'Britannia Industries Ltd', basePrice: 4567.80 },
            { symbol: 'HDFCAMC', name: 'HDFC Asset Management Company', basePrice: 3456.40 },
            { symbol: 'MARICO', name: 'Marico Ltd', basePrice: 567.80 },
            { symbol: 'PIDILITIND', name: 'Pidilite Industries Ltd', basePrice: 2345.60 },
            { symbol: 'SIEMENS', name: 'Siemens Ltd', basePrice: 3456.70 },
        ];
    }

    /**
     * Generate sample stock data with realistic variations
     * @param {number} count - Number of stocks to generate
     * @returns {Array} Array of stock data objects
     */
    generateSampleData(count = 50) {
        const stocks = this.sampleStocks.slice(0, Math.min(count, this.sampleStocks.length));
        const now = new Date();
        
        return stocks.map(stock => {
            // Generate realistic price variation (-5% to +5%)
            const variation = (Math.random() * 10 - 5) / 100;
            const currentPrice = stock.basePrice * (1 + variation);
            const change = currentPrice - stock.basePrice;
            const percentChange = (change / stock.basePrice) * 100;
            
            // Generate realistic volume (based on market cap)
            const marketCap = currentPrice * (Math.random() * 1000000000 + 500000000);
            const volume = Math.floor(marketCap / currentPrice * (Math.random() * 0.1 + 0.05));

            return {
                symbol: stock.symbol,
                company_name: stock.name,
                last_price: parseFloat(currentPrice.toFixed(2)),
                change: parseFloat(change.toFixed(2)),
                percent_change: parseFloat(percentChange.toFixed(2)),
                volume: volume,
                market_cap: Math.floor(marketCap),
            };
        });
    }

    /**
     * Seed sample data into database
     * @param {number} count - Number of stocks to seed
     * @returns {Promise<Object>} Result with inserted count
     */
    async seedSampleData(count = 50) {
        try {
            // Initialize tables if MySQL is available
            const pool = require('../database').getPool();
            if (pool) {
                await stockDataService.initializeTables();
            } else {
                LOG.info('[Sample Data] MySQL not available, using in-memory storage');
            }

            // Generate sample data
            const sampleData = this.generateSampleData(count);
            LOG.info(`[Sample Data] Generating ${sampleData.length} sample stock records`);

            // Archive existing data (works for both MySQL and in-memory)
            try {
                await stockDataService.archiveCurrentData();
            } catch (err) {
                // Ignore if no data to archive
                LOG.info('[Sample Data] No existing data to archive');
            }

            // Truncate and insert (works for both MySQL and in-memory)
            await stockDataService.truncateLiveData();
            const inserted = await stockDataService.insertLiveData(sampleData);

            LOG.success(`[Sample Data] Seeded ${inserted} sample stock records`);
            
            return {
                inserted,
                total: sampleData.length,
                stocks: sampleData.map(s => s.symbol)
            };
        } catch (error) {
            LOG.error('[Sample Data] Error seeding sample data:', error.message);
            throw error;
        }
    }
}

module.exports = new SampleStockDataService();

