# How to Access Data Trace Endpoint

## Problem
If `/api/trading/data-trace` is redirecting to home screen, you're likely accessing it through the **frontend app** instead of directly to the **backend server**.

## Solution: Access Backend Directly

### Option 1: Direct Browser Access
1. Find your backend server URL (usually `http://localhost:3000` or similar)
2. Open browser and go to:
   ```
   http://localhost:YOUR_PORT/api/trading/data-trace
   ```
3. You should see JSON response (not a redirect)

### Option 2: Using curl (Command Line)
```bash
curl http://localhost:YOUR_PORT/api/trading/data-trace
```

### Option 3: Using Postman or REST Client
1. Method: `GET`
2. URL: `http://localhost:YOUR_PORT/api/trading/data-trace`
3. Headers: None required (no authentication needed)

### Option 4: Test Simple Endpoint First
Try the simple test endpoint:
```
http://localhost:YOUR_PORT/api/trading-data-trace/simple
```

This will confirm the route is accessible.

## Finding Your Backend Port

Check your `.env` file or `backend/server.js` for the port:
- Look for `PORT` environment variable
- Or check where `server.listen()` is called

Common ports:
- `3000` (default)
- `5000`
- `8000`
- `8080`

## Why Redirect Happens

The redirect happens because:
1. **Frontend routing** - React Native/Expo app catches the route
2. **Navigation guard** - App redirects unknown routes to home
3. **Not accessing backend directly** - You need to hit the backend server, not the frontend app

## Correct URLs

✅ **Correct (Backend):**
```
http://localhost:3000/api/trading/data-trace
```

❌ **Wrong (Frontend):**
```
http://localhost:19006/api/trading/data-trace  (Expo dev server)
http://localhost:8081/api/trading/data-trace    (React Native)
```

## Quick Test

1. **Test simple endpoint:**
   ```
   http://localhost:YOUR_PORT/api/trading-data-trace/simple
   ```
   Should return: `{ "success": true, "message": "Data trace endpoint is accessible" }`

2. **If simple works, try full trace:**
   ```
   http://localhost:YOUR_PORT/api/trading/data-trace
   ```

## Alternative: Check Server Logs

If you can't access via browser, check your backend server logs. The endpoint logs everything, so you can see the trace in the console.

Look for:
```
[Data Trace] ========================================
[Data Trace] Starting complete data trace...
[Data Trace] STEP 1: Reading raw Excel data...
```

## Still Having Issues?

1. Make sure backend server is running
2. Check backend server logs for errors
3. Verify the port number
4. Try accessing other trading endpoints first:
   - `http://localhost:YOUR_PORT/api/trading/sync-status`
   - `http://localhost:YOUR_PORT/api/trading/test-data`

If these work, the data-trace endpoint should work too.

