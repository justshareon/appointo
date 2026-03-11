/**
 * Verify Cyber Users & Vendor Sync
 * Uses the same connection as the running server
 * Run: node backend/verify_cyber_sync.js
 */
require('dotenv').config();
const db = require('./database');

async function verify() {
    console.log('\n=== Verifying Cyber Users & Vendor Sync ===\n');
    
    const dbType = db.getType();
    console.log(`Database type: ${dbType}\n`);
    
    if (dbType !== 'mysql') {
        console.log('⚠️  Database type is not MySQL.');
        console.log('   Cyber users/vendor exist in in-memory database only.');
        console.log('   Set DB_TYPE=mysql in .env to sync to MySQL.\n');
        
        // Check in-memory
        const user1 = await db.getUserById('usr_cyber1');
        const user2 = await db.getUserById('usr_cybervendor1');
        const vendor = await db.getVendorById('v_cyber1');
        
        console.log('In-memory database:');
        console.log(`   usr_cyber1: ${user1 ? '✓' : '✗'}`);
        console.log(`   usr_cybervendor1: ${user2 ? '✓' : '✗'}`);
        console.log(`   v_cyber1: ${vendor ? '✓' : '✗'}`);
        if (vendor) {
            console.log(`      features_cyber: ${vendor.features_cyber}`);
            console.log(`      is_active: ${vendor.is_active}`);
            console.log(`      visibility_list: ${vendor.visibility_list}`);
        }
        process.exit(0);
    }
    
    const pool = db.getPool();
    if (!pool) {
        console.error('✗ MySQL pool not available');
        process.exit(1);
    }
    
    try {
        console.log('Checking MySQL database...\n');
        
        // Check users
        const [users] = await pool.query(
            'SELECT id, name, email, mobile, role FROM users WHERE id IN (?, ?)', 
            ['usr_cyber1', 'usr_cybervendor1']
        );
        
        console.log('Users:');
        if (users.length === 0) {
            console.log('   ✗ No cyber users found in MySQL');
        } else {
            users.forEach(u => {
                console.log(`   ✓ ${u.id}: ${u.name} (${u.email})`);
            });
            if (users.length < 2) {
                console.log(`   ⚠️  Expected 2 users, found ${users.length}`);
            }
        }
        
        // Check vendor
        const [vendors] = await pool.query(
            'SELECT id, shop_name, owner_id, features_cyber, is_active, visibility_list FROM vendors WHERE id = ?', 
            ['v_cyber1']
        );
        
        console.log('\nVendor:');
        if (vendors.length === 0) {
            console.log('   ✗ Cyber vendor not found in MySQL');
            console.log('\n⚠️  Sync may not have completed. Try:');
            console.log('   1. Check server logs for [Cyber Sync] messages');
            console.log('   2. Restart server (sync runs on startup)');
            console.log('   3. Call POST /api/admin/sync-cyber endpoint');
        } else {
            const v = vendors[0];
            console.log(`   ✓ ${v.id}: ${v.shop_name}`);
            console.log(`     Owner: ${v.owner_id}`);
            
            const issues = [];
            if (v.features_cyber !== 1) issues.push('features_cyber must be 1');
            if (v.is_active !== 1) issues.push('is_active must be 1');
            if (v.visibility_list !== 1) issues.push('visibility_list must be 1');
            
            if (issues.length === 0) {
                console.log(`     features_cyber: ${v.features_cyber} ✓`);
                console.log(`     is_active: ${v.is_active} ✓`);
                console.log(`     visibility_list: ${v.visibility_list} ✓`);
                console.log('\n✅ All values are correct!');
            } else {
                console.log(`     features_cyber: ${v.features_cyber} ${v.features_cyber === 1 ? '✓' : '✗'}`);
                console.log(`     is_active: ${v.is_active} ${v.is_active === 1 ? '✓' : '✗'}`);
                console.log(`     visibility_list: ${v.visibility_list} ${v.visibility_list === 1 ? '✓' : '✗'}`);
                console.log('\n⚠️  Issues found:');
                issues.forEach(issue => console.log(`   - ${issue}`));
                console.log('\n   Re-running sync to fix...');
                if (db.ensureCyberUsersAndVendor) {
                    await db.ensureCyberUsersAndVendor();
                    console.log('   ✓ Sync completed. Run this script again to verify.');
                }
            }
        }
        
        // Test getVendors
        console.log('\nTesting getVendors API...');
        const allVendors = await db.getVendors(true, 1, 1000, 'newest', '', true);
        const cyberVendors = allVendors.filter(v => 
            v.features_cyber === true || 
            v.features_cyber === 1 || 
            v.features_cyber === '1'
        );
        
        console.log(`   Total vendors: ${allVendors.length}`);
        console.log(`   Cyber vendors: ${cyberVendors.length}`);
        
        if (cyberVendors.length > 0) {
            console.log('   ✓ Cyber vendor is returned by getVendors');
            cyberVendors.forEach(v => {
                console.log(`      - ${v.id}: ${v.shop_name}`);
            });
            console.log('\n✅ SUCCESS: Cyber users and vendor are synced and visible!');
        } else {
            console.log('   ✗ Cyber vendor not returned by getVendors');
            console.log('   This might be a filtering issue in the query.');
        }
        
        console.log('\n=== Verification Complete ===\n');
        console.log('Login credentials:');
        console.log('   - cyber1@test.com / 8000000011 (user)');
        console.log('   - cybervendor1@test.com / 8000000012 (vendor)\n');
        
    } catch (error) {
        console.error('\n✗ Error:', error.message);
        console.error(error);
        process.exit(1);
    }
    
    setTimeout(() => process.exit(0), 1000);
}

verify();

