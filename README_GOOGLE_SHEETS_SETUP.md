# Google Sheets to MySQL Trading Data Pipeline Setup Guide

## Overview

This system syncs stock market data from Google Sheets to MySQL database every 25 minutes. By default, Yahoo Finance API is **DISABLED** and the application uses data from MySQL (populated by Google Sheets).

## Prerequisites

1. Node.js installed
2. MySQL database running
3. Google Cloud Project with Sheets API enabled
4. Google Service Account credentials (JSON key file)

## Setup Steps

### 1. Install Dependencies

```bash
cd backend
npm install
```

This will install:
- `googleapis` - Google Sheets API client
- `node-cron` - Cron job scheduler
- `mysql2` - MySQL database client

### 2. Google Cloud Setup

1. **Create a Google Cloud Project**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select an existing one

2. **Enable Google Sheets API**
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google Sheets API"
   - Click "Enable"

3. **Create Service Account**
   - Go to "IAM & Admin" > "Service Accounts"
   - Click "Create Service Account"
   - Give it a name (e.g., "trading-data-sync")
   - Click "Create and Continue"
   - Skip role assignment (not needed for Sheets API)
   - Click "Done"

4. **Create and Download JSON Key**
   - Click on the service account you just created
   - Go to "Keys" tab
   - Click "Add Key" > "Create new key"
   - Select "JSON" format
   - Download the JSON file
   - Save it to `backend/config/google-credentials.json` (or your preferred location)

5. **Share Google Sheet with Service Account**
   - Open your Google Sheet
   - Click "Share" button
   - Add the service account email (found in the JSON file as `client_email`)
   - Give it "Viewer" permission
   - Click "Send"

### 3. Configure Environment Variables

Copy `.env.example` to `.env` and update the values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Database
DB_TYPE=mysql
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=qr_queue

# Trading Data Source (DISABLE Yahoo Finance)
USE_YAHOO_FINANCE=false

# Google Sheets
GOOGLE_SHEET_ID=your_google_sheet_id_here
GOOGLE_SHEET_RANGE=Sheet1!A:H
GOOGLE_APPLICATION_CREDENTIALS=./config/google-credentials.json

# Sync Schedule (optional)
GOOGLE_SHEET_SYNC_CRON=*/25 * * * *
GOOGLE_SHEET_SYNC_ENABLED=true
```

### 4. Google Sheet Format

Your Google Sheet should have the following columns (in order):

| Column | Header | Description | Example |
|--------|--------|-------------|---------|
| A | Symbol | Stock symbol | RELIANCE |
| B | Company Name | Company name | Reliance Industries Ltd |
| C | Last Price | Current price | 2456.50 |
| D | Change | Price pchange | 12.30 |
| E | Change % | Percentage pchange | 0.50 |
| F | Volume | Trading volume | 1250000 |
| G | Market Cap | Market capitalization | 1660000000000 |

**Important:**
- First row must be headers
- Data starts from row 2
- Symbol column (A) is required
- Other columns can be empty but should be present

### 5. Database Schema

The system automatically creates these tables:

**live_stock_data** - Current stock data
- `symbol` (VARCHAR, UNIQUE)
- `company_name`
- `last_price`
- pchange
- `per_change`
- `volume`
- `market_cap`
- `last_updated`

**stock_data_history** - Historical data (archived every 25 minutes)
- Same structure as `live_stock_data`
- `archived_at` timestamp

### 6. Start the Server

```bash
npm start
```

The server will:
1. Initialize database tables
2. Start the Google Sheets sync job (runs every 25 minutes)
3. Run initial sync after 5 seconds

## How It Works

1. **Every 25 minutes**, the cron job:
   - Fetches data from Google Sheets
   - Archives current `live_stock_data` to `stock_data_history`
   - Truncates `live_stock_data`
   - Inserts fresh data from Google Sheets

2. **API Endpoints** query `live_stock_data` table:
   - `/api/trading/quote` - Get stock quotes
   - `/api/trading/top-gainers` - Get top gainers
   - `/api/trading/top-losers` - Get top losers
   - `/api/trading/screen` - Screen stocks

## Manual Sync

You can manually trigger a sync by calling the sync method:

```javascript
const GoogleSheetSyncJob = require('./jobs/googleSheetSyncJob');
const syncJob = new GoogleSheetSyncJob();
await syncJob.sync();
```

Or add a route to trigger it:

```javascript
router.post('/api/trading/sync-google-sheets', async (req, res) => {
    const syncJob = require('../server').googleSheetSyncJob;
    await syncJob.sync();
    res.json({ success: true, message: 'Sync completed' });
});
```

## Switching Between Data Sources

### Use Google Sheets (Default)
```env
USE_YAHOO_FINANCE=false
```

### Use Yahoo Finance API
```env
USE_YAHOO_FINANCE=true
```

When switching, restart the server.

## Troubleshooting

### "Google credentials file not found"
- Check `GOOGLE_APPLICATION_CREDENTIALS` path in `.env`
- Ensure the JSON file exists at that path

### "No data received from Google Sheets"
- Verify `GOOGLE_SHEET_ID` is correct
- Check that the service account email has access to the sheet
- Verify the sheet range (`GOOGLE_SHEET_RANGE`) is correct

### "MySQL connection not available"
- Check database credentials in `.env`
- Ensure MySQL is running
- Verify database exists

### "No valid stock data after transformation"
- Check Google Sheet format matches expected columns
- Ensure first row is headers
- Verify data starts from row 2

## Column Mapping

You can customize column mapping in `config/tradingConfig.js`:

```javascript
columnMapping: {
    symbol: 0,        // Column A
    companyName: 1,  // Column B
    lastPrice: 2,    // Column C
    pchange: 3,       // Column D
    percentChange: 4,// Column E
    volume: 5,       // Column F
    marketCap: 6,    // Column G
}
```

## Monitoring

Check sync status:

```bash
GET /api/trading/refresh-status
```

Response includes:
- Data source (Google Sheets or Yahoo Finance)
- Last sync time
- Sync status (success/error)
- Number of records synced

## Security Notes

1. **Never commit `.env` file** - It contains sensitive credentials
2. **Never commit `google-credentials.json`** - Add to `.gitignore`
3. **Service account** should have minimal permissions (Viewer only)
4. **Database credentials** should be kept secure

## Support

For issues or questions, check:
- Logs in console output
- Database tables for data
- Google Cloud Console for API quotas/errors

