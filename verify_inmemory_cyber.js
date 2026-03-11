/**
 * Verify Cyber Users & Vendor in In-Memory Database
 * Run: node backend/verify_inmemory_cyber.js
 */
require('dotenv').config();

// Force in-memory mode
process.env.DB_TYPE = 'inmemory';

const db = require('./database');

async function verify() {
    console.log('\n=== Verifying Cyber Users & Vendor (In-Memory) ===\n');
    
    const dbType = db.getType();
    console.log(`Database type: ${dbType}\n`);
    
    // Check users
    console.log('1. Checking Users...');
    const user1 = await db.getUserById('usr_cyber1');
    const user2 = await db.getUserById('usr_cybervendor1');
    
    console.log(`   usr_cyber1: ${user1 ? '✓' : '✗'}`);
    if (user1) {
        console.log(`      - Name: ${user1.name}`);
        console.log(`      - Email: ${user1.email}`);
        console.log(`      - Mobile: ${user1.mobile}`);
        console.log(`      - Role: ${user1.role}`);
    }
    
    console.log(`   usr_cybervendor1: ${user2 ? '✓' : '✗'}`);
    if (user2) {
        console.log(`      - Name: ${user2.name}`);
        console.log(`      - Email: ${user2.email}`);
        console.log(`      - Mobile: ${user2.mobile}`);
        console.log(`      - Role: ${user2.role}`);
    }
    
    // Check vendor
    console.log('\n2. Checking Vendor...');
    const vendor = await db.getVendorById('v_cyber1');
    
    console.log(`   v_cyber1: ${vendor ? '✓' : '✗'}`);
    if (vendor) {
        console.log(`      - Shop Name: ${vendor.shop_name}`);
        console.log(`      - Owner ID: ${vendor.owner_id}`);
        console.log(`      - Category: ${vendor.category}`);
        console.log(`      - features_cyber: ${vendor.features_cyber} ${vendor.features_cyber === true ? '✓' : '✗'}`);
        console.log(`      - is_active: ${vendor.is_active} ${vendor.is_active === true ? '✓' : '✗'}`);
        console.log(`      - visibility_list: ${vendor.visibility_list} ${vendor.visibility_list === true ? '✓' : '✗'}`);
    }
    
    // Test getVendors with include_cyber
    console.log('\n3. Testing getVendors API...');
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
            console.log(`      - ${v.id}: ${v.shop_name} (features_cyber: ${v.features_cyber})`);
        });
        console.log('\n✅ SUCCESS: Cyber users and vendor are in in-memory database and visible!');
    } else {
        console.log('   ✗ Cyber vendor not returned by getVendors');
        console.log('   This might be a filtering issue.');
    }
    
    // Test getVendors without include_cyber (should exclude)
    console.log('\n4. Testing getVendors without include_cyber (should exclude)...');
    const regularVendors = await db.getVendors(true, 1, 1000, 'newest', '', false);
    const cyberInRegular = regularVendors.filter(v => 
        v.features_cyber === true || 
        v.features_cyber === 1 || 
        v.features_cyber === '1'
    );
    console.log(`   Regular vendors: ${regularVendors.length}`);
    console.log(`   Cyber vendors in regular list: ${cyberInRegular.length} ${cyberInRegular.length === 0 ? '✓ (correctly excluded)' : '✗ (should be excluded)'}`);
    
    console.log('\n=== Verification Complete ===\n');
    console.log('Login credentials:');
    console.log('   - cyber1@test.com / 8000000011 (user)');
    console.log('   - cybervendor1@test.com / 8000000012 (vendor)\n');
    
    if (user1 && user2 && vendor && cyberVendors.length > 0) {
        console.log('✅ All checks passed! Cyber users and vendor are ready to use.\n');
    } else {
        console.log('⚠️  Some checks failed. Review the output above.\n');
    }
}

verify().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});

