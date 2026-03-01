/**
 * Suspicious Location Detection Service
 * Tracks locations where 10+ devices report hazards and marks them as suspicious
 */

const db = require('../database');
const LOG = require('../utils/logger');

const SUSPICIOUS_THRESHOLD = 10; // Number of devices needed to mark location as suspicious
const LOCATION_RADIUS = 0.01; // ~1km radius for grouping locations (in degrees)

/**
 * Check and mark suspicious locations after a hazard is reported
 */
async function checkAndMarkSuspiciousLocation(latitude, longitude, driverId) {
    try {
        await ensureFleetTablesInitialized();
        
        if (db.getType() !== 'mysql') {
            return null;
        }

        const pool = db.getPool();
        
        // Round coordinates to group nearby locations (within ~1km)
        const roundedLat = Math.round(latitude * 100) / 100;
        const roundedLng = Math.round(longitude * 100) / 100;
        
        // Find all hazards within the same rounded location
        const [locationHazards] = await pool.query(`
            SELECT 
                COUNT(DISTINCT driver_id) as device_count,
                COUNT(*) as total_reports,
                ROUND(latitude, 2) as rounded_lat,
                ROUND(longitude, 2) as rounded_lng,
                GROUP_CONCAT(DISTINCT hazard_type) as hazard_types
            FROM fleet_hazards
            WHERE 
                ROUND(latitude, 2) = ? 
                AND ROUND(longitude, 2) = ?
                AND reported_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            GROUP BY ROUND(latitude, 2), ROUND(longitude, 2)
        `, [roundedLat, roundedLng]);
        
        if (locationHazards.length === 0) {
            return null;
        }
        
        const locationData = locationHazards[0];
        const deviceCount = locationData.device_count || 0;
        
        LOG.info(`[SuspiciousLocation] Location (${roundedLat}, ${roundedLng}): ${deviceCount} devices, ${locationData.total_reports} reports`);
        
        // Check if threshold is met
        if (deviceCount >= SUSPICIOUS_THRESHOLD) {
            // Check if already marked as suspicious
            const [existing] = await pool.query(`
                SELECT id FROM fleet_suspicious_locations
                WHERE rounded_latitude = ? AND rounded_longitude = ?
            `, [roundedLat, roundedLng]);
            
            if (existing.length === 0) {
                // Mark as suspicious location
                await pool.query(`
                    INSERT INTO fleet_suspicious_locations
                    (rounded_latitude, rounded_longitude, device_count, total_reports, 
                     first_reported_at, last_reported_at, hazard_types, status)
                    VALUES (?, ?, ?, ?, 
                            (SELECT MIN(reported_at) FROM fleet_hazards 
                             WHERE ROUND(latitude, 2) = ? AND ROUND(longitude, 2) = ?),
                            NOW(), ?, 'active')
                `, [
                    roundedLat, roundedLng, deviceCount, locationData.total_reports,
                    roundedLat, roundedLng, locationData.hazard_types
                ]);
                
                LOG.warning(`[SuspiciousLocation] ⚠️ Marked location (${roundedLat}, ${roundedLng}) as SUSPICIOUS - ${deviceCount} devices reported`);
                
                return {
                    is_suspicious: true,
                    location: { latitude: roundedLat, longitude: roundedLng },
                    device_count: deviceCount,
                    total_reports: locationData.total_reports,
                    hazard_types: locationData.hazard_types
                };
            } else {
                // Update existing suspicious location
                await pool.query(`
                    UPDATE fleet_suspicious_locations
                    SET device_count = ?,
                        total_reports = ?,
                        last_reported_at = NOW(),
                        hazard_types = ?
                    WHERE rounded_latitude = ? AND rounded_longitude = ?
                `, [
                    deviceCount, locationData.total_reports, 
                    locationData.hazard_types, roundedLat, roundedLng
                ]);
            }
        }
        
        return {
            is_suspicious: deviceCount >= SUSPICIOUS_THRESHOLD,
            device_count: deviceCount,
            threshold: SUSPICIOUS_THRESHOLD
        };
    } catch (e) {
        LOG.error("[SuspiciousLocation] Failed to check suspicious location", e.message);
        return null;
    }
}

/**
 * Get all suspicious locations
 */
async function getSuspiciousLocations(limit = 50) {
    try {
        await ensureFleetTablesInitialized();
        
        if (db.getType() !== 'mysql') {
            return [];
        }

        const pool = db.getPool();
        
        const [locations] = await pool.query(`
            SELECT 
                id,
                rounded_latitude as latitude,
                rounded_longitude as longitude,
                device_count,
                total_reports,
                hazard_types,
                first_reported_at,
                last_reported_at,
                status,
                TIMESTAMPDIFF(MINUTE, last_reported_at, NOW()) as minutes_ago
            FROM fleet_suspicious_locations
            WHERE status = 'active'
            ORDER BY device_count DESC, last_reported_at DESC
            LIMIT ?
        `, [limit]);
        
        return locations.map(loc => ({
            id: loc.id,
            latitude: parseFloat(loc.latitude),
            longitude: parseFloat(loc.longitude),
            device_count: loc.device_count,
            total_reports: loc.total_reports,
            hazard_types: loc.hazard_types ? loc.hazard_types.split(',') : [],
            first_reported_at: loc.first_reported_at,
            last_reported_at: loc.last_reported_at,
            minutes_ago: loc.minutes_ago,
            status: loc.status,
            severity: loc.device_count >= 20 ? 'critical' : loc.device_count >= 15 ? 'high' : 'medium'
        }));
    } catch (e) {
        LOG.error("[SuspiciousLocation] Failed to get suspicious locations", e.message);
        return [];
    }
}

/**
 * Ensure suspicious locations table exists
 */
async function ensureFleetTablesInitialized() {
    if (db.getType() !== 'mysql') return;
    
    const pool = db.getPool();
    if (!pool) return;
    
    try {
        // Create suspicious locations table if it doesn't exist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS fleet_suspicious_locations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                rounded_latitude DECIMAL(10, 2) NOT NULL,
                rounded_longitude DECIMAL(11, 2) NOT NULL,
                device_count INT NOT NULL DEFAULT 0,
                total_reports INT NOT NULL DEFAULT 0,
                hazard_types TEXT,
                first_reported_at TIMESTAMP NOT NULL,
                last_reported_at TIMESTAMP NOT NULL,
                status ENUM('active', 'investigating', 'resolved') DEFAULT 'active',
                resolved_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_location (rounded_latitude, rounded_longitude),
                INDEX idx_status (status),
                INDEX idx_last_reported (last_reported_at)
            )
        `);
    } catch (e) {
        LOG.error("[SuspiciousLocation] Failed to create table", e.message);
    }
}

module.exports = {
    checkAndMarkSuspiciousLocation,
    getSuspiciousLocations,
    ensureFleetTablesInitialized
};

