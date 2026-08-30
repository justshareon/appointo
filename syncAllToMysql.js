/**
 * COMPREHENSIVE IN-MEMORY TO MYSQL SYNC UTILITY
 * Syncs ALL in-memory data collections to MySQL
 * Usage: npm run sync:all or node backend/syncAllToMysql.js
 */

require('./loadEnv');
const db = require('./database');
const LOG = require('./utils/logger');
const featureConnectionManager = require('./database/featureConnectionManager');
const syncStatus = require('./services/syncStatusService');

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

const doneSync = ({ itemsSynced = 0, version = 0, queriesSynced = 0, totalItems = 0 } = {}) => ({
    itemsSynced,
    version,
    queriesSynced,
    totalItems: totalItems || version,
});

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
            features_r_detector BOOLEAN DEFAULT FALSE,
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
const syncUsers = async ({ startOffset = 0, onProgress } = {}) => {
    const users = inMemoryDb.users || [];
    const totalItems = users.length;
    let itemsSynced = 0;
    let queriesSynced = 0;
    if (startOffset > 0) LOG.info(`[Users Sync] Resuming from ${startOffset}/${totalItems}...`);
    else LOG.info(`[Users Sync] Starting sync of ${totalItems} users...`);

    for (let i = startOffset; i < users.length; i += BATCH_SIZE) {
        const batch = users.slice(i, i + BATCH_SIZE);
        const values = batch.map(u => [
            u.id,
            u.name || '',
            u.email || '',
            u.mobile || '',
            u.role || 'user',
            u.location_name || '',
            0,
            new Date()
        ]);

        const created = await insertBatch(
            'users',
            ['id', 'name', 'email', 'mobile', 'role', 'location_name', 'loyalty_points', 'created_at'],
            values
        );
        queriesSynced += 1;
        itemsSynced += created;
        const version = Math.min(i + batch.length, totalItems);
        if (onProgress) await onProgress({ version, queriesSynced, itemsSynced, totalItems });
    }

    LOG.success(`[Users Sync] Completed: ${itemsSynced} users synced to MySQL`);
    return doneSync({ itemsSynced, version: totalItems, queriesSynced, totalItems });
};

const syncVendorCategories = async ({ startOffset = 0, onProgress } = {}) => {
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
    const totalItems = names.length;
    let itemsSynced = 0;
    let queriesSynced = 0;
    const pool = await getPool();

    if (startOffset > 0) LOG.info(`[Vendor Categories Sync] Resuming from ${startOffset}/${totalItems}...`);
    else LOG.info(`[Vendor Categories Sync] Starting sync of ${totalItems} categories...`);

    for (let idx = startOffset; idx < names.length; idx++) {
        const name = names[idx];
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
            queriesSynced += 1;
            if (result?.affectedRows) itemsSynced += 1;
        } catch (err) {
            LOG.warning('[Vendor Categories Sync] row skipped:', err.message);
        }
        if (onProgress && (idx % 10 === 0 || idx === names.length - 1)) {
            await onProgress({ version: idx + 1, queriesSynced, itemsSynced, totalItems });
        }
    }

    LOG.success(`[Vendor Categories Sync] Completed: ${itemsSynced} categories synced to MySQL`);
    return doneSync({ itemsSynced, version: totalItems, queriesSynced, totalItems });
};

