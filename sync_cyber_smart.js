/**
 * Smart Sync - Detects if local server is up, uses local MySQL if up, otherwise remote
 * Run: node backend/sync_cyber_smart.js
 */
require('dotenv').config();
const mysql = require('mysql2');
const http = require('http');

async function checkLocalServer() {
    return new Promise((resolve) => {
        const req = http.get('http://localhost:5000/health', { timeout: 2000 }, (res) => {
            resolve(true);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
    });
}

async function syncSmart() {
    console.log('\n=== Smart Sync: Cyber Users & Vendor ===\n');
    
    // Check if local server is running
    console.log('Checking if local server is running...');
    const isLocalUp = await checkLocalServer();
    
    let dbHost, dbPort, dbUser, dbPassword, dbName, useSSL;
    
    if (isLocalUp) {
        console.log('✓ Local server is UP - Using LOCAL MySQL connection\n');
        dbHost = process.env.DB_HOST || 'localhost';
        dbPort = process.env.DB_PORT || 3306;
        dbUser = process.env.DB_USER || 'root';
        dbPassword = process.env.DB_PASSWORD || 'root';
        dbName = process.env.DB_NAME || 'qr_queue';
        useSSL = false; // Local MySQL usually doesn't use SSL
    } else {
        console.log('⚠️  Local server is DOWN - Using REMOTE MySQL connection\n');
        // Use remote MySQL settings (same as server would use)
        dbHost = process.env.DB_HOST || 'localhost';
        dbPort = process.env.DB_PORT || 3306;
        dbUser = process.env.DB_USER || 'root';
        dbPassword = process.env.DB_PASSWORD || 'root';
        dbName = process.env.DB_NAME || 'qr_queue';
        useSSL = process.env.DB_SSL === 'true' || process.env.DB_HOST?.includes('render') || process.env.DB_HOST?.includes('tidb');
    }
    
    console.log(`Connecting to MySQL:`);
    console.log(`   Host: ${dbHost}`);
    console.log(`   Port: ${dbPort}`);
    console.log(`   Database: ${dbName}`);
    console.log(`   User: ${dbUser}\n`);
    
    const pool = mysql.createPool({
        host: dbHost,
        port: dbPort,
        user: dbUser,
        password: dbPassword,
        database: dbName,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        ssl: useSSL ? {
            rejectUnauthorized: false
        } : false
    }).promise();
    
    try {
        // Test connection
        const [test] = await pool.query('SELECT 1 as test');
        console.log('✓ Connected to MySQL\n');
        
        // Cyber Users
        const cyberUsers = [
            { id: 'usr_cyber1', name: 'Cyber User 1', email: 'cyber1@test.com', mobile: '8000000011', role: 'user', location_name: 'Mumbai' },
            { id: 'usr_cybervendor1', name: 'Cyber Vendor 1', email: 'cybervendor1@test.com', mobile: '8000000012', role: 'vendor', location_name: 'Mumbai' }
        ];
        
        console.log('1. Syncing Cyber Users...');
        for (const user of cyberUsers) {
            const [existing] = await pool.query('SELECT id FROM users WHERE id = ?', [user.id]);
            
            if (existing.length === 0) {
                await pool.query(
                    `INSERT INTO users (id, name, email, mobile, role, location_name, created_at) 
                     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                    [user.id, user.name, user.email, user.mobile, user.role, user.location_name]
                );
                console.log(`   ✓ Created: ${user.id} (${user.name})`);
            } else {
                await pool.query(
                    `UPDATE users SET name=?, email=?, mobile=?, role=?, location_name=? WHERE id=?`,
                    [user.name, user.email, user.mobile, user.role, user.location_name, user.id]
                );
                console.log(`   ✓ Updated: ${user.id} (${user.name})`);
            }
        }
        
        // Cyber Vendor
        console.log('\n2. Syncing Cyber Vendor...');
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
            features_cyber: 1,
            visibility_top_rated: 0,
            visibility_list: 1,
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
            console.log(`   ✓ Created: ${cyberVendor.id} (${cyberVendor.shop_name})`);
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
            console.log(`   ✓ Updated: ${cyberVendor.id} (${cyberVendor.shop_name})`);
        }
        
        // Verify
        console.log('\n3. Verifying...');
        const [users] = await pool.query('SELECT id, name, email FROM users WHERE id IN (?, ?)', ['usr_cyber1', 'usr_cybervendor1']);
        const [vendors] = await pool.query('SELECT id, shop_name, features_cyber, is_active, visibility_list FROM vendors WHERE id = ?', ['v_cyber1']);
        
        console.log(`   Users: ${users.length}/2 ✓`);
        users.forEach(u => console.log(`      - ${u.id}: ${u.name}`));
        
        if (vendors.length > 0) {
            const v = vendors[0];
            console.log(`   Vendor: ✓ ${v.id}: ${v.shop_name}`);
            const allGood = v.features_cyber === 1 && v.is_active === 1 && v.visibility_list === 1;
            console.log(`      features_cyber: ${v.features_cyber} ${v.features_cyber === 1 ? '✓' : '✗'}`);
            console.log(`      is_active: ${v.is_active} ${v.is_active === 1 ? '✓' : '✗'}`);
            console.log(`      visibility_list: ${v.visibility_list} ${v.visibility_list === 1 ? '✓' : '✗'}`);
            if (allGood) {
                console.log('\n✅ SUCCESS: All values are correct!');
            }
        } else {
            console.log('   Vendor: ✗ Not found!');
        }
        
        console.log('\n=== ✅ Sync Complete ===\n');
        console.log('Login with:');
        console.log('   - cyber1@test.com / 8000000011');
        console.log('   - cybervendor1@test.com / 8000000012\n');
        
    } catch (error) {
        console.error('\n✗ Error:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.error('   Cannot connect to MySQL.');
            if (isLocalUp) {
                console.error('   Local server is up but MySQL connection failed.');
                console.error('   Check: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD in .env');
            } else {
                console.error('   Remote MySQL connection failed.');
                console.error('   Check: DB_HOST, DB_PORT, credentials, IP whitelist');
            }
        }
        process.exit(1);
    } finally {
        await pool.end();
    }
}

syncSmart();

