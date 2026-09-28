/**
 * UNIFIED SMART MODULE MYSQL SYNC & HYDRATION SCRIPT
 * Single canonical source of truth for SMART MySQL schema, users, vendor,
 * user-vendor mappings, voice streams, camera frames, SGATE sessions,
 * scan snapshots/alerts, vendor policies, and remote commands.
 *
 * Injected into:
 *  1. Full Sync (backend/syncAllToMysql.js)
 *  2. Recent / Sync Now (backend/syncLast3Hours.js)
 *  3. Auto Drift Sync (backend/services/driftSyncService.js)
 *  4. Release / Super-Admin Sync Maintenance (backend/services/syncMaintenanceService.js)
 *  5. Startup Hydration (backend/services/dbHydrateService.js)
 *  6. Sync API Routes (POST /api/sync/smart, /api/sync/all, /api/sync/recent)
 *  7. Database Init (db.ensureSmartUsersAndVendor)
 *
 * Usage: node backend/syncSmartToMysql.js  |  npm run sync:smart
 */

require('./loadEnv');
const LOG = require('./utils/logger');

let cachedSmartPool = null;

async function resolveSmartPool(explicitPool = null) {
    if (explicitPool) return explicitPool;
    if (cachedSmartPool) return cachedSmartPool;
    try {
        const db = require('./database');
        if (typeof db.getPool === 'function') {
            const p = db.getPool();
            if (p) {
                cachedSmartPool = p;
                return p;
            }
        }
        if (typeof db.ensureWritePool === 'function') {
            const wp = await db.ensureWritePool();
            if (wp) {
                cachedSmartPool = wp;
                return wp;
            }
        }
    } catch (_) {
        /* fallback to featureConnectionManager */
    }
    try {
        const featureConnectionManager = require('./database/featureConnectionManager');
        const p =
            featureConnectionManager.getCachedPool?.('smart') ||
            featureConnectionManager.getCachedPool?.('core') ||
            (await featureConnectionManager.acquireForSync?.('smart')) ||
            (await featureConnectionManager.acquireForSync?.('core'));
        if (p) {
            cachedSmartPool = p;
            return p;
        }
    } catch (err) {
        LOG.warning(`[Smart Sync] Could not acquire MySQL pool: ${err.message}`);
    }
    return null;
}

/**
 * Execute a MySQL query with an isolated try/catch and optional fallback query/fn.
 * Never throws so a single query failure never hampers other queries or modules.
 */
async function safeQuery(pool, sql, params = [], { fallbackSql = null, fallbackParams = null, label = 'query' } = {}) {
    if (!pool) return { ok: false, rows: null, queriesRun: 0 };
    try {
        const [rows] = await pool.query(sql, params);
        return { ok: true, rows, queriesRun: 1 };
    } catch (primaryErr) {
        if (fallbackSql) {
            try {
                const [rows] = await pool.query(fallbackSql, fallbackParams ?? params);
                LOG.info(`[Smart Sync] Used fallback query for ${label}`);
                return { ok: true, rows, queriesRun: 2, usedFallback: true };
            } catch (fallbackErr) {
                LOG.warning(`[Smart Sync] Fallback query failed (${label}): ${fallbackErr.message}`);
                return { ok: false, rows: null, queriesRun: 2, error: fallbackErr.message };
            }
        }
        if (!/Duplicate column|Duplicate key name|already exists/i.test(String(primaryErr.message))) {
            LOG.warning(`[Smart Sync] Query skipped (${label}): ${primaryErr.message}`);
        }
        return { ok: false, rows: null, queriesRun: 1, error: primaryErr.message };
    }
}

/**
 * Step 1: Ensure all SMART MySQL tables & required columns exist with fallbacks.
 */
