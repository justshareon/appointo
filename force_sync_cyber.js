/**
 * Force Sync Cyber Users and Vendor to MySQL
 * This uses the ensureCyberUsersAndVendor function from database.js
 * Run this when your server is running OR when DB_TYPE=mysql in .env
 * 
 * Usage:
 *   1. Make sure DB_TYPE=mysql in .env
 *   2. Make sure MySQL connection details are correct in .env
 *   3. Run: node backend/force_sync_cyber.js
 */
require('dotenv').config();

// Set DB_TYPE to mysql if not set
if (!process.env.DB_TYPE) {
    process.env.DB_TYPE = 'mysql';
    console.log('⚠️  DB_TYPE not set, defaulting to mysql');
}

const db = require('./database');

async function forceSync() {
    console.log('\n=== Force Syncing Cyber Users & Vendor ===\n');
    
    const dbType = db.getType();
    console.log(`Database type: ${dbType}\n`);
    
    if (dbType !== 'mysql') {
        console.error('✗ This script requires DB_TYPE=mysql');
        console.error('   Please set DB_TYPE=mysql in your .env file');
        process.exit(1);
    }
    
    if (!db.ensureCyberUsersAndVendor) {
        console.error('✗ ensureCyberUsersAndVendor function not found in database module');
        process.exit(1);
    }
    
    try {
        console.log('Running ensureCyberUsersAndVendor...');
        await db.ensureCyberUsersAndVendor();
        console.log('✓ Sync function completed\n');
        
        // Wait a moment for connection to be ready
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Verify
        console.log('Verifying data...');
        const pool = db.getPool();
        if (pool) {
            const [users] = await pool.query('SELECT id, name, email, mobile, role FROM users WHERE id IN (?, ?)', ['usr_cyber1', 'usr_cybervendor1']);
            const [vendors] = await pool.query('SELECT id, shop_name, owner_id, features_cyber, is_active, visibility_list FROM vendors WHERE id = ?', ['v_cyber1']);
            
            console.log(`\nUsers found: ${users.length}`);
            users.forEach(u => {
                console.log(`   ✓ ${u.id}: ${u.name} (${u.email})`);
            });
            
            console.log(`\nVendors found: ${vendors.length}`);
            if (vendors.length > 0) {
                const v = vendors[0];
                console.log(`   ✓ ${v.id}: ${v.shop_name}`);
                console.log(`     - Owner: ${v.owner_id}`);
                console.log(`     - features_cyber: ${v.features_cyber} ${v.features_cyber === 1 ? '✓' : '✗'}`);
                console.log(`     - is_active: ${v.is_active} ${v.is_active === 1 ? '✓' : '✗'}`);
                console.log(`     - visibility_list: ${v.visibility_list} ${v.visibility_list === 1 ? '✓' : '✗'}`);
            }
            
            // Test getVendors
            console.log('\nTesting getVendors...');
            const allVendors = await db.getVendors(true, 1, 1000, 'newest', '', true);
            const cyberVendors = allVendors.filter(v => v.features_cyber === true || v.features_cyber === 1 || v.features_cyber === '1');
            console.log(`   Total vendors: ${allVendors.length}`);
            console.log(`   Cyber vendors: ${cyberVendors.length}`);
            if (cyberVendors.length > 0) {
                cyberVendors.forEach(v => {
                    console.log(`      ✓ ${v.id}: ${v.shop_name}`);
                });
            }
        }
        
        console.log('\n=== Sync Complete ===\n');
        console.log('✅ Cyber users and vendor should now be in MySQL');
        console.log('✅ Login credentials:');
        console.log('   - cyber1@test.com / 8000000011 (user)');
        console.log('   - cybervendor1@test.com / 8000000012 (vendor)');
        console.log('\n');
        
    } catch (error) {
        console.error('\n✗ Error:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.error('\n⚠️  Cannot connect to MySQL. Options:');
            console.error('   1. Make sure MySQL server is running');
            console.error('   2. Check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD in .env');
            console.error('   3. If using remote MySQL (Render/TiDB), make sure:');
            console.error('      - IP whitelist includes your IP (0.0.0.0/0 for all)');
            console.error('      - Connection details are correct');
            console.error('   4. Try running this script when your server is running');
        }
        console.error('\nFull error:', error);
        process.exit(1);
    }
    
    // Don't exit immediately, let connection close naturally
    setTimeout(() => process.exit(0), 2000);
}

forceSync();

