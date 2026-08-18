#!/usr/bin/env node

/**
 * SYNC MANAGEMENT CLI
 * Easy command-line tool for managing in-memory to MySQL sync
 * 
 * Usage:
 *   node syncManager.js all              # Full sync
 *   node syncManager.js status           # Check status
 *   node syncManager.js users            # Sync users only
 *   node syncManager.js vendors          # Sync vendors only
 *   node syncManager.js products         # Sync products only
 *   node syncManager.js orders           # Sync orders only
 *   node syncManager.js help             # Show help
 */

const axios = require('axios');
const colors = require('colors');

const API_URL = process.env.API_URL || 'http://localhost:5000';
const COMMAND = process.argv[2] || 'help';

colors.enable();

const log = {
    info: (msg) => console.log(colors.cyan(`ℹ ${msg}`)),
    success: (msg) => console.log(colors.green(`✓ ${msg}`)),
    error: (msg) => console.log(colors.red(`✗ ${msg}`)),
    warn: (msg) => console.log(colors.yellow(`⚠ ${msg}`)),
    header: (msg) => console.log(colors.bold.blue(`\n═══ ${msg} ═══\n`))
};

async function callApi(endpoint, method = 'GET') {
    try {
        const config = { method, url: `${API_URL}${endpoint}` };
        const response = await axios(config);
        return { success: true, data: response.data };
    } catch (err) {
        return {
            success: false,
            error: err.response?.data || err.message
        };
    }
}

async function syncAll() {
    log.header('Full Sync');
    log.info('Triggering full in-memory to MySQL sync...');
    
    const result = await callApi('/api/sync/all', 'POST');
    
    if (result.success) {
        const { status, startedAt, completedAt } = result.data;
        log.success(`Sync ${status}!`);
        
        if (startedAt && completedAt) {
            const duration = new Date(completedAt) - new Date(startedAt);
            log.info(`Duration: ${(duration / 1000).toFixed(2)}s`);
            log.info(`Started: ${startedAt}`);
            log.info(`Completed: ${completedAt}`);
        }
    } else {
        log.error(`Sync failed: ${result.error.message || result.error}`);
        process.exit(1);
    }
}

async function syncEntity(entity) {
    log.header(`Sync ${entity.toUpperCase()}`);
    log.info(`Syncing ${entity}...`);
    
    const result = await callApi(`/api/sync/${entity}`, 'POST');
    
    if (result.success) {
        const { status, itemsSynced } = result.data;
        log.success(`${status}! Synced ${itemsSynced} items`);
    } else {
        log.error(`Sync failed: ${result.error.message || result.error}`);
        process.exit(1);
    }
}

async function checkStatus() {
    log.header('Sync Status');
    
    const result = await callApi('/api/sync/status');
    
    if (result.success) {
        const { isSyncing, lastSyncTime, lastSyncStatus } = result.data;
        
        log.info(`Currently syncing: ${isSyncing ? 'YES' : 'NO'}`);
        
        if (lastSyncTime) {
            log.info(`Last sync: ${lastSyncTime}`);
            
            if (lastSyncStatus) {
                const { status, startedAt, completedAt } = lastSyncStatus;
                log.info(`Status: ${status}`);
                
                if (startedAt && completedAt) {
                    const duration = new Date(completedAt) - new Date(startedAt);
                    log.info(`Duration: ${(duration / 1000).toFixed(2)}s`);
                }
            }
        } else {
            log.warn('No sync has run yet');
        }
    } else {
        log.error(`Failed to get status: ${result.error.message || result.error}`);
        log.warn('Is the backend server running on ' + API_URL + '?');
        process.exit(1);
    }
}

function showHelp() {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║              SYNC MANAGEMENT CLI                           ║
║         In-Memory to MySQL Sync Manager                    ║
╚════════════════════════════════════════════════════════════╝

USAGE:
  node syncManager.js <command> [options]

COMMANDS:
  all                 Sync all in-memory data to MySQL
  status              Check sync status and history
  users               Sync users only
  vendors             Sync vendors only
  products            Sync products only
  orders              Sync orders only
  help                Show this help message

EXAMPLES:
  node syncManager.js all          # Full sync
  node syncManager.js status       # Check status
  node syncManager.js users        # Sync users
  
ENVIRONMENT VARIABLES:
  API_URL             Backend API URL (default: http://localhost:5000)

EXAMPLES WITH CUSTOM URL:
  API_URL=http://prod.example.com node syncManager.js status
  API_URL=http://192.168.1.100:5000 node syncManager.js all

─────────────────────────────────────────────────────────────

For detailed information, see SYNC_GUIDE.md
    `);
}

// Main execution
(async () => {
    switch (COMMAND.toLowerCase()) {
        case 'all':
            await syncAll();
            break;
        
        case 'status':
            await checkStatus();
            break;
        
        case 'users':
        case 'vendors':
        case 'products':
        case 'orders':
            await syncEntity(COMMAND.toLowerCase());
            break;
        
        case 'help':
        case '-h':
        case '--help':
            showHelp();
            break;
        
        default:
            log.error(`Unknown command: ${COMMAND}`);
            console.log(`\nUse 'node syncManager.js help' for usage information\n`);
            process.exit(1);
    }
})();
