/**
 * Manual Sync - Forces sync using server's database connection
 * This will work if server is running with MySQL connection
 */
require('dotenv').config();

// Force MySQL mode
process.env.DB_TYPE = 'mysql';

const db = require('./database');

async function manualSync() {
    console.log('\n=== Manual Cyber Sync ===\n');
    
    // Wait a moment for connection
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const dbType = db.getType();
    console.log(`Database type: ${dbType}\n`);
    
    if (dbType !== 'mysql') {
        console.error('✗ Cannot sync - database type is not MySQL');
        console.error('   Make sure DB_TYPE=mysql in .env and server is using MySQL\n');
        process.exit(1);
    }
    
    const pool = db.getPool();
    if (!pool) {
        console.error('✗ MySQL pool not available');
        console.error('   Server might not be connected to MySQL yet');
        console.error('   Wait a few seconds and try again\n');
        process.exit(1);
    }
    
    console.log('✓ MySQL connection available\n');
    
    if (!db.ensureCyberUsersAndVendor) {
        console.error('✗ ensureCyberUsersAndVendor function not found');
        process.exit(1);
    }
    
    try {
        console.log('Running ensureCyberUsersAndVendor...');
        await db.ensureCyberUsersAndVendor();
        console.log('✓ Sync completed\n');
        
        // Verify
        const [users] = await pool.query('SELECT id, name FROM users WHERE id IN (?, ?)', ['usr_cyber1', 'usr_cybervendor1']);
        const [vendors] = await pool.query('SELECT id, shop_name, features_cyber FROM vendors WHERE id = ?', ['v_cyber1']);
        
        console.log(`Users synced: ${users.length}/2`);
        console.log(`Vendor synced: ${vendors.length}/1`);
        
        if (vendors.length > 0 && vendors[0].features_cyber === 1) {
            console.log('\n✅ SUCCESS: Cyber users and vendor are now in MySQL!');
        }
        
        console.log('\n');
    } catch (error) {
        console.error('\n✗ Error:', error.message);
        process.exit(1);
    }
    
    setTimeout(() => process.exit(0), 1000);
}

manualSync();

