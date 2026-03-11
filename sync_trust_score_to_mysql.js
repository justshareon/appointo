/**
 * Direct MySQL Sync Script for Trust Score Users and Vendor
 * This script directly inserts/updates trust score users and vendor in MySQL
 * Run: node backend/sync_trust_score_to_mysql.js
 */
require('dotenv').config();
const mysql = require('mysql2');
const db = require('./database');

async function syncTrustScoreToMySQL() {
    console.log('\n=== Syncing Trust Score Users & Vendor to MySQL ===\n');
    
    const pool = db.getPool();
    if (!pool) {
        console.error('✗ MySQL pool not available. Make sure DB_TYPE=mysql in .env');
        process.exit(1);
    }
    
    try {
        // Trust Score Users
        const trustScoreUsers = [
            { id: 'usr_trust1', name: 'Trust User 1', email: 'trust1@test.com', mobile: '8000000101', role: 'user', location_name: 'Mumbai' },
            { id: 'usr_trustvendor1', name: 'Trust Vendor 1', email: 'trustvendor1@test.com', mobile: '8000000102', role: 'vendor', location_name: 'Mumbai' }
        ];
        
        console.log('1. Syncing Trust Score Users...');
        for (const user of trustScoreUsers) {
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
        
        // Trust Score Vendor
        console.log('\n2. Syncing Trust Score Vendor...');
        const trustScoreVendor = {
            id: 'v_trust1',
            owner_id: 'usr_trustvendor1',
            shop_name: 'Trust Score Services',
            category: 'Trust Services',
            is_active: 1,
            is_promoted: 0,
            latitude: 19.1136,
            longitude: 72.8697,
            location_name: 'Mumbai',
            google_link: '',
            instagram_handle: '',
            facebook_link: '',
            features_products: 1,  // Match in-memory database
            features_payments: 1,  // Match in-memory database
            features_appointments: 1,  // Match in-memory database
            features_queue: 1,  // Match in-memory database
            features_matchmaking: 0,
            features_trust_score: 1,  // CRITICAL: This must be 1
            visibility_top_rated: 0,
            visibility_list: 1,  // CRITICAL: This must be 1
            visibility_feed: 0
        };
        
        const [existingVendor] = await pool.query('SELECT id FROM vendors WHERE id = ?', [trustScoreVendor.id]);
        
        if (existingVendor.length === 0) {
            await pool.query(
                `INSERT INTO vendors (
                    id, owner_id, shop_name, category, is_active, is_promoted, 
                    latitude, longitude, location_name, google_link, instagram_handle, facebook_link,
                    features_products, features_payments, features_appointments, features_queue,
                    features_matchmaking, features_trust_score, visibility_top_rated, visibility_list, visibility_feed
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    trustScoreVendor.id, trustScoreVendor.owner_id, trustScoreVendor.shop_name, trustScoreVendor.category,
                    trustScoreVendor.is_active, trustScoreVendor.is_promoted, trustScoreVendor.latitude, trustScoreVendor.longitude,
                    trustScoreVendor.location_name, trustScoreVendor.google_link, trustScoreVendor.instagram_handle, trustScoreVendor.facebook_link,
                    trustScoreVendor.features_products, trustScoreVendor.features_payments, trustScoreVendor.features_appointments,
                    trustScoreVendor.features_queue, trustScoreVendor.features_matchmaking, trustScoreVendor.features_trust_score,
                    trustScoreVendor.visibility_top_rated, trustScoreVendor.visibility_list, trustScoreVendor.visibility_feed
                ]
            );
            console.log(`   ✓ Created vendor: ${trustScoreVendor.id} (${trustScoreVendor.shop_name})`);
        } else {
            await pool.query(
                `UPDATE vendors SET 
                    owner_id=?, shop_name=?, category=?, is_active=?, is_promoted=?,
                    latitude=?, longitude=?, location_name=?, google_link=?, instagram_handle=?, facebook_link=?,
                    features_products=?, features_payments=?, features_appointments=?, features_queue=?,
                    features_matchmaking=?, features_trust_score=?, visibility_top_rated=?, visibility_list=?, visibility_feed=?
                WHERE id=?`,
                [
                    trustScoreVendor.owner_id, trustScoreVendor.shop_name, trustScoreVendor.category,
                    trustScoreVendor.is_active, trustScoreVendor.is_promoted, trustScoreVendor.latitude, trustScoreVendor.longitude,
                    trustScoreVendor.location_name, trustScoreVendor.google_link, trustScoreVendor.instagram_handle, trustScoreVendor.facebook_link,
                    trustScoreVendor.features_products, trustScoreVendor.features_payments, trustScoreVendor.features_appointments,
                    trustScoreVendor.features_queue, trustScoreVendor.features_matchmaking, trustScoreVendor.features_trust_score,
                    trustScoreVendor.visibility_top_rated, trustScoreVendor.visibility_list, trustScoreVendor.visibility_feed,
                    trustScoreVendor.id
                ]
            );
            console.log(`   ✓ Updated vendor: ${trustScoreVendor.id} (${trustScoreVendor.shop_name})`);
        }
        
        // Verify
        console.log('\n3. Verifying data...');
        const [users] = await pool.query('SELECT id, name, email, mobile, role FROM users WHERE id IN (?, ?)', ['usr_trust1', 'usr_trustvendor1']);
        const [vendors] = await pool.query('SELECT id, shop_name, owner_id, features_trust_score, is_active, visibility_list FROM vendors WHERE id = ?', ['v_trust1']);
        
        console.log(`   Users found: ${users.length}`);
        users.forEach(u => {
            console.log(`      - ${u.id}: ${u.name} (${u.email})`);
        });
        
        console.log(`   Vendors found: ${vendors.length}`);
        if (vendors.length > 0) {
            const v = vendors[0];
            console.log(`      - ${v.id}: ${v.shop_name}`);
            console.log(`      - Owner: ${v.owner_id}`);
            console.log(`      - features_trust_score: ${v.features_trust_score} ${v.features_trust_score === 1 ? '✓' : '✗'}`);
            console.log(`      - is_active: ${v.is_active} ${v.is_active === 1 ? '✓' : '✗'}`);
            console.log(`      - visibility_list: ${v.visibility_list} ${v.visibility_list === 1 ? '✓' : '✗'}`);
        }
        
        // Test getVendors
        console.log('\n4. Testing getVendors with include_trust_score...');
        const allVendors = await db.getVendors(true, 1, 1000, 'newest', '', true); // includeTradeOffer=true to include service vendors
        const trustScoreVendors = allVendors.filter(v => v.features_trust_score === true || v.features_trust_score === 1 || v.features_trust_score === '1');
        console.log(`   Total vendors returned: ${allVendors.length}`);
        console.log(`   Trust Score vendors found: ${trustScoreVendors.length}`);
        if (trustScoreVendors.length > 0) {
            trustScoreVendors.forEach(v => {
                console.log(`      ✓ ${v.id}: ${v.shop_name} (features_trust_score: ${v.features_trust_score})`);
            });
        } else {
            console.log('      ✗ No trust score vendors found in getVendors result!');
        }
        
        console.log('\n=== Sync Complete ===\n');
        console.log('✅ Trust Score users and vendor are now in MySQL database');
        console.log('✅ You can now login with:');
        console.log('   - trust1@test.com / 8000000101 (user)');
        console.log('   - trustvendor1@test.com / 8000000102 (vendor)');
        console.log('\n');
        
    } catch (error) {
        console.error('\n✗ Error syncing to MySQL:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        // Don't close pool, it's shared
        process.exit(0);
    }
}

syncTrustScoreToMySQL();