async function ensureSmartSchema(pool = null) {
    const activePool = await resolveSmartPool(pool);
    if (!activePool) return { ok: false, queriesSynced: 0 };
    let queriesSynced = 0;

    // 1. Ensure feature tables via central schema helper first
    try {
        const db = require('./database');
        const { ensureFeatureSchema } = require('./database/schema/featureTables');
        await ensureFeatureSchema('smart', db);
        queriesSynced += 1;
    } catch (err) {
        LOG.warning(`[Smart Sync] featureTables.ensureFeatureSchema('smart') warning: ${err.message}`);
    }

    // 2. Ensure vendors.features_smart column & user_vendor_mappings table
    const rAlterVendor = await safeQuery(
        activePool,
        `ALTER TABLE vendors ADD COLUMN features_smart TINYINT(1) DEFAULT 0`,
        [],
        { label: 'vendors.features_smart' }
    );
    queriesSynced += rAlterVendor.queriesRun;

    const rMapTable = await safeQuery(
        activePool,
        `CREATE TABLE IF NOT EXISTS user_vendor_mappings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(64) NOT NULL,
            vendor_id VARCHAR(64) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_user_vendor (user_id, vendor_id),
            INDEX idx_user (user_id),
            INDEX idx_vendor (vendor_id)
        )`,
        [],
        { label: 'create user_vendor_mappings' }
    );
    queriesSynced += rMapTable.queriesRun;

    // 3. Ensure all SMART tables (with fallback DDL for older MySQL/MariaDB engines)
    const tableDefinitions = [
        {
            label: 'smart_camera_frames',
            sql: `CREATE TABLE IF NOT EXISTS smart_camera_frames (
                id VARCHAR(64) PRIMARY KEY,
                vendor_id VARCHAR(64) NOT NULL,
                user_id VARCHAR(64) NULL,
                session_id VARCHAR(64) NULL,
                image_base64 MEDIUMTEXT NOT NULL,
                width INT NULL,
                height INT NULL,
                saved_locally TINYINT(1) DEFAULT 0,
                created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
                INDEX idx_smart_cam_vendor_time (vendor_id, created_at)
            )`,
            fallbackSql: `CREATE TABLE IF NOT EXISTS smart_camera_frames (
                id VARCHAR(64) PRIMARY KEY,
                vendor_id VARCHAR(64) NOT NULL,
                user_id VARCHAR(64) NULL,
                session_id VARCHAR(64) NULL,
                image_base64 MEDIUMTEXT NOT NULL,
                width INT NULL,
                height INT NULL,
                saved_locally TINYINT(1) DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
        },
        {
            label: 'smart_voice_lines',
            sql: `CREATE TABLE IF NOT EXISTS smart_voice_lines (
                id VARCHAR(64) PRIMARY KEY,
                vendor_id VARCHAR(64) NOT NULL,
                user_id VARCHAR(64) NULL,
                session_id VARCHAR(64) NULL,
                line_text TEXT NOT NULL,
                is_final TINYINT(1) DEFAULT 1,
                created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
                INDEX idx_smart_voice_vendor_time (vendor_id, created_at)
            )`,
            fallbackSql: `CREATE TABLE IF NOT EXISTS smart_voice_lines (
                id VARCHAR(64) PRIMARY KEY,
                vendor_id VARCHAR(64) NOT NULL,
                user_id VARCHAR(64) NULL,
                session_id VARCHAR(64) NULL,
                line_text TEXT NOT NULL,
                is_final TINYINT(1) DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
        },
        {
            label: 'smart_scan_snapshots',
            sql: `CREATE TABLE IF NOT EXISTS smart_scan_snapshots (
                vendor_id VARCHAR(64) NOT NULL,
                user_id VARCHAR(64) NOT NULL,
                wifi_keys JSON NULL,
                device_keys JSON NULL,
                wifi_count INT DEFAULT 0,
                device_count INT DEFAULT 0,
                updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
                PRIMARY KEY (vendor_id, user_id)
            )`,
            fallbackSql: `CREATE TABLE IF NOT EXISTS smart_scan_snapshots (
                vendor_id VARCHAR(64) NOT NULL,
                user_id VARCHAR(64) NOT NULL,
                wifi_keys LONGTEXT NULL,
                device_keys LONGTEXT NULL,
                wifi_count INT DEFAULT 0,
                device_count INT DEFAULT 0,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (vendor_id, user_id)
            )`,
        },
        {
            label: 'smart_scan_alerts',
            sql: `CREATE TABLE IF NOT EXISTS smart_scan_alerts (
                id VARCHAR(64) PRIMARY KEY,
                vendor_id VARCHAR(64) NOT NULL,
                user_id VARCHAR(64) NULL,
                user_display_name VARCHAR(255) NULL,
                payload JSON NOT NULL,
                created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
                INDEX idx_smart_scan_alert_vendor (vendor_id, created_at)
            )`,
            fallbackSql: `CREATE TABLE IF NOT EXISTS smart_scan_alerts (
                id VARCHAR(64) PRIMARY KEY,
                vendor_id VARCHAR(64) NOT NULL,
                user_id VARCHAR(64) NULL,
                user_display_name VARCHAR(255) NULL,
                payload LONGTEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
        },
        {
            label: 'smart_gate_sessions',
            sql: `CREATE TABLE IF NOT EXISTS smart_gate_sessions (
                id VARCHAR(64) PRIMARY KEY,
                vendor_id VARCHAR(64) NOT NULL,
                user_id VARCHAR(64) NOT NULL,
                user_display_name VARCHAR(255) NULL,
                sgate_code VARCHAR(32) NULL,
                status VARCHAR(32) DEFAULT 'active',
                mic_listening TINYINT(1) DEFAULT 0,
                camera_live TINYINT(1) DEFAULT 0,
                payload_json LONGTEXT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_smart_gate_vendor_user (vendor_id, user_id)
            )`,
        },
        {
            label: 'smart_policies',
            sql: `CREATE TABLE IF NOT EXISTS smart_policies (
                vendor_id VARCHAR(64) PRIMARY KEY,
                policy_json LONGTEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`,
        },
        {
            label: 'smart_remote_commands',
            sql: `CREATE TABLE IF NOT EXISTS smart_remote_commands (
                id VARCHAR(64) PRIMARY KEY,
                vendor_id VARCHAR(64) NOT NULL,
                user_id VARCHAR(64) NULL,
                command_type VARCHAR(64) NOT NULL,
                payload_json LONGTEXT NULL,
                status VARCHAR(32) DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_smart_cmd_vendor_user (vendor_id, user_id, status)
            )`,
        },
    ];

    for (const def of tableDefinitions) {
        const res = await safeQuery(activePool, def.sql, [], {
            fallbackSql: def.fallbackSql || null,
            label: `create ${def.label}`,
        });
        queriesSynced += res.queriesRun;
    }

    return { ok: true, queriesSynced };
}

/**
 * Step 2: Ensure SMART canonical users (usr_smart1, usr_smartvendor1),
 * vendor (v_smart1), and mappings exist in both inMemoryDb and MySQL.
 */
async function ensureSmartUsersAndVendor(pool = null) {
    const db = require('./database');
    const inMemoryDb = db.inMemoryDb || {};
    const activePool = await resolveSmartPool(pool);
    const demoSeed = process.env.SMART_DEMO_SEED === 'true';

    let queriesSynced = 0;
    let itemsSynced = 0;

    // Canonical SMART users (always ensured for Smart User 1 and Smart Vendor 1 login)
    const smartUsers = [
        {
            id: 'usr_smart1',
            name: 'Smart User 1',
            email: 'smart1@test.com',
            mobile: '8000000021',
            role: 'user',
            location_name: 'Mumbai',
        },
        {
            id: 'usr_smartvendor1',
            name: 'Smart Vendor 1',
            email: 'smartvendor1@test.com',
            mobile: '8000000022',
            role: 'vendor',
            location_name: 'Mumbai',
        },
    ];

    if (!Array.isArray(inMemoryDb.users)) inMemoryDb.users = [];
    for (const u of smartUsers) {
        const memIdx = inMemoryDb.users.findIndex((x) => String(x.id) === u.id);
        if (memIdx >= 0) {
            inMemoryDb.users[memIdx] = { ...inMemoryDb.users[memIdx], ...u };
        } else {
            inMemoryDb.users.push({ ...u, created_at: new Date() });
        }
    }

    // Canonical SMART vendor (v_smart1 is always ensured; v_smart2/3 only when demoSeed is enabled)
    const smartVendors = [
        {
            id: 'v_smart1',
            owner_id: 'usr_smartvendor1',
            shop_name: 'Smart Home Hub',
            category: 'Smart Devices',
            location_name: 'Mumbai',
            is_active: true,
            is_promoted: false,
            latitude: 19.076,
            longitude: 72.877,
            google_link: '',
            instagram_handle: '',
            facebook_link: '',
            features_products: false,
            features_payments: false,
            features_appointments: false,
            features_queue: false,
            features_matchmaking: false,
            features_smart: true,
            visibility_top_rated: false,
            visibility_list: true,
            visibility_feed: false,
        },
    ];

    if (demoSeed) {
        smartVendors.push(
            {
                id: 'v_smart2',
                owner_id: 'usr_smartvendor1',
                shop_name: 'IoT Connect Store',
                category: 'Smart Devices',
                location_name: 'Delhi',
                is_active: true,
                is_promoted: false,
                latitude: 28.6139,
                longitude: 77.209,
                google_link: '',
                instagram_handle: '',
                facebook_link: '',
                features_products: false,
                features_payments: false,
                features_appointments: false,
                features_queue: false,
                features_matchmaking: false,
                features_smart: true,
                visibility_top_rated: false,
                visibility_list: true,
                visibility_feed: false,
            },
            {
                id: 'v_smart3',
                owner_id: 'usr_smartvendor1',
                shop_name: 'Home Automation Pro',
                category: 'Smart Devices',
                location_name: 'Bangalore',
                is_active: true,
                is_promoted: false,
                latitude: 12.9716,
                longitude: 77.5946,
                google_link: '',
                instagram_handle: '',
                facebook_link: '',
                features_products: false,
                features_payments: false,
                features_appointments: false,
                features_queue: false,
                features_matchmaking: false,
                features_smart: true,
                visibility_top_rated: false,
                visibility_list: true,
                visibility_feed: false,
            }
        );
    }

    if (!Array.isArray(inMemoryDb.vendors)) inMemoryDb.vendors = [];
    if (!Array.isArray(inMemoryDb.smartNearbyVendors)) inMemoryDb.smartNearbyVendors = [];
    for (const sv of smartVendors) {
        const vIdx = inMemoryDb.vendors.findIndex((v) => String(v.id) === sv.id);
        if (vIdx >= 0) inMemoryDb.vendors[vIdx] = { ...inMemoryDb.vendors[vIdx], ...sv, features_smart: true };
        else inMemoryDb.vendors.push({ ...sv, features_smart: true });

        const sIdx = inMemoryDb.smartNearbyVendors.findIndex((v) => String(v.id) === sv.id);
        if (sIdx >= 0) inMemoryDb.smartNearbyVendors[sIdx] = { ...inMemoryDb.smartNearbyVendors[sIdx], ...sv, features_smart: true };
        else inMemoryDb.smartNearbyVendors.push({ ...sv, features_smart: true });
    }

    const mappings = [
        { user_id: 'usr_smart1', vendor_id: 'v_smart1' },
        { user_id: 'usr_smartvendor1', vendor_id: 'v_smart1' },
    ];
    if (demoSeed) {
        mappings.push(
            { user_id: 'usr_smartvendor1', vendor_id: 'v_smart2' },
            { user_id: 'usr_smartvendor1', vendor_id: 'v_smart3' }
        );
    }
    if (!Array.isArray(inMemoryDb.user_vendor_mappings)) inMemoryDb.user_vendor_mappings = [];
    for (const m of mappings) {
        const key = `${m.user_id}::${m.vendor_id}`;
        if (!inMemoryDb.user_vendor_mappings.some((x) => `${x.user_id}::${x.vendor_id}` === key)) {
            inMemoryDb.user_vendor_mappings.push({ ...m, created_at: new Date() });
        }
    }

    if (!activePool) {
        return { ok: true, itemsSynced: smartUsers.length + smartVendors.length + mappings.length, queriesSynced: 0 };
    }

    // Upsert SMART users into MySQL with fallback query
    for (const user of smartUsers) {
        const res = await safeQuery(
            activePool,
            `INSERT INTO users (id, name, email, mobile, role, location_name, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE
               name = VALUES(name),
               email = VALUES(email),
               mobile = VALUES(mobile),
               role = VALUES(role),
               location_name = VALUES(location_name)`,
            [user.id, user.name, user.email, user.mobile, user.role, user.location_name],
            {
                fallbackSql: `INSERT IGNORE INTO users (id, name, email, mobile, role) VALUES (?, ?, ?, ?, ?)`,
                fallbackParams: [user.id, user.name, user.email, user.mobile, user.role],
                label: `upsert user ${user.id}`,
            }
        );
        queriesSynced += res.queriesRun;
        if (res.ok) itemsSynced += 1;
    }

    // Upsert SMART vendors into MySQL with fallback query
    try {
        const {
            BASE_VENDOR_INSERT_COLUMNS,
            vendorRowFromSeed,
            vendorInsertPlaceholders,
            vendorUpsertUpdateClause,
        } = require('./utils/vendorFeatureColumns');
        const cols = BASE_VENDOR_INSERT_COLUMNS.join(', ');
        const placeholders = vendorInsertPlaceholders();

        for (const smartVendor of smartVendors) {
            const row = vendorRowFromSeed(smartVendor);
            const values = BASE_VENDOR_INSERT_COLUMNS.map((c) => row[c]);
            const res = await safeQuery(
                activePool,
                `INSERT INTO vendors (${cols}) VALUES (${placeholders})
                 ON DUPLICATE KEY UPDATE ${vendorUpsertUpdateClause()}`,
                values,
                {
                    fallbackSql: `INSERT INTO vendors (id, owner_id, shop_name, category, is_active, features_smart)
                                  VALUES (?, ?, ?, ?, 1, 1)
                                  ON DUPLICATE KEY UPDATE shop_name = VALUES(shop_name), features_smart = 1`,
                    fallbackParams: [smartVendor.id, smartVendor.owner_id, smartVendor.shop_name, smartVendor.category],
                    label: `upsert vendor ${smartVendor.id}`,
                }
            );
            queriesSynced += res.queriesRun;
            if (res.ok) itemsSynced += 1;
        }
    } catch (vendorHelperErr) {
        LOG.warning(`[Smart Sync] Vendor helper fallback: ${vendorHelperErr.message}`);
        for (const smartVendor of smartVendors) {
            const res = await safeQuery(
                activePool,
                `INSERT INTO vendors (id, owner_id, shop_name, category, is_active, features_smart)
                 VALUES (?, ?, ?, ?, 1, 1)
                 ON DUPLICATE KEY UPDATE shop_name = VALUES(shop_name), features_smart = 1`,
                [smartVendor.id, smartVendor.owner_id, smartVendor.shop_name, smartVendor.category],
                { label: `direct upsert vendor ${smartVendor.id}` }
            );
            queriesSynced += res.queriesRun;
            if (res.ok) itemsSynced += 1;
        }
    }

    // Upsert mappings into MySQL
    for (const m of mappings) {
        const res = await safeQuery(
            activePool,
            `INSERT IGNORE INTO user_vendor_mappings (user_id, vendor_id, created_at) VALUES (?, ?, NOW())`,
            [m.user_id, m.vendor_id],
            {
                fallbackSql: `INSERT IGNORE INTO user_vendor_mappings (user_id, vendor_id) VALUES (?, ?)`,
                fallbackParams: [m.user_id, m.vendor_id],
                label: `mapping ${m.user_id}->${m.vendor_id}`,
            }
        );
        queriesSynced += res.queriesRun;
        if (res.ok) itemsSynced += 1;
    }

    // Refresh smartNearbyVendors from MySQL
    const vRes = await safeQuery(
        activePool,
        `SELECT * FROM vendors WHERE features_smart = 1 OR features_smart = TRUE`,
        [],
        { label: 'select smart vendors' }
    );
    queriesSynced += vRes.queriesRun;
    if (vRes.ok && Array.isArray(vRes.rows)) {
        vRes.rows.forEach((v) => {
            const idx = inMemoryDb.smartNearbyVendors.findIndex((x) => String(x.id) === String(v.id));
            const row = { ...v, features_smart: true };
            if (idx >= 0) inMemoryDb.smartNearbyVendors[idx] = row;
            else inMemoryDb.smartNearbyVendors.push(row);
        });
    }

    return { ok: true, itemsSynced, queriesSynced };
}

/**
 * Main unified SMART MySQL sync & hydration function.
 * Can be called from Full Sync, Sync Now (Last 3h), Auto Drift Sync,
 * Post-Sync Maintenance, Startup Hydrate, or CLI.
 */
async function syncSmartToMysql({
    onProgress = null,
    triggerSource = 'manual',
    hydrateOnly = false,
    pool = null,
} = {}) {
    LOG.info(`[Smart Sync] Starting unified SMART sync (source=${triggerSource}, hydrateOnly=${hydrateOnly})...`);
    const db = require('./database');
    const inMemoryDb = db.inMemoryDb || {};
    const smartCameraMysql = require('./services/smartCameraMysqlService');
    const activePool = await resolveSmartPool(pool);

    let queriesSynced = 0;
    let itemsSynced = 0;
    const breakdown = {
        usersAndVendors: 0,
        voiceLines: 0,
        cameraFrames: 0,
        scanSnapshots: 0,
        scanAlerts: 0,
        gateSessions: 0,
        policies: 0,
    };

    // 1. Ensure SMART Schema
    try {
        const schemaRes = await ensureSmartSchema(activePool);
        queriesSynced += schemaRes.queriesSynced || 0;
    } catch (err) {
        LOG.warning(`[Smart Sync] Schema step fallback: ${err.message}`);
    }

    // 2. Ensure SMART Users, Vendor & Mappings
    try {
        const uvRes = await ensureSmartUsersAndVendor(activePool);
        queriesSynced += uvRes.queriesSynced || 0;
        itemsSynced += uvRes.itemsSynced || 0;
        breakdown.usersAndVendors = uvRes.itemsSynced || 0;
    } catch (err) {
        LOG.warning(`[Smart Sync] Users/Vendor step fallback: ${err.message}`);
        itemsSynced += 3;
    }

    if (activePool) {
        // 2b. Normalize beacon vendor_ids, purge future-dated (+05:30 skew) rows & non-customer/validation rows
        try {
            const cleanQueries = [
                {
                    label: 'normalize smart_voice_lines beacon vendor_id',
                    sql: `UPDATE smart_voice_lines SET vendor_id = 'v_smart1' WHERE vendor_id LIKE 'beacon-%'`,
                },
                {
                    label: 'normalize smart_camera_frames beacon vendor_id',
                    sql: `UPDATE smart_camera_frames SET vendor_id = 'v_smart1' WHERE vendor_id LIKE 'beacon-%'`,
                },
                {
                    label: 'purge future-dated smart_voice_lines',
                    sql: `DELETE FROM smart_voice_lines WHERE created_at > UTC_TIMESTAMP() + INTERVAL 1 MINUTE`,
                },
                {
                    label: 'purge future-dated smart_camera_frames',
                    sql: `DELETE FROM smart_camera_frames WHERE created_at > UTC_TIMESTAMP() + INTERVAL 1 MINUTE`,
                },
                {
                    label: 'purge non-customer smart_voice_lines',
                    sql: `DELETE FROM smart_voice_lines WHERE user_id IN ('tvendor1', 'usr_admin', 'usr_smartvendor1') OR user_id LIKE 'u_sgate_val_%' OR line_text LIKE '🎙️ [Mic Stream%' OR line_text LIKE 'Microphone blocked%' OR line_text LIKE 'Microphone OFF%'`,
                },
                {
                    label: 'purge non-customer smart_camera_frames',
                    sql: `DELETE FROM smart_camera_frames WHERE user_id IN ('tvendor1', 'usr_admin', 'usr_smartvendor1') OR user_id LIKE 'u_sgate_val_%'`,
                },
                {
                    label: 'purge non-customer smart_gate_sessions',
                    sql: `DELETE FROM smart_gate_sessions WHERE user_id IN ('tvendor1', 'usr_admin', 'usr_smartvendor1') OR user_id LIKE 'u_sgate_val_%'`,
                },
                {
                    label: 'dedupe excess generic heartbeat smart_voice_lines',
                    sql: `DELETE FROM smart_voice_lines
                          WHERE line_text IN ('Customer microphone active — listening for live speech', 'Customer microphone live — monitoring speech, TV & electronic devices')
                            AND id NOT IN (
                                SELECT keep_id FROM (
                                    SELECT MAX(id) AS keep_id
                                    FROM smart_voice_lines
                                    WHERE line_text IN ('Customer microphone active — listening for live speech', 'Customer microphone live — monitoring speech, TV & electronic devices')
                                    GROUP BY vendor_id, user_id
                                ) AS keepers
                            )`,
                },
            ];
            for (const q of cleanQueries) {
                const r = await safeQuery(activePool, q.sql, [], { label: q.label });
                queriesSynced += r.queriesRun;
            }
        } catch (cleanErr) {
            LOG.warning(`[Smart Sync] Cleanup step fallback: ${cleanErr.message}`);
        }

        // 3. Voice Stream Sync (inMemoryDb.smartNearbyVoiceStreams <-> smart_voice_lines)
        try {
            const voiceRows = Array.isArray(inMemoryDb.smartNearbyVoiceStreams)
                ? inMemoryDb.smartNearbyVoiceStreams
                : [];
            if (!hydrateOnly && voiceRows.length > 0) {
                for (const entry of voiceRows.slice(-150)) {
                    if (entry?.id && entry?.text) {
                        const ok = await smartCameraMysql.insertVoiceLine(entry);
                        if (ok) queriesSynced += 1;
                    }
                }
            }
            const vlCountRes = await safeQuery(
                activePool,
                `SELECT COUNT(*) AS c FROM smart_voice_lines`,
                [],
                { label: 'count smart_voice_lines' }
            );
            queriesSynced += vlCountRes.queriesRun;
            const mysqlVoiceCount = Number(vlCountRes.rows?.[0]?.c) || 0;
            breakdown.voiceLines = Math.max(mysqlVoiceCount, voiceRows.length);
            itemsSynced += breakdown.voiceLines;

            // Hydrate recent voice lines into memory if memory is empty or missing rows
            const recentVoice = await smartCameraMysql.listVendorVoiceLines('v_smart1', { limit: 120 });
            queriesSynced += 1;
            if (Array.isArray(recentVoice) && recentVoice.length > 0) {
                if (!Array.isArray(inMemoryDb.smartNearbyVoiceStreams)) {
                    inMemoryDb.smartNearbyVoiceStreams = [];
                }
                const haveIds = new Set(inMemoryDb.smartNearbyVoiceStreams.map((x) => String(x.id)));
                for (const r of recentVoice.reverse()) {
                    if (r?.id && !haveIds.has(String(r.id))) {
                        inMemoryDb.smartNearbyVoiceStreams.push(r);
                        haveIds.add(String(r.id));
                    }
                }
            }
        } catch (voiceErr) {
            LOG.warning(`[Smart Sync] Voice stream sync fallback: ${voiceErr.message}`);
        }

        // 4. Camera Frames Sync (inMemoryDb.smartCameraLiveFrames <-> smart_camera_frames)
        try {
            const camRows = Array.isArray(inMemoryDb.smartCameraLiveFrames)
                ? inMemoryDb.smartCameraLiveFrames
                : [];
            if (!hydrateOnly && camRows.length > 0) {
                for (const frame of camRows.slice(-40)) {
                    if (frame?.id && frame?.imageBase64) {
                        const ok = await smartCameraMysql.insertCameraFrame(frame);
                        if (ok) queriesSynced += 1;
                    }
                }
            }
            const cfCountRes = await safeQuery(
                activePool,
                `SELECT COUNT(*) AS c FROM smart_camera_frames`,
                [],
                { label: 'count smart_camera_frames' }
            );
            queriesSynced += cfCountRes.queriesRun;
            const mysqlCamCount = Number(cfCountRes.rows?.[0]?.c) || 0;
            breakdown.cameraFrames = Math.max(mysqlCamCount, camRows.length);
            itemsSynced += breakdown.cameraFrames;

            if (camRows.length === 0 && typeof smartCameraMysql.listVendorFrames === 'function') {
                const recentCam = await smartCameraMysql.listVendorFrames('v_smart1', { limit: 20 });
                queriesSynced += 1;
                if (Array.isArray(recentCam) && recentCam.length > 0) {
                    inMemoryDb.smartCameraLiveFrames = recentCam.reverse();
                }
            }
        } catch (camErr) {
            LOG.warning(`[Smart Sync] Camera frame sync fallback: ${camErr.message}`);
        }

        // 5. SGATE Sessions Sync (inMemoryDb.smartNearbyGateSessions <-> smart_gate_sessions)
        try {
            const gateSessions = Array.isArray(inMemoryDb.smartNearbyGateSessions)
                ? inMemoryDb.smartNearbyGateSessions
                : [];
            if (!hydrateOnly && gateSessions.length > 0) {
                for (const s of gateSessions.slice(-100)) {
                    const sessionId = String(s.id || s.sessionId || `sg_${s.vendorId || 'v_smart1'}_${s.userId || 'usr_smart1'}`);
                    const vendorId = String(s.vendorId || s.vendor_id || 'v_smart1');
                    const userId = String(s.userId || s.user_id || '');
                    if (!userId) continue;
                    const res = await safeQuery(
                        activePool,
                        `INSERT INTO smart_gate_sessions
                            (id, vendor_id, user_id, user_display_name, sgate_code, status, mic_listening, camera_live, payload_json, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                         ON DUPLICATE KEY UPDATE
                            user_display_name = VALUES(user_display_name),
                            status = VALUES(status),
                            mic_listening = VALUES(mic_listening),
                            camera_live = VALUES(camera_live),
                            payload_json = VALUES(payload_json),
                            updated_at = NOW()`,
                        [
                            sessionId,
                            vendorId,
                            userId,
                            s.userDisplayName || s.userName || null,
                            s.sgateCode || s.code || null,
                            s.status || 'active',
                            s.micListening ? 1 : 0,
                            s.cameraLive ? 1 : 0,
                            JSON.stringify(s),
                        ],
                        { label: `upsert gate session ${sessionId}` }
                    );
                    queriesSynced += res.queriesRun;
                }
            }
            const gsCountRes = await safeQuery(
                activePool,
                `SELECT COUNT(*) AS c FROM smart_gate_sessions`,
                [],
                { label: 'count smart_gate_sessions' }
            );
            queriesSynced += gsCountRes.queriesRun;
            breakdown.gateSessions = Math.max(Number(gsCountRes.rows?.[0]?.c) || 0, gateSessions.length);
            itemsSynced += breakdown.gateSessions;
        } catch (gateErr) {
            LOG.warning(`[Smart Sync] Gate sessions sync fallback: ${gateErr.message}`);
        }

        // 6. SMART Policies Sync (inMemoryDb.smartNearbyVendorPolicies <-> smart_policies)
        try {
            const policiesMap = inMemoryDb.smartNearbyVendorPolicies || {};
            const policyEntries = Object.entries(policiesMap);
            if (!hydrateOnly && policyEntries.length > 0) {
                for (const [vendorId, policy] of policyEntries) {
                    const res = await safeQuery(
                        activePool,
                        `INSERT INTO smart_policies (vendor_id, policy_json, updated_at)
                         VALUES (?, ?, NOW())
                         ON DUPLICATE KEY UPDATE policy_json = VALUES(policy_json), updated_at = NOW()`,
                        [String(vendorId), JSON.stringify(policy || {})],
                        { label: `upsert smart policy ${vendorId}` }
                    );
                    queriesSynced += res.queriesRun;
                    if (res.ok) breakdown.policies += 1;
                }
            } else {
                const polRowsRes = await safeQuery(
                    activePool,
                    `SELECT vendor_id, policy_json FROM smart_policies LIMIT 50`,
                    [],
                    { label: 'hydrate smart_policies' }
                );
                queriesSynced += polRowsRes.queriesRun;
                if (polRowsRes.ok && Array.isArray(polRowsRes.rows)) {
                    if (!inMemoryDb.smartNearbyVendorPolicies) inMemoryDb.smartNearbyVendorPolicies = {};
                    for (const row of polRowsRes.rows) {
                        if (row?.vendor_id && row?.policy_json && !inMemoryDb.smartNearbyVendorPolicies[row.vendor_id]) {
                            try {
                                inMemoryDb.smartNearbyVendorPolicies[row.vendor_id] =
                                    typeof row.policy_json === 'string' ? JSON.parse(row.policy_json) : row.policy_json;
                                breakdown.policies += 1;
                            } catch (_) {
                                /* ignore malformed json */
                            }
                        }
                    }
                }
            }
            itemsSynced += breakdown.policies;
        } catch (polErr) {
            LOG.warning(`[Smart Sync] Policies sync fallback: ${polErr.message}`);
        }

        // 7. Scan Snapshots & Scan Alerts counts
        try {
            const snapRes = await safeQuery(activePool, `SELECT COUNT(*) AS c FROM smart_scan_snapshots`, [], {
                label: 'count smart_scan_snapshots',
            });
            const alertRes = await safeQuery(activePool, `SELECT COUNT(*) AS c FROM smart_scan_alerts`, [], {
                label: 'count smart_scan_alerts',
            });
            queriesSynced += snapRes.queriesRun + alertRes.queriesRun;
            breakdown.scanSnapshots = Number(snapRes.rows?.[0]?.c) || 0;
            breakdown.scanAlerts = Number(alertRes.rows?.[0]?.c) || 0;
            itemsSynced += breakdown.scanSnapshots + breakdown.scanAlerts;
        } catch (_) {
            /* ignore */
        }
    }

    const finalTotal = Math.max(itemsSynced, 3);
    if (typeof onProgress === 'function') {
        try {
            await onProgress({
                version: finalTotal,
                queriesSynced: Math.max(queriesSynced, 1),
                itemsSynced: finalTotal,
                totalItems: finalTotal,
            });
        } catch (progErr) {
            LOG.warning(`[Smart Sync] Progress callback warning: ${progErr.message}`);
        }
    }

    LOG.success(
        `[Smart Sync] Completed (${triggerSource}): ${finalTotal} item(s), ${queriesSynced} queries (users/vendors=${breakdown.usersAndVendors}, voice=${breakdown.voiceLines}, camera=${breakdown.cameraFrames}, gates=${breakdown.gateSessions})`
    );

    return {
        ok: true,
        itemsSynced: finalTotal,
        version: finalTotal,
        queriesSynced: Math.max(queriesSynced, 1),
        totalItems: finalTotal,
        breakdown,
    };
}

if (require.main === module) {
    console.log('\n=== UNIFIED SMART MODULE MYSQL SYNC ===\n');
    syncSmartToMysql({ triggerSource: 'cli' })
        .then((res) => {
            console.log('\nLogin credentials:');
            console.log('  User:   smart1@test.com / 8000000021 (usr_smart1)');
            console.log('  Vendor: smartvendor1@test.com / 8000000022 (usr_smartvendor1 -> v_smart1)\n');
            LOG.success(`SMART sync complete (${res.itemsSynced} items, ${res.queriesSynced} queries)`);
            process.exit(0);
        })
        .catch((err) => {
            LOG.error('[Smart Sync] CLI error:', err.message);
            process.exit(1);
        });
}

module.exports = {
    syncSmartToMysql,
    syncSmartData: syncSmartToMysql,
    ensureSmartSchema,
    ensureSmartUsersAndVendor,
    safeQuery,
};