const syncVendors = async ({ startOffset = 0, onProgress } = {}) => {
    const vendors = inMemoryDb.vendors || [];
    const totalItems = vendors.length;
    if (startOffset > 0) LOG.info(`[Vendors Sync] Resuming from ${startOffset}/${totalItems}...`);
    else LOG.info(`[Vendors Sync] Starting sync of ${totalItems} vendors...`);

    const {
        ALTER_VENDOR_FEATURE_SQL,
        BASE_VENDOR_INSERT_COLUMNS,
        vendorRowFromSeed,
        vendorInsertPlaceholders,
        vendorUpsertUpdateClause,
    } = require('./utils/vendorFeatureColumns');

    try {
        await (await getPool()).query(ALTER_VENDOR_FEATURE_SQL);
    } catch (err) {
        LOG.warning('[Vendors Sync] Column check (non-fatal):', err.message);
    }

    let itemsSynced = 0;
    let queriesSynced = 0;
    const pool = await getPool();

    for (let idx = startOffset; idx < vendors.length; idx++) {
        const v = vendors[idx];
        try {
            const row = vendorRowFromSeed(v);
            const values = BASE_VENDOR_INSERT_COLUMNS.map((col) => row[col]);
            const [result] = await pool.query(
                `INSERT INTO vendors (${BASE_VENDOR_INSERT_COLUMNS.join(', ')})
                 VALUES (${vendorInsertPlaceholders()})
                 ON DUPLICATE KEY UPDATE ${vendorUpsertUpdateClause()}`,
                values
            );
            queriesSynced += 1;
            if (result?.affectedRows) itemsSynced += 1;
        } catch (err) {
            LOG.warning('[Vendors Sync] row skipped:', err.message);
        }
        if (onProgress && (idx % 25 === 0 || idx === vendors.length - 1)) {
            await onProgress({ version: idx + 1, queriesSynced, itemsSynced, totalItems });
        }
    }

    LOG.success(`[Vendors Sync] Completed: ${itemsSynced} vendors synced to MySQL`);
    return doneSync({ itemsSynced, version: totalItems, queriesSynced, totalItems });
};

const syncUserVendorMappings = async ({ startOffset = 0, onProgress } = {}) => {
    const mappings = inMemoryDb.user_vendor_mappings || [];
    const totalItems = mappings.length;
    if (startOffset > 0) LOG.info(`[Mappings Sync] Resuming from ${startOffset}/${totalItems}...`);
    else LOG.info(`[Mappings Sync] Starting sync of ${totalItems} user-vendor mappings...`);
    
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
    
    let itemsSynced = 0;
    let queriesSynced = 0;
    
    for (let i = startOffset; i < mappings.length; i += BATCH_SIZE) {
        const batch = mappings.slice(i, i + BATCH_SIZE);
        const values = batch.map(m => [m.user_id, m.vendor_id, new Date()]);
        
        const created = await insertBatch(
            'user_vendor_mappings',
            ['user_id', 'vendor_id', 'created_at'],
            values
        );
        queriesSynced += 1;
        itemsSynced += created;
        const version = Math.min(i + batch.length, totalItems);
        if (onProgress) await onProgress({ version, queriesSynced, itemsSynced, totalItems });
    }
    
    LOG.success(`[Mappings Sync] Completed: ${itemsSynced} mappings synced to MySQL`);
    return doneSync({ itemsSynced, version: totalItems, queriesSynced, totalItems });
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

const syncProducts = async ({ startOffset = 0, onProgress } = {}) => {
    dedupeInMemoryProducts();
    const products = inMemoryDb.products || [];
    const totalItems = products.length;
    if (startOffset > 0) LOG.info(`[Products Sync] Resuming from ${startOffset}/${totalItems}...`);
    else LOG.info(`[Products Sync] Starting sync of ${totalItems} products...`);
    
    let itemsSynced = 0;
    let queriesSynced = 0;
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

    for (let idx = startOffset; idx < products.length; idx++) {
        const p = products[idx];
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
            queriesSynced += 1;
            if (result?.affectedRows) itemsSynced += 1;
        } catch (err) {
            LOG.warning('[Products Sync] row skipped:', err.message);
        }
        if (onProgress && (idx % 25 === 0 || idx === products.length - 1)) {
            await onProgress({ version: idx + 1, queriesSynced, itemsSynced, totalItems });
        }
    }
    
    LOG.success(`[Products Sync] Completed: ${itemsSynced} products synced to MySQL`);
    return doneSync({ itemsSynced, version: totalItems, queriesSynced, totalItems });
};

