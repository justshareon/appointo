/**
 * Database Setup Script for Trading and Real Estate Features
 * This script initializes all MySQL tables required for trading and real estate functionality
 * 
 * Usage:
 *   node setup_trading_realestate_db.js
 * 
 * Make sure your .env file has the correct MySQL credentials:
 *   DB_HOST=localhost
 *   DB_PORT=3306
 *   DB_USER=root
 *   DB_PASSWORD=your_password
 *   DB_NAME=qr_queue
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

const LOG = {
    info: (msg) => console.log(`[INFO] ${new Date().toLocaleTimeString()} | ${msg}`),
    success: (msg) => console.log(`[SUCCESS] ${new Date().toLocaleTimeString()} | ${msg}`),
    error: (msg, detail = '') => console.error(`[ERROR] ${new Date().toLocaleTimeString()} | ${msg} ${detail}`),
    warning: (msg) => console.warn(`[WARN] ${new Date().toLocaleTimeString()} | ${msg}`)
};

const tradingSchema = `
-- ============================================
-- TRADING FEATURES DATABASE SCHEMA
-- ============================================

-- Stock Data Tables
CREATE TABLE IF NOT EXISTS live_stock_data (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    company_name VARCHAR(255),
    last_price DECIMAL(10, 2),
    \`change\` DECIMAL(10, 2),
    percent_change DECIMAL(5, 2),
    volume BIGINT,
    market_cap BIGINT,
    pe_ratio DECIMAL(10, 2),
    week_52_low DECIMAL(10, 2),
    week_52_high DECIMAL(10, 2),
    data_type ENUM('gainers', 'decliners', 'actives', 'data') DEFAULT 'data',
    additional_data JSON,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_symbol_type (symbol, data_type),
    INDEX idx_symbol (symbol),
    INDEX idx_data_type (data_type),
    INDEX idx_last_updated (last_updated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_data_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    company_name VARCHAR(255),
    last_price DECIMAL(10, 2),
    \`change\` DECIMAL(10, 2),
    percent_change DECIMAL(5, 2),
    volume BIGINT,
    market_cap BIGINT,
    pe_ratio DECIMAL(10, 2),
    week_52_low DECIMAL(10, 2),
    week_52_high DECIMAL(10, 2),
    data_type ENUM('gainers', 'decliners', 'actives', 'data') DEFAULT 'data',
    additional_data JSON,
    archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_symbol (symbol),
    INDEX idx_data_type (data_type),
    INDEX idx_archived_at (archived_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Trading Stock Quotes Table
CREATE TABLE IF NOT EXISTS trading_stock_quotes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL,
    full_symbol VARCHAR(50) NOT NULL,
    name VARCHAR(255),
    price DECIMAL(15, 2),
    change_amount DECIMAL(15, 2),
    change_percent DECIMAL(10, 4),
    previous_close DECIMAL(15, 2),
    open_price DECIMAL(15, 2),
    high_price DECIMAL(15, 2),
    low_price DECIMAL(15, 2),
    volume BIGINT,
    market_cap BIGINT,
    currency VARCHAR(10) DEFAULT 'INR',
    exchange VARCHAR(10) DEFAULT 'NSE',
    quote_date DATE NOT NULL,
    quote_time TIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_symbol (symbol),
    INDEX idx_quote_date (quote_date),
    INDEX idx_full_symbol (full_symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Trading Market Indices Table
CREATE TABLE IF NOT EXISTS trading_market_indices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    index_name VARCHAR(50) NOT NULL,
    value DECIMAL(15, 2),
    change_amount DECIMAL(15, 2),
    change_percent DECIMAL(10, 4),
    expiry_date VARCHAR(50),
    quote_date DATE NOT NULL,
    quote_time TIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_index_name (index_name),
    INDEX idx_quote_date (quote_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Trading Top Stocks Table
CREATE TABLE IF NOT EXISTS trading_top_stocks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL,
    name VARCHAR(255),
    price DECIMAL(15, 2),
    change_amount DECIMAL(15, 2),
    change_percent DECIMAL(10, 4),
    volume BIGINT,
    category ENUM('gainers', 'losers', 'market_high', 'most_bought') NOT NULL,
    rank INT,
    quote_date DATE NOT NULL,
    quote_time TIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    INDEX idx_quote_date (quote_date),
    INDEX idx_symbol (symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Stock Indicators Table (for technical analysis)
CREATE TABLE IF NOT EXISTS stock_indicators (
    symbol VARCHAR(20) NOT NULL,
    computed_at DATETIME NOT NULL,
    -- 20 indicator columns
    sma10 DECIMAL(10,2),
    sma20 DECIMAL(10,2),
    sma50 DECIMAL(10,2),
    ema12 DECIMAL(10,2),
    ema26 DECIMAL(10,2),
    macd DECIMAL(10,2),
    macd_signal DECIMAL(10,2),
    macd_histogram DECIMAL(10,2),
    rsi14 DECIMAL(10,2),
    bb_upper DECIMAL(10,2),
    bb_middle DECIMAL(10,2),
    bb_lower DECIMAL(10,2),
    atr14 DECIMAL(10,2),
    stoch_k DECIMAL(10,2),
    stoch_d DECIMAL(10,2),
    williams_r DECIMAL(10,2),
    cci20 DECIMAL(10,2),
    adx14 DECIMAL(10,2),
    obv DECIMAL(20,2),
    vwap DECIMAL(10,2),
    mom10 DECIMAL(10,2),
    roc12 DECIMAL(10,2),
    mfi14 DECIMAL(10,2),
    psar DECIMAL(10,2),
    ad_line DECIMAL(20,2),
    bb_percent_b DECIMAL(10,4),
    volume_roc DECIMAL(10,2),
    ichimoku_tenkan DECIMAL(10,2),
    ichimoku_kijun DECIMAL(10,2),
    -- Optional fundamentals
    market_cap DECIMAL(20,2),
    pe_ratio DECIMAL(10,2),
    week_52_low DECIMAL(10,2),
    week_52_high DECIMAL(10,2),
    -- Prediction fields
    prediction BOOLEAN DEFAULT FALSE,
    confidence DECIMAL(5,2),
    positive_indicators INT DEFAULT 0,
    total_indicators INT DEFAULT 0,
    positive_ratio DECIMAL(5,4),
    all_indicators_positive BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (symbol, computed_at),
    INDEX idx_symbol (symbol),
    INDEX idx_computed_at (computed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Stock History Table (for indicator calculations)
CREATE TABLE IF NOT EXISTS stock_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    date DATE NOT NULL,
    open DECIMAL(10,2),
    high DECIMAL(10,2),
    low DECIMAL(10,2),
    close DECIMAL(10,2),
    volume BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_symbol_date (symbol, date),
    INDEX idx_symbol (symbol),
    INDEX idx_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Mutual Funds Table
CREATE TABLE IF NOT EXISTS mutual_funds (
    id INT AUTO_INCREMENT PRIMARY KEY,
    scheme_code VARCHAR(50),
    scheme_name VARCHAR(255) NOT NULL,
    nav DECIMAL(10, 4),
    \`change\` DECIMAL(10, 4),
    change_percent DECIMAL(5, 2),
    category VARCHAR(100),
    fund_house VARCHAR(255),
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_scheme_code (scheme_code),
    INDEX idx_category (category),
    INDEX idx_scheme_name (scheme_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Corporate Actions Table
CREATE TABLE IF NOT EXISTS corporate_actions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    company_name VARCHAR(255),
    action_type VARCHAR(100),
    ex_date DATE,
    record_date DATE,
    purpose TEXT,
    details JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_symbol (symbol),
    INDEX idx_ex_date (ex_date),
    INDEX idx_action_type (action_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Board Meetings Table
CREATE TABLE IF NOT EXISTS board_meetings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL,
    company_name VARCHAR(255),
    meeting_date DATE,
    meeting_type VARCHAR(100),
    purpose TEXT,
    details JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_symbol (symbol),
    INDEX idx_meeting_date (meeting_date),
    INDEX idx_meeting_type (meeting_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Trading Orders Table
CREATE TABLE IF NOT EXISTS trading_orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id VARCHAR(100) NOT NULL UNIQUE,
    user_id VARCHAR(255) NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    quantity INT NOT NULL,
    order_type ENUM('LIMIT', 'MARKET') NOT NULL,
    price DECIMAL(15, 2),
    side ENUM('BUY', 'SELL') NOT NULL,
    api_provider VARCHAR(50) DEFAULT 'Zerodha',
    validity ENUM('Day', 'IOC', 'FOK', 'GTD') DEFAULT 'Day',
    status ENUM('pending', 'executed', 'cancelled', 'rejected', 'partially_executed') DEFAULT 'pending',
    order_value DECIMAL(15, 2),
    executed_price DECIMAL(15, 2),
    executed_quantity INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_symbol (symbol),
    INDEX idx_status (status),
    INDEX idx_order_id (order_id),
    INDEX idx_created_at (created_at),
    INDEX idx_side (side),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Trading Fund Transactions Table
CREATE TABLE IF NOT EXISTS trading_fund_transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    type ENUM('credit', 'debit') NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    payment_method VARCHAR(50) DEFAULT 'UPI',
    description TEXT,
    status ENUM('pending', 'completed', 'failed', 'cancelled') DEFAULT 'completed',
    transaction_reference VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_type (type),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const realEstateSchema = `
-- ============================================
-- REAL ESTATE FEATURES DATABASE SCHEMA
-- ============================================

-- Properties/Listings Table
CREATE TABLE IF NOT EXISTS real_estate_properties (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vendor_id VARCHAR(255),
    property_type ENUM('apartment', 'house', 'villa', 'plot', 'commercial', 'office', 'shop', 'warehouse', 'other') DEFAULT 'apartment',
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
    price_unit ENUM('lakhs', 'crores', 'sqft', 'sqmeter', 'per_month', 'per_year') DEFAULT 'lakhs',
    area_sqft DECIMAL(10, 2),
    bedrooms INT,
    bathrooms INT,
    balconies INT,
    floors INT,
    floor_number INT,
    facing ENUM('north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest'),
    age_of_construction INT COMMENT 'Age in years',
    furnishing_status ENUM('unfurnished', 'semi_furnished', 'fully_furnished'),
    parking_spots INT,
    lift_available BOOLEAN DEFAULT FALSE,
    power_backup BOOLEAN DEFAULT FALSE,
    water_supply ENUM('municipal', 'borewell', 'both'),
    images JSON COMMENT 'Array of image URLs',
    amenities JSON COMMENT 'Array of amenities like ["swimming_pool", "gym", "park"]',
    rera_registered BOOLEAN DEFAULT FALSE,
    rera_number VARCHAR(100),
    availability_status ENUM('available', 'sold', 'rented', 'under_construction', 'reserved') DEFAULT 'available',
    possession_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    is_featured BOOLEAN DEFAULT FALSE,
    view_count INT DEFAULT 0,
    INDEX idx_vendor (vendor_id),
    INDEX idx_property_type (property_type),
    INDEX idx_city (city),
    INDEX idx_locality (locality),
    INDEX idx_price (price),
    INDEX idx_availability (availability_status),
    INDEX idx_active (is_active),
    INDEX idx_location (latitude, longitude),
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Property Enquiries Table
CREATE TABLE IF NOT EXISTS real_estate_enquiries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    property_id INT NOT NULL,
    user_id VARCHAR(255),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    mobile VARCHAR(20) NOT NULL,
    message TEXT,
    enquiry_type ENUM('buy', 'rent', 'visit', 'info') DEFAULT 'info',
    status ENUM('new', 'contacted', 'interested', 'not_interested', 'closed') DEFAULT 'new',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_property (property_id),
    INDEX idx_user (user_id),
    INDEX idx_status (status),
    FOREIGN KEY (property_id) REFERENCES real_estate_properties(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Property Favorites/Wishlist Table
CREATE TABLE IF NOT EXISTS real_estate_favorites (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    property_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_user_property (user_id, property_id),
    INDEX idx_user (user_id),
    INDEX idx_property (property_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (property_id) REFERENCES real_estate_properties(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

async function setupDatabase() {
    let connection;
    
    try {
        // Get database credentials from environment variables
        const dbConfig = {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '3306'),
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || 'root',
            database: process.env.DB_NAME || 'qr_queue',
            multipleStatements: true
        };

        LOG.info(`Connecting to MySQL at ${dbConfig.host}:${dbConfig.port}...`);
        connection = await mysql.createConnection(dbConfig);
        LOG.success('Connected to MySQL database');

        // Create database if it doesn't exist
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\``);
        await connection.query(`USE \`${dbConfig.database}\``);
        LOG.success(`Using database: ${dbConfig.database}`);

        // Setup Trading Tables
        LOG.info('Setting up Trading tables...');
        await connection.query(tradingSchema);
        LOG.success('Trading tables created successfully');

        // Setup Real Estate Tables
        LOG.info('Setting up Real Estate tables...');
        await connection.query(realEstateSchema);
        LOG.success('Real Estate tables created successfully');

        // Verify tables were created
        LOG.info('Verifying table creation...');
        const [tables] = await connection.query(`
            SELECT TABLE_NAME 
            FROM information_schema.TABLES 
            WHERE TABLE_SCHEMA = ? 
            AND TABLE_NAME IN (
                'live_stock_data',
                'stock_data_history',
                'trading_stock_quotes',
                'trading_market_indices',
                'trading_top_stocks',
                'stock_indicators',
                'stock_history',
                'mutual_funds',
                'corporate_actions',
                'board_meetings',
                'real_estate_properties',
                'real_estate_enquiries',
                'real_estate_favorites'
            )
        `, [dbConfig.database]);

        LOG.success(`Successfully created ${tables.length} tables:`);
        tables.forEach(table => {
            LOG.info(`  ✓ ${table.TABLE_NAME}`);
        });

        LOG.success('\n✅ Database setup completed successfully!');
        LOG.info('\nNext steps:');
        LOG.info('1. Make sure your .env file has correct MySQL credentials');
        LOG.info('2. Set DB_TYPE=mysql in your .env file');
        LOG.info('3. Restart your backend server');

    } catch (error) {
        LOG.error('Database setup failed:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            LOG.info('Database connection closed');
        }
    }
}

// Run the setup
if (require.main === module) {
    setupDatabase()
        .then(() => {
            process.exit(0);
        })
        .catch((error) => {
            LOG.error('Setup failed:', error.message);
            process.exit(1);
        });
}

module.exports = { setupDatabase };