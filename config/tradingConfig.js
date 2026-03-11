/**
 * Trading Data Configuration
 * Central configuration for trading data sources
 * 
 * By default, Yahoo Finance is DISABLED and the system uses Google Sheets -> MySQL pipeline
 */
require('dotenv').config();

module.exports = {
    dataSources: {
        // Yahoo Finance is DISABLED by default
        // Set USE_YAHOO_FINANCE=true in .env to enable
        useYahooFinance: process.env.USE_YAHOO_FINANCE === 'true' || false,
    },
    excelFile: {
        filePath: process.env.EXCEL_FILE_PATH || './India_Stock_Market_Tracker_v1.0.xlsx', // Path to Excel file
        sheetName: process.env.EXCEL_SHEET_NAME || null, // Sheet name (null = first sheet)
    },
    database: {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'root',
        database: process.env.DB_NAME || 'qr_queue',
    },
    schedule: {
        // Run every 25 minutes
        // Cron expression: */25 * * * * (every 25 minutes)
        cronExpression: process.env.EXCEL_SYNC_CRON || '*/25 * * * *',
        enabled: process.env.EXCEL_SYNC_ENABLED !== 'false', // Enabled by default
    },
    // Column mapping from Excel to database
    // Excel structure: No. | Ticker | Name | Volume | Price | Change | Change % | Market Cap
    // Column indices:   0   |   1    |  2   |   3    |   4   |   5    |    6     |     7
    columnMapping: {
        symbol: 1,        // Column B (Ticker) - Skip Column A (No./Row numbers)
        companyName: 2,   // Column C (Name)
        volume: 3,        // Column D (Volume)
        lastPrice: 4,     // Column E (Price)
        change: 5,        // Column F (Change)
        percentChange: 6, // Column G (Change %)
        marketCap: 7,     // Column H (Market Cap)
        // Add more columns as needed
    }
};