const syncOrders = async ({ startOffset = 0, onProgress } = {}) => {
    const orders = inMemoryDb.orders || [];
    const totalItems = orders.length;
    if (startOffset > 0) LOG.info(`[Orders Sync] Resuming from ${startOffset}/${totalItems}...`);
    else LOG.info(`[Orders Sync] Starting sync of ${totalItems} orders...`);
    
    let itemsSynced = 0;
    let queriesSynced = 0;
    
    for (let i = startOffset; i < orders.length; i += BATCH_SIZE) {
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
        queriesSynced += 1;
        itemsSynced += created;
        const version = Math.min(i + batch.length, totalItems);
        if (onProgress) await onProgress({ version, queriesSynced, itemsSynced, totalItems });
    }
    
    LOG.success(`[Orders Sync] Completed: ${itemsSynced} orders synced to MySQL`);
    return doneSync({ itemsSynced, version: totalItems, queriesSynced, totalItems });
};

// ====================
// QUEUES & APPOINTMENTS
// ====================
const syncQueues = async ({ startOffset = 0, onProgress } = {}) => {
    const queues = (inMemoryDb.queues || []).slice(startOffset);
    const totalItems = (inMemoryDb.queues || []).length;
    if (startOffset > 0) LOG.info(`[Queues Sync] Resuming from ${startOffset}/${totalItems}...`);
    else LOG.info(`[Queues Sync] Starting sync of ${totalItems} queues...`);
    const itemsSynced = await upsertQueue(queues);
    if (onProgress) await onProgress({ version: totalItems, queriesSynced: 1, itemsSynced, totalItems });
    LOG.success(`[Queues Sync] Completed: ${itemsSynced} queues synced to MySQL`);
    return doneSync({ itemsSynced, version: totalItems, queriesSynced: 1, totalItems });
};

const syncAppointments = async ({ startOffset = 0, onProgress } = {}) => {
    const appointments = (inMemoryDb.appointments || []).slice(startOffset);
    const totalItems = (inMemoryDb.appointments || []).length;
    if (startOffset > 0) LOG.info(`[Appointments Sync] Resuming from ${startOffset}/${totalItems}...`);
    else LOG.info(`[Appointments Sync] Starting sync of ${totalItems} appointments...`);
    const itemsSynced = await upsertAppointments(appointments);
    if (onProgress) await onProgress({ version: totalItems, queriesSynced: 1, itemsSynced, totalItems });
    LOG.success(`[Appointments Sync] Completed: ${itemsSynced} appointments synced to MySQL`);
    return doneSync({ itemsSynced, version: totalItems, queriesSynced: 1, totalItems });
};

// ====================
// ACTIVITIES & OTPs
// ====================
const syncActivities = async ({ startOffset = 0, onProgress } = {}) => {
    const activities = inMemoryDb.activities || [];
    const totalItems = activities.length;
    if (startOffset > 0) LOG.info(`[Activities Sync] Resuming from ${startOffset}/${totalItems}...`);
    else LOG.info(`[Activities Sync] Starting sync of ${totalItems} activities...`);
    
    let itemsSynced = 0;
    let queriesSynced = 0;
    const pool = await getPool();

    // Ensure optional columns used by seed data
    for (const sql of [
        "ALTER TABLE activities ADD COLUMN vendor_id VARCHAR(255) NULL",
        "ALTER TABLE activities ADD COLUMN reactions JSON NULL",
    ]) {
        try { await pool.query(sql); } catch (e) { /* exists */ }
    }

    for (let idx = startOffset; idx < activities.length; idx++) {
        const act = activities[idx];
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
            queriesSynced += 1;
            if (result?.affectedRows) itemsSynced += 1;
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
                queriesSynced += 1;
                if (result?.affectedRows) itemsSynced += 1;
            } catch (err2) {
                LOG.warning('[Activities Sync] row skipped:', err2.message);
            }
        }
        if (onProgress && (idx % 25 === 0 || idx === activities.length - 1)) {
            await onProgress({ version: idx + 1, queriesSynced, itemsSynced, totalItems });
        }
    }
    
    LOG.success(`[Activities Sync] Completed: ${itemsSynced} activities synced to MySQL`);
    return doneSync({ itemsSynced, version: totalItems, queriesSynced, totalItems });
};

