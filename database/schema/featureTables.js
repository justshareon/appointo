/**
 * Per-feature MySQL upgrades (CREATE TABLE IF NOT EXISTS + ADD COLUMN).
 * Called on first open. Never DROP / TRUNCATE.
 */
const { runOnce, ensureTable, addColumns, addIndex } = require('../schemaUpgrade');

const LOG = {
    info: (msg) => console.log(`[FeatureSchema] ${msg}`),
    warn: (msg) => console.warn(`[FeatureSchema] ${msg}`),
};

function poolOf(mainDb) {
    if (!mainDb) return null;
    if (typeof mainDb.getPool === 'function') return mainDb.getPool();
    return mainDb.pool || null;
}

async function ensureCore(pool, mainDb) {
    if (mainDb?.ensureVendorFeatureColumns) await mainDb.ensureVendorFeatureColumns();
    if (mainDb?.ensureUserVendorMappingTable) await mainDb.ensureUserVendorMappingTable();
    if (mainDb?.ensureUsersUpdatedAtColumn) await mainDb.ensureUsersUpdatedAtColumn();
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS system_settings (
            key_name VARCHAR(50) PRIMARY KEY,
            value TEXT
        )
    `);
    await ensureTable(pool, `
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
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS otps (
            id INT AUTO_INCREMENT PRIMARY KEY,
            mobile VARCHAR(20) NOT NULL,
            otp VARCHAR(6) NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    try {
        const syncStatus = require('../../services/syncStatusService');
        await syncStatus.ensureTables(pool);
    } catch (e) {
        LOG.warn(`sync status tables skip: ${e.message}`);
    }
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS notifications (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(255),
            title VARCHAR(255),
            body TEXT,
            is_read TINYINT(1) DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await addColumns(pool, 'notifications', {
        body: 'TEXT NULL',
        message: 'TEXT NULL',
        type: 'VARCHAR(50) NULL',
        data_json: 'TEXT NULL',
    });
    await addIndex(pool, 'notifications', 'idx_notifications_user', 'user_id');
    await addColumns(pool, 'vendors', {
        features_news: 'TINYINT(1) DEFAULT 0',
        features_chat: 'TINYINT(1) DEFAULT 1',
        location_name: 'VARCHAR(255) NULL',
    });
    // Shop home uses these on first login — keep schema ready, seed still lazy per feature.
    await ensureQueue(pool);
    await ensureAppointments(pool);
    await ensureShopping(pool);
    await ensureChat(pool);
    await ensureHealth(pool);
}

async function ensureQueue(pool) {
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS queues (
            id INT AUTO_INCREMENT PRIMARY KEY,
            vendor_id VARCHAR(255),
            user_id VARCHAR(255),
            status ENUM('waiting', 'serving', 'done', 'cancelled') DEFAULT 'waiting',
            position INT,
            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await addColumns(pool, 'queues', {
        position: 'INT NULL',
    });
    await addIndex(pool, 'queues', 'idx_queue_vendor_status', 'vendor_id, status');
    await addIndex(pool, 'queues', 'idx_queue_user', 'user_id');
    await addIndex(pool, 'queues', 'idx_queue_status_joined', 'status, joined_at');
}

async function ensureAppointments(pool) {
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS appointments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            vendor_id VARCHAR(255),
            user_id VARCHAR(255),
            date DATE,
            time TIME,
            status VARCHAR(32) DEFAULT 'pending',
            notes VARCHAR(255) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await addColumns(pool, 'appointments', {
        status: "VARCHAR(32) DEFAULT 'pending'",
        notes: 'VARCHAR(255) NULL',
        updated_at: 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    });
    await addIndex(pool, 'appointments', 'idx_appt_status_date', 'status, date');
    await addIndex(pool, 'appointments', 'idx_appt_user', 'user_id');
    await addIndex(pool, 'appointments', 'idx_appt_vendor', 'vendor_id');
}

async function ensureShopping(pool) {
    await ensureTable(pool, `
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
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS orders (
            id INT AUTO_INCREMENT PRIMARY KEY,
            vendor_id VARCHAR(255) NOT NULL,
            user_id VARCHAR(255) NOT NULL,
            total_amount DECIMAL(10,2) NOT NULL,
            payment_gateway VARCHAR(30),
            payment_ref VARCHAR(255),
            status ENUM('paid', 'pending', 'failed') DEFAULT 'paid',
            items_json JSON,
            fulfillment_status VARCHAR(32) DEFAULT 'received',
            current_location VARCHAR(255) NULL,
            location_updated_at TIMESTAMP NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await addColumns(pool, 'products', {
        name_key: 'VARCHAR(255) NULL',
        description: 'TEXT NULL',
        stock: 'INT DEFAULT 0',
        image_urls_json: 'JSON NULL',
        validity_from: 'DATE NULL',
        validity_to: 'DATE NULL',
        category: 'VARCHAR(100) NULL',
        offer: 'VARCHAR(255) NULL',
        offer_amount: 'DECIMAL(10, 2) DEFAULT 0',
    });
    await addColumns(pool, 'orders', {
        fulfillment_status: "VARCHAR(32) DEFAULT 'received'",
        current_location: 'VARCHAR(255) NULL',
        location_updated_at: 'TIMESTAMP NULL',
        payment_gateway: 'VARCHAR(30) NULL',
        payment_ref: 'VARCHAR(255) NULL',
        items_json: 'JSON NULL',
    });
    await addIndex(pool, 'products', 'idx_products_vendor', 'vendor_id');
    await addIndex(pool, 'orders', 'idx_orders_vendor', 'vendor_id');
    await addIndex(pool, 'orders', 'idx_orders_user', 'user_id');
    await addIndex(pool, 'orders', 'idx_orders_created', 'created_at');
}

async function ensureChat(pool) {
    await ensureTable(pool, `
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
}

async function ensureNews(pool, mainDb) {
    if (mainDb?.ensureNewsCacheTable) {
        await mainDb.ensureNewsCacheTable();
        return;
    }
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS news_cache (
            id INT AUTO_INCREMENT PRIMARY KEY,
            unique_key VARCHAR(255) UNIQUE,
            text TEXT,
            link TEXT,
            source VARCHAR(255),
            category VARCHAR(255),
            country VARCHAR(255),
            city VARCHAR(255),
            locality VARCHAR(255),
            image TEXT,
            published_at DATETIME NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
}

async function ensureHealth(pool) {
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS health_reports (
            id VARCHAR(64) PRIMARY KEY,
            user_id VARCHAR(64) NOT NULL,
            vendor_id VARCHAR(64) NULL,
            report_year INT NOT NULL,
            report_type VARCHAR(64) NULL,
            file_name VARCHAR(255) NULL,
            notes TEXT NULL,
            markers_json TEXT NULL,
            extracted_text TEXT NULL,
            created_at DATETIME NULL
        )
    `);
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS health_illness_years (
            id VARCHAR(64) PRIMARY KEY,
            illness_key VARCHAR(64) NOT NULL,
            year INT NOT NULL,
            risk_index INT NOT NULL,
            note TEXT NULL,
            source VARCHAR(255) NULL
        )
    `);
}

async function ensureOffer(pool) {
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS companies (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL UNIQUE,
            slug VARCHAR(50) NOT NULL UNIQUE,
            base_url VARCHAR(255),
            api_endpoint VARCHAR(255),
            api_key VARCHAR(255),
            logo_url VARCHAR(255),
            is_active BOOLEAN DEFAULT TRUE,
            sync_interval_minutes INT DEFAULT 30,
            last_synced_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS categories (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(200) NOT NULL,
            slug VARCHAR(100) NOT NULL UNIQUE,
            parent_id INT NULL,
            level TINYINT DEFAULT 1,
            description TEXT,
            image_url VARCHAR(255),
            is_active BOOLEAN DEFAULT TRUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS deals (
            id INT AUTO_INCREMENT PRIMARY KEY,
            company_id INT NOT NULL,
            external_deal_id VARCHAR(200),
            title VARCHAR(500) NOT NULL,
            description TEXT,
            discount_text_raw VARCHAR(500),
            discount_type VARCHAR(32) DEFAULT 'OTHER',
            discount_percentage_min DECIMAL(5, 2) NULL,
            discount_percentage_max DECIMAL(5, 2) NULL,
            discount_amount_min DECIMAL(10, 2) NULL,
            discount_amount_max DECIMAL(10, 2) NULL,
            starting_price DECIMAL(10, 2) NULL,
            url VARCHAR(500),
            image_url VARCHAR(255),
            start_date DATETIME,
            end_date DATETIME,
            is_active BOOLEAN DEFAULT TRUE,
            is_featured BOOLEAN DEFAULT FALSE,
            view_count INT DEFAULT 0,
            metadata JSON,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS sync_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            company_id INT NULL,
            sync_type VARCHAR(32) DEFAULT 'FULL',
            status VARCHAR(32) DEFAULT 'PENDING',
            message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

async function ensureRealestate(pool) {
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS real_estate_properties (
            id INT AUTO_INCREMENT PRIMARY KEY,
            vendor_id VARCHAR(255),
            property_type VARCHAR(32) DEFAULT 'apartment',
            title VARCHAR(255) NOT NULL,
            description TEXT,
            address TEXT,
            city VARCHAR(100),
            state VARCHAR(100),
            pincode VARCHAR(10),
            locality VARCHAR(255),
            latitude DECIMAL(10, 8),
            longitude DECIMAL(11, 8),
            price DECIMAL(15, 2),
            price_unit VARCHAR(32) DEFAULT 'lakhs',
            area_sqft DECIMAL(10, 2),
            bedrooms INT,
            bathrooms INT,
            images JSON,
            amenities JSON,
            rera_registered BOOLEAN DEFAULT FALSE,
            rera_number VARCHAR(100),
            availability_status VARCHAR(32) DEFAULT 'available',
            is_active BOOLEAN DEFAULT TRUE,
            is_featured BOOLEAN DEFAULT FALSE,
            view_count INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS real_estate_enquiries (
            id INT AUTO_INCREMENT PRIMARY KEY,
            property_id INT NOT NULL,
            user_id VARCHAR(255),
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255),
            mobile VARCHAR(20) NOT NULL,
            message TEXT,
            enquiry_type VARCHAR(16) DEFAULT 'info',
            status VARCHAR(32) DEFAULT 'new',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS real_estate_favorites (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            property_id INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_user_property (user_id, property_id)
        )
    `);
}

async function ensureTrustScore(pool) {
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS trust_score_projects (
            id VARCHAR(64) PRIMARY KEY,
            name VARCHAR(255),
            rera_number VARCHAR(64),
            builder_name VARCHAR(255),
            builder_id VARCHAR(64),
            address TEXT,
            latitude DECIMAL(10, 8),
            longitude DECIMAL(11, 8),
            total_area VARCHAR(64),
            number_of_floors INT,
            number_of_units INT,
            project_status VARCHAR(64),
            launch_date DATE NULL,
            expected_completion_date DATE NULL,
            actual_completion_date DATE NULL,
            rera_extension_details TEXT,
            land_ownership_title VARCHAR(128),
            land_owner_name VARCHAR(255),
            land_area VARCHAR(64),
            land_id VARCHAR(64),
            approval_authorities TEXT,
            approved_building_plans TEXT,
            bank_name VARCHAR(128),
            loan_amount_sanctioned VARCHAR(64),
            total_amount_collected VARCHAR(64),
            funding_sources TEXT,
            litigation_history TEXT,
            rera_complaints_count INT DEFAULT 0,
            rera_complaints_status VARCHAR(128),
            trust_score INT DEFAULT 0,
            builder_score INT DEFAULT 0,
            project_score INT DEFAULT 0,
            completion INT DEFAULT 0,
            price_rise VARCHAR(32),
            location VARCHAR(128),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS trust_score_builders (
            id VARCHAR(64) PRIMARY KEY,
            name VARCHAR(255),
            rera_registration VARCHAR(128),
            address TEXT,
            total_projects INT DEFAULT 0,
            delivered_projects INT DEFAULT 0,
            ongoing_projects INT DEFAULT 0,
            delayed_projects INT DEFAULT 0,
            delivered_on_time INT DEFAULT 0,
            rera_complaints INT DEFAULT 0,
            cidco_complaints INT DEFAULT 0,
            land_title_disputes INT DEFAULT 0,
            average_user_rating DECIMAL(4, 2) DEFAULT 0,
            total_reviews INT DEFAULT 0,
            years_in_business INT DEFAULT 0,
            trust_score INT DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS trust_score_reviews (
            id VARCHAR(64) PRIMARY KEY,
            user_id VARCHAR(64),
            entity_type VARCHAR(32),
            entity_id VARCHAR(64),
            entity_name VARCHAR(255),
            rating INT DEFAULT 0,
            title VARCHAR(255),
            review TEXT,
            tags TEXT,
            helpful_count INT DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS trust_score_complaints (
            id VARCHAR(64) PRIMARY KEY,
            user_id VARCHAR(64),
            project_id VARCHAR(64),
            project_name VARCHAR(255),
            issue_type VARCHAR(64),
            description TEXT,
            status VARCHAR(32),
            documents TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS trust_score_fraud_alerts (
            id VARCHAR(64) PRIMARY KEY,
            land_id VARCHAR(64),
            latitude DECIMAL(10, 8),
            longitude DECIMAL(11, 8),
            project_id VARCHAR(64),
            project_name VARCHAR(255),
            fraud_type VARCHAR(64),
            severity VARCHAR(16),
            status VARCHAR(32),
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS trust_score_watchlist (
            id VARCHAR(64) PRIMARY KEY,
            user_id VARCHAR(64),
            project_id VARCHAR(64),
            project_name VARCHAR(255),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS trust_score_land_ledger (
            id VARCHAR(64) PRIMARY KEY,
            land_id VARCHAR(64),
            latitude DECIMAL(10, 8),
            longitude DECIMAL(11, 8),
            buyer_id VARCHAR(64),
            buyer_name VARCHAR(255),
            sale_date DATE NULL,
            amount VARCHAR(64),
            status VARCHAR(32),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS trust_score_contributor_scores (
            user_id VARCHAR(64) PRIMARY KEY,
            score INT DEFAULT 0,
            rating VARCHAR(32),
            points_this_month INT DEFAULT 0,
            total_points INT DEFAULT 0,
            activities TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS trust_score_api_configs (
            id VARCHAR(50) PRIMARY KEY,
            authority_name VARCHAR(100) NOT NULL,
            authority_type VARCHAR(32) NOT NULL,
            base_url VARCHAR(500),
            api_key VARCHAR(500),
            api_secret VARCHAR(500),
            auth_type VARCHAR(32) DEFAULT 'Bearer',
            auth_header VARCHAR(100) DEFAULT 'Authorization',
            is_enabled BOOLEAN DEFAULT TRUE,
            use_api BOOLEAN DEFAULT TRUE,
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
}

async function ensureTrade(pool, mainDb) {
    if (mainDb?.ensureVendorFeatureColumns) await mainDb.ensureVendorFeatureColumns();
    try {
        const featureEngineeringService = require('../../services/featureEngineeringService');
        if (featureEngineeringService.initializeTables) {
            await featureEngineeringService.initializeTables();
        }
    } catch (err) {
        LOG.warn(`Trade indicators: ${err.message}`);
    }
}

async function ensureRDetector(pool) {
    const commuteService = require('../../services/rDetectorCommuteService');
    const rDetectorService = require('../../services/rDetectorService');
    await commuteService.ensureCommuteTables();
    await rDetectorService.ensureScanResultsTable(pool);
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS r_detector_incident_votes (
            incident_id VARCHAR(64) NOT NULL,
            user_id VARCHAR(64) NOT NULL,
            vote VARCHAR(32) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (incident_id, user_id)
        )
    `);
}

async function ensureSuraksha(pool) {
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS suraksha_validations (
            id VARCHAR(64) PRIMARY KEY,
            user_id VARCHAR(64) NOT NULL,
            input_value VARCHAR(500) NOT NULL,
            type VARCHAR(32) NOT NULL,
            status VARCHAR(32) DEFAULT 'pending',
            result_data JSON NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_user_created (user_id, created_at)
        )
    `);
    await ensureTable(pool, `
        CREATE TABLE IF NOT EXISTS suraksha_reports (
            id VARCHAR(64) PRIMARY KEY,
            user_id VARCHAR(64) NOT NULL,
            complaint_id VARCHAR(64) NULL,
            input VARCHAR(500) NULL,
            type VARCHAR(32) NULL,
            amount DECIMAL(12, 2) DEFAULT 0,
            beneficiary VARCHAR(255) NULL,
            description TEXT NULL,
            transaction_date VARCHAR(32) NULL,
            evidence JSON NULL,
            status VARCHAR(32) DEFAULT 'saved',
            govt_sent TINYINT(1) DEFAULT 0,
            govt_complaint_id VARCHAR(64) NULL,
            reminder_count INT DEFAULT 0,
            last_reminder_at DATETIME NULL,
            sent_at DATETIME NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_user_created (user_id, created_at)
        )
    `);
}

const HANDLERS = {
    core: ensureCore,
    queue: ensureQueue,
    appointments: ensureAppointments,
    shopping: ensureShopping,
    chat: ensureChat,
    news: ensureNews,
    health: ensureHealth,
    offer: ensureOffer,
    realestate: ensureRealestate,
    trust_score: ensureTrustScore,
    trade: ensureTrade,
    qless: async (pool, mainDb) => {
        if (mainDb?.ensureVendorFeatureColumns) await mainDb.ensureVendorFeatureColumns();
    },
    matchmaking: async (_pool, mainDb) => {
        if (mainDb?.ensureMatchmakingTables) await mainDb.ensureMatchmakingTables();
    },
    fleet: async (_pool, mainDb) => {
        if (mainDb?.ensureFleetTables) await mainDb.ensureFleetTables();
    },
    r_detector: ensureRDetector,
    cyber: async (pool, mainDb) => {
        if (mainDb?.ensureCyberThreatTables) await mainDb.ensureCyberThreatTables();
        await ensureSuraksha(pool);
    },
};

async function ensureFeatureSchema(featureId, mainDb) {
    const handler = HANDLERS[featureId];
    if (!handler) return;
    await runOnce(`schema:${featureId}:v3`, async () => {
        const pool = poolOf(mainDb);
        if (!pool) {
            LOG.info(`Skipped MySQL schema for "${featureId}" (in-memory mode)`);
            return;
        }
        try {
            await handler(pool, mainDb);
            LOG.info(`Upgraded schema for "${featureId}"`);
        } catch (err) {
            LOG.warn(`Schema upgrade for "${featureId}" skipped: ${err.message}`);
        }
    });
}

module.exports = {
    ensureFeatureSchema,
    HANDLERS,
};
