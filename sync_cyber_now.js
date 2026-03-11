/**
 * Sync Cyber Users & Vendor to MySQL using existing connection
 * Uses the same connection logic as the server (local if up, remote if not)
 * Run: node backend/sync_cyber_now.js
 */
require('dotenv').config();

// Import database module (uses existing connection logic)
const db = require('./database');

async function syncNow() {
    console.log('\n=== Syncing Cyber Users & Vendor ===\n');
    
    const dbType = db.getType();
    console.log(`Database type: ${dbType}`);
    
    if (dbType !== 'mysql') {
        console.log('\n⚠️  Database type is not MySQL. Sync only works with MySQL.');
        console.log('   Set DB_TYPE=mysql in .env to enable MySQL sync.\n');
        process.exit(0);
    }
    
    const pool = db.getPool();
    if (!pool) {
        console.log('\n⚠️  MySQL pool not available yet.');
        console.log('   The connection might still be initializing.');
        console.log('   Wait a few seconds and try again, or check your MySQL connection settings.\n');
        process.exit(1);
    }
    
    console.log('✓ MySQL connection available\n');
    
    // Check if ensureCyberUsersAndVendor function exists
    if (!db.ensureCyberUsersAndVendor) {
        console.error('✗ ensureCyberUsersAndVendor function not found');
        process.exit(1);
    }
    
    try {
        console.log('Running ensureCyberUsersAndVendor...');
        await db.ensureCyberUsersAndVendor();
        console.log('✓ Sync completed\n');
        
        // Wait a moment for any async operations
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Verify the data
        console.log('Verifying data...\n');
        
        const [users] = await pool.query(
            'SELECT id, name, email, mobile, role FROM users WHERE id IN (?, ?)', 
            ['usr_cyber1', 'usr_cybervendor1']
        );
        
        console.log(`Users found: ${users.length}`);
        if (users.length > 0) {
            users.forEach(u => {
                console.log(`   ✓ ${u.id}: ${u.name} (${u.email})`);
            });
        } else {
            console.log('   ✗ No cyber users found!');
        }
        
        const [vendors] = await pool.query(
            'SELECT id, shop_name, owner_id, features_cyber, is_active, visibility_list FROM vendors WHERE id = ?', 
            ['v_cyber1']
        );
        
        console.log(`\nVendors found: ${vendors.length}`);
        if (vendors.length > 0) {
            const v = vendors[0];
            console.log(`   ✓ ${v.id}: ${v.shop_name}`);
            console.log(`     - Owner: ${v.owner_id}`);
            console.log(`     - features_cyber: ${v.features_cyber} ${v.features_cyber === 1 ? '✓' : '✗ MUST BE 1'}`);
            console.log(`     - is_active: ${v.is_active} ${v.is_active === 1 ? '✓' : '✗ MUST BE 1'}`);
            console.log(`     - visibility_list: ${v.visibility_list} ${v.visibility_list === 1 ? '✓' : '✗ MUST BE 1'}`);
            
            if (v.features_cyber !== 1 || v.is_active !== 1 || v.visibility_list !== 1) {
                console.log('\n⚠️  WARNING: Vendor has incorrect values. Re-running sync...');
                await db.ensureCyberUsersAndVendor();
                console.log('✓ Re-sync completed');
            }
        } else {
            console.log('   ✗ Cyber vendor not found!');
        }
        
        // Test getVendors to see if it returns the cyber vendor
        console.log('\nTesting getVendors with include_cyber=true...');
        const allVendors = await db.getVendors(true, 1, 1000, 'newest', '', true);
        const cyberVendors = allVendors.filter(v => 
            v.features_cyber === true || 
            v.features_cyber === 1 || 
            v.features_cyber === '1'
        );
        
        console.log(`   Total vendors returned: ${allVendors.length}`);
        console.log(`   Cyber vendors found: ${cyberVendors.length}`);
        
        if (cyberVendors.length > 0) {
            cyberVendors.forEach(v => {
                console.log(`      ✓ ${v.id}: ${v.shop_name} (features_cyber: ${v.features_cyber})`);
            });
            console.log('\n✅ SUCCESS: Cyber users and vendor are synced and visible!');
        } else {
            console.log('\n⚠️  WARNING: Cyber vendor not returned by getVendors');
            console.log('   This might be a filtering issue. Check server logs.');
        }
        
        console.log('\n=== Sync Complete ===\n');
        console.log('Login credentials:');
        console.log('   - cyber1@test.com / 8000000011 (user)');
        console.log('   - cybervendor1@test.com / 8000000012 (vendor)\n');
        
    } catch (error) {
        console.error('\n✗ Error during sync:', error.message);
        if (error.code) {
            console.error(`   Error code: ${error.code}`);
        }
        if (error.sqlMessage) {
            console.error(`   SQL Error: ${error.sqlMessage}`);
        }
        console.error('\nFull error:', error);
        process.exit(1);
    }
    
    // Exit after a short delay to allow logs to flush
    setTimeout(() => process.exit(0), 1000);
}

// Run the sync
syncNow().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