const syncOTPs = async ({ startOffset = 0, onProgress } = {}) => {
    const otps = inMemoryDb.otps || [];
    const totalItems = otps.length;
    if (startOffset > 0) LOG.info(`[OTPs Sync] Resuming from ${startOffset}/${totalItems}...`);
    else LOG.info(`[OTPs Sync] Starting sync of ${totalItems} OTPs...`);
    
    let itemsSynced = 0;
    let queriesSynced = 0;
    
    for (let i = startOffset; i < otps.length; i += BATCH_SIZE) {
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
        queriesSynced += 1;
        itemsSynced += created;
        const version = Math.min(i + batch.length, totalItems);
        if (onProgress) await onProgress({ version, queriesSynced, itemsSynced, totalItems });
    }
    
    LOG.success(`[OTPs Sync] Completed: ${itemsSynced} OTPs synced to MySQL`);
    return doneSync({ itemsSynced, version: totalItems, queriesSynced, totalItems });
};

// ====================
// CYBER/SURAKSHA SYNC
// ====================
const syncCyberThreats = async ({ startOffset = 0, onProgress } = {}) => {
    const threats = inMemoryDb.cyberThreats || [];
    const totalItems = threats.length;
    if (startOffset > 0) LOG.info(`[Cyber Threats Sync] Resuming from ${startOffset}/${totalItems}...`);
    else LOG.info(`[Cyber Threats Sync] Starting sync of ${totalItems} cyber threats...`);
    
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
    
    let itemsSynced = 0;
    let queriesSynced = 0;
    
    for (let i = startOffset; i < threats.length; i += BATCH_SIZE) {
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
        queriesSynced += 1;
        itemsSynced += created;
        const version = Math.min(i + batch.length, totalItems);
        if (onProgress) await onProgress({ version, queriesSynced, itemsSynced, totalItems });
    }
    
    LOG.success(`[Cyber Threats Sync] Completed: ${itemsSynced} cyber threats synced to MySQL`);
    return doneSync({ itemsSynced, version: totalItems, queriesSynced, totalItems });
};

// ====================
// NEWS CACHE SYNC (lazy slice backing store)
// ====================
const syncNewsCache = async ({ onProgress } = {}) => {
    LOG.info('[News Cache Sync] Starting news cache sync...');
    const items = inMemoryDb.news_cache || [];
    let itemsSynced = 0;
    let queriesSynced = 0;

    if (typeof db.ensureNewsCacheTable === 'function') {
        await db.ensureNewsCacheTable();
        queriesSynced += 1;
    }

    if (items.length > 0 && typeof db.saveNewsItems === 'function') {
        const withKeys = items.map((item) => ({
            ...item,
            unique_key: item.unique_key || item.link || item.id || `${item.source || ''}|${item.text || ''}`,
        }));
        const result = await db.saveNewsItems(withKeys);
        itemsSynced = result?.saved || withKeys.length;
        queriesSynced += Math.ceil(withKeys.length / BATCH_SIZE);
    }

    if (onProgress) await onProgress({ version: 1, queriesSynced, itemsSynced, totalItems: Math.max(items.length, 1) });
    LOG.success(`[News Cache Sync] Completed: ${itemsSynced} news items synced to MySQL`);
    return doneSync({ itemsSynced, version: 1, queriesSynced, totalItems: Math.max(items.length, 1) });
};

