# Admin Trading Configuration Guide

## Overview

Super users can manage trading data source configuration and seed sample data through admin API endpoints.

## Admin Endpoints

All endpoints require authentication (JWT token in Authorization header).

### 1. Get Trading Configuration

**GET** `/api/admin/trading-config`

Get current trading data source configuration.

**Response:**
```json
{
  "success": true,
  "data": {
    "useYahooFinance": false,
    "googleSheets": {
      "spreadsheetId": "your_sheet_id",
      "range": "Sheet1!A:H"
    },
    "schedule": {
      "cronExpression": "*/25 * * * *",
      "enabled": true
    }
  }
}
```

### 2. Enable/Disable Yahoo Finance

**POST** `/api/admin/trading-config/yahoo-finance`

Toggle Yahoo Finance data source on/off.

**Request Body:**
```json
{
  "enabled": true  // or false
}
```

**Response:**
```json
{
  "success": true,
  "message": "Yahoo Finance enabled",
  "useYahooFinance": true,
  "note": "Server restart required for changes to take effect"
}
```

**Note:** After changing this setting, restart the server for changes to take effect.

### 3. Seed Sample Data

**POST** `/api/admin/trading-data/seed-sample`

Seed sample stock data for testing (50 popular Indian stocks).

**Request Body (optional):**
```json
{
  "count": 50  // Number of stocks to seed (default: 50, max: 50)
}
```

**Response:**
```json
{
  "success": true,
  "message": "Seeded 50 sample stock records",
  "data": {
    "inserted": 50,
    "total": 50,
    "stocks": ["RELIANCE", "TCS", "HDFCBANK", ...]
  }
}
```

**Use Cases:**
- Testing before Google Sheet is ready
- Development environment setup
- Demo purposes

### 4. Import CSV Data

**POST** `/api/admin/trading-data/import-csv`

Import stock data from CSV file (downloaded from Google Sheets).

**Request Body:**
```json
{
  "csvData": "Symbol,Company Name,Last Price,Change,Change %,Volume,Market Cap\nRELIANCE,Reliance Industries Ltd,2456.50,12.30,0.50,1250000,1660000000000\n..."
}
```

**CSV Format:**
- First row must be headers
- Columns should match: Symbol, Company Name, Last Price, Change, Change %, Volume, Market Cap
- Or adjust column mapping in `config/tradingConfig.js`

**Response:**
```json
{
  "success": true,
  "message": "Imported 50 stock records from CSV",
  "data": {
    "inserted": 50,
    "total": 50,
    "stocks": ["RELIANCE", "TCS", ...]
  }
}
```

**How to get CSV from Google Sheets:**
1. Open your Google Sheet
2. File → Download → Comma Separated Values (.csv)
3. Read the CSV file content
4. Send it in the `csvData` field

### 5. Clear All Stock Data

**DELETE** `/api/admin/trading-data/clear`

Clear all stock data from database (for testing).

**Response:**
```json
{
  "success": true,
  "message": "All stock data cleared"
}
```

## Usage Examples

### Using cURL

#### Get Configuration
```bash
curl -X GET http://localhost:3000/api/admin/trading-config \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### Enable Yahoo Finance
```bash
curl -X POST http://localhost:3000/api/admin/trading-config/yahoo-finance \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

#### Seed Sample Data
```bash
curl -X POST http://localhost:3000/api/admin/trading-data/seed-sample \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"count": 50}'
```

#### Import CSV
```bash
# Read CSV file and send
CSV_CONTENT=$(cat stock_data.csv)
curl -X POST http://localhost:3000/api/admin/trading-data/import-csv \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"csvData\": \"$CSV_CONTENT\"}"
```

### Using JavaScript/Fetch

```javascript
const token = 'YOUR_JWT_TOKEN';
const baseURL = 'http://localhost:3000/api/admin';

// Get configuration
const config = await fetch(`${baseURL}/trading-config`, {
  headers: { 'Authorization': `Bearer ${token}` }
}).then(r => r.json());

// Enable Yahoo Finance
await fetch(`${baseURL}/trading-config/yahoo-finance`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ enabled: true })
});

// Seed sample data
await fetch(`${baseURL}/trading-data/seed-sample`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ count: 50 })
});

// Import CSV
const csvContent = await fetch('stock_data.csv').then(r => r.text());
await fetch(`${baseURL}/trading-data/import-csv`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ csvData: csvContent })
});
```

## Workflow

### Initial Setup (Before Google Sheet is Ready)

1. **Start the server** - Sample data will be auto-seeded if database is empty
2. **Or manually seed:**
   ```bash
   POST /api/admin/trading-data/seed-sample
   ```
3. **Test API endpoints:**
   - `GET /api/trading/top-gainers`
   - `GET /api/trading/quote?symbols=RELIANCE,TCS`
   - `GET /api/trading/top-losers`

### When Google Sheet is Ready

1. **Download CSV from Google Sheets:**
   - File → Download → CSV
   
2. **Import CSV:**
   ```bash
   POST /api/admin/trading-data/import-csv
   # with csvData in body
   ```

3. **Or configure Google Sheets sync:**
   - Set `GOOGLE_SHEET_ID` in `.env`
   - Set `GOOGLE_APPLICATION_CREDENTIALS` path
   - Sync will run automatically every 25 minutes

### Switching Data Sources

1. **Check current config:**
   ```bash
   GET /api/admin/trading-config
   ```

2. **Enable/disable Yahoo Finance:**
   ```bash
   POST /api/admin/trading-config/yahoo-finance
   # { "enabled": true } or { "enabled": false }
   ```

3. **Restart server** for changes to take effect

## Sample Data

The sample data includes 50 popular Indian stocks:
- RELIANCE, TCS, HDFCBANK, INFY, ICICIBANK
- HINDUNILVR, SBIN, BHARTIARTL, ITC, KOTAKBANK
- And 40 more...

Each stock has:
- Realistic price variations (-5% to +5%)
- Calculated change and change percentage
- Estimated volume and market cap

## Notes

- **Sample data is for testing only** - Use real Google Sheets data in production
- **Server restart required** after changing `USE_YAHOO_FINANCE` setting
- **CSV import** archives existing data before inserting new data
- **All operations** are logged for audit purposes

## Troubleshooting

### "No data in database"
- Run `POST /api/admin/trading-data/seed-sample` to add sample data
- Or import CSV using `POST /api/admin/trading-data/import-csv`

### "Server restart required"
- After changing Yahoo Finance setting, restart the Node.js server
- The setting is written to `.env` file

### "CSV import failed"
- Check CSV format matches expected columns
- Ensure first row is headers
- Verify column mapping in `config/tradingConfig.js`

