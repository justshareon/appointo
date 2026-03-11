# Fix: Cyber Users & Vendor Not Syncing

## Problem
Database type is set to `inmemory` instead of `mysql`, so the sync function doesn't run.

## Solution

### Step 1: Set DB_TYPE in .env

Add or update this line in `backend/.env`:

```env
DB_TYPE=mysql
```

### Step 2: Add MySQL Connection Details

Also add your MySQL connection details in `backend/.env`:

```env
DB_TYPE=mysql
DB_HOST=localhost          # or your remote MySQL host
DB_PORT=3306
DB_USER=root               # your MySQL username
DB_PASSWORD=your_password  # your MySQL password
DB_NAME=qr_queue           # your database name
```

### Step 3: Restart Server

After updating `.env`, restart your server:

```bash
# Stop the server (Ctrl+C)
# Then start again
npm start
```

### Step 4: Verify

After restart, check server logs for:
```
[Cyber Sync] Created user: usr_cyber1 (Cyber User 1)
[Cyber Sync] Created user: usr_cybervendor1 (Cyber Vendor 1)
[Cyber Sync] Created vendor: v_cyber1 (Cyber Shop 1)
[Cyber Sync] Cyber users and vendor synced to MySQL
```

Or run:
```bash
node backend/verify_cyber_sync.js
```

## Current Status

✅ Cyber users and vendor exist in **in-memory database**
❌ They are **NOT** in MySQL (because DB_TYPE=inmemory)

After setting DB_TYPE=mysql and restarting, they will be synced to MySQL automatically.

## If Using Remote MySQL (Render/TiDB)

For remote MySQL, your `.env` should look like:

```env
DB_TYPE=mysql
DB_HOST=your-remote-host.com
DB_PORT=4000
DB_USER=your_username
DB_PASSWORD=your_password
DB_NAME=qr_queue
DB_SSL=true
```

Make sure:
- IP whitelist includes your IP (0.0.0.0/0 for all)
- Credentials are correct
- Database exists