// ====================
// SURAKSHA SYNC (validations + reports)
// ====================
const syncSurakshaData = async ({ onProgress } = {}) => {
    LOG.info('[Suraksha Sync] Starting suraksha data sync...');
    const pool = await getPool();
    let itemsSynced = 0;
    let queriesSynced = 0;

    try {
        const { ensureFeatureSchema } = require('./database/schema/featureTables');
        await ensureFeatureSchema('cyber', db);
        queriesSynced += 1;
    } catch (err) {
        LOG.warning('[Suraksha Sync] Schema check (non-fatal):', err.message);
    }

    const validations = inMemoryDb.surakshaValidations || [];
    for (const v of validations) {
        try {
            await pool.query(
                `INSERT INTO suraksha_validations
                 (id, user_id, input_value, type, status, result_data, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                   status=VALUES(status),
                   result_data=VALUES(result_data),
                   updated_at=VALUES(updated_at)`,
                [
                    v.id,
                    v.user_id,
                    v.input_value || v.input || '',
                    v.type || 'other',
                    v.status || 'pending',
                    v.result_data ? JSON.stringify(v.result_data) : null,
                    v.created_at || new Date(),
                    v.updated_at || new Date(),
                ]
            );
            itemsSynced += 1;
            queriesSynced += 1;
        } catch (err) {
            LOG.warning(`[Suraksha Sync] validation ${v.id}:`, err.message);
        }
    }

    const reports = inMemoryDb.surakshaReports || [];
    for (const r of reports) {
        try {
            await pool.query(
                `INSERT INTO suraksha_reports
                 (id, user_id, complaint_id, input, type, amount, beneficiary, description,
                  transaction_date, evidence, status, govt_sent, govt_complaint_id,
                  reminder_count, last_reminder_at, sent_at, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                   status=VALUES(status),
                   govt_sent=VALUES(govt_sent),
                   govt_complaint_id=VALUES(govt_complaint_id),
                   reminder_count=VALUES(reminder_count),
                   last_reminder_at=VALUES(last_reminder_at),
                   sent_at=VALUES(sent_at),
                   updated_at=VALUES(updated_at)`,
                [
                    r.id,
                    r.user_id,
                    r.complaint_id || null,
                    r.input || '',
                    r.type || 'other',
                    r.amount || 0,
                    r.beneficiary || r.input || '',
                    r.description || '',
                    r.transaction_date || null,
                    JSON.stringify(r.evidence || {}),
                    r.status || 'saved',
                    r.govt_sent ? 1 : 0,
                    r.govt_complaint_id || null,
                    r.reminder_count || 0,
                    r.last_reminder_at || null,
                    r.sent_at || null,
                    r.created_at || new Date(),
                    r.updated_at || new Date(),
                ]
            );
            itemsSynced += 1;
            queriesSynced += 1;
        } catch (err) {
            LOG.warning(`[Suraksha Sync] report ${r.id}:`, err.message);
        }
    }

    if (onProgress) await onProgress({ version: 1, queriesSynced, itemsSynced, totalItems: validations.length + reports.length });
    LOG.success(`[Suraksha Sync] Completed: ${itemsSynced} suraksha rows synced to MySQL`);
    return doneSync({ itemsSynced, version: 1, queriesSynced, totalItems: validations.length + reports.length });
};

