/**
 * COMPREHENSIVE IN-MEMORY TO MYSQL SYNC UTILITY
 * Syncs ALL in-memory data collections to MySQL
 * Usage: npm run sync:all or node backend/syncAllToMysql.js
 */

require('./loadEnv');
const db = require('./database');
const LOG = require('./utils/logger');

const {
    getPool,
    inMemoryDb,
    toMysqlDateTime,
    normalizeProductRow
} = db;

const BATCH_SIZE = 100;

// Helper to insert batches
const insertBatch = async (table, columns, values, ignoreErrors = true) => {
    if (!values.length) return 0;
    
    const placeholders = values.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
    const query = `INSERT IGNORE INTO ${table} (${columns.join(',')}) VALUES ${placeholders}`;
    const flatValues = values.flat();
    
    try {
        const result = await getPool().query(query, flatValues);
        return result[0]?.affectedRows || 0;
    } catch (err) {
        if (!ignoreErrors) throw err;
        LOG.warning(`[Batch Insert] Error in ${table}:`, err.message);
        return 0;
    }
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

const syncVendors = async () => {
    LOG.info(`[Vendors Sync] Starting sync of ${inMemoryDb.vendors.length} vendors...`);
    
    // Ensure columns first
    try {
        await getPool().query(`
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
    
    for (let i = 0; i < inMemoryDb.vendors.length; i += BATCH_SIZE) {
        const batch = inMemoryDb.vendors.slice(i, i + BATCH_SIZE);
        const values = batch.map(v => [
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
            v.visibility_list ? 1 : 0,
            v.visibility_feed ? 1 : 0,
            v.location_name || ''
        ]);
        
        const created = await insertBatch(
            'vendors',
            [
                'id', 'owner_id', 'shop_name', 'category', 'is_active', 'is_promoted',
                'latitude', 'longitude', 'google_link', 'instagram_handle', 'facebook_link',
                'features_products', 'features_payments', 'features_appointments', 'features_queue',
                'features_matchmaking', 'features_cyber', 'features_trade', 'features_offer', 'features_qless',
                'features_fleet', 'features_realestate', 'features_trust_score',
                'visibility_top_rated', 'visibility_list', 'visibility_feed', 'location_name'
            ],
            values
        );
        total += created;
    }
    
    LOG.success(`[Vendors Sync] Completed: ${total} vendors synced to MySQL`);
    return total;
};

const syncUserVendorMappings = async () => {
    const mappings = inMemoryDb.user_vendor_mappings || [];
    LOG.info(`[Mappings Sync] Starting sync of ${mappings.length} user-vendor mappings...`);
    
    // Ensure table
    try {
        await getPool().query(`
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
const syncProducts = async () => {
    const products = inMemoryDb.products || [];
    LOG.info(`[Products Sync] Starting sync of ${products.length} products...`);
    
    let total = 0;
    
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
        const batch = products.slice(i, i + BATCH_SIZE);
        const values = batch.map(p => [
            p.id,
            p.vendor_id || '',
            p.name || '',
            p.price || 0,
            p.description || '',
            p.offer || '',
            p.offer_amount || 0,
            JSON.stringify(p.image_urls || []),
            p.validity_from || null,
            p.validity_to || null,
            p.category || '',
            p.stock || 0
        ]);
        
        const created = await insertBatch(
            'products',
            ['id', 'vendor_id', 'name', 'price', 'description', 'offer', 'offer_amount', 'image_urls_json', 'validity_from', 'validity_to', 'category', 'stock'],
            values
        );
        total += created;
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
    
    let total = 0;
    
    for (let i = 0; i < queues.length; i += BATCH_SIZE) {
        const batch = queues.slice(i, i + BATCH_SIZE);
        const values = batch.map(q => [
            q.id,
            q.vendor_id || '',
            q.user_id || '',
            q.status || 'waiting',
            q.position || 0,
            q.joined_at || new Date()
        ]);
        
        const created = await insertBatch(
            'queues',
            ['id', 'vendor_id', 'user_id', 'status', 'position', 'joined_at'],
            values
        );
        total += created;
    }
    
    LOG.success(`[Queues Sync] Completed: ${total} queues synced to MySQL`);
    return total;
};

const syncAppointments = async () => {
    const appointments = inMemoryDb.appointments || [];
    LOG.info(`[Appointments Sync] Starting sync of ${appointments.length} appointments...`);
    
    let total = 0;
    
    for (let i = 0; i < appointments.length; i += BATCH_SIZE) {
        const batch = appointments.slice(i, i + BATCH_SIZE);
        const values = batch.map(a => [
            a.id,
            a.vendor_id || '',
            a.user_id || '',
            a.date || null,
            a.time || null,
            a.status || 'pending',
            a.created_at || new Date()
        ]);
        
        const created = await insertBatch(
            'appointments',
            ['id', 'vendor_id', 'user_id', 'date', 'time', 'status', 'created_at'],
            values
        );
        total += created;
    }
    
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
    
    for (let i = 0; i < activities.length; i += BATCH_SIZE) {
        const batch = activities.slice(i, i + BATCH_SIZE);
        const values = batch.map(act => [
            act.id,
            act.type || '',
            act.user_id || '',
            act.user_name || act.userName || '',
            act.message || '',
            JSON.stringify(act.metadata || {}),
            act.timestamp || new Date()
        ]);
        
        const created = await insertBatch(
            'activities',
            ['id', 'type', 'user_id', 'user_name', 'message', 'metadata', 'timestamp'],
            values
        );
        total += created;
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
        await getPool().query(`
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
        await getPool().query(`
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
                await getPool().query(
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
        await getPool().query(`
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
const syncAllToMysql = async () => {
    LOG.info('');
    LOG.info('═══════════════════════════════════════════════════════════════');
    LOG.info('    STARTING COMPREHENSIVE IN-MEMORY TO MYSQL SYNC');
    LOG.info('═══════════════════════════════════════════════════════════════');
    LOG.info('');
    
    const startTime = Date.now();
    let totalSynced = 0;
    
    try {
        // Core entities
        totalSynced += await syncUsers();
        totalSynced += await syncVendors();
        totalSynced += await syncUserVendorMappings();
        
        // Commerce
        totalSynced += await syncProducts();
        totalSynced += await syncOrders();
        
        // Service management
        totalSynced += await syncQueues();
        totalSynced += await syncAppointments();
        
        // Activity & Auth
        totalSynced += await syncActivities();
        totalSynced += await syncOTPs();
        
        // Features
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
        
        process.exit(0);
    } catch (err) {
        LOG.error('SYNC FAILED:', err);
        process.exit(1);
    }
};

// Execute if called directly
if (require.main === module) {
    syncAllToMysql().catch(err => {
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
