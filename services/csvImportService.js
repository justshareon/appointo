/**
 * CSV Import Service
 * Imports stock data from CSV file (downloaded from Google Sheets)
 */
const stockDataService = require('./stockDataService');
const config = require('../config/tradingConfig');
const LOG = require('../utils/logger');

class CSVImportService {
    /**
     * Parse CSV string to array of rows
     * @param {string} csvData - CSV content as string
     * @returns {Array} Array of rows (2D array)
     */
    parseCSV(csvData) {
        const lines = csvData.split('\n').filter(line => line.trim());
        return lines.map(line => {
            // Simple CSV parsing (handles quoted values)
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
            
            return result;
        });
    }

    /**
     * Transform CSV rows to stock data objects
     * @param {Array} rows - 2D array from CSV
     * @returns {Array} Array of stock data objects
     */
    transformToStockData(rows) {
        if (rows.length === 0) {
            return [];
        }

        // First row is header, skip it
        const dataRows = rows.slice(1);
        const mapping = config.columnMapping;
        const stockData = [];

        for (const row of dataRows) {
            // Skip empty rows
            if (!row || row.length === 0 || !row[mapping.symbol]) {
                continue;
            }

            try {
                const stock = {
                    symbol: String(row[mapping.symbol] || '').trim().toUpperCase(),
                    company_name: String(row[mapping.companyName] || '').trim() || null,
                    last_price: this.parseDecimal(row[mapping.lastPrice]),
                    change: this.parseDecimal(row[mapping.change]),
                    percent_change: this.parseDecimal(row[mapping.percentChange]),
                    volume: this.parseBigInt(row[mapping.volume]),
                    market_cap: this.parseBigInt(row[mapping.marketCap] || row[mapping.marketCap]),
                };

                // Only add if symbol is valid
                if (stock.symbol) {
                    stockData.push(stock);
                }
            } catch (error) {
                LOG.warning(`[CSV Import] Error parsing row: ${row.join(', ')} - ${error.message}`);
                continue;
            }
        }

        return stockData;
    }

    /**
     * Parse decimal value from string
     */
    parseDecimal(value) {
        if (!value) return null;
        const parsed = parseFloat(String(value).replace(/[^\d.-]/g, ''));
        return isNaN(parsed) ? null : parsed;
    }

    /**
     * Parse big integer value from string
     */
    parseBigInt(value) {
        if (!value) return null;
        const parsed = parseFloat(String(value).replace(/[^\d.-]/g, ''));
        return isNaN(parsed) ? null : Math.floor(parsed);
    }

    /**
     * Import stock data from CSV string
     * @param {string} csvData - CSV content as string
     * @returns {Promise<Object>} Result with inserted count
     */
    async importFromCSV(csvData) {
        try {
            // Initialize tables if needed
            await stockDataService.initializeTables();

            // Parse CSV
            LOG.info('[CSV Import] Parsing CSV data...');
            const rows = this.parseCSV(csvData);
            LOG.info(`[CSV Import] Parsed ${rows.length} rows from CSV`);

            if (rows.length === 0) {
                throw new Error('No data found in CSV');
            }

            // Transform to stock data
            LOG.info('[CSV Import] Transforming data...');
            const stockData = this.transformToStockData(rows);
            
            if (stockData.length === 0) {
                throw new Error('No valid stock data after transformation');
            }

            LOG.info(`[CSV Import] Transformed ${stockData.length} stock records`);

            // Archive existing data
            const pool = require('../database').getPool();
            if (pool) {
                try {
                    await stockDataService.archiveCurrentData();
                } catch (err) {
                    // Ignore if no data to archive
                    LOG.info('[CSV Import] No existing data to archive');
                }
            }

            // Truncate and insert
            await stockDataService.truncateLiveData();
            const inserted = await stockDataService.insertLiveData(stockData);

            LOG.success(`[CSV Import] Imported ${inserted} stock records from CSV`);
            
            return {
                inserted,
                total: stockData.length,
                stocks: stockData.map(s => s.symbol)
            };
        } catch (error) {
            LOG.error('[CSV Import] Error importing CSV:', error.message);
            throw error;
        }
    }
}

module.exports = new CSVImportService();

