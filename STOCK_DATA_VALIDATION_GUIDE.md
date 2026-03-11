# Stock Data Validation Guide

## Step-by-Step Data Flow Validation

This guide helps you identify where the data flow is breaking.

## Data Flow Steps

```
1. Excel File Read → 2. Data Transformation → 3. Database Save → 4. Database Fetch → 5. API Response → 6. Frontend Display
```

## Quick Diagnostics

### 1. Run Diagnostics Endpoint

Visit: `GET http://localhost:YOUR_PORT/api/trading/diagnostics`

This will check all 8 steps:
- ✅ Step 1: Excel File Check
- ✅ Step 2: Read Excel File
- ✅ Step 3: Database Connection
- ✅ Step 4: Database Tables
- ✅ Step 5: Fetch from Database
- ✅ Step 6: Format Data for API
- ✅ Step 7: API Response Structure
- ✅ Step 8: Sync Job Status

### 2. Check Sync Status

Visit: `GET http://localhost:YOUR_PORT/api/trading/sync-status`

This shows:
- Last sync time
- Sync status (success/error)
- Error messages
- Excel file path

### 3. Manually Trigger Sync

Visit: `POST http://localhost:YOUR_PORT/api/trading/refresh`

This will:
- Trigger Excel sync immediately
- Show before/after record counts
- Return sample data

## Common Issues & Solutions

### Issue 1: Excel File Not Found
**Symptoms:** Step 1 fails
**Solution:** 
- Check file path: `backend/India_Stock_Market_Tracker_v1.0.xlsx`
- Verify file exists
- Check file permissions

### Issue 2: Excel File Read Returns 0 Records
**Symptoms:** Step 2 passes but shows 0 records
**Solution:**
- Check Excel file has data (not just headers)
- Verify sheet names match: GAINERS, DECLINERS, ACTIVES, DATA
- Check column structure matches expected format
- Review server logs for column detection details

### Issue 3: Database Empty
**Symptoms:** Step 4 shows 0 records
**Solution:**
- Check if sync job has run: `/api/trading/sync-status`
- Manually trigger sync: `POST /api/trading/refresh`
- Check MySQL connection in `.env`
- Review sync job logs for errors

### Issue 4: Database Fetch Returns 0 Records
**Symptoms:** Step 5 returns empty array
**Solution:**
- Verify data_type column has correct values ('gainers', 'decliners', etc.)
- Check if data was inserted with correct data_type
- Run SQL query: `SELECT * FROM live_stock_data WHERE data_type = 'gainers' LIMIT 5;`

### Issue 5: Frontend Not Receiving Data
**Symptoms:** API returns data but UI shows nothing
**Solution:**
- Check browser console for errors
- Verify API response structure: `{ success: true, data: [...] }`
- Check network tab for API calls
- Verify frontend is parsing response correctly

## Manual SQL Queries for Validation

```sql
-- Check total records
SELECT COUNT(*) FROM live_stock_data;

-- Check by data type
SELECT data_type, COUNT(*) as count 
FROM live_stock_data 
GROUP BY data_type;

-- Check sample gainers
SELECT symbol, company_name, last_price, percent_change, data_type 
FROM live_stock_data 
WHERE data_type = 'gainers' 
ORDER BY percent_change DESC 
LIMIT 10;

-- Check sample decliners
SELECT symbol, company_name, last_price, percent_change, data_type 
FROM live_stock_data 
WHERE data_type = 'decliners' 
ORDER BY percent_change ASC 
LIMIT 10;

-- Check if data has company names
SELECT COUNT(*) as total,
       COUNT(company_name) as with_name,
       COUNT(*) - COUNT(company_name) as missing_name
FROM live_stock_data;
```

## Logging Locations

### Backend Logs
- Excel file read: `[Excel File]` prefix
- Sync job: `[Excel File Sync]` prefix
- Database: `[Stock Data]` prefix
- API routes: `[Trading Routes]` prefix

### Frontend Logs
- API calls: `[TRADING]` prefix
- Discover screen: `[Discover]` prefix

## Testing Checklist

- [ ] Excel file exists at correct path
- [ ] Excel file has data (not empty)
- [ ] Excel file has correct sheet names
- [ ] Sync job is running (check logs)
- [ ] Database connection is working
- [ ] Database tables exist
- [ ] Data is inserted into database
- [ ] API endpoint returns data
- [ ] Frontend receives data
- [ ] Frontend displays data correctly

## Next Steps After Diagnostics

1. **If Step 1 fails:** Fix Excel file path/permissions
2. **If Step 2 fails:** Fix Excel file structure/format
3. **If Step 3 fails:** Fix MySQL connection
4. **If Step 4 fails:** Run table initialization
5. **If Step 5 fails:** Check data_type values in database
6. **If Step 6 fails:** Check formatStockData function
7. **If Step 7 fails:** Check API response structure
8. **If Step 8 fails:** Check sync job initialization

