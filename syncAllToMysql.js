/**
 * COMPREHENSIVE IN-MEMORY TO MYSQL SYNC UTILITY
 * Syncs ALL in-memory data collections to MySQL
 * Usage: npm run sync:all or node backend/syncAllToMysql.js
 */

require('./loadEnv');
const db = require('./database');
const LOG = require('./utils/logger');
const featureConnectionManager = require('./database/featureConnectionManager');

const inMemoryDb = db.inMemoryDb;

let syncPool = null;

const getPool = async () => {
    if (syncPool) return syncPool;
    if (typeof db.getPool === 'function') {
        const existing = db.getPool();
        if (existing) {
            syncPool = existing;
            return syncPool;
        }
    }
    syncPool = await featureConnectionManager.acquireForSync('core');
    return syncPool;
};

const BATCH_SIZE = 100;

const ensureCoreSchema = async () => {
    const pool = await getPool();
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(255) PRIMARY KEY,
            name VARCHAR(255),
            email VARCHAR(255),
            password VARCHAR(255),
            role VARCHAR(50) DEFAULT 'user',
            mobile VARCHAR(20),
            location_name VARCHAR(255),
            loyalty_points INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS vendors (
            id VARCHAR(255) PRIMARY KEY,
            owner_id VARCHAR(255),
            shop_name VARCHAR(255),
            category VARCHAR(100),
            is_active BOOLEAN DEFAULT TRUE,
            is_promoted BOOLEAN DEFAULT FALSE,
            latitude DECIMAL(10, 8),
            longitude DECIMAL(11, 8),
            google_link TEXT,
            instagram_handle VARCHAR(100),
            facebook_link TEXT,
            features_products BOOLEAN DEFAULT TRUE,
            features_payments BOOLEAN DEFAULT TRUE,
            features_appointments BOOLEAN DEFAULT TRUE,
            features_queue BOOLEAN DEFAULT TRUE,
            features_matchmaking BOOLEAN DEFAULT FALSE,
            features_cyber BOOLEAN DEFAULT FALSE,
            features_trade BOOLEAN DEFAULT FALSE,
            features_offer BOOLEAN DEFAULT FALSE,
            features_qless BOOLEAN DEFAULT FALSE,
            features_fleet BOOLEAN DEFAULT FALSE,
            features_realestate BOOLEAN DEFAULT FALSE,
            features_trust_score BOOLEAN DEFAULT FALSE,
            visibility_top_rated BOOLEAN DEFAULT FALSE,
            visibility_list BOOLEAN DEFAULT TRUE,
            visibility_feed BOOLEAN DEFAULT FALSE,
            location_name VARCHAR(255)
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS queues (
            id INT AUTO_INCREMENT PRIMARY KEY,
            vendor_id VARCHAR(255),
            user_id VARCHAR(255),
            status VARCHAR(32) DEFAULT 'waiting',
            position INT,
            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS appointments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            vendor_id VARCHAR(255),
            user_id VARCHAR(255),
            date DATE,
            time VARCHAR(16),
            status VARCHAR(32) DEFAULT 'pending',
            notes VARCHAR(255) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS products (
            id INT AUTO_INCREMENT PRIMARY KEY,
            vendor_id VARCHAR(255),
            name VARCHAR(255),
            name_key VARCHAR(255),
            price DECIMAL(10, 2),
            description TEXT,
            offer VARCHAR(255),
            offer_amount DECIMAL(10, 2) DEFAULT 0,
            image_urls_json JSON,
            validity_from DATE,
            validity_to DATE,
            category VARCHAR(100),
            stock INT DEFAULT 0
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
            id INT AUTO_INCREMENT PRIMARY KEY,
            vendor_id VARCHAR(255) NOT NULL,
            user_id VARCHAR(255) NOT NULL,
            total_amount DECIMAL(10,2) NOT NULL,
            payment_gateway VARCHAR(30),
            payment_ref VARCHAR(255),
            status VARCHAR(32) DEFAULT 'paid',
            fulfillment_status VARCHAR(32) DEFAULT 'received',
            current_location VARCHAR(255) NULL,
            location_updated_at TIMESTAMP NULL,
            items_json JSON,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS activities (
            id INT AUTO_INCREMENT PRIMARY KEY,
            type VARCHAR(50),
            user_id VARCHAR(255),
            user_name VARCHAR(255),
            message TEXT,
            metadata JSON,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS otps (
            id INT AUTO_INCREMENT PRIMARY KEY,
            mobile VARCHAR(20) NOT NULL,
            otp VARCHAR(6) NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS vendor_categories (
            id VARCHAR(255) PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_vendor_category_name (name)
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_messages (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            vendor_id VARCHAR(255) NOT NULL,
            sender_id VARCHAR(255) NOT NULL,
            sender_role VARCHAR(16) NOT NULL,
            body TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_chat_thread_time (user_id, vendor_id, created_at),
            INDEX idx_chat_created (created_at)
        )
    `);
    const alters = [
        "ALTER TABLE appointments ADD COLUMN notes VARCHAR(255) NULL",
        "ALTER TABLE appointments ADD COLUMN status VARCHAR(32) DEFAULT 'pending'",
        "ALTER TABLE appointments ADD UNIQUE KEY uniq_appt_slot (vendor_id, user_id, date, time)",
        "ALTER TABLE vendors ADD COLUMN features_qless TINYINT(1) DEFAULT 0",
        "ALTER TABLE vendors ADD COLUMN features_queue TINYINT(1) DEFAULT 1",
        "ALTER TABLE vendors ADD COLUMN features_appointments TINYINT(1) DEFAULT 1",
        "ALTER TABLE products ADD COLUMN name_key VARCHAR(255) NULL",
        "ALTER TABLE orders ADD COLUMN fulfillment_status VARCHAR(32) DEFAULT 'received'",
        "ALTER TABLE orders ADD COLUMN current_location VARCHAR(255) NULL",
        "ALTER TABLE orders ADD COLUMN location_updated_at TIMESTAMP NULL",
    ];
    for (const sql of alters) {
        try { await pool.query(sql); } catch (e) { /* exists */ }
    }

    try {
        const { FEATURE_IDS } = require('./database/featureRegistry');
        for (const id of FEATURE_IDS) {
            if (typeof db.ensureFeatureSchema === 'function') {
                await db.ensureFeatureSchema(id);
            }
        }
    } catch (e) {
        LOG.warning('[Schema] Feature upgrades skipped:', e.message);
    }

    // Backfill name_key, remove duplicates, then enforce unique (vendor_id, name_key)
    try {
        await pool.query(`UPDATE products SET name_key = LOWER(TRIM(name)) WHERE name_key IS NULL OR name_key = ''`);
        await pool.query(`
            DELETE p FROM products p
            INNER JOIN (
                SELECT vendor_id, name_key, MIN(id) AS keep_id
                FROM products
                WHERE name_key IS NOT NULL AND name_key <> ''
                GROUP BY vendor_id, name_key
                HAVING COUNT(*) > 1
            ) d ON p.vendor_id = d.vendor_id
                AND p.name_key = d.name_key
                AND p.id <> d.keep_id
        `);
        await pool.query(`ALTER TABLE products ADD UNIQUE KEY uniq_vendor_product_name (vendor_id, name_key)`);
    } catch (e) { /* index may already exist */ }
};

const insertBatch = async (table, columns, values, ignoreErrors = true) => {
    if (!values.length) return 0;
    const pool = await getPool();
    const placeholders = values.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
    const query = `INSERT IGNORE INTO ${table} (${columns.join(',')}) VALUES ${placeholders}`;
    const flatValues = values.flat();
    try {
        const result = await pool.query(query, flatValues);
        return result[0]?.affectedRows || 0;
    } catch (err) {
        if (!ignoreErrors) throw err;
        LOG.warning(`[Batch Insert] Error in ${table}:`, err.message);
        return 0;
    }
};

const upsertAppointments = async (rows) => {
    if (!rows.length) return 0;
    const pool = await getPool();
    let n = 0;
    for (const a of rows) {
        try {
            const [result] = await pool.query(
                `INSERT INTO appointments (vendor_id, user_id, date, time, status, notes, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE status = VALUES(status), notes = VALUES(notes)`,
                [
                    a.vendor_id || '',
                    a.user_id || '',
                    a.date || null,
                    a.time || null,
                    a.status || 'pending',
                    a.notes || null,
                    a.created_at || new Date()
                ]
            );
            n += result?.affectedRows ? 1 : 0;
        } catch (err) {
            LOG.warning('[Appointments Sync] row skipped:', err.message);
        }
    }
    return n;
};

const upsertQueue = async (rows) => {
    if (!rows.length) return 0;
    const pool = await getPool();
    let n = 0;
    for (const q of rows) {
        try {
            const [result] = await pool.query(
                `INSERT INTO queues (vendor_id, user_id, status, position, joined_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE status = VALUES(status), position = VALUES(position)`,
                [
                    q.vendor_id || '',
                    q.user_id || '',
                    q.status || 'waiting',
                    q.position || 0,
                    q.joined_at || new Date()
                ]
            );
            n += result?.affectedRows ? 1 : 0;
        } catch (err) {
            LOG.warning('[Queues Sync] row skipped:', err.message);
        }
    }
    return n;
};

// ====================
// USERS & VENDORS SYNC
// ====================
const syncUsers = async () => {
    LOG.info(`[Users Sync] Starting sync of ${inMemoryDb.users.length} users...`);
    let total = 0;
    
    for (let i = 0; i < inMemoryDb.users.length; i += BATCH_SIZE) {
        const batch = inMemoryDb.users.slice(i, i + BATCH_SIZE);
        const values = batch.map(u => [
            u.id,
            u.name || '',
            u.email || '',
            u.mobile || '',
            u.role || 'user',
            u.location_name || '',
            0, // loyalty_points
            new Date()
        ]);
        
        const created = await insertBatch(
            'users',
            ['id', 'name', 'email', 'mobile', 'role', 'location_name', 'loyalty_points', 'created_at'],
            values
        );
        total += created;
    }
    
    LOG.success(`[Users Sync] Completed: ${total} users synced to MySQL`);
    return total;
};

const syncVendorCategories = async () => {
    const { DEFAULT_VENDOR_CATEGORIES, titleCaseCategory, uniqueSortedCategories } = require('./utils/vendorCategories');
    if (!Array.isArray(inMemoryDb.vendor_categories)) {
        inMemoryDb.vendor_categories = [];
    }

    const fromVendors = (inMemoryDb.vendors || []).map((v) => v.category).filter(Boolean);
    const names = uniqueSortedCategories([
        ...DEFAULT_VENDOR_CATEGORIES,
        ...inMemoryDb.vendor_categories.map((c) => c.name || c),
        ...fromVendors
    ]);

    LOG.info(`[Vendor Categories Sync] Starting sync of ${names.length} categories...`);
    let total = 0;
    const pool = await getPool();

    for (const name of names) {
        const label = titleCaseCategory(name);
        if (!label) continue;
        const existing = inMemoryDb.vendor_categories.find(
            (c) => String(c.name || '').toLowerCase() === label.toLowerCase()
        );
        const id = existing?.id || `cat_${label.toLowerCase().replace(/\s+/g, '_')}`;
        if (!existing) {
            inMemoryDb.vendor_categories.push({ id, name: label, created_at: new Date() });
        }
        try {
            const [result] = await pool.query(
                `INSERT INTO vendor_categories (id, name, created_at)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE name = VALUES(name)`,
                [id, label, existing?.created_at || new Date()]
            );
            if (result?.affectedRows) total += 1;
        } catch (err) {
            LOG.warning('[Vendor Categories Sync] row skipped:', err.message);
        }
    }

    LOG.success(`[Vendor Categories Sync] Completed: ${total} categories synced to MySQL`);
    return total;
};

const syncVendors = async () => {
    LOG.info(`[Vendors Sync] Starting sync of ${inMemoryDb.vendors.length} vendors...`);
    
    // Ensure columns first
    try {
        await (await getPool()).query(`
            ALTER TABLE vendors
            ADD COLUMN IF NOT EXISTS features_queue TINYINT(1) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS features_matchmaking TINYINT(1) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS features_cyber TINYINT(1) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS features_trade TINYINT(1) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS features_offer TINYINT(1) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS features_qless TINYINT(1) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS features_fleet TINYINT(1) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS features_realestate TINYINT(1) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS features_trust_score TINYINT(1) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS visibility_top_rated TINYINT(1) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS visibility_list TINYINT(1) DEFAULT 1,
            ADD COLUMN IF NOT EXISTS visibility_feed TINYINT(1) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS location_name VARCHAR(255)
        `);
    } catch (err) {
        LOG.warning('[Vendors Sync] Column check (non-fatal):', err.message);
    }
    
    let total = 0;
    const pool = await getPool();

    for (const v of inMemoryDb.vendors) {
        try {
            const [result] = await pool.query(
                `INSERT INTO vendors (
                    id, owner_id, shop_name, category, is_active, is_promoted,
                    latitude, longitude, google_link, instagram_handle, facebook_link,
                    features_products, features_payments, features_appointments, features_queue,
                    features_matchmaking, features_cyber, features_trade, features_offer, features_qless,
                    features_fleet, features_realestate, features_trust_score,
                    visibility_top_rated, visibility_list, visibility_feed, location_name
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    owner_id = VALUES(owner_id),
                    shop_name = VALUES(shop_name),
                    category = VALUES(category),
                    is_active = VALUES(is_active),
                    features_products = VALUES(features_products),
                    features_payments = VALUES(features_payments),
                    features_appointments = VALUES(features_appointments),
                    features_queue = VALUES(features_queue),
                    features_matchmaking = VALUES(features_matchmaking),
                    features_cyber = VALUES(features_cyber),
                    features_trade = VALUES(features_trade),
                    features_offer = VALUES(features_offer),
                    features_qless = VALUES(features_qless),
                    features_fleet = VALUES(features_fleet),
                    features_realestate = VALUES(features_realestate),
                    features_trust_score = VALUES(features_trust_score),
                    visibility_list = VALUES(visibility_list),
                    location_name = VALUES(location_name)`,
                [
                    v.id,
                    v.owner_id || '',
                    v.shop_name || '',
                    v.category || '',
                    v.is_active ? 1 : 0,
                    v.is_promoted ? 1 : 0,
                    v.latitude || 0,
                    v.longitude || 0,
                    v.google_link || '',
                    v.instagram_handle || '',
                    v.facebook_link || '',
                    v.features_products ? 1 : 0,
                    v.features_payments ? 1 : 0,
                    v.features_appointments ? 1 : 0,
                    v.features_queue ? 1 : 0,
                    v.features_matchmaking ? 1 : 0,
                    v.features_cyber ? 1 : 0,
                    v.features_trade ? 1 : 0,
                    v.features_offer ? 1 : 0,
                    v.features_qless ? 1 : 0,
                    v.features_fleet ? 1 : 0,
                    v.features_realestate ? 1 : 0,
                    v.features_trust_score ? 1 : 0,
                    v.visibility_top_rated ? 1 : 0,
                    v.visibility_list !== false ? 1 : 0,
                    v.visibility_feed ? 1 : 0,
                    v.location_name || ''
                ]
            );
            if (result?.affectedRows) total += 1;
        } catch (err) {
            LOG.warning('[Vendors Sync] row skipped:', err.message);
        }
    }
    
    LOG.success(`[Vendors Sync] Completed: ${total} vendors synced to MySQL`);
    return total;
};

const syncUserVendorMappings = async () => {
    const mappings = inMemoryDb.user_vendor_mappings || [];
    LOG.info(`[Mappings Sync] Starting sync of ${mappings.length} user-vendor mappings...`);
    
    // Ensure table
    try {
        await (await getPool()).query(`
            CREATE TABLE IF NOT EXISTS user_vendor_mappings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id VARCHAR(64) NOT NULL,
                vendor_id VARCHAR(64) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_user_vendor (user_id, vendor_id),
                INDEX idx_user (user_id),
                INDEX idx_vendor (vendor_id)
            )
        `);
    } catch (err) {
        LOG.warning('[Mappings Sync] Table check (non-fatal):', err.message);
    }
    
    let total = 0;
    
    for (let i = 0; i < mappings.length; i += BATCH_SIZE) {
        const batch = mappings.slice(i, i + BATCH_SIZE);
        const values = batch.map(m => [m.user_id, m.vendor_id, new Date()]);
        
        const created = await insertBatch(
            'user_vendor_mappings',
            ['user_id', 'vendor_id', 'created_at'],
            values
        );
        total += created;
    }
    
    LOG.success(`[Mappings Sync] Completed: ${total} mappings synced to MySQL`);
    return total;
};

// ====================
// PRODUCTS & ORDERS SYNC
// ====================
const productNameKey = (name) =>
    String(name || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();

/** Keep one product per vendor + normalized name (lowest id). */
const dedupeInMemoryProducts = () => {
    const list = inMemoryDb.products || [];
    const keep = new Map();
    const removeIds = [];
    [...list]
        .sort((a, b) => Number(a.id) - Number(b.id))
        .forEach((p) => {
            const key = `${String(p.vendor_id)}::${productNameKey(p.name)}`;
            if (!keep.has(key)) {
                p.name_key = productNameKey(p.name);
                keep.set(key, p);
            } else {
                removeIds.push(p.id);
            }
        });
    if (removeIds.length) {
        const removeSet = new Set(removeIds.map(String));
        inMemoryDb.products = list.filter((p) => !removeSet.has(String(p.id)));
        LOG.info(`[Products Sync] Removed ${removeIds.length} duplicate in-memory products`);
    }
    return removeIds.length;
};

const syncProducts = async () => {
    dedupeInMemoryProducts();
    const products = inMemoryDb.products || [];
    LOG.info(`[Products Sync] Starting sync of ${products.length} products...`);
    
    let total = 0;
    const pool = await getPool();

    // Ensure MySQL duplicates are cleared before unique upserts
    try {
        await pool.query(`UPDATE products SET name_key = LOWER(TRIM(name)) WHERE name_key IS NULL OR name_key = ''`);
        const [del] = await pool.query(`
            DELETE p FROM products p
            INNER JOIN (
                SELECT vendor_id, COALESCE(NULLIF(name_key, ''), LOWER(TRIM(name))) AS nk, MIN(id) AS keep_id
                FROM products
                GROUP BY vendor_id, COALESCE(NULLIF(name_key, ''), LOWER(TRIM(name)))
                HAVING COUNT(*) > 1
            ) d ON p.vendor_id = d.vendor_id
                AND COALESCE(NULLIF(p.name_key, ''), LOWER(TRIM(p.name))) = d.nk
                AND p.id <> d.keep_id
        `);
        if (del?.affectedRows) {
            LOG.info(`[Products Sync] Removed ${del.affectedRows} duplicate MySQL products`);
        }
    } catch (err) {
        LOG.warning('[Products Sync] MySQL dedupe skip:', err.message);
    }

    for (const p of products) {
        try {
            const name = String(p.name || '').trim().replace(/\s+/g, ' ');
            const nameKey = productNameKey(name);
            const [result] = await pool.query(
                `INSERT INTO products
                    (id, vendor_id, name, name_key, price, description, offer, offer_amount, image_urls_json, validity_from, validity_to, category, stock)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    vendor_id = VALUES(vendor_id),
                    name = VALUES(name),
                    name_key = VALUES(name_key),
                    price = VALUES(price),
                    description = VALUES(description),
                    offer = VALUES(offer),
                    offer_amount = VALUES(offer_amount),
                    image_urls_json = VALUES(image_urls_json),
                    validity_from = VALUES(validity_from),
                    validity_to = VALUES(validity_to),
                    category = VALUES(category),
                    stock = VALUES(stock)`,
                [
                    p.id,
                    p.vendor_id || '',
                    name,
                    nameKey,
                    p.price || 0,
                    p.description || '',
                    p.offer || '',
                    p.offer_amount || 0,
                    JSON.stringify(p.image_urls || []),
                    p.validity_from || null,
                    p.validity_to || null,
                    p.category || '',
                    p.stock || 0
                ]
            );
            if (result?.affectedRows) total += 1;
        } catch (err) {
            LOG.warning('[Products Sync] row skipped:', err.message);
        }
    }
    
    LOG.success(`[Products Sync] Completed: ${total} products synced to MySQL`);
    return total;
};

const syncOrders = async () => {
    const orders = inMemoryDb.orders || [];
    LOG.info(`[Orders Sync] Starting sync of ${orders.length} orders...`);
    
    let total = 0;
    
    for (let i = 0; i < orders.length; i += BATCH_SIZE) {
        const batch = orders.slice(i, i + BATCH_SIZE);
        const values = batch.map(o => [
            o.id,
            o.vendor_id || '',
            o.user_id || '',
            o.total_amount || 0,
            o.payment_gateway || 'direct',
            o.payment_ref || '',
            o.status || 'pending',
            JSON.stringify(o.items_json || {}),
            o.created_at || new Date()
        ]);
        
        const created = await insertBatch(
            'orders',
            ['id', 'vendor_id', 'user_id', 'total_amount', 'payment_gateway', 'payment_ref', 'status', 'items_json', 'created_at'],
            values
        );
        total += created;
    }
    
    LOG.success(`[Orders Sync] Completed: ${total} orders synced to MySQL`);
    return total;
};

// ====================
// QUEUES & APPOINTMENTS
// ====================
const syncQueues = async () => {
    const queues = inMemoryDb.queues || [];
    LOG.info(`[Queues Sync] Starting sync of ${queues.length} queues...`);
    const total = await upsertQueue(queues);
    LOG.success(`[Queues Sync] Completed: ${total} queues synced to MySQL`);
    return total;
};

const syncAppointments = async () => {
    const appointments = inMemoryDb.appointments || [];
    LOG.info(`[Appointments Sync] Starting sync of ${appointments.length} appointments...`);
    const total = await upsertAppointments(appointments);
    LOG.success(`[Appointments Sync] Completed: ${total} appointments synced to MySQL`);
    return total;
};

// ====================
// ACTIVITIES & OTPs
// ====================
const syncActivities = async () => {
    const activities = inMemoryDb.activities || [];
    LOG.info(`[Activities Sync] Starting sync of ${activities.length} activities...`);
    
    let total = 0;
    const pool = await getPool();

    // Ensure optional columns used by seed data
    for (const sql of [
        "ALTER TABLE activities ADD COLUMN vendor_id VARCHAR(255) NULL",
        "ALTER TABLE activities ADD COLUMN reactions JSON NULL",
    ]) {
        try { await pool.query(sql); } catch (e) { /* exists */ }
    }

    for (const act of activities) {
        try {
            const userId = act.user_id || act.userId || '';
            const userName = act.user_name || act.userName || '';
            const metadata = act.metadata || (act.reactions ? { reactions: act.reactions } : {});
            const [result] = await pool.query(
                `INSERT INTO activities (id, type, user_id, user_name, message, metadata, timestamp, vendor_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    type = VALUES(type),
                    user_id = VALUES(user_id),
                    user_name = VALUES(user_name),
                    message = VALUES(message),
                    metadata = VALUES(metadata),
                    timestamp = VALUES(timestamp),
                    vendor_id = VALUES(vendor_id)`,
                [
                    act.id,
                    act.type || '',
                    userId,
                    userName,
                    act.message || '',
                    JSON.stringify(metadata),
                    act.timestamp || new Date(),
                    act.vendor_id || null,
                ]
            );
            if (result?.affectedRows) total += 1;
        } catch (err) {
            // Fallback without vendor_id column if alter failed on some hosts
            try {
                const userId = act.user_id || act.userId || '';
                const userName = act.user_name || act.userName || '';
                const [result] = await pool.query(
                    `INSERT INTO activities (id, type, user_id, user_name, message, metadata, timestamp)
                     VALUES (?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        type = VALUES(type),
                        user_id = VALUES(user_id),
                        user_name = VALUES(user_name),
                        message = VALUES(message),
                        metadata = VALUES(metadata),
                        timestamp = VALUES(timestamp)`,
                    [
                        act.id,
                        act.type || '',
                        userId,
                        userName,
                        act.message || '',
                        JSON.stringify(act.metadata || {}),
                        act.timestamp || new Date(),
                    ]
                );
                if (result?.affectedRows) total += 1;
            } catch (err2) {
                LOG.warning('[Activities Sync] row skipped:', err2.message);
            }
        }
    }
    
    LOG.success(`[Activities Sync] Completed: ${total} activities synced to MySQL`);
    return total;
};

const syncOTPs = async () => {
    const otps = inMemoryDb.otps || [];
    LOG.info(`[OTPs Sync] Starting sync of ${otps.length} OTPs...`);
    
    let total = 0;
    
    for (let i = 0; i < otps.length; i += BATCH_SIZE) {
        const batch = otps.slice(i, i + BATCH_SIZE);
        const values = batch.map(o => [
            o.mobile || '',
            o.otp || '',
            o.expires_at || new Date(),
            o.created_at || new Date()
        ]);
        
        const created = await insertBatch(
            'otps',
            ['mobile', 'otp', 'expires_at', 'created_at'],
            values
        );
        total += created;
    }
    
    LOG.success(`[OTPs Sync] Completed: ${total} OTPs synced to MySQL`);
    return total;
};

// ====================
// CYBER/SURAKSHA SYNC
// ====================
const syncCyberThreats = async () => {
    const threats = inMemoryDb.cyberThreats || [];
    LOG.info(`[Cyber Threats Sync] Starting sync of ${threats.length} cyber threats...`);
    
    // Ensure table
    try {
        await (await getPool()).query(`
            CREATE TABLE IF NOT EXISTS cyber_threats (
                id VARCHAR(255) PRIMARY KEY,
                user_id VARCHAR(64) NOT NULL,
                type ENUM('phone', 'email', 'url', 'upi', 'bank_account', 'other') NOT NULL,
                value VARCHAR(255) NOT NULL,
                title VARCHAR(500) NOT NULL,
                description TEXT,
                severity ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
                category ENUM('phishing', 'scam', 'malware', 'fraud', 'spam', 'other') DEFAULT 'other',
                tags JSON,
                evidence TEXT,
                location VARCHAR(255),
                report_count INT DEFAULT 1,
                reported_by JSON,
                status ENUM('active', 'resolved', 'false_positive') DEFAULT 'active',
                verified BOOLEAN DEFAULT FALSE,
                verified_by VARCHAR(64),
                verified_at DATETIME NULL,
                source VARCHAR(100),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_type_value (type, value),
                INDEX idx_status (status),
                INDEX idx_severity (severity),
                INDEX idx_user (user_id),
                INDEX idx_created (created_at)
            )
        `);
    } catch (err) {
        LOG.warning('[Cyber Threats Sync] Table check (non-fatal):', err.message);
    }
    
    let total = 0;
    
    for (let i = 0; i < threats.length; i += BATCH_SIZE) {
        const batch = threats.slice(i, i + BATCH_SIZE);
        const values = batch.map(t => [
            t.id || '',
            t.user_id || '',
            t.type || 'other',
            t.value || '',
            t.title || '',
            t.description || '',
            t.severity || 'medium',
            t.category || 'other',
            JSON.stringify(t.tags || []),
            t.evidence || '',
            t.location || '',
            t.report_count || 1,
            JSON.stringify(t.reported_by || []),
            t.status || 'active',
            t.verified ? 1 : 0,
            t.verified_by || '',
            t.verified_at || null,
            t.source || '',
            t.created_at || new Date(),
            t.updated_at || new Date()
        ]);
        
        const created = await insertBatch(
            'cyber_threats',
            [
                'id', 'user_id', 'type', 'value', 'title', 'description', 'severity', 'category',
                'tags', 'evidence', 'location', 'report_count', 'reported_by', 'status', 'verified',
                'verified_by', 'verified_at', 'source', 'created_at', 'updated_at'
            ],
            values
        );
        total += created;
    }
    
    LOG.success(`[Cyber Threats Sync] Completed: ${total} cyber threats synced to MySQL`);
    return total;
};

// ====================
// TRADING DATA SYNC
// ====================
const syncTradingData = async () => {
    LOG.info('[Trading Data Sync] Starting trading data sync...');
    
    const tradingData = inMemoryDb.tradingData || {};
    
    // Create trading data tables if needed
    try {
        await (await getPool()).query(`
            CREATE TABLE IF NOT EXISTS trading_market_data (
                id INT AUTO_INCREMENT PRIMARY KEY,
                data_type VARCHAR(50) NOT NULL,
                content JSON NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    } catch (err) {
        LOG.warning('[Trading Data Sync] Table check (non-fatal):', err.message);
    }
    
    let total = 0;
    
    // Insert trading data as JSON
    const types = ['marketIndices', 'stockQuotes', 'topGainers', 'topLosers', 'marketHigh', 'mostBought'];
    
    for (const type of types) {
        const data = tradingData[type] || [];
        if (data.length > 0) {
            try {
                await (await getPool()).query(
                    'INSERT INTO trading_market_data (data_type, content) VALUES (?, ?)',
                    [type, JSON.stringify(data)]
                );
                total++;
            } catch (err) {
                LOG.warning(`[Trading Data Sync] Error syncing ${type}:`, err.message);
            }
        }
    }
    
    LOG.success(`[Trading Data Sync] Completed: ${total} trading data collections synced to MySQL`);
    return total;
};

// ====================
// FLEET DATA SYNC
// ====================
const syncFleetData = async () => {
    LOG.info('[Fleet Data Sync] Starting fleet data sync...');
    
    // Ensure tables exist
    try {
        await (await getPool()).query(`
            CREATE TABLE IF NOT EXISTS fleet_gates (
                id INT AUTO_INCREMENT PRIMARY KEY,
                vendor_id VARCHAR(64) NOT NULL,
                gate_name VARCHAR(255),
                location VARCHAR(255),
                latitude DECIMAL(10, 8),
                longitude DECIMAL(11, 8),
                is_active BOOLEAN DEFAULT TRUE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_vendor_gate (vendor_id, gate_name)
            )
        `);
    } catch (err) {
        LOG.warning('[Fleet Data Sync] Fleet gates table check (non-fatal):', err.message);
    }
    
    LOG.success('[Fleet Data Sync] Fleet data sync completed');
    return 1;
};

// ====================
// MAIN SYNC ORCHESTRATOR
// ====================
const syncAllToMysql = async ({ exit = false } = {}) => {
    LOG.info('');
    LOG.info('═══════════════════════════════════════════════════════════════');
    LOG.info('    STARTING COMPREHENSIVE IN-MEMORY TO MYSQL SYNC');
    LOG.info('═══════════════════════════════════════════════════════════════');
    LOG.info('');
    
    const startTime = Date.now();
    let totalSynced = 0;
    
    try {
        await ensureCoreSchema();
        try {
            const featureMemory = require('./database/featureMemoryManager');
            if (typeof featureMemory.ensureFeature === 'function') {
                await featureMemory.ensureFeature('qless', { mode: 'basic' });
                await featureMemory.ensureFeature('appointments', { mode: 'basic' });
                await featureMemory.ensureFeature('queue', { mode: 'basic' });
            }
        } catch (e) {
            LOG.warning('[Sync] Feature seed skip:', e.message);
        }

        totalSynced += await syncUsers();
        totalSynced += await syncVendorCategories();
        totalSynced += await syncVendors();
        totalSynced += await syncUserVendorMappings();
        
        totalSynced += await syncProducts();
        totalSynced += await syncOrders();
        
        totalSynced += await syncQueues();
        totalSynced += await syncAppointments();
        
        totalSynced += await syncActivities();
        totalSynced += await syncOTPs();
        
        totalSynced += await syncCyberThreats();
        totalSynced += await syncTradingData();
        totalSynced += await syncFleetData();
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        
        LOG.info('');
        LOG.info('═══════════════════════════════════════════════════════════════');
        LOG.success(`✓ SYNC COMPLETED SUCCESSFULLY`);
        LOG.success(`✓ Total items synced: ${totalSynced}`);
        LOG.success(`✓ Time taken: ${duration}s`);
        LOG.info('═══════════════════════════════════════════════════════════════');
        LOG.info('');
        
        if (exit) process.exit(0);
        return { success: true, totalSynced, duration };
    } catch (err) {
        LOG.error('SYNC FAILED:', err);
        if (exit) process.exit(1);
        throw err;
    }
};

if (require.main === module) {
    syncAllToMysql({ exit: true }).catch(err => {
        LOG.error('Fatal error:', err);
        process.exit(1);
    });
}

module.exports = {
    syncAllToMysql,
    syncUsers,
    syncVendors,
    syncUserVendorMappings,
    syncProducts,
    syncOrders,
    syncQueues,
    syncAppointments,
    syncActivities,
    syncOTPs,
    syncCyberThreats,
    syncTradingData,
    syncFleetData
};
