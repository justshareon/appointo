# Excel File Sync - Setup Guide

## Overview

The system reads stock data from a local Excel file (`India_Stock_Market_Tracker_v1.0.xlsx`) and syncs it to MySQL every 25 minutes.

## Excel File Location

**Default:** `backend/India_Stock_Market_Tracker_v1.0.xlsx`

The file should be located in the `backend` directory.

## Excel File Format

Your Excel file should have the following columns (in order):

| Column | Header | Description | Example |
|--------|--------|-------------|---------|
| A | Symbol | Stock symbol | RELIANCE |
| B | Company Name | Company name | Reliance Industries Ltd |
| C | Last Price | Current price | 2456.50 |
| D | Change | Price change | 12.30 |
| E | Change % | Percentage change | 0.50 |
| F | Volume | Trading volume | 1250000 |
| G | Market Cap | Market capitalization | 1660000000000 |

**Important:**
- First row must be headers
- Data starts from row 2
- Symbol column (A) is required
- Other columns can be empty but should be present

## Column Mapping

You can customize column mapping in `config/tradingConfig.js`:

```javascript
columnMapping: {
    symbol: 0,        // Column A (0-indexed)
    companyName: 1,   // Column B
    lastPrice: 2,     // Column C
    change: 3,        // Column D
    percentChange: 4, // Column E
    volume: 5,        // Column F
    marketCap: 6,     // Column G
}
```

## Configuration

### Environment Variables (Optional)

```env
# Excel File Path (default: ./India_Stock_Market_Tracker_v1.0.xlsx)
EXCEL_FILE_PATH=./India_Stock_Market_Tracker_v1.0.xlsx

# Sheet Name (default: first sheet)
EXCEL_SHEET_NAME=Sheet1

# Sync Schedule (default: every 25 minutes)
EXCEL_SYNC_CRON=*/25 * * * *

# Enable/disable sync (default: true)
EXCEL_SYNC_ENABLED=true
```

## How It Works

1. **Every 25 minutes**, the cron job:
   - Reads data from Excel file
   - Archives current `live_stock_data` to `stock_data_history`
   - Truncates `live_stock_data`
   - Inserts fresh data from Excel file

2. **API Endpoints** query `live_stock_data` table:
   - `/api/trading/quote` - Get stock quotes
   - `/api/trading/top-gainers` - Get top gainers
   - `/api/trading/top-losers` - Get top losers
   - `/api/trading/screen` - Screen stocks

## Manual Sync

You can manually trigger a sync:

```bash
POST /api/trading/refresh
```

Or via admin endpoint (requires authentication):

```bash
POST /api/admin/trading-data/import-csv
Body: { "csvData": "your_csv_content" }
```

## Updating the Excel File

1. **Update the Excel file** with new data
2. **Save the file** - The sync job will pick it up on the next run (every 25 minutes)
3. **Or trigger manual sync** via API

## Troubleshooting

### "Excel file not found"

- Check that `India_Stock_Market_Tracker_v1.0.xlsx` exists in `backend/` directory
- Verify file path in configuration
- Check file permissions

### "No data found in Excel file"

- Ensure first row is headers
- Check that data starts from row 2
- Verify sheet name is correct (if specified)

### "No valid stock data after transformation"

- Check column mapping matches your Excel structure
- Ensure Symbol column (A) has valid data
- Verify data types (numbers for prices, etc.)

## Monitoring

Check sync status:

```bash
GET /api/trading/refresh-status
```

Response includes:
- Last sync time
- Sync status (success/error)
- Number of records synced
- Excel file path

## Notes

- **File must be saved** before sync can read new data
- **Sync runs every 25 minutes** automatically
- **Previous data is archived** before inserting new data
- **Transaction-based** for data integrity

