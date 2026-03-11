/**
 * Check what database type the running server is using
 */
require('dotenv').config({ path: './backend/.env' });
const http = require('http');

async function check() {
    console.log('\n=== Checking Server Database Type ===\n');
    
    // Check .env directly
    console.log('From .env file:');
    console.log(`   DB_TYPE: ${process.env.DB_TYPE || 'not set'}`);
    console.log(`   DB_HOST: ${process.env.DB_HOST || 'not set'}`);
    console.log(`   DB_NAME: ${process.env.DB_NAME || 'not set'}\n`);
    
    // Check if server is running
    const isUp = await new Promise((resolve) => {
        const req = http.get('http://localhost:5000/health', { timeout: 2000 }, (res) => {
            resolve(true);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
    });
    
    if (isUp) {
        console.log('✓ Server is running on port 5000\n');
        console.log('The server should be using MySQL if DB_TYPE=mysql in .env');
        console.log('Check your server logs for:');
        console.log('   - "[DB INFO] Connecting to MySQL at..."');
        console.log('   - "[Cyber Sync] Created user: usr_cyber1"');
        console.log('   - "[Cyber Sync] Created vendor: v_cyber1"\n');
        
        if (process.env.DB_TYPE === 'mysql') {
            console.log('✅ DB_TYPE=mysql is set in .env');
            console.log('   The sync should have run when server started.');
            console.log('   If you don\'t see sync messages, check:');
            console.log('   1. MySQL connection is working');
            console.log('   2. Server logs for errors');
            console.log('   3. Run: node backend/sync_cyber_smart.js\n');
        } else {
            console.log('⚠️  DB_TYPE is not set to "mysql"');
            console.log('   Update backend/.env: DB_TYPE=mysql\n');
        }
    } else {
        console.log('✗ Server is not running on port 5000');
        console.log('   Start server first: npm start (in backend folder)\n');
    }
}

check();

