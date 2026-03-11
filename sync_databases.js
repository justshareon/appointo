/**
 * Database Sync Script
 * Syncs data between in-memory and MySQL databases
 * 
 * Usage:
 *   node backend/sync_databases.js to-mysql      # Sync in-memory → MySQL
 *   node backend/sync_databases.js from-mysql    # Sync MySQL → in-memory
 *   node backend/sync_databases.js bidirectional # Full bidirectional sync
 */

require('dotenv').config({ path: './backend/.env' });
const bidirectionalSyncService = require('./services/bidirectionalSyncService');
const LOG = require('./utils/logger');

const direction = process.argv[2] || 'bidirectional';

async function main() {
    console.log('\n========================================');
    console.log('Database Sync Script');
    console.log('========================================\n');

    try {
        let result;
        
        switch (direction) {
            case 'to-mysql':
                console.log('🔄 Syncing: In-Memory → MySQL\n');
                result = await bidirectionalSyncService.syncToMySQL();
                break;
            
            case 'from-mysql':
                console.log('🔄 Syncing: MySQL → In-Memory\n');
                result = await bidirectionalSyncService.syncFromMySQL();
                break;
            
            case 'bidirectional':
            default:
                console.log('🔄 Syncing: Bidirectional (MySQL ↔ In-Memory)\n');
                result = await bidirectionalSyncService.syncBidirectional();
                break;
        }

        if (result.success) {
            console.log('\n✅ Sync completed successfully!\n');
            process.exit(0);
        } else {
            console.error('\n❌ Sync failed:', result.error || result.message || 'Unknown error');
            process.exit(1);
        }
    } catch (error) {
        console.error('\n❌ Sync error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

main();

