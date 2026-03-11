/**
 * Diagnostic script to check if cyber users and vendor exist in database
 * Run: node check_cyber_users.js
 */
require('dotenv').config();
const db = require('./database');

async function checkCyberUsers() {
    console.log('\n=== Cyber Users & Vendor Diagnostic ===\n');
    
    console.log('1. Checking database type...');
    const dbType = db.getType();
    console.log(`   Database type: ${dbType}\n`);
    
    if (dbType === 'inmemory') {
        console.log('2. Checking in-memory database...');
        try {
            const cyberUser1 = await db.getUserById('usr_cyber1');
            const cyberVendor1 = await db.getUserById('usr_cybervendor1');
            const cyberVendor = await db.getVendorById('v_cyber1');
            
            console.log(`   usr_cyber1: ${cyberUser1 ? '✓ Found' : '✗ NOT FOUND'}`);
            if (cyberUser1) {
                console.log(`      - Name: ${cyberUser1.name}`);
                console.log(`      - Email: ${cyberUser1.email}`);
                console.log(`      - Mobile: ${cyberUser1.mobile}`);
            }
            
            console.log(`   usr_cybervendor1: ${cyberVendor1 ? '✓ Found' : '✗ NOT FOUND'}`);
            if (cyberVendor1) {
                console.log(`      - Name: ${cyberVendor1.name}`);
                console.log(`      - Email: ${cyberVendor1.email}`);
                console.log(`      - Mobile: ${cyberVendor1.mobile}`);
            }
            
            console.log(`   v_cyber1: ${cyberVendor ? '✓ Found' : '✗ NOT FOUND'}`);
            if (cyberVendor) {
                console.log(`      - Shop Name: ${cyberVendor.shop_name}`);
                console.log(`      - Owner ID: ${cyberVendor.owner_id}`);
                console.log(`      - features_cyber: ${cyberVendor.features_cyber}`);
                console.log(`      - is_active: ${cyberVendor.is_active}`);
                console.log(`      - visibility_list: ${cyberVendor.visibility_list}`);
            }
        } catch (err) {
            console.log(`   ✗ Error: ${err.message}`);
        }
    } else {
        console.log('2. Checking MySQL database...');
        try {
            const pool = db.getPool();
            if (!pool) {
                console.log('   ✗ MySQL pool not available');
                return;
            }
            
            // Check users
            const [users] = await pool.query('SELECT * FROM users WHERE id IN (?, ?)', ['usr_cyber1', 'usr_cybervendor1']);
            console.log(`   Found ${users.length} cyber users in MySQL:`);
            users.forEach(u => {
                console.log(`      - ${u.id}: ${u.name} (${u.email})`);
            });
            
            // Check vendor
            const [vendors] = await pool.query('SELECT * FROM vendors WHERE id = ?', ['v_cyber1']);
            console.log(`   Found ${vendors.length} cyber vendor in MySQL:`);
            if (vendors.length > 0) {
                const v = vendors[0];
                console.log(`      - ${v.id}: ${v.shop_name}`);
                console.log(`      - Owner: ${v.owner_id}`);
                console.log(`      - features_cyber: ${v.features_cyber}`);
                console.log(`      - is_active: ${v.is_active}`);
                console.log(`      - visibility_list: ${v.visibility_list}`);
            }
            
            // Try to get vendors with include_cyber
            console.log('\n3. Testing getVendors with include_cyber...');
            const allVendors = await db.getVendors(true, 1, 1000, 'newest', '', true);
            const cyberVendors = allVendors.filter(v => v.features_cyber === true || v.features_cyber === 1 || v.features_cyber === '1');
            console.log(`   Total vendors: ${allVendors.length}`);
            console.log(`   Cyber vendors: ${cyberVendors.length}`);
            if (cyberVendors.length > 0) {
                cyberVendors.forEach(v => {
                    console.log(`      - ${v.id}: ${v.shop_name} (features_cyber: ${v.features_cyber})`);
                });
            } else {
                console.log('   ✗ No cyber vendors found!');
            }
            
            // Run sync manually
            console.log('\n4. Running ensureCyberUsersAndVendor...');
            if (db.ensureCyberUsersAndVendor) {
                await db.ensureCyberUsersAndVendor();
                console.log('   ✓ Sync function executed');
            } else {
                console.log('   ✗ ensureCyberUsersAndVendor function not found');
            }
            
        } catch (err) {
            console.error('   ✗ Error checking MySQL:', err.message);
        }
    }
    
    console.log('\n=== End Diagnostic ===\n');
    process.exit(0);
}

checkCyberUsers().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});

