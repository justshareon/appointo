# Trading & Real Estate Database Setup Guide

This guide explains how to set up MySQL database tables for Trading and Real Estate features.

## Prerequisites

1. **MySQL Server** installed and running locally
2. **Node.js** and npm installed
3. **Database credentials** ready

## Quick Setup

### Step 1: Configure Environment Variables

Create or update your `.env` file in the `backend` directory:

```env
# Database Configuration
DB_TYPE=mysql
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=qr_queue
```

### Step 2: Run the Setup Script

Navigate to the `backend` directory and run:

```bash
cd backend
node setup_trading_realestate_db.js
```

The script will:
- Connect to your MySQL database
- Create the database if it doesn't exist
- Create all required tables for Trading and Real Estate features
- Verify the setup

## Database Tables Created

### Trading Tables

1. **live_stock_data** - Current stock market data
2. **stock_data_history** - Historical stock data archive
3. **trading_stock_quotes** - Stock quotes with full details
4. **trading_market_indices** - Market indices (NIFTY, SENSEX, etc.)
5. **trading_top_stocks** - Top gainers, losers, market high, most bought
6. **stock_indicators** - Technical indicators (SMA, EMA, MACD, RSI, etc.)
7. **stock_history** - Historical price data for indicator calculations
8. **mutual_funds** - Mutual fund NAV and details
9. **corporate_actions** - Corporate actions (dividends, splits, etc.)
10. **board_meetings** - Board meeting announcements

### Real Estate Tables

1. **real_estate_properties** - Property listings with full details
2. **real_estate_enquiries** - Property enquiry/lead management
3. **real_estate_favorites** - User favorites/wishlist

## Table Details

### Trading Tables

#### `live_stock_data`
Stores current stock market data with support for different data types (gainers, decliners, actives, data).

#### `stock_indicators`
Stores 20 technical indicators for each stock:
- Moving Averages: SMA10, SMA20, SMA50, EMA12, EMA26
- Momentum: MACD, RSI, Stochastic, Williams %R, CCI, ADX, Momentum, ROC, MFI
- Volatility: Bollinger Bands, ATR, PSAR
- Volume: OBV, VWAP, Volume ROC
- Advanced: A/D Line, BB %B, Ichimoku Tenkan-sen, Ichimoku Kijun-sen

#### `stock_history`
Historical OHLCV (Open, High, Low, Close, Volume) data for technical indicator calculations.

### Real Estate Tables

#### `real_estate_properties`
Comprehensive property listing table with:
- Property details (type, size, bedrooms, bathrooms, etc.)
- Location (address, city, coordinates)
- Pricing and availability
- Amenities and features
- RERA registration
- Images and metadata

#### `real_estate_enquiries`
Tracks property enquiries from users with status management.

#### `real_estate_favorites`
User wishlist/favorites for properties.

## Verification

After running the setup script, verify the tables were created:

```sql
USE qr_queue;
SHOW TABLES LIKE '%stock%';
SHOW TABLES LIKE '%trading%';
SHOW TABLES LIKE '%real_estate%';
```

## Troubleshooting

### Connection Error
- Verify MySQL server is running: `mysql -u root -p`
- Check credentials in `.env` file
- Ensure MySQL port (default 3306) is correct

### Permission Error
- Grant privileges: `GRANT ALL PRIVILEGES ON qr_queue.* TO 'root'@'localhost';`
- Flush privileges: `FLUSH PRIVILEGES;`

### Table Already Exists
- The script uses `CREATE TABLE IF NOT EXISTS`, so it's safe to run multiple times
- Existing data will not be affected

## Next Steps

1. **Start the backend server**:
   ```bash
   npm start
   ```

2. **Verify database connection** in server logs:
   ```
   [DB SUCCESS] MySQL Database Connected successfully!
   ```

3. **Test Trading endpoints**:
   - GET `/api/trading/quotes`
   - GET `/api/trading/indices`
   - GET `/api/trading/analytics`

4. **Test Real Estate endpoints**:
   - GET `/api/realestate/properties`
   - POST `/api/realestate/enquiries`

## Data Population

### Trading Data
Trading data is populated automatically from:
- Excel files (when `USE_YAHOO_FINANCE=false`)
- Google Sheets sync (if configured)
- Manual API calls

### Real Estate Data
Real Estate properties can be added via:
- Vendor dashboard (vendors with `features_realestate=true`)
- API endpoints
- Direct database inserts

## Maintenance

### Backup Database
```bash
mysqldump -u root -p qr_queue > backup_$(date +%Y%m%d).sql
```

### Restore Database
```bash
mysql -u root -p qr_queue < backup_20240101.sql
```

## Support

For issues or questions:
1. Check server logs in `backend/error.log`
2. Verify `.env` configuration
3. Test MySQL connection manually
4. Review table structure: `DESCRIBE table_name;`

