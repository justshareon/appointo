/**
 * Trigger Cyber Sync via API (uses running server's connection)
 * Run: node backend/trigger_sync_via_api.js
 */
require('dotenv').config();
const http = require('http');

async function triggerSync() {
    console.log('\n=== Triggering Cyber Sync via API ===\n');
    
    // Check if local server is running
    const isLocalUp = await new Promise((resolve) => {
        const req = http.get('http://localhost:5000/health', { timeout: 2000 }, (res) => {
            resolve(true);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
    });
    
    if (!isLocalUp) {
        console.error('✗ Local server is not running on port 5000');
        console.error('   Start your server first: npm start (in backend folder)');
        process.exit(1);
    }
    
    console.log('✓ Local server is running\n');
    console.log('⚠️  To sync cyber users, you need to:');
    console.log('   1. Login as Super Admin (9999999999)');
    console.log('   2. Call: POST http://localhost:5000/api/admin/sync-cyber');
    console.log('   3. Include JWT token in Authorization header\n');
    console.log('   OR use curl:');
    console.log('   curl -X POST http://localhost:5000/api/admin/sync-cyber \\');
    console.log('        -H "Authorization: Bearer YOUR_JWT_TOKEN" \\');
    console.log('        -H "Content-Type: application/json"\n');
    console.log('   OR simply restart your server - sync runs automatically on startup!\n');
    
    process.exit(0);
}

triggerSync();

