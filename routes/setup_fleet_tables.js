/**
 * Setup script to create fleet tables in MySQL database
 * Run this once: node backend/setup_fleet_tables.js
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

const fleetSchema = `
-- Fleet Queues Table
CREATE TABLE IF NOT EXISTS fleet_queues (
    id INT AUTO_INCREMENT PRIMARY KEY,
    gate_id VARCHAR(255) NOT NULL,
    gate_name VARCHAR(255) NOT NULL,
    driver_id VARCHAR(255) NOT NULL,
    vendor_id VARCHAR(255),
    status ENUM('waiting', 'processing', 'completed', 'cancelled') DEFAULT 'waiting',
    position INT DEFAULT 0,
    estimated_wait_time INT DEFAULT 0,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    notes TEXT,
    INDEX idx_gate_status (gate_id, status),
    INDEX idx_driver (driver_id)
);

-- Fleet Trips Table
CREATE TABLE IF NOT EXISTS fleet_trips (
    id INT AUTO_INCREMENT PRIMARY KEY,
    driver_id VARCHAR(255) NOT NULL,
    vendor_id VARCHAR(255),
    trip_type ENUM('pickup', 'delivery', 'transport', 'other') DEFAULT 'transport',
    origin VARCHAR(255),
    destination VARCHAR(255),
    start_latitude DECIMAL(10, 8),
    start_longitude DECIMAL(11, 8),
    end_latitude DECIMAL(10, 8),
    end_longitude DECIMAL(11, 8),
    status ENUM('scheduled', 'in_progress', 'completed', 'cancelled') DEFAULT 'scheduled',
    scheduled_start TIMESTAMP,
    actual_start TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    distance_miles DECIMAL(10, 2) DEFAULT 0,
    duration_minutes INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_driver_status (driver_id, status),
    INDEX idx_vendor (vendor_id)
);

-- Fleet Road Conditions Table
CREATE TABLE IF NOT EXISTS fleet_road_conditions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    type ENUM('pothole', 'lane_closure', 'wet_road', 'accident', 'construction', 'other') NOT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    distance_from_location DECIMAL(10, 2),
    severity ENUM('low', 'medium', 'high') DEFAULT 'medium',
    description TEXT,
    reported_by VARCHAR(255),
    reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL,
    is_active BOOLEAN DEFAULT TRUE,
    INDEX idx_location (latitude, longitude),
    INDEX idx_type_active (type, is_active)
);

-- Fleet Hazards Table
CREATE TABLE IF NOT EXISTS fleet_hazards (
    id INT AUTO_INCREMENT PRIMARY KEY,
    driver_id VARCHAR(255) NOT NULL,
    hazard_type ENUM('pothole', 'lane_closure', 'wet_road', 'accident', 'construction', 'other') NOT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    description TEXT,
    image_url TEXT,
    points_awarded INT DEFAULT 5,
    status ENUM('reported', 'verified', 'resolved') DEFAULT 'reported',
    reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    verified_at TIMESTAMP NULL,
    resolved_at TIMESTAMP NULL,
    INDEX idx_driver (driver_id),
    INDEX idx_status (status)
);

-- Fleet Driver Stats Table
CREATE TABLE IF NOT EXISTS fleet_driver_stats (
    id INT AUTO_INCREMENT PRIMARY KEY,
    driver_id VARCHAR(255) NOT NULL,
    stat_date DATE NOT NULL,
    trips_count INT DEFAULT 0,
    miles_driven DECIMAL(10, 2) DEFAULT 0,
    safe_events INT DEFAULT 0,
    points_earned INT DEFAULT 0,
    safety_score INT DEFAULT 100,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_driver_date (driver_id, stat_date),
    INDEX idx_driver_date (driver_id, stat_date)
);

-- Fleet Gates Table
CREATE TABLE IF NOT EXISTS fleet_gates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    gate_id VARCHAR(255) NOT NULL UNIQUE,
    gate_name VARCHAR(255) NOT NULL,
    location_name VARCHAR(255),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    vendor_id VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    current_queue_count INT DEFAULT 0,
    estimated_wait_time INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_vendor (vendor_id),
    INDEX idx_active (is_active)
);
`;

(async () => {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com',
            port: process.env.DB_PORT || 4000,
            user: process.env.DB_USER || '45gthaydhVD1pM3.root',
            password: process.env.DB_PASSWORD || 'XHSYhumyCXkvaj9m',
            database: process.env.DB_NAME || 'qr_queue',
            ssl: { rejectUnauthorized: false }
        });

        console.log('Creating fleet tables...');
        
        // Split and execute each CREATE TABLE statement
        const statements = fleetSchema.split(';').filter(s => s.trim());
        for (const statement of statements) {
            if (statement.trim()) {
                await connection.query(statement);
            }
        }

        // Seed sample gates
        await connection.query(`
            INSERT IGNORE INTO fleet_gates (gate_id, gate_name, location_name, vendor_id, is_active)
            VALUES
            ('gate_7', 'Port of Oakland - Gate 7', 'Oakland, CA', 'v_fleet1', TRUE),
            ('gate_12', 'Port of Oakland - Gate 12', 'Oakland, CA', 'v_fleet1', TRUE),
            ('gate_1', 'Port of Los Angeles - Gate 1', 'Los Angeles, CA', 'v_fleet1', TRUE)
        `);

        console.log('✅ Fleet tables created successfully!');
        console.log('✅ Sample gates seeded!');
        
    } catch (err) {
        console.error('❌ Error setting up fleet tables:', err);
        process.exit(1);
    } finally {
        if (connection) await connection.end();
    }
})();