// ====================
// R-DETECTOR SYNC (commute + scans)
// ====================
const syncRDetectorData = async ({ onProgress } = {}) => {
    LOG.info('[R-Detector Sync] Starting r-detector data sync...');
    const pool = await getPool();
    const commuteService = require('./services/rDetectorCommuteService');
    const rDetectorService = require('./services/rDetectorService');
    let itemsSynced = 0;
    let queriesSynced = 0;

    await commuteService.ensureCommuteTables();
    await rDetectorService.ensureScanResultsTable(pool);
    queriesSynced += 2;

    const pings = inMemoryDb.r_detector_activity_pings || [];
    for (const p of pings) {
        try {
            if (p.id != null) {
                const [existing] = await pool.query(
                    'SELECT id FROM r_detector_activity_pings WHERE id = ? LIMIT 1',
                    [p.id]
                );
                if (existing?.length) continue;
            }
            await pool.query(
                `INSERT INTO r_detector_activity_pings
                 (user_id, latitude, longitude, speed_kmh, day_of_week, recorded_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    p.user_id,
                    p.latitude,
                    p.longitude,
                    p.speed_kmh || 0,
                    p.day_of_week,
                    p.recorded_at || new Date(),
                ]
            );
            itemsSynced += 1;
            queriesSynced += 1;
        } catch (err) {
            LOG.warning('[R-Detector Sync] ping:', err.message);
        }
    }

    const trips = inMemoryDb.r_detector_commute_trips || [];
    for (const t of trips) {
        try {
            if (t.id != null) {
                const [existing] = await pool.query(
                    'SELECT id FROM r_detector_commute_trips WHERE id = ? LIMIT 1',
                    [t.id]
                );
                if (existing?.length) continue;
            }
            await pool.query(
                `INSERT INTO r_detector_commute_trips
                 (user_id, day_of_week, departure_minutes, origin_lat, origin_lng,
                  dest_lat, dest_lng, direction, recorded_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    t.user_id,
                    t.day_of_week,
                    t.departure_minutes,
                    t.origin_lat,
                    t.origin_lng,
                    t.dest_lat ?? null,
                    t.dest_lng ?? null,
                    t.direction || 'unknown',
                    t.recorded_at || new Date(),
                ]
            );
            itemsSynced += 1;
            queriesSynced += 1;
        } catch (err) {
            LOG.warning('[R-Detector Sync] trip:', err.message);
        }
    }

    const routes = inMemoryDb.r_detector_commute_routes || [];
    for (const r of routes) {
        try {
            await pool.query(
                `INSERT INTO r_detector_commute_routes
                 (user_id, label, origin_lat, origin_lng, dest_lat, dest_lng, direction,
                  sample_count, confidence, active, last_seen_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                   sample_count=VALUES(sample_count),
                   confidence=VALUES(confidence),
                   active=VALUES(active),
                   last_seen_at=VALUES(last_seen_at)`,
                [
                    r.user_id,
                    r.label || 'Daily route',
                    r.origin_lat,
                    r.origin_lng,
                    r.dest_lat,
                    r.dest_lng,
                    r.direction || 'outbound',
                    r.sample_count || 0,
                    r.confidence || 0.5,
                    r.active != null ? r.active : 1,
                    r.last_seen_at || null,
                ]
            );
            itemsSynced += 1;
            queriesSynced += 1;
        } catch (err) {
            LOG.warning('[R-Detector Sync] route:', err.message);
        }
    }

    const schedules = inMemoryDb.r_detector_commute_schedules || [];
    for (const s of schedules) {
        try {
            await pool.query(
                `INSERT INTO r_detector_commute_schedules
                 (user_id, route_id, day_of_week, departure_minutes, alert_lead_minutes,
                  direction, origin_lat, origin_lng, dest_lat, dest_lng, confidence, source, active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                   route_id=VALUES(route_id),
                   confidence=VALUES(confidence),
                   active=VALUES(active),
                   updated_at=CURRENT_TIMESTAMP`,
                [
                    s.user_id,
                    s.route_id ?? null,
                    s.day_of_week,
                    s.departure_minutes,
                    s.alert_lead_minutes ?? 10,
                    s.direction || 'outbound',
                    s.origin_lat,
                    s.origin_lng,
                    s.dest_lat,
                    s.dest_lng,
                    s.confidence || 0.5,
                    s.source || 'inferred',
                    s.active != null ? s.active : 1,
                ]
            );
            itemsSynced += 1;
            queriesSynced += 1;
        } catch (err) {
            LOG.warning('[R-Detector Sync] schedule:', err.message);
        }
    }

    const scans = inMemoryDb.r_detector_scan_results || [];
    for (const s of scans) {
        try {
            if (s.id != null) {
                const [existing] = await pool.query(
                    'SELECT id FROM r_detector_scan_results WHERE id = ? LIMIT 1',
                    [s.id]
                );
                if (existing?.length) continue;
            }
            await pool.query(
                `INSERT INTO r_detector_scan_results
                 (user_id, latitude, longitude, speed_kmh, confidence, issue_type, hazard_id, scan_date, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    s.user_id,
                    s.latitude,
                    s.longitude,
                    s.speed_kmh ?? null,
                    s.confidence ?? null,
                    s.issue_type || 'bad_road',
                    s.hazard_id ?? null,
                    s.scan_date || new Date().toISOString().slice(0, 10),
                    s.created_at || new Date(),
                ]
            );
            itemsSynced += 1;
            queriesSynced += 1;
        } catch (err) {
            LOG.warning('[R-Detector Sync] scan:', err.message);
        }
    }

    if (onProgress) await onProgress({ version: 1, queriesSynced, itemsSynced, totalItems: itemsSynced || 1 });
    LOG.success(`[R-Detector Sync] Completed: ${itemsSynced} r-detector rows synced to MySQL`);
    return doneSync({ itemsSynced, version: 1, queriesSynced, totalItems: itemsSynced || 1 });
};

// ====================
// TRADING DATA SYNC
// ====================
const syncTradingData = async ({ startOffset = 0, onProgress } = {}) => {
    LOG.info('[Trading Data Sync] Starting trading data sync...');
    
    const tradingData = inMemoryDb.tradingData || {};
    const types = ['marketIndices', 'stockQuotes', 'topGainers', 'topLosers', 'marketHigh', 'mostBought'];
    const totalItems = types.length;
    let itemsSynced = 0;
    let queriesSynced = 0;
    
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
    
    for (let idx = startOffset; idx < types.length; idx++) {
        const type = types[idx];
        const data = tradingData[type] || [];
        if (data.length > 0) {
            try {
                await (await getPool()).query(
                    'INSERT INTO trading_market_data (data_type, content) VALUES (?, ?)',
                    [type, JSON.stringify(data)]
                );
                queriesSynced += 1;
                itemsSynced += 1;
            } catch (err) {
                LOG.warning(`[Trading Data Sync] Error syncing ${type}:`, err.message);
            }
        }
        if (onProgress) await onProgress({ version: idx + 1, queriesSynced, itemsSynced, totalItems });
    }
    
    LOG.success(`[Trading Data Sync] Completed: ${itemsSynced} trading data collections synced to MySQL`);
    return doneSync({ itemsSynced, version: totalItems, queriesSynced, totalItems });
};

const syncFleetData = async ({ onProgress } = {}) => {
    LOG.info('[Fleet Data Sync] Starting fleet data sync...');
    const pool = await getPool();
    let queriesSynced = 0;

    try {
        if (typeof db.ensureFleetTables === 'function') {
            await db.ensureFleetTables();
            queriesSynced += 1;
        }
    } catch (err) {
        LOG.warning('[Fleet Data Sync] Table setup (non-fatal):', err.message);
    }

    const { applyMumbaiPuneFleetSeed } = require('./database/features/fleetRouteSeed');
    await applyMumbaiPuneFleetSeed(pool);
    queriesSynced += 6;

    const hazards = inMemoryDb.fleet_hazards || [];
    for (const h of hazards) {
        try {
            if (h.id != null) {
                const [existing] = await pool.query('SELECT id FROM fleet_hazards WHERE id = ? LIMIT 1', [h.id]);
                if (existing?.length) continue;
            }
            await pool.query(
                `INSERT INTO fleet_hazards
                 (driver_id, hazard_type, latitude, longitude, description, image_url,
                  points_awarded, status, reported_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    h.driver_id || h.user_id || 'unknown',
                    h.hazard_type || h.type || 'other',
                    h.latitude,
                    h.longitude,
                    h.description || '',
                    h.image_url || null,
                    h.points_awarded ?? 5,
                    h.status || 'reported',
                    h.reported_at || h.created_at || new Date(),
                ]
            );
            queriesSynced += 1;
        } catch (err) {
            LOG.warning('[Fleet Data Sync] hazard:', err.message);
        }
    }

    const itemsSynced = 1 + hazards.length;
    LOG.success('[Fleet Data Sync] Mumbai–Pune corridor synced to MySQL');
    if (onProgress) await onProgress({ version: 1, queriesSynced, itemsSynced, totalItems: 1 });
    return doneSync({ itemsSynced, version: 1, queriesSynced, totalItems: 1 });
};

