# Quick Start: Trading Data Pipeline

## 🚀 Get Started in 3 Steps

### Step 1: Start the Server

```bash
cd backend
npm install  # If not already done
npm start
```

**What happens:**
- Server starts
- If database is empty, **sample data is automatically seeded** (50 stocks)
- You can immediately test API endpoints!

### Step 2: Test the API

```bash
# Get top gainers
curl http://localhost:3000/api/trading/top-gainers

# Get stock quote
curl http://localhost:3000/api/trading/quote?symbols=RELIANCE,TCS

# Get top losers
curl http://localhost:3000/api/trading/top-losers
```

### Step 3: (Optional) Import Your Google Sheet

When you download your Google Sheet as CSV:

```bash
# Using admin endpoint (requires authentication)
POST /api/admin/trading-data/import-csv
Body: { "csvData": "your_csv_content_here" }
```

Or configure automatic sync:
1. Set `GOOGLE_SHEET_ID` in `.env`
2. Set `GOOGLE_APPLICATION_CREDENTIALS` path
3. Sync runs automatically every 25 minutes

## 📊 Sample Data Included

The system automatically seeds **50 popular Indian stocks**:
- RELIANCE, TCS, HDFCBANK, INFY, ICICIBANK
- HINDUNILVR, SBIN, BHARTIARTL, ITC, KOTAKBANK
- And 40 more...

Each with realistic:
- Prices (with variations)
- Change amounts
- Volume and market cap

## 🎛️ Admin Controls

### Enable/Disable Yahoo Finance

```bash
POST /api/admin/trading-config/yahoo-finance
Body: { "enabled": true }  # or false
```

**Note:** Restart server after changing this setting.

### Add More Sample Data

```bash
POST /api/admin/trading-data/seed-sample
Body: { "count": 50 }
```

### Import CSV from Google Sheets

1. Download CSV from Google Sheets (File → Download → CSV)
2. Send to API:
```bash
POST /api/admin/trading-data/import-csv
Body: { "csvData": "Symbol,Company Name,...\nRELIANCE,..." }
```

## 📝 Google Sheet Format

Your Google Sheet should have these columns:

| Column | Header | Example |
|--------|--------|---------|
| A | Symbol | RELIANCE |
| B | Company Name | Reliance Industries Ltd |
| C | Last Price | 2456.50 |
| D | Change | 12.30 |
| E | Change % | 0.50 |
| F | Volume | 1250000 |
| G | Market Cap | 1660000000000 |

**Important:**
- First row = Headers
- Data starts from row 2

## 🔄 Data Flow

```
Startup → Check Database
    ↓
Empty? → Auto-seed 50 sample stocks
    ↓
Ready to use!
    ↓
(Optional) Import CSV or configure Google Sheets sync
```

## ✅ What Works Out of the Box

- ✅ Sample data auto-seeded on first run
- ✅ All API endpoints work immediately
- ✅ Top gainers/losers calculated
- ✅ Stock quotes available
- ✅ No external API calls needed
- ✅ Fast and reliable

## 📚 More Info

- **Admin Guide:** See `ADMIN_TRADING_CONFIG.md`
- **Setup Guide:** See `README_GOOGLE_SHEETS_SETUP.md`
- **Full Documentation:** See `TRADING_DATA_PIPELINE_SUMMARY.md`

---

**You're ready to go!** 🎉

