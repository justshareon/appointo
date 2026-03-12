/**
 * Bidirectional Database Sync Service
 * Syncs data between in-memory and MySQL databases
 * 
 * Usage:
 * - Sync in-memory → MySQL: syncToMySQL()
 * - Sync MySQL → in-memory: syncFromMySQL()
 * - Full bidirectional sync: syncBidirectional()
 */

const db = require('../database');
const LOG = require('../utils/logger');
const mysql = require('mysql2/promise');

class BidirectionalSyncService {
    constructor() {
        this.isSyncing = false;
        this.lastSyncTime = null;
        this.syncDirection = null; // 'to_mysql', 'from_mysql', 'bidirectional'
    }

    /**
     * Get MySQL connection pool
     */
    getPool() {
        return db.getPool();
    }

    /**
     * Get in-memory database
     */
    getInMemoryDb() {
        // inMemoryDb is exported as db.inMemoryDb
        return db.inMemoryDb || db;
    }

    /**
     * Sync all data from in-memory to MySQL
     */
    async syncToMySQL() {
        if (this.isSyncing) {
            LOG.warning('[Bidirectional Sync] Sync already in progress, skipping...');
            return { success: false, message: 'Sync already in progress' };
        }

        const pool = this.getPool();
        if (!pool) {
            LOG.warning('[Bidirectional Sync] MySQL not available, cannot sync to MySQL');
            return { success: false, message: 'MySQL not available' };
        }

        try {
            this.isSyncing = true;
            this.syncDirection = 'to_mysql';
            LOG.info('[Bidirectional Sync] ========================================');
            LOG.info('[Bidirectional Sync] Starting sync: In-Memory → MySQL');
            LOG.info('[Bidirectional Sync] ========================================');

            const inMemoryDb = this.getInMemoryDb();
            const connection = await pool.getConnection();
            await connection.beginTransaction();

            const syncResult = {
                users: 0,
                vendors: 0,
                products: 0,
                orders: 0,
                queues: 0,
                appointments: 0,
                settings: 0,
                matchmaking_templates: 0,
                activities: 0,
                errors: []
            };

            try {
                // 1. SYNC USERS
                LOG.info('[Bidirectional Sync] Syncing users...');
                const [existingUsers] = await connection.query('SELECT * FROM users');
                const existingUserIds = new Set(existingUsers.map(u => u.id));

                for (const u of inMemoryDb.users || []) {
                    try {
                        if (existingUserIds.has(u.id)) {
                            await connection.query(
                                `UPDATE users SET name=?, email=?, mobile=?, role=?, location_name=? WHERE id=?`,
                                [u.name, u.email, u.mobile, u.role, u.location_name || null, u.id]
                            );
                        } else {
                            await connection.query(
                                `INSERT INTO users (id, name, email, mobile, role, location_name, created_at) 
                                 VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                                [u.id, u.name, u.email, u.mobile, u.role, u.location_name || null]
                            );
                        }
                        syncResult.users++;
                    } catch (err) {
                        syncResult.errors.push(`User ${u.id}: ${err.message}`);
                        LOG.warning(`[Bidirectional Sync] Error syncing user ${u.id}:`, err.message);
                    }
                }
                LOG.success(`[Bidirectional Sync] Synced ${syncResult.users} users`);

                // 2. SYNC VENDORS
                LOG.info('[Bidirectional Sync] Syncing vendors...');
                for (const v of inMemoryDb.vendors || []) {
                    try {
                        await connection.query(
                            `INSERT INTO vendors (
                                id, owner_id, shop_name, category, is_active, is_promoted, latitude, longitude, 
                                google_link, instagram_handle, facebook_link, 
                                features_products, features_payments, features_appointments, features_queue, 
                                features_matchmaking, features_trade, features_offer, features_qless, 
                                features_fleet, features_realestate, features_cyber,
                                gateway_razorpay, gateway_sabpaisa,
                                visibility_top_rated, visibility_list, visibility_feed
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON DUPLICATE KEY UPDATE 
                                shop_name=VALUES(shop_name), category=VALUES(category), is_active=VALUES(is_active),
                                features_queue=VALUES(features_queue), features_appointments=VALUES(features_appointments),
                                features_products=VALUES(features_products), features_payments=VALUES(features_payments),
                                features_matchmaking=VALUES(features_matchmaking),
                                features_trade=VALUES(features_trade), features_offer=VALUES(features_offer),
                                features_qless=VALUES(features_qless), features_fleet=VALUES(features_fleet), 
                                features_realestate=VALUES(features_realestate), features_cyber=VALUES(features_cyber),
                                gateway_razorpay=VALUES(gateway_razorpay), gateway_sabpaisa=VALUES(gateway_sabpaisa),
                                visibility_top_rated=VALUES(visibility_top_rated), visibility_list=VALUES(visibility_list), 
                                visibility_feed=VALUES(visibility_feed)`,
                            [
                                v.id, v.owner_id, v.shop_name, v.category, v.is_active || true, v.is_promoted || false,
                                v.latitude || 0, v.longitude || 0, v.google_link || '', v.instagram_handle || '', v.facebook_link || '',
                                v.features_products || false, v.features_payments || false, v.features_appointments || false,
                                v.features_queue || false, v.features_matchmaking || false,
                                v.features_trade || false, v.features_offer || false, v.features_qless || false,
                                v.features_fleet || false, v.features_realestate || false, v.features_cyber || false,
                                v.gateway_razorpay || false, v.gateway_sabpaisa || false,
                                v.visibility_top_rated !== false, v.visibility_list !== false, v.visibility_feed !== false
                            ]
                        );
                        syncResult.vendors++;
                    } catch (err) {
                        syncResult.errors.push(`Vendor ${v.id}: ${err.message}`);
                        LOG.warning(`[Bidirectional Sync] Error syncing vendor ${v.id}:`, err.message);
                    }
                }
                LOG.success(`[Bidirectional Sync] Synced ${syncResult.vendors} vendors`);

                // 3. SYNC PRODUCTS
                LOG.info('[Bidirectional Sync] Syncing products...');
                for (const p of inMemoryDb.products || []) {
                    try {
                        const imageUrlsJson = JSON.stringify(p.image_urls || []);
                        await connection.query(
                            `INSERT INTO products (id, vendor_id, name, price, offer, offer_amount, validity_from, validity_to, image_urls_json)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                             ON DUPLICATE KEY UPDATE 
                                name=VALUES(name), price=VALUES(price), offer=VALUES(offer), 
                                offer_amount=VALUES(offer_amount), image_urls_json=VALUES(image_urls_json)`,
                            [p.id, p.vendor_id, p.name, p.price, p.offer || '', p.offer_amount || 0,
                             p.validity_from || null, p.validity_to || null, imageUrlsJson]
                        );
                        syncResult.products++;
                    } catch (err) {
                        syncResult.errors.push(`Product ${p.id}: ${err.message}`);
                        LOG.warning(`[Bidirectional Sync] Error syncing product ${p.id}:`, err.message);
                    }
                }
                LOG.success(`[Bidirectional Sync] Synced ${syncResult.products} products`);

                // 4. SYNC ORDERS
                LOG.info('[Bidirectional Sync] Syncing orders...');
                const [existingOrders] = await connection.query('SELECT * FROM orders');
                const existingOrderIds = new Set(existingOrders.map(o => o.id));

                for (const o of inMemoryDb.orders || []) {
                    try {
                        if (existingOrderIds.has(o.id)) {
                            await connection.query(
                                `UPDATE orders SET vendor_id=?, user_id=?, total_amount=? WHERE id=?`,
                                [o.vendor_id, o.user_id, o.total_amount, o.id]
                            );
                        } else {
                            await connection.query(
                                `INSERT INTO orders (id, vendor_id, user_id, total_amount, created_at)
                                 VALUES (?, ?, ?, ?, ?)`,
                                [o.id, o.vendor_id, o.user_id, o.total_amount, o.created_at || new Date()]
                            );
                        }
                        syncResult.orders++;
                    } catch (err) {
                        syncResult.errors.push(`Order ${o.id}: ${err.message}`);
                        LOG.warning(`[Bidirectional Sync] Error syncing order ${o.id}:`, err.message);
                    }
                }
                LOG.success(`[Bidirectional Sync] Synced ${syncResult.orders} orders`);

                // 5. SYNC QUEUES
                LOG.info('[Bidirectional Sync] Syncing queues...');
                const [existingQueues] = await connection.query('SELECT * FROM queues');
                const existingQueueIds = new Set(existingQueues.map(q => q.id));

                for (const q of inMemoryDb.queues || []) {
                    try {
                        if (existingQueueIds.has(q.id)) {
                            await connection.query(
                                `UPDATE queues SET vendor_id=?, user_id=?, status=? WHERE id=?`,
                                [q.vendor_id, q.user_id, q.status, q.id]
                            );
                        } else {
                            await connection.query(
                                `INSERT INTO queues (id, vendor_id, user_id, status, joined_at)
                                 VALUES (?, ?, ?, ?, ?)`,
                                [q.id, q.vendor_id, q.user_id, q.status, q.joined_at || new Date()]
                            );
                        }
                        syncResult.queues++;
                    } catch (err) {
                        syncResult.errors.push(`Queue ${q.id}: ${err.message}`);
                        LOG.warning(`[Bidirectional Sync] Error syncing queue ${q.id}:`, err.message);
                    }
                }
                LOG.success(`[Bidirectional Sync] Synced ${syncResult.queues} queues`);

                // 6. SYNC APPOINTMENTS
                LOG.info('[Bidirectional Sync] Syncing appointments...');
                const [existingAppointments] = await connection.query('SELECT * FROM appointments');
                const existingAppointmentIds = new Set(existingAppointments.map(a => a.id));

                for (const a of inMemoryDb.appointments || []) {
                    try {
                        if (existingAppointmentIds.has(a.id)) {
                            await connection.query(
                                `UPDATE appointments SET vendor_id=?, user_id=?, date=?, time=?, status=? WHERE id=?`,
                                [a.vendor_id, a.user_id, a.date, a.time, a.status, a.id]
                            );
                        } else {
                            await connection.query(
                                `INSERT INTO appointments (id, vendor_id, user_id, date, time, status, created_at)
                                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                [a.id, a.vendor_id, a.user_id, a.date, a.time, a.status, a.created_at || new Date()]
                            );
                        }
                        syncResult.appointments++;
                    } catch (err) {
                        syncResult.errors.push(`Appointment ${a.id}: ${err.message}`);
                        LOG.warning(`[Bidirectional Sync] Error syncing appointment ${a.id}:`, err.message);
                    }
                }
                LOG.success(`[Bidirectional Sync] Synced ${syncResult.appointments} appointments`);

                // 7. SYNC SETTINGS
                LOG.info('[Bidirectional Sync] Syncing system settings...');
                await connection.query(`
                    CREATE TABLE IF NOT EXISTS system_settings (
                        key_name VARCHAR(50) PRIMARY KEY, 
                        value VARCHAR(10)
                    )
                `);
                for (const [key, val] of Object.entries(inMemoryDb.settings || {})) {
                    try {
                        await connection.query(
                            'INSERT INTO system_settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value=VALUES(value)',
                            [key, String(val)]
                        );
                        syncResult.settings++;
                    } catch (err) {
                        syncResult.errors.push(`Setting ${key}: ${err.message}`);
                        LOG.warning(`[Bidirectional Sync] Error syncing setting ${key}:`, err.message);
                    }
                }
                LOG.success(`[Bidirectional Sync] Synced ${syncResult.settings} settings`);

                // 8. SYNC MATCHMAKING TEMPLATES
                LOG.info('[Bidirectional Sync] Syncing matchmaking templates...');
                await connection.query(`
                    CREATE TABLE IF NOT EXISTS matchmaking_templates (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        vendor_id VARCHAR(64) NOT NULL UNIQUE,
                        template_name VARCHAR(255) NOT NULL,
                        selected_preset VARCHAR(120) NOT NULL,
                        template_json LONGTEXT NOT NULL,
                        scoring_json LONGTEXT NOT NULL,
                        is_active BOOLEAN DEFAULT TRUE,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                    )
                `);
                for (const t of inMemoryDb.matchmaking_templates || []) {
                    try {
                        await connection.query(
                            `INSERT INTO matchmaking_templates (vendor_id, template_name, selected_preset, template_json, scoring_json, is_active)
                             VALUES (?, ?, ?, ?, ?, ?)
                             ON DUPLICATE KEY UPDATE
                                template_name=VALUES(template_name),
                                selected_preset=VALUES(selected_preset),
                                template_json=VALUES(template_json),
                                scoring_json=VALUES(scoring_json),
                                is_active=VALUES(is_active)`,
                            [
                                t.vendor_id,
                                t.template_name,
                                t.selected_preset || 'custom',
                                typeof t.template_json === 'string' ? t.template_json : JSON.stringify(t.template_json || []),
                                typeof t.scoring_json === 'string' ? t.scoring_json : JSON.stringify(t.scoring_json || {}),
                                t.is_active !== false ? 1 : 0
                            ]
                        );
                        syncResult.matchmaking_templates++;
                    } catch (err) {
                        syncResult.errors.push(`Template ${t.vendor_id}: ${err.message}`);
                        LOG.warning(`[Bidirectional Sync] Error syncing template ${t.vendor_id}:`, err.message);
                    }
                }
                LOG.success(`[Bidirectional Sync] Synced ${syncResult.matchmaking_templates} matchmaking templates`);

                // 9. SYNC ACTIVITIES
                LOG.info('[Bidirectional Sync] Syncing activities...');
                await connection.query(`
                    CREATE TABLE IF NOT EXISTS activities (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        type VARCHAR(50),
                        vendor_id VARCHAR(64),
                        userId VARCHAR(64),
                        userName VARCHAR(255),
                        message TEXT,
                        timestamp DATETIME,
                        reactions_json TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                for (const a of inMemoryDb.activities || []) {
                    try {
                        const reactionsJson = JSON.stringify(a.reactions || {});
                        await connection.query(
                            `INSERT INTO activities (id, type, vendor_id, userId, userName, message, timestamp, reactions_json)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                             ON DUPLICATE KEY UPDATE
                                type=VALUES(type), message=VALUES(message), reactions_json=VALUES(reactions_json)`,
                            [a.id, a.type, a.vendor_id, a.userId, a.userName, a.message, a.timestamp || new Date(), reactionsJson]
                        );
                        syncResult.activities++;
                    } catch (err) {
                        syncResult.errors.push(`Activity ${a.id}: ${err.message}`);
                        LOG.warning(`[Bidirectional Sync] Error syncing activity ${a.id}:`, err.message);
                    }
                }
                LOG.success(`[Bidirectional Sync] Synced ${syncResult.activities} activities`);

                await connection.commit();
                this.lastSyncTime = new Date().toISOString();

                LOG.success('[Bidirectional Sync] ========================================');
                LOG.success('[Bidirectional Sync] ✅ Sync to MySQL completed successfully!');
                LOG.success(`[Bidirectional Sync] Users: ${syncResult.users}, Vendors: ${syncResult.vendors}, Products: ${syncResult.products}`);
                LOG.success(`[Bidirectional Sync] Orders: ${syncResult.orders}, Queues: ${syncResult.queues}, Appointments: ${syncResult.appointments}`);
                LOG.success(`[Bidirectional Sync] Settings: ${syncResult.settings}, Templates: ${syncResult.matchmaking_templates}, Activities: ${syncResult.activities}`);
                if (syncResult.errors.length > 0) {
                    LOG.warning(`[Bidirectional Sync] ⚠️ ${syncResult.errors.length} errors occurred during sync`);
                }
                LOG.success('[Bidirectional Sync] ========================================');

                return {
                    success: true,
                    direction: 'to_mysql',
                    result: syncResult,
                    lastSyncTime: this.lastSyncTime
                };

            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }

        } catch (error) {
            LOG.error('[Bidirectional Sync] ❌ Sync to MySQL failed:', error);
            return {
                success: false,
                direction: 'to_mysql',
                error: error.message
            };
        } finally {
            this.isSyncing = false;
            this.syncDirection = null;
        }
    }

    /**
     * Sync all data from MySQL to in-memory
     */
    async syncFromMySQL() {
        if (this.isSyncing) {
            LOG.warning('[Bidirectional Sync] Sync already in progress, skipping...');
            return { success: false, message: 'Sync already in progress' };
        }

        const pool = this.getPool();
        if (!pool) {
            LOG.warning('[Bidirectional Sync] MySQL not available, cannot sync from MySQL');
            return { success: false, message: 'MySQL not available' };
        }

        try {
            this.isSyncing = true;
            this.syncDirection = 'from_mysql';
            LOG.info('[Bidirectional Sync] ========================================');
            LOG.info('[Bidirectional Sync] Starting sync: MySQL → In-Memory');
            LOG.info('[Bidirectional Sync] ========================================');

            const inMemoryDb = this.getInMemoryDb();
            const connection = await pool.getConnection();

            const syncResult = {
                users: 0,
                vendors: 0,
                products: 0,
                orders: 0,
                queues: 0,
                appointments: 0,
                settings: 0,
                matchmaking_templates: 0,
                activities: 0,
                errors: []
            };

            try {
                // 1. SYNC USERS
                LOG.info('[Bidirectional Sync] Loading users from MySQL...');
                const [users] = await connection.query('SELECT * FROM users');
                inMemoryDb.users = users.map(u => ({
                    id: u.id,
                    name: u.name,
                    email: u.email,
                    mobile: u.mobile,
                    role: u.role,
                    location_name: u.location_name || null
                }));
                syncResult.users = users.length;
                LOG.success(`[Bidirectional Sync] Loaded ${syncResult.users} users from MySQL`);

                // 2. SYNC VENDORS
                LOG.info('[Bidirectional Sync] Loading vendors from MySQL...');
                const [vendors] = await connection.query('SELECT * FROM vendors');
                inMemoryDb.vendors = vendors.map(v => ({
                    id: v.id,
                    owner_id: v.owner_id,
                    shop_name: v.shop_name,
                    category: v.category,
                    is_active: v.is_active,
                    is_promoted: v.is_promoted,
                    latitude: v.latitude || 0,
                    longitude: v.longitude || 0,
                    google_link: v.google_link || '',
                    instagram_handle: v.instagram_handle || '',
                    facebook_link: v.facebook_link || '',
                    features_products: v.features_products || false,
                    features_payments: v.features_payments || false,
                    features_appointments: v.features_appointments || false,
                    features_queue: v.features_queue || false,
                    features_matchmaking: v.features_matchmaking || false,
                    features_trade: v.features_trade || false,
                    features_offer: v.features_offer || false,
                    features_qless: v.features_qless || false,
                    features_fleet: v.features_fleet || false,
                    features_realestate: v.features_realestate || false,
                    features_cyber: v.features_cyber || false,
                    gateway_razorpay: v.gateway_razorpay || false,
                    gateway_sabpaisa: v.gateway_sabpaisa || false,
                    visibility_top_rated: v.visibility_top_rated !== 0,
                    visibility_list: v.visibility_list !== 0,
                    visibility_feed: v.visibility_feed !== 0
                }));
                syncResult.vendors = vendors.length;
                LOG.success(`[Bidirectional Sync] Loaded ${syncResult.vendors} vendors from MySQL`);

                // 3. SYNC PRODUCTS
                LOG.info('[Bidirectional Sync] Loading products from MySQL...');
                const [products] = await connection.query('SELECT * FROM products');
                inMemoryDb.products = products.map(p => ({
                    id: p.id,
                    vendor_id: p.vendor_id,
                    name: p.name,
                    price: p.price,
                    offer: p.offer || '',
                    offer_amount: p.offer_amount || 0,
                    validity_from: p.validity_from,
                    validity_to: p.validity_to,
                    image_urls: p.image_urls_json ? JSON.parse(p.image_urls_json) : []
                }));
                syncResult.products = products.length;
                LOG.success(`[Bidirectional Sync] Loaded ${syncResult.products} products from MySQL`);

                // 4. SYNC ORDERS
                LOG.info('[Bidirectional Sync] Loading orders from MySQL...');
                const [orders] = await connection.query('SELECT * FROM orders');
                inMemoryDb.orders = orders.map(o => ({
                    id: o.id,
                    vendor_id: o.vendor_id,
                    user_id: o.user_id,
                    total_amount: o.total_amount,
                    created_at: o.created_at
                }));
                syncResult.orders = orders.length;
                LOG.success(`[Bidirectional Sync] Loaded ${syncResult.orders} orders from MySQL`);

                // 5. SYNC QUEUES
                LOG.info('[Bidirectional Sync] Loading queues from MySQL...');
                const [queues] = await connection.query('SELECT * FROM queues');
                inMemoryDb.queues = queues.map(q => ({
                    id: q.id,
                    vendor_id: q.vendor_id,
                    user_id: q.user_id,
                    status: q.status,
                    joined_at: q.joined_at
                }));
                syncResult.queues = queues.length;
                LOG.success(`[Bidirectional Sync] Loaded ${syncResult.queues} queues from MySQL`);

                // 6. SYNC APPOINTMENTS
                LOG.info('[Bidirectional Sync] Loading appointments from MySQL...');
                const [appointments] = await connection.query('SELECT * FROM appointments');
                inMemoryDb.appointments = appointments.map(a => ({
                    id: a.id,
                    vendor_id: a.vendor_id,
                    user_id: a.user_id,
                    date: a.date,
                    time: a.time,
                    status: a.status,
                    created_at: a.created_at
                }));
                syncResult.appointments = appointments.length;
                LOG.success(`[Bidirectional Sync] Loaded ${syncResult.appointments} appointments from MySQL`);

                // 7. SYNC SETTINGS
                LOG.info('[Bidirectional Sync] Loading settings from MySQL...');
                try {
                    const [settingsRows] = await connection.query('SELECT * FROM system_settings');
                    inMemoryDb.settings = {};
                    for (const row of settingsRows) {
                        const raw = row.value;
                        if (raw === 'true' || raw === '1') {
                            inMemoryDb.settings[row.key_name] = true;
                        } else if (raw === 'false' || raw === '0') {
                            inMemoryDb.settings[row.key_name] = false;
                        } else {
                            inMemoryDb.settings[row.key_name] = raw;
                        }
                    }
                    syncResult.settings = settingsRows.length;
                    LOG.success(`[Bidirectional Sync] Loaded ${syncResult.settings} settings from MySQL`);
                } catch (err) {
                    LOG.warning('[Bidirectional Sync] Settings table may not exist, using defaults');
                    inMemoryDb.settings = {
                        enable_queue: false,
                        enable_appointments: false,
                        enable_shopping: false,
                        enable_email_notifications: true,
                        enable_sms_notifications: true,
                        enable_in_app_notifications: true,
                        enable_pdf_reports: true,
                        enable_news: true,
                        news_user_emails: 'newsuser1',
                        news_vendor_emails: 'newsvendor1',
                        trade_news_source: 'telegram',
                        trade_news_sources: '[{"id":"google-global","type":"rss","enabled":true,"name":"Google News Global","url":"https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"global_news"},{"id":"google-tech","type":"rss","enabled":true,"name":"Google News Technology","url":"https://news.google.com/rss/search?q=technology&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"new_technology"},{"id":"google-sports","type":"rss","enabled":true,"name":"Google News Sports","url":"https://news.google.com/rss/search?q=sports&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"sports"},{"id":"google-travel","type":"rss","enabled":true,"name":"Google News Travel","url":"https://news.google.com/rss/search?q=travel%20deals&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"travel"},{"id":"google-coupons","type":"rss","enabled":true,"name":"Google News Coupons","url":"https://news.google.com/rss/search?q=local%20coupons%20OR%20food%20coupons&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"food_coupons"},{"id":"google-deals","type":"rss","enabled":true,"name":"Google News Deals","url":"https://news.google.com/rss/search?q=deal%20of%20the%20day%20OR%20flash%20sale&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"trending_deals"},{"id":"google-flash-sale","type":"rss","enabled":true,"name":"Google News Flash Sale","url":"https://news.google.com/rss/search?q=flash%20sale%20OR%20limited%20time%20offer%20OR%20mega%20sale&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"trending_offer"},{"id":"slickdeals","type":"rss","enabled":true,"name":"Slickdeals Frontpage","url":"https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1","category":"trending_deals"},{"id":"dealnews","type":"rss","enabled":true,"name":"DealNews","url":"https://www.dealnews.com/rss/","category":"trending_offer"}]',
                        news_grouping_mode: 'category',
                        news_subscribers: '',
                        news_cache_last_updated: '',
                        news_cache_ttl_hours: 24,
                        news_cache_auto_refresh: true,
                        news_cache_cron: '0 */3 * * *',
                        news_default_country: 'IN',
                        news_default_city: 'Delhi',
                        news_default_locality: 'Delhi',
                        news_default_lat: '28.6139',
                        news_default_lng: '77.2090',
                        news_preset_country: 'IN',
                        youtube_latest_rss: 'https://www.youtube.com/feeds/videos.xml?chart=mostPopular&hl=en',
                        enable_trends_for_flash_sale: true,
                        trends_geo: 'IN',
                        trends_rss_template: 'https://trends.google.com/trends/trendingsearches/daily/rss?geo={geo}',
                        newsapi_api_key: '',
                        newsapi_language: 'en',
                        gnews_api_key: '',
                        gnews_language: 'en',
                        gnews_country: '',
                        gdelt_query: 'stock market OR nifty OR sensex OR trading',
                        gdelt_timespan: '1d',
                        gdelt_languages: 'eng',
                        telegram_bot_token: '',
                        telegram_channel: '',
                        telegram_news_categories: 'cyber_threat,entertainment,sports,global_news,new_technology,new_offer,trending_offer,trending_deals,food_coupons,travel,flight,country_visit,other',
                        telegram_news_filters: '{"cyber_threat":["cyber","malware","ransomware","phishing","breach","hack","vulnerability","zero-day","ddos","data leak"],"entertainment":["movie","film","trailer","celebrity","music","tv","series","award","entertainment"],"sports":["sports","match","tournament","league","cricket","football","soccer","tennis","olympic"],"global_news":["global","world","international","geopolitical","diplomatic","united nations","war","summit"],"new_technology":["technology","tech","ai","artificial intelligence","robot","startup","innovation","chip","semiconductor","gadget"],"new_offer":["offer","discount","sale","deal","coupon","cashback"],"trending_offer":["hot deal","limited offer","best offer","flash sale","trending offer"],"trending_deals":["deal of the day","trending deal","mega sale","daily deal"],"food_coupons":["food coupon","food offer","restaurant offer","swiggy","zomato","ubereats","dominos","pizza"],"travel":["travel","tour","holiday","vacation","trip","package","hotel","resort"],"flight":["flight","airline","airfare","ticket","airport","aviation"],"country_visit":["visit","visa","tourist","immigration","country visit","travel advisory"]}',
                        telegram_news_global_filters: '',
                        telegram_news_filter_mode: 'include',
                        telegram_news_per_category_limit: 20,
                        telegram_news_since_hours: 48,
                        telegram_news_limit: 50,
                        notify_on_orders: true,
                        notify_on_appointments: true,
                        notify_on_queue: true,
                        notify_on_queue_status: true,
                        notify_on_queue_leave: true,
                        notify_on_queue_delete: true,
                        notify_on_appointment_status: true,
                        notify_on_appointment_delete: true,
                        notify_on_matchmaking: true,
                        notify_on_subscriptions: true,
                        notify_on_subscription_cancel: true,
                        notify_on_subscription_auto_renew: true,
                        notify_on_vendor_profile: true,
                        notify_on_product_updates: true,
                        notify_email_provider: 'resend',
                        notify_email_from: '',
                        notify_email_recipients: '',
                        notify_email_webhook_url: '',
                        notify_sms_provider: 'textbelt',
                        notify_sms_from: '',
                        notify_sms_recipients: '',
                        notify_sms_webhook_url: ''
                    };
                }

                // 8. SYNC MATCHMAKING TEMPLATES
                LOG.info('[Bidirectional Sync] Loading matchmaking templates from MySQL...');
                try {
                    const [templates] = await connection.query('SELECT * FROM matchmaking_templates');
                    inMemoryDb.matchmaking_templates = templates.map(t => ({
                        vendor_id: t.vendor_id,
                        template_name: t.template_name,
                        selected_preset: t.selected_preset,
                        template_json: typeof t.template_json === 'string' ? JSON.parse(t.template_json) : t.template_json,
                        scoring_json: typeof t.scoring_json === 'string' ? JSON.parse(t.scoring_json) : t.scoring_json,
                        is_active: t.is_active !== 0
                    }));
                    syncResult.matchmaking_templates = templates.length;
                    LOG.success(`[Bidirectional Sync] Loaded ${syncResult.matchmaking_templates} matchmaking templates from MySQL`);
                } catch (err) {
                    LOG.warning('[Bidirectional Sync] Matchmaking templates table may not exist');
                    inMemoryDb.matchmaking_templates = [];
                }

                // 9. SYNC ACTIVITIES
                LOG.info('[Bidirectional Sync] Loading activities from MySQL...');
                try {
                    const [activities] = await connection.query('SELECT * FROM activities');
                    inMemoryDb.activities = activities.map(a => ({
                        id: a.id,
                        type: a.type,
                        vendor_id: a.vendor_id,
                        userId: a.userId,
                        userName: a.userName,
                        message: a.message,
                        timestamp: a.timestamp,
                        reactions: a.reactions_json ? JSON.parse(a.reactions_json) : {}
                    }));
                    syncResult.activities = activities.length;
                    LOG.success(`[Bidirectional Sync] Loaded ${syncResult.activities} activities from MySQL`);
                } catch (err) {
                    LOG.warning('[Bidirectional Sync] Activities table may not exist');
                    inMemoryDb.activities = [];
                }

                this.lastSyncTime = new Date().toISOString();

                LOG.success('[Bidirectional Sync] ========================================');
                LOG.success('[Bidirectional Sync] ✅ Sync from MySQL completed successfully!');
                LOG.success(`[Bidirectional Sync] Users: ${syncResult.users}, Vendors: ${syncResult.vendors}, Products: ${syncResult.products}`);
                LOG.success(`[Bidirectional Sync] Orders: ${syncResult.orders}, Queues: ${syncResult.queues}, Appointments: ${syncResult.appointments}`);
                LOG.success(`[Bidirectional Sync] Settings: ${syncResult.settings}, Templates: ${syncResult.matchmaking_templates}, Activities: ${syncResult.activities}`);
                LOG.success('[Bidirectional Sync] ========================================');

                return {
                    success: true,
                    direction: 'from_mysql',
                    result: syncResult,
                    lastSyncTime: this.lastSyncTime
                };

            } finally {
                connection.release();
            }

        } catch (error) {
            LOG.error('[Bidirectional Sync] ❌ Sync from MySQL failed:', error);
            return {
                success: false,
                direction: 'from_mysql',
                error: error.message
            };
        } finally {
            this.isSyncing = false;
            this.syncDirection = null;
        }
    }

    /**
     * Full bidirectional sync (MySQL → In-Memory → MySQL)
     * This ensures both databases are in sync
     */
    async syncBidirectional() {
        LOG.info('[Bidirectional Sync] Starting full bidirectional sync...');
        
        // First, sync from MySQL to in-memory (to get latest MySQL data)
        const fromMySQLResult = await this.syncFromMySQL();
        
        if (!fromMySQLResult.success) {
            LOG.warning('[Bidirectional Sync] Failed to sync from MySQL, attempting to sync to MySQL only...');
            return await this.syncToMySQL();
        }
        
        // Then, sync from in-memory back to MySQL (to ensure MySQL has all in-memory data)
        const toMySQLResult = await this.syncToMySQL();
        
        return {
            success: fromMySQLResult.success && toMySQLResult.success,
            fromMySQL: fromMySQLResult,
            toMySQL: toMySQLResult
        };
    }

    /**
     * Get sync status
     */
    getSyncStatus() {
        return {
            isSyncing: this.isSyncing,
            lastSyncTime: this.lastSyncTime,
            syncDirection: this.syncDirection
        };
    }
}

module.exports = new BidirectionalSyncService();

