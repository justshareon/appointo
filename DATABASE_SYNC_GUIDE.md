# Database Sync Guide

This guide explains how to sync data between in-memory and MySQL databases.

## Overview

The bidirectional sync service allows you to:
- **Sync In-Memory → MySQL**: Copy all data from in-memory database to MySQL
- **Sync MySQL → In-Memory**: Load all data from MySQL into in-memory database
- **Bidirectional Sync**: Full sync in both directions to ensure both databases are in sync

## What Gets Synced

The sync service synchronizes the following data:

1. **Users** - All user accounts
2. **Vendors** - All vendor/shop information
3. **Products** - All product listings
4. **Orders** - All order records
5. **Queues** - All queue entries
6. **Appointments** - All appointment bookings
7. **Settings** - System settings
8. **Matchmaking Templates** - Matchmaking questionnaire templates
9. **Activities** - Activity feed entries

## Usage Methods

### Method 1: Command Line Script

```bash
# Sync from in-memory to MySQL
node backend/sync_databases.js to-mysql

# Sync from MySQL to in-memory
node backend/sync_databases.js from-mysql

# Full bidirectional sync (recommended)
node backend/sync_databases.js bidirectional
```

### Method 2: API Endpoints (Requires Authentication)

All sync endpoints require super admin authentication.

#### Sync to MySQL
```bash
POST /api/admin/sync/to-mysql
Authorization: Bearer <token>
```

#### Sync from MySQL
```bash
POST /api/admin/sync/from-mysql
Authorization: Bearer <token>
```

#### Bidirectional Sync
```bash
POST /api/admin/sync/bidirectional
Authorization: Bearer <token>
```

#### Get Sync Status
```bash
GET /api/admin/sync/status
Authorization: Bearer <token>
```

## When to Use Each Sync Direction

### Use `to-mysql` when:
- You've been working with in-memory database and want to persist data to MySQL
- You've made changes in development and want to sync to production MySQL
- You want to backup in-memory data to MySQL

### Use `from-mysql` when:
- You want to load production data into in-memory for local development
- You've made changes in MySQL and want to sync to in-memory
- You're switching from MySQL to in-memory mode

### Use `bidirectional` when:
- You want to ensure both databases are fully in sync
- You're unsure which database has the latest data
- You want to merge data from both sources

## Sync Behavior

### Sync to MySQL
- **Updates** existing records if they exist (preserves `created_at` timestamps)
- **Inserts** new records that don't exist
- Uses transactions to ensure data consistency
- Preserves MySQL data that doesn't exist in in-memory (doesn't delete)

### Sync from MySQL
- **Replaces** in-memory data with MySQL data
- Loads all records from MySQL tables
- Handles missing tables gracefully (uses defaults)
- Preserves in-memory structure

### Bidirectional Sync
1. First syncs MySQL → In-Memory (loads latest MySQL data)
2. Then syncs In-Memory → MySQL (ensures MySQL has all in-memory data)
3. Ensures both databases end up with the same data

## Example Workflows

### Development Workflow
```bash
# 1. Start with in-memory database (default)
npm start

# 2. Make changes, test locally

# 3. When ready, sync to MySQL
node backend/sync_databases.js to-mysql

# 4. Switch to MySQL mode
# Edit backend/.env: DB_TYPE=mysql
# Restart server
```

### Production Workflow
```bash
# 1. Working with MySQL in production
# DB_TYPE=mysql in .env

# 2. Make changes via API or direct MySQL

# 3. Sync to in-memory for local testing
node backend/sync_databases.js from-mysql

# 4. Test locally with in-memory

# 5. Sync back to MySQL
node backend/sync_databases.js to-mysql
```

### Full Sync Workflow
```bash
# Ensure both databases are in sync
node backend/sync_databases.js bidirectional
```

## Error Handling

The sync service handles errors gracefully:
- **Missing tables**: Creates them automatically
- **Missing columns**: Uses defaults or skips gracefully
- **Data conflicts**: Updates existing records, inserts new ones
- **Connection errors**: Returns clear error messages

## Logging

All sync operations are logged with:
- `[Bidirectional Sync]` prefix
- Detailed progress for each table
- Success/failure summary
- Error details if any occur

## Notes

- **Transactions**: Sync to MySQL uses database transactions for atomicity
- **Performance**: Large datasets may take time; be patient
- **Backup**: Always backup MySQL before syncing if you have important data
- **Testing**: Test sync operations in development before using in production

## Troubleshooting

### "MySQL not available"
- Ensure `DB_TYPE=mysql` in `backend/.env`
- Check MySQL connection settings
- Verify MySQL server is running

### "Sync already in progress"
- Wait for current sync to complete
- Check sync status: `GET /api/admin/sync/status`

### "Table doesn't exist"
- Sync service will create missing tables automatically
- If creation fails, check MySQL permissions

### Data not syncing
- Check logs for specific error messages
- Verify table structure matches expected schema
- Ensure data exists in source database

## API Response Examples

### Success Response
```json
{
  "success": true,
  "message": "Sync to MySQL completed successfully",
  "result": {
    "users": 25,
    "vendors": 12,
    "products": 45,
    "orders": 150,
    "queues": 8,
    "appointments": 30,
    "settings": 3,
    "matchmaking_templates": 2,
    "activities": 50,
    "errors": []
  },
  "lastSyncTime": "2024-01-15T10:30:00.000Z"
}
```

### Error Response
```json
{
  "success": false,
  "error": "MySQL not available",
  "message": "MySQL connection pool not initialized"
}
```