// ====================
// MAIN SYNC ORCHESTRATOR
// ====================
const syncAllToMysql = async ({ exit = false, triggerSource = 'manual', forceFull = false } = {}) => {
    LOG.info('');
    LOG.info('═══════════════════════════════════════════════════════════════');
    LOG.info('    STARTING COMPREHENSIVE IN-MEMORY TO MYSQL SYNC');
    LOG.info('═══════════════════════════════════════════════════════════════');
    LOG.info('');
    
    const startTime = Date.now();
    let totalSynced = 0;
    let runId = null;
    let resume = false;
    const stepOpts = () => ({ forceFull, resume });
    const step = (key, fn) => syncStatus.runStep(key, fn, runId, stepOpts());
    
    try {
        ({ runId, resume } = await syncStatus.startRun(triggerSource, { forceFull }));
        LOG.info(resume
            ? `[Sync] Resuming from checkpoint (build ${syncStatus.getBuildVersion()})`
            : `[Sync] Full sync — empty table or forceFull (build ${syncStatus.getBuildVersion()})`);

        await step('core_schema', () => ensureCoreSchema().then(() => doneSync({ itemsSynced: 1, version: 1, queriesSynced: 1, totalItems: 1 })));

        await step('feature_seed', async () => {
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
            return doneSync({ itemsSynced: 0, version: 1, queriesSynced: 3, totalItems: 1 });
        });

        totalSynced += await step('users', syncUsers);
        totalSynced += await step('vendor_categories', syncVendorCategories);
        totalSynced += await step('vendors', syncVendors);
        totalSynced += await step('user_vendor_mappings', syncUserVendorMappings);
        totalSynced += await step('products', syncProducts);
        totalSynced += await step('orders', syncOrders);
        totalSynced += await step('queues', syncQueues);
        totalSynced += await step('appointments', syncAppointments);
        totalSynced += await step('activities', syncActivities);
        totalSynced += await step('otps', syncOTPs);
        totalSynced += await step('cyber_threats', syncCyberThreats);
        totalSynced += await step('suraksha_data', syncSurakshaData);
        totalSynced += await step('news_cache', syncNewsCache);
        totalSynced += await step('r_detector_data', syncRDetectorData);
        totalSynced += await step('trading_data', syncTradingData);
        totalSynced += await step('fleet_data', syncFleetData);
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        const state = await syncStatus.getModuleState();
        await syncStatus.completeRun(runId, {
            success: true,
            totalSynced,
            queriesSynced: state.summary.totalQueriesSynced,
        });
        syncStatus.printSummary(state.modules, state.summary);
        
        LOG.info('');
        LOG.info('═══════════════════════════════════════════════════════════════');
        LOG.success(`✓ SYNC COMPLETED SUCCESSFULLY`);
        LOG.success(`✓ Total items synced: ${totalSynced}`);
        LOG.success(`✓ Time taken: ${duration}s`);
        LOG.info('═══════════════════════════════════════════════════════════════');
        LOG.info('');
        
        if (exit) process.exit(0);
        return { success: true, totalSynced, duration, runId, resume, modules: state.modules, summary: state.summary };
    } catch (err) {
        const state = await syncStatus.getModuleState().catch(() => ({ summary: { totalQueriesSynced: 0 } }));
        await syncStatus.completeRun(runId, {
            success: false,
            totalSynced,
            queriesSynced: state.summary?.totalQueriesSynced || 0,
            error: err.message,
        });
        try {
            const state = await syncStatus.getModuleState();
            syncStatus.printSummary(state.modules, state.summary);
        } catch {
            /* ignore */
        }
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
    syncSurakshaData,
    syncNewsCache,
    syncRDetectorData,
    syncTradingData,
    syncFleetData
};
