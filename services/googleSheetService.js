/**
 * Google Sheets Service
 * Handles authentication and data fetching from Google Sheets
 * Uses Google Sheets API v4 with service account authentication
 */
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const config = require('../config/tradingConfig');
const LOG = require('../utils/logger');

class GoogleSheetService {
    constructor() {
        this.sheets = null;
        this.authenticated = false;
    }

    /**
     * Authenticate with Google Sheets API using service account
     */
    async authenticate() {
        try {
            if (this.authenticated && this.sheets) {
                return this.sheets;
            }

            const credentialsPath = config.googleSheets.credentialsPath;
            
            if (!credentialsPath) {
                throw new Error('GOOGLE_APPLICATION_CREDENTIALS environment variable is not set');
            }

            // Check if credentials file exists
            if (!fs.existsSync(credentialsPath)) {
                throw new Error(`Google credentials file not found at: ${credentialsPath}`);
            }

            // Read service account credentials
            const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));

            // Authenticate using service account
            const auth = new google.auth.GoogleAuth({
                credentials: credentials,
                scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
            });

            const authClient = await auth.getClient();
            this.sheets = google.sheets({ version: 'v4', auth: authClient });
            this.authenticated = true;

            LOG.success('[Google Sheets] Authenticated successfully');
            return this.sheets;
        } catch (error) {
            LOG.error('[Google Sheets] Authentication failed:', error.message);
            throw error;
        }
    }

    /**
     * Fetch data from Google Sheet
     * @param {string} spreadsheetId - Google Sheet ID
     * @param {string} range - Sheet range (e.g., 'Sheet1!A:H')
     * @returns {Promise<Array>} Array of rows (2D array)
     */
    async fetchData(spreadsheetId = null, range = null) {
        try {
            const sheets = await this.authenticate();
            
            const sheetId = spreadsheetId || config.googleSheets.spreadsheetId;
            const sheetRange = range || config.googleSheets.range;

            if (!sheetId) {
                throw new Error('Google Sheet ID is not configured');
            }

            LOG.info(`[Google Sheets] Fetching data from sheet: ${sheetId}, range: ${sheetRange}`);

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: sheetRange,
            });

            const rows = response.data.values || [];
            
            if (rows.length === 0) {
                LOG.warning('[Google Sheets] No data found in the specified range');
                return [];
            }

            LOG.success(`[Google Sheets] Fetched ${rows.length} rows from Google Sheet`);
            return rows;
        } catch (error) {
            LOG.error('[Google Sheets] Error fetching data:', error.message);
            throw error;
        }
    }

    /**
     * Transform Google Sheets data to stock data objects
     * Assumes first row is header, subsequent rows are data
     * @param {Array} rows - 2D array from Google Sheets
     * @returns {Array} Array of stock data objects
     */
    transformToStockData(rows) {
        if (rows.length === 0) {
            return [];
        }

        // First row is header, skip it
        const headerRow = rows[0];
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
                    pchange: this.parseDecimal(row[mapping.pchange]),
                    per_change: this.parseDecimal(row[mapping.percentChange]),
                    volume: this.parseBigInt(row[mapping.volume]),
                    market_cap: this.parseBigInt(row[mapping.marketCap] || row[mapping.marketCap]),
                };

                // Only add if symbol is valid
                if (stock.symbol) {
                    stockData.push(stock);
                }
            } catch (error) {
                LOG.warning(`[Google Sheets] Error parsing row: ${row.join(', ')} - ${error.message}`);
                continue;
            }
        }

        LOG.info(`[Google Sheets] Transformed ${stockData.length} rows to stock data`);
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
}

module.exports = new GoogleSheetService();

