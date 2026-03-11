/**
 * Direct MySQL Sync Script for Cyber Users and Vendor
 * Connects directly to MySQL and inserts/updates data
 * Run: node backend/sync_cyber_direct.js
 */
require('dotenv').config();
const mysql = require('mysql2');

async function syncCyberDirect() {
    console.log('\n=== Syncing Cyber Users & Vendor to MySQL (Direct Connection) ===\n');
    
    // Create direct connection
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'root',
        database: process.env.DB_NAME || 'qr_queue',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        ssl: {
            rejectUnauthorized: false
        }
    }).promise();
    
    try {
        // Test connection
        console.log('1. Testing MySQL connection...');
        const [test] = await pool.query('SELECT 1 as test');
        console.log('   ✓ Connected to MySQL\n');
        
        // Cyber Users
        const cyberUsers = [
            { id: 'usr_cyber1', name: 'Cyber User 1', email: 'cyber1@test.com', mobile: '8000000011', role: 'user', location_name: 'Mumbai' },
            { id: 'usr_cybervendor1', name: 'Cyber Vendor 1', email: 'cybervendor1@test.com', mobile: '8000000012', role: 'vendor', location_name: 'Mumbai' }
        ];
        
        console.log('2. Syncing Cyber Users...');
        for (const user of cyberUsers) {
            const [existing] = await pool.query('SELECT id FROM users WHERE id = ?', [user.id]);
            
            if (existing.length === 0) {
                await pool.query(
                    `INSERT INTO users (id, name, email, mobile, role, location_name, created_at) 
                     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                    [user.id, user.name, user.email, user.mobile, user.role, user.location_name]
                );
                console.log(`   ✓ Created user: ${user.id} (${user.name})`);
            } else {
                await pool.query(
                    `UPDATE users SET name=?, email=?, mobile=?, role=?, location_name=? WHERE id=?`,
                    [user.name, user.email, user.mobile, user.role, user.location_name, user.id]
                );
                console.log(`   ✓ Updated user: ${user.id} (${user.name})`);
            }
        }
        
        // Cyber Vendor
        console.log('\n3. Syncing Cyber Vendor...');
        const cyberVendor = {
            id: 'v_cyber1',
            owner_id: 'usr_cybervendor1',
            shop_name: 'Cyber Shop 1',
            category: 'Cyber',
            is_active: 1,
            is_promoted: 0,
            latitude: 0,
            longitude: 0,
            google_link: '',
            instagram_handle: '',
            facebook_link: '',
            features_products: 1,
            features_payments: 1,
            features_appointments: 1,
            features_queue: 1,
            features_matchmaking: 0,
            features_cyber: 1,  // CRITICAL: This must be 1
            visibility_top_rated: 0,
            visibility_list: 1,  // CRITICAL: This must be 1
            visibility_feed: 0
        };
        
        const [existingVendor] = await pool.query('SELECT id FROM vendors WHERE id = ?', [cyberVendor.id]);
        
        if (existingVendor.length === 0) {
            await pool.query(
                `INSERT INTO vendors (
                    id, owner_id, shop_name, category, is_active, is_promoted, 
                    latitude, longitude, google_link, instagram_handle, facebook_link,
                    features_products, features_payments, features_appointments, features_queue,
                    features_matchmaking, features_cyber, visibility_top_rated, visibility_list, visibility_feed
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    cyberVendor.id, cyberVendor.owner_id, cyberVendor.shop_name, cyberVendor.category,
                    cyberVendor.is_active, cyberVendor.is_promoted, cyberVendor.latitude, cyberVendor.longitude,
                    cyberVendor.google_link, cyberVendor.instagram_handle, cyberVendor.facebook_link,
                    cyberVendor.features_products, cyberVendor.features_payments, cyberVendor.features_appointments,
                    cyberVendor.features_queue, cyberVendor.features_matchmaking, cyberVendor.features_cyber,
                    cyberVendor.visibility_top_rated, cyberVendor.visibility_list, cyberVendor.visibility_feed
                ]
            );
            console.log(`   ✓ Created vendor: ${cyberVendor.id} (${cyberVendor.shop_name})`);
        } else {
            await pool.query(
                `UPDATE vendors SET 
                    owner_id=?, shop_name=?, category=?, is_active=?, is_promoted=?,
                    latitude=?, longitude=?, google_link=?, instagram_handle=?, facebook_link=?,
                    features_products=?, features_payments=?, features_appointments=?, features_queue=?,
                    features_matchmaking=?, features_cyber=?, visibility_top_rated=?, visibility_list=?, visibility_feed=?
                WHERE id=?`,
                [
                    cyberVendor.owner_id, cyberVendor.shop_name, cyberVendor.category,
                    cyberVendor.is_active, cyberVendor.is_promoted, cyberVendor.latitude, cyberVendor.longitude,
                    cyberVendor.google_link, cyberVendor.instagram_handle, cyberVendor.facebook_link,
                    cyberVendor.features_products, cyberVendor.features_payments, cyberVendor.features_appointments,
                    cyberVendor.features_queue, cyberVendor.features_matchmaking, cyberVendor.features_cyber,
                    cyberVendor.visibility_top_rated, cyberVendor.visibility_list, cyberVendor.visibility_feed,
                    cyberVendor.id
                ]
            );
            console.log(`   ✓ Updated vendor: ${cyberVendor.id} (${cyberVendor.shop_name})`);
        }
        
        // Verify
        console.log('\n4. Verifying data...');
        const [users] = await pool.query('SELECT id, name, email, mobile, role FROM users WHERE id IN (?, ?)', ['usr_cyber1', 'usr_cybervendor1']);
        const [vendors] = await pool.query('SELECT id, shop_name, owner_id, features_cyber, is_active, visibility_list FROM vendors WHERE id = ?', ['v_cyber1']);
        
        console.log(`   Users found: ${users.length}`);
        users.forEach(u => {
            console.log(`      - ${u.id}: ${u.name} (${u.email})`);
        });
        
        console.log(`   Vendors found: ${vendors.length}`);
        if (vendors.length > 0) {
            const v = vendors[0];
            console.log(`      - ${v.id}: ${v.shop_name}`);
            console.log(`      - Owner: ${v.owner_id}`);
            console.log(`      - features_cyber: ${v.features_cyber} ${v.features_cyber === 1 ? '✓' : '✗'}`);
            console.log(`      - is_active: ${v.is_active} ${v.is_active === 1 ? '✓' : '✗'}`);
            console.log(`      - visibility_list: ${v.visibility_list} ${v.visibility_list === 1 ? '✓' : '✗'}`);
        }
        
        // Test query
        console.log('\n5. Testing vendor query with features_cyber...');
        const [cyberVendorsQuery] = await pool.query(
            'SELECT id, shop_name, features_cyber, is_active, visibility_list FROM vendors WHERE features_cyber = 1'
        );
        console.log(`   Cyber vendors in database: ${cyberVendorsQuery.length}`);
        cyberVendorsQuery.forEach(v => {
            console.log(`      ✓ ${v.id}: ${v.shop_name}`);
        });
        
        console.log('\n=== Sync Complete ===\n');
        console.log('✅ Cyber users and vendor are now in MySQL database');
        console.log('✅ You can now login with:');
        console.log('   - cyber1@test.com / 8000000011 (user)');
        console.log('   - cybervendor1@test.com / 8000000012 (vendor)');
        console.log('\n');
        
    } catch (error) {
        console.error('\n✗ Error syncing to MySQL:', error.message);
        if (error.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error('   Check your MySQL credentials in .env file');
        } else if (error.code === 'ECONNREFUSED') {
            console.error('   Cannot connect to MySQL. Check if MySQL is running and DB_HOST/DB_PORT are correct');
        } else if (error.code === 'ER_BAD_DB_ERROR') {
            console.error('   Database does not exist. Create it first or check DB_NAME in .env');
        }
        console.error('\nFull error:', error);
        process.exit(1);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

syncCyberDirect();

