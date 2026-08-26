const db = require('../database');
const LOG = require('../utils/logger');

// Ensure fleet tables are created on first use
let fleetTablesInitialized = false;
const ensureFleetTablesInitialized = async () => {
    if (fleetTablesInitialized) return;
    try {
        if (db.getType() === 'mysql' && db.ensureFleetTables) {
            await db.ensureFleetTables();
            fleetTablesInitialized = true;
        }
    } catch (e) {
        LOG.warning("Fleet tables initialization check failed", e.message);
    }
};

const fleetService = {
    /**
     * Get active queue for a driver
     */
    async getActiveQueue(driverId) {
        try {
            await ensureFleetTablesInitialized();
            if (db.getType() === 'mysql') {
                const pool = db.getPool();
                const [rows] = await pool.query(`
                    SELECT 
                        fq.*,
                        fg.gate_name,
                        fg.location_name,
                        fg.latitude,
                        fg.longitude,
                        (SELECT COUNT(*) FROM fleet_queues WHERE gate_id = fq.gate_id AND status = 'waiting') as total_in_queue
                    FROM fleet_queues fq
                    JOIN fleet_gates fg ON fq.gate_id = fg.gate_id
                    WHERE fq.driver_id = ? AND fq.status IN ('waiting', 'processing')
                    ORDER BY fq.joined_at DESC
                    LIMIT 1
                `, [driverId]);
                
                if (rows.length > 0) {
                    const queue = rows[0];
                    
                    // Only calculate position if still waiting (not processing)
                    if (queue.status === 'waiting') {
                        const [positionRows] = await pool.query(`
                            SELECT COUNT(*) as position
                            FROM fleet_queues
                            WHERE gate_id = ? AND status = 'waiting' AND joined_at <= ?
                        `, [queue.gate_id, queue.joined_at]);
                        
                        queue.position = positionRows[0].position || 1;
                        // Recalculate wait time dynamically based on position
                        const avgProcessingTime = 3; // minutes per vehicle
                        const baseWaitTime = queue.estimated_wait_time || 10;
                        queue.estimated_wait_time = Math.max(5, baseWaitTime + ((queue.position - 1) * avgProcessingTime));
                    } else {
                        // If processing, position is 0 (at gate)
                        queue.position = 0;
                        queue.estimated_wait_time = 0;
                    }
                    
                    return queue;
                }
            }
            return null;
        } catch (e) {
            LOG.error("Failed to get active queue", e.message);
            return null;
        }
    },

    /**
     * Join a queue at a gate
     */
    async joinQueue(gateId, driverId, vendorId = null) {
        try {
            await ensureFleetTablesInitialized();
            LOG.info(`[FLEET-JOIN] Driver ${driverId} joining gate ${gateId} (passed vendorId: ${vendorId})`);
            
            if (db.getType() === 'mysql') {
                const pool = db.getPool();
                
                // Check if already in queue
                const [existing] = await pool.query(`
                    SELECT fq.*, fg.gate_name 
                    FROM fleet_queues fq
                    JOIN fleet_gates fg ON fq.gate_id = fg.gate_id
                    WHERE fq.driver_id = ? AND fq.status = 'waiting'
                    ORDER BY fq.joined_at DESC LIMIT 1
                `, [driverId]);
                
                if (existing.length > 0) {
                    const queue = existing[0];
                    // Calculate position
                    const [positionRows] = await pool.query(`
                        SELECT COUNT(*) as position
                        FROM fleet_queues
                        WHERE gate_id = ? AND status = 'waiting' AND joined_at <= ?
                    `, [queue.gate_id, queue.joined_at]);
                    
                    const position = positionRows[0].position || 1;
                    LOG.info(`[FLEET-JOIN] Driver ${driverId} already in queue at gate ${queue.gate_id}. Returning existing position #${position}.`);
                    return {
                        id: queue.id,
                        gate_id: queue.gate_id,
                        gate_name: queue.gate_name,
                        position: position,
                        estimated_wait_time: queue.estimated_wait_time,
                        already_joined: true
                    };
                }
                
                // Get gate info
                const [gateRows] = await pool.query(`
                    SELECT * FROM fleet_gates WHERE gate_id = ? AND is_active = TRUE
                `, [gateId]);
                
                if (gateRows.length === 0) {
                    throw new Error('Gate not found or inactive');
                }
                
                const gate = gateRows[0];
                
                // Resolve vendor_id from driver mapping if not provided
                let resolvedVendorId = vendorId;
                if (!resolvedVendorId) {
                    const [mappingRows] = await pool.query(`
                        SELECT vendor_id FROM user_vendor_mappings WHERE user_id = ? LIMIT 1
                    `, [driverId]);
                    if (mappingRows.length > 0) {
                        resolvedVendorId = mappingRows[0].vendor_id;
                    } else {
                        resolvedVendorId = 'v_fleet1'; // Default fallback
                    }
                }
                
                // Get current queue count for position
                const [countRows] = await pool.query(`
                    SELECT COUNT(*) as count FROM fleet_queues 
                    WHERE gate_id = ? AND status = 'waiting'
                `, [gateId]);
                
                const position = (countRows[0].count || 0) + 1;
                // Dynamic wait time calculation: base wait time + (position - 1) * average processing time
                const avgProcessingTime = 3; // minutes per vehicle
                const baseWaitTime = gate.estimated_wait_time || 10;
                const estimatedWaitTime = Math.max(5, baseWaitTime + ((position - 1) * avgProcessingTime));
                
                // Insert queue entry
                const [result] = await pool.query(`
                    INSERT INTO fleet_queues 
                    (gate_id, gate_name, driver_id, vendor_id, position, estimated_wait_time)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [gateId, gate.gate_name, driverId, resolvedVendorId, position, estimatedWaitTime]);
                
                // Update gate queue count
                await pool.query(`
                    UPDATE fleet_gates 
                    SET current_queue_count = current_queue_count + 1
                    WHERE gate_id = ?
                `, [gateId]);
                
                LOG.success(`[FLEET-JOIN] Driver ${driverId} successfully joined gate ${gateId} at position #${position} (vendor: ${resolvedVendorId})`);
                
                return {
                    id: result.insertId,
                    gate_id: gateId,
                    gate_name: gate.gate_name,
                    position: position,
                    estimated_wait_time: estimatedWaitTime
                };
            }
            
            // Fallback for in-memory
            // Initialize in-memory queue array if needed
            if (!db.inMemoryDb) db.inMemoryDb = {};
            if (!db.inMemoryDb.fleet_queues) db.inMemoryDb.fleet_queues = [];
            
            const existingMem = db.inMemoryDb.fleet_queues.find(q => q.driver_id === driverId && q.status === 'waiting');
            if (existingMem) {
                LOG.info(`[FLEET-JOIN] (In-Memory) Driver ${driverId} already in queue. Returning existing position.`);
                return existingMem;
            }
            
            const position = db.inMemoryDb.fleet_queues.filter(q => q.gate_id === gateId && q.status === 'waiting').length + 1;
            const newQueue = {
                id: Date.now(),
                gate_id: gateId,
                gate_name: `Gate ${gateId}`,
                driver_id: driverId,
                vendor_id: vendorId || 'v_fleet1',
                position: position,
                estimated_wait_time: 10 + (position - 1) * 3,
                status: 'waiting'
            };
            db.inMemoryDb.fleet_queues.push(newQueue);
            LOG.success(`[FLEET-JOIN] (In-Memory) Driver ${driverId} joined gate ${gateId} at position #${position}`);
            return newQueue;
        } catch (e) {
            LOG.error("Failed to join queue", e.message);
            throw e;
        }
    },

    /**
     * Get road conditions near a location
     */
    async getRoadConditions(latitude, longitude, radiusMiles = 5) {
        try {
            await ensureFleetTablesInitialized();
            if (db.getType() === 'mysql') {
                const pool = db.getPool();
                
                // Simple distance calculation (Haversine formula approximation)
                const [rows] = await pool.query(`
                    SELECT 
                        *,
                        (3959 * acos(
                            cos(radians(?)) * 
                            cos(radians(latitude)) * 
                            cos(radians(longitude) - radians(?)) + 
                            sin(radians(?)) * 
                            sin(radians(latitude))
                        )) AS distance_miles
                    FROM fleet_road_conditions
                    WHERE is_active = TRUE
                    HAVING distance_miles <= ?
                    ORDER BY distance_miles ASC
                    LIMIT 10
                `, [latitude, longitude, latitude, radiusMiles]);
                
                return rows.map(row => ({
                    id: row.id,
                    type: row.type,
                    distance: `${row.distance_miles.toFixed(1)}mi`,
                    icon: this._getIconForType(row.type),
                    color: this._getColorForType(row.type),
                    description: row.description
                }));
            }
            
            // Fallback
            return [
                { id: 1, type: "pothole", distance: "0.5mi", icon: "⚠️", color: "#F59E0B" },
                { id: 2, type: "lane_closure", distance: "1.2mi", icon: "🚧", color: "#EF4444" },
                { id: 3, type: "wet_road", distance: "2mi", icon: "🌧️", color: "#2A7DE1" },
            ];
        } catch (e) {
            LOG.error("Failed to get road conditions", e.message);
            return [];
        }
    },

    /**
     * Report a hazard
     */
    async reportHazard(driverId, hazardData) {
        try {
            await ensureFleetTablesInitialized();
            if (db.getType() === 'mysql') {
                const pool = db.getPool();
                
                // Accept both 'type' and 'hazard_type' for compatibility
                const hazardType = hazardData.hazard_type || hazardData.type || 'other';
                
                // Dynamic points based on hazard type and severity
                const pointsMap = {
                    'accident': 15,      // High priority
                    'lane_closure': 10,   // Medium-high priority
                    'construction': 8,   // Medium priority
                    'pothole': 5,        // Standard
                    'wet_road': 3,       // Low priority
                    'other': 5           // Default
                };
                const pointsAwarded = pointsMap[hazardType] || 5;
                
                const [result] = await pool.query(`
                    INSERT INTO fleet_hazards 
                    (driver_id, hazard_type, latitude, longitude, description, image_url, points_awarded)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [
                    driverId,
                    hazardType,
                    hazardData.latitude,
                    hazardData.longitude,
                    hazardData.description || '',
                    hazardData.image_url || '',
                    pointsAwarded
                ]);
                
                // Check if this location should be marked as suspicious
                const suspiciousLocationService = require('./suspiciousLocationService');
                await suspiciousLocationService.ensureFleetTablesInitialized();
                const suspiciousCheck = await suspiciousLocationService.checkAndMarkSuspiciousLocation(
                    hazardData.latitude,
                    hazardData.longitude,
                    driverId
                );
                
                if (suspiciousCheck && suspiciousCheck.is_suspicious) {
                    LOG.warning(`[Fleet Service] ⚠️ Suspicious location detected: ${suspiciousCheck.device_count} devices reported`);
                }
                
                // Also add to road conditions if not exists
                await pool.query(`
                    INSERT INTO fleet_road_conditions 
                    (type, latitude, longitude, description, reported_by, is_active)
                    VALUES (?, ?, ?, ?, ?, TRUE)
                    ON DUPLICATE KEY UPDATE is_active = TRUE
                `, [
                    hazardType,
                    hazardData.latitude,
                    hazardData.longitude,
                    hazardData.description || '',
                    driverId
                ]);
                
                // Update driver stats
                await this._updateDriverPoints(driverId, pointsAwarded);
                
                return {
                    success: true,
                    points_awarded: pointsAwarded,
                    hazard_id: result.insertId,
                    hazard_type: hazardType
                };
            }
            
            return { success: true, points: 5 };
        } catch (e) {
            LOG.error("Failed to report hazard", e.message);
            throw e;
        }
    },

    /**
     * Get driver statistics
     */
    async getDriverStats(driverId, date = null) {
        try {
            await ensureFleetTablesInitialized();
            const targetDate = date || new Date().toISOString().split('T')[0];
            
            if (db.getType() === 'mysql') {
                const pool = db.getPool();
                
                // Get today's stats
                const [rows] = await pool.query(`
                    SELECT * FROM fleet_driver_stats
                    WHERE driver_id = ? AND stat_date = ?
                `, [driverId, targetDate]);
                
                if (rows.length > 0) {
                    return rows[0];
                }
                
                // If no stats exist, create default
                await pool.query(`
                    INSERT INTO fleet_driver_stats 
                    (driver_id, stat_date, trips_count, miles_driven, safe_events, points_earned, safety_score)
                    VALUES (?, ?, 0, 0, 0, 0, 100)
                `, [driverId, targetDate]);
                
                return {
                    driver_id: driverId,
                    stat_date: targetDate,
                    trips_count: 0,
                    miles_driven: 0,
                    safe_events: 0,
                    points_earned: 0,
                    safety_score: 100
                };
            }
            
            // Fallback
            return {
                trips_count: 3,
                miles_driven: 124,
                safe_events: 0,
                points_earned: 450,
                safety_score: 98
            };
        } catch (e) {
            LOG.error("Failed to get driver stats", e.message);
            return null;
        }
    },

    /**
     * Get active trips for a driver
     */
    async getActiveTrips(driverId) {
        try {
            await ensureFleetTablesInitialized();
            if (db.getType() === 'mysql') {
                const pool = db.getPool();
                
                const [rows] = await pool.query(`
                    SELECT * FROM fleet_trips
                    WHERE driver_id = ? AND status IN ('scheduled', 'in_progress')
                    ORDER BY scheduled_start ASC
                `, [driverId]);
                
                return rows;
            }
            
            return [];
        } catch (e) {
            LOG.error("Failed to get active trips", e.message);
            return [];
        }
    },

    /**
     * Get all gates
     */
    async getAllGates(vendorId = null) {
        try {
            await ensureFleetTablesInitialized();
            if (db.getType() === 'mysql') {
                const pool = db.getPool();
                
                // For driver view, return all active gates regardless of vendor_id
                // Only filter by vendor_id if explicitly provided and not null
                const { CORRIDOR_GATE_IDS } = require('../database/features/fleetRouteSeed');
                let query = `SELECT * FROM fleet_gates WHERE is_active = TRUE AND gate_id IN (${CORRIDOR_GATE_IDS.map(() => '?').join(',')})`;
                const params = [...CORRIDOR_GATE_IDS];
                
                if (vendorId && vendorId.trim() !== '') {
                    query += ` AND (vendor_id = ? OR vendor_id IS NULL)`;
                    params.push(vendorId);
                }
                
                query += ` ORDER BY FIELD(gate_id, ${CORRIDOR_GATE_IDS.map(() => '?').join(',')})`;
                params.push(...CORRIDOR_GATE_IDS);
                
                const [rows] = await pool.query(query, params);
                LOG.info(`[FleetService] getAllGates returned ${rows.length} gates (vendorId: ${vendorId || 'all'})`);
                return rows;
            }
            
            return [];
        } catch (e) {
            LOG.error("Failed to get gates", e.message);
            return [];
        }
    },

    /**
     * Helper: Get icon for road condition type
     */
    _getIconForType(type) {
        const icons = {
            pothole: '⚠️',
            bad_road: '🛣️',
            lane_closure: '🚧',
            wet_road: '🌧️',
            accident: '🚨',
            construction: '🏗️',
            other: '⚠️'
        };
        return icons[type] || '⚠️';
    },

    /**
     * Helper: Get color for road condition type
     */
    _getColorForType(type) {
        const colors = {
            pothole: '#F59E0B',
            bad_road: '#B45309',
            lane_closure: '#EF4444',
            wet_road: '#2A7DE1',
            accident: '#EF4444',
            construction: '#F59E0B',
            other: '#6B7280'
        };
        return colors[type] || '#6B7280';
    },

    /**
     * Helper: Update driver points
     */
    /**
     * Mark driver as arrived at gate
     */
    async markArrived(driverId, gateId = null) {
        try {
            await ensureFleetTablesInitialized();
            if (db.getType() === 'mysql') {
                const pool = db.getPool();
                
                // Find the active queue entry for this driver
                const [queueRows] = await pool.query(`
                    SELECT id, gate_id FROM fleet_queues 
                    WHERE driver_id = ? AND status = 'waiting'
                    ORDER BY joined_at DESC
                    LIMIT 1
                `, [driverId]);
                
                if (queueRows.length === 0) {
                    throw new Error('No active queue found for driver');
                }
                
                const queueId = queueRows[0].id;
                const queueGateId = queueRows[0].gate_id;
                
                // Update status to 'processing' (arrived at gate, waiting for processing)
                await pool.query(`
                    UPDATE fleet_queues 
                    SET status = 'processing', processed_at = NOW()
                    WHERE id = ?
                `, [queueId]);
                
                // Update gate queue count
                await pool.query(`
                    UPDATE fleet_gates 
                    SET current_queue_count = GREATEST(0, current_queue_count - 1)
                    WHERE gate_id = ?
                `, [queueGateId]);
                
                // Recalculate positions for remaining drivers in queue
                const [remainingQueues] = await pool.query(`
                    SELECT id, driver_id, joined_at FROM fleet_queues 
                    WHERE gate_id = ? AND status = 'waiting'
                    ORDER BY joined_at ASC
                `, [queueGateId]);
                
                for (let i = 0; i < remainingQueues.length; i++) {
                    const position = i + 1;
                    const avgProcessingTime = 3;
                    const [gateInfo] = await pool.query(`SELECT estimated_wait_time FROM fleet_gates WHERE gate_id = ?`, [queueGateId]);
                    const baseWaitTime = gateInfo[0]?.estimated_wait_time || 10;
                    const estimatedWaitTime = Math.max(5, baseWaitTime + ((position - 1) * avgProcessingTime));
                    
                    await pool.query(`
                        UPDATE fleet_queues 
                        SET position = ?, estimated_wait_time = ?
                        WHERE id = ?
                    `, [position, estimatedWaitTime, remainingQueues[i].id]);
                }
                
                return {
                    success: true,
                    queue_id: queueId,
                    gate_id: queueGateId,
                    status: 'processing'
                };
            }
            
            return { success: true, status: 'processing' };
        } catch (e) {
            LOG.error("Failed to mark arrived", e.message);
            throw e;
        }
    },

    async _updateDriverPoints(driverId, points) {
        try {
            await ensureFleetTablesInitialized();
            if (db.getType() === 'mysql') {
                const pool = db.getPool();
                const today = new Date().toISOString().split('T')[0];
                
                await pool.query(`
                    INSERT INTO fleet_driver_stats 
                    (driver_id, stat_date, points_earned)
                    VALUES (?, ?, ?)
                    ON DUPLICATE KEY UPDATE 
                    points_earned = points_earned + ?
                `, [driverId, today, points, points]);
            }
        } catch (e) {
            LOG.error("Failed to update driver points", e.message);
        }
    },

    /**
     * Get operations dashboard statistics
     */
    async getOperationsStats() {
        try {
            LOG.info('[Fleet Service] getOperationsStats() called');
            await ensureFleetTablesInitialized();
            
            if (db.getType() === 'mysql') {
                const pool = db.getPool();
                LOG.info('[Fleet Service] Using MySQL database');
                
                // Active vehicles (drivers with active trips or in queue)
                LOG.info('[Fleet Service] Querying active vehicles...');
                const [activeVehiclesRows] = await pool.query(`
                    SELECT COUNT(DISTINCT driver_id) as count
                    FROM (
                        SELECT driver_id FROM fleet_trips WHERE status IN ('scheduled', 'in_progress')
                        UNION
                        SELECT driver_id FROM fleet_queues WHERE status IN ('waiting', 'processing')
                    ) as active
                `);
                const activeVehicles = activeVehiclesRows[0]?.count || 0;
                LOG.info(`[Fleet Service] Active vehicles: ${activeVehicles}`);
                
                // Average queue time (from active queues)
                LOG.info('[Fleet Service] Querying average queue time...');
                const [avgQueueTimeRows] = await pool.query(`
                    SELECT AVG(estimated_wait_time) as avg_time
                    FROM fleet_queues
                    WHERE status = 'waiting'
                `);
                const avgQueueTime = Math.round(avgQueueTimeRows[0]?.avg_time || 0);
                LOG.info(`[Fleet Service] Average queue time: ${avgQueueTime} minutes`);
                
                // Incidents (unresolved hazards from last 24 hours)
                LOG.info('[Fleet Service] Querying incidents...');
                const [incidentsRows] = await pool.query(`
                    SELECT COUNT(*) as count
                    FROM fleet_hazards
                    WHERE status = 'reported' 
                    AND reported_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
                `);
                const incidents = incidentsRows[0]?.count || 0;
                LOG.info(`[Fleet Service] Incidents: ${incidents}`);
                
                // Average safety score (from today's driver stats)
                const today = new Date().toISOString().split('T')[0];
                LOG.info(`[Fleet Service] Querying safety score for date: ${today}...`);
                const [safetyScoreRows] = await pool.query(`
                    SELECT AVG(safety_score) as avg_score
                    FROM fleet_driver_stats
                    WHERE stat_date = ?
                `, [today]);
                const safetyScore = Math.round(safetyScoreRows[0]?.avg_score || 100);
                LOG.info(`[Fleet Service] Safety score: ${safetyScore}%`);
                
                const result = {
                    active_vehicles: activeVehicles,
                    avg_queue_time: avgQueueTime,
                    incidents: incidents,
                    safety_score: safetyScore
                };
                LOG.info(`[Fleet Service] Operations stats result:`, JSON.stringify(result));
                return result;
            }
            
            LOG.warning('[Fleet Service] Using in-memory DB fallback');
            // Fallback for in-memory
            return {
                active_vehicles: 0,
                avg_queue_time: 0,
                incidents: 0,
                safety_score: 100
            };
        } catch (e) {
            LOG.error("[Fleet Service] Failed to get operations stats", e.message);
            LOG.error("[Fleet Service] Error stack:", e.stack);
            throw e;
        }
    },

    /**
     * Get all gates with real-time queue data
     */
    async getAllGatesWithQueueData(vendorId = null) {
        try {
            await ensureFleetTablesInitialized();
            if (db.getType() === 'mysql') {
                const pool = db.getPool();
                
                const { CORRIDOR_GATE_IDS } = require('../database/features/fleetRouteSeed');
                let query = `
                    SELECT 
                        fg.*,
                        COALESCE(queue_stats.queue_count, 0) as current_queue_count,
                        COALESCE(queue_stats.avg_wait_time, fg.estimated_wait_time, 0) as avg_wait_time,
                        COALESCE(queue_stats.driver_count, 0) as driver_count
                    FROM fleet_gates fg
                    LEFT JOIN (
                        SELECT 
                            gate_id,
                            COUNT(*) as queue_count,
                            AVG(estimated_wait_time) as avg_wait_time,
                            COUNT(DISTINCT driver_id) as driver_count
                        FROM fleet_queues
                        WHERE status = 'waiting'
                        GROUP BY gate_id
                    ) as queue_stats ON fg.gate_id = queue_stats.gate_id
                    WHERE fg.gate_id IN (${CORRIDOR_GATE_IDS.map(() => '?').join(',')})
                `;
                
                const params = [...CORRIDOR_GATE_IDS];
                if (vendorId) {
                    query += ' AND fg.vendor_id = ?';
                    params.push(vendorId);
                }
                
                query += ` ORDER BY FIELD(fg.gate_id, ${CORRIDOR_GATE_IDS.map(() => '?').join(',')})`;
                params.push(...CORRIDOR_GATE_IDS);
                
                const [rows] = await pool.query(query, params);
                
                return rows.map(gate => ({
                    id: gate.gate_id,
                    name: gate.gate_name,
                    status: gate.is_active 
                        ? (gate.current_queue_count > 20 ? 'busy' : 'open')
                        : 'closed',
                    queueLength: Math.round((gate.current_queue_count / 100) * 100), // Percentage for visualization
                    waitTime: Math.round(gate.avg_wait_time || gate.estimated_wait_time || 0),
                    drivers: gate.driver_count || 0,
                    location: gate.location_name,
                    is_active: gate.is_active
                }));
            }
            
            return [];
        } catch (e) {
            LOG.error("Failed to get gates with queue data", e.message);
            throw e;
        }
    },

    /**
     * Get active alerts/incidents
     */
    async getActiveAlerts(limit = 10) {
        try {
            LOG.info(`[Fleet Service] getActiveAlerts(${limit}) called`);
            await ensureFleetTablesInitialized();
            
            if (db.getType() === 'mysql') {
                const pool = db.getPool();
                
                // Get recent hazards as alerts
                LOG.info('[Fleet Service] Querying active alerts from fleet_hazards...');
                const [hazardRows] = await pool.query(`
                    SELECT 
                        h.*,
                        u.name as driver_name,
                        TIMESTAMPDIFF(MINUTE, h.reported_at, NOW()) as minutes_ago
                    FROM fleet_hazards h
                    LEFT JOIN users u ON h.driver_id = u.id
                    WHERE h.status = 'reported'
                    AND h.reported_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
                    ORDER BY h.reported_at DESC
                    LIMIT ?
                `, [limit]);
                
                LOG.info(`[Fleet Service] Found ${hazardRows.length} hazards in last 24 hours`);
                
                const result = hazardRows.map(hazard => {
                    let type = 'hazard';
                    let priority = 'medium';
                    
                    if (hazard.hazard_type === 'accident') {
                        type = 'accident';
                        priority = 'critical';
                    } else if (hazard.hazard_type === 'lane_closure' || hazard.hazard_type === 'construction') {
                        priority = 'high';
                    }
                    
                    return {
                        id: hazard.id,
                        type: type,
                        priority: priority,
                        title: `${hazard.hazard_type === 'accident' ? 'Accident' : 'Hazard'}: ${hazard.hazard_type.replace('_', ' ')}`,
                        message: hazard.description || `${hazard.hazard_type} reported`,
                        time: `${hazard.minutes_ago}min ago`,
                        action: hazard.hazard_type === 'accident' ? 'Dispatch' : 'Maintain',
                        driver_id: hazard.driver_id,
                        driver_name: hazard.driver_name
                    };
                });
                
                LOG.info(`[Fleet Service] Processed ${result.length} alerts`);
                return result;
            }
            
            LOG.warning('[Fleet Service] Using in-memory DB fallback');
            return [];
        } catch (e) {
            LOG.error("[Fleet Service] Failed to get active alerts", e.message);
            LOG.error("[Fleet Service] Error stack:", e.stack);
            throw e;
        }
    },

    /**
     * Get driver safety board data
     */
    async getDriverSafetyBoard(limit = 10) {
        try {
            LOG.info(`[Fleet Service] getDriverSafetyBoard(${limit}) called`);
            await ensureFleetTablesInitialized();
            
            if (db.getType() === 'mysql') {
                const pool = db.getPool();
                const today = new Date().toISOString().split('T')[0];
                LOG.info(`[Fleet Service] Querying driver stats for date: ${today}`);
                
                // Try today's date first, then fallback to most recent stats
                let [rows] = await pool.query(`
                    SELECT 
                        ds.*,
                        u.name,
                        u.email,
                        (SELECT COUNT(*) FROM fleet_hazards 
                         WHERE driver_id = ds.driver_id 
                         AND reported_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                         AND hazard_type = 'accident') as accident_count
                    FROM fleet_driver_stats ds
                    JOIN users u ON ds.driver_id = u.id
                    WHERE ds.stat_date = ?
                    ORDER BY ds.safety_score DESC
                    LIMIT ?
                `, [today, limit]);
                
                // If no data for today, get most recent stats
                if (rows.length === 0) {
                    LOG.info(`[Fleet Service] No stats for today (${today}), fetching most recent stats`);
                    [rows] = await pool.query(`
                        SELECT 
                            ds.*,
                            u.name,
                            u.email,
                            (SELECT COUNT(*) FROM fleet_hazards 
                             WHERE driver_id = ds.driver_id 
                             AND reported_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                             AND hazard_type = 'accident') as accident_count
                        FROM fleet_driver_stats ds
                        JOIN users u ON ds.driver_id = u.id
                        ORDER BY ds.stat_date DESC, ds.safety_score DESC
                        LIMIT ?
                    `, [limit]);
                }
                
                LOG.info(`[Fleet Service] Found ${rows.length} drivers with stats`);
                
                if (rows.length === 0) {
                    LOG.warning(`[Fleet Service] No driver stats found. Checking if stats table has data...`);
                    // Check if there's any data at all
                    const [allStats] = await pool.query(`SELECT COUNT(*) as count FROM fleet_driver_stats`);
                    const [allUsers] = await pool.query(`SELECT COUNT(*) as count FROM users WHERE email LIKE '%fleet%' OR role LIKE '%fleet%'`);
                    LOG.info(`[Fleet Service] Total driver stats in DB: ${allStats[0].count}, Fleet users: ${allUsers[0].count}`);
                }
                
                const result = rows.map(driver => {
                    const nameParts = driver.name?.split(' ') || [];
                    const avatar = (nameParts[0]?.[0] || '') + (nameParts[1]?.[0] || '');
                    
                    return {
                        id: driver.driver_id,
                        name: nameParts[0] + (nameParts[1] ? ' ' + nameParts[1][0] + '.' : ''),
                        score: driver.safety_score || 100,
                        avatar: avatar || 'D',
                        incidents: {
                            fatigue: 0, // TODO: Add fatigue detection data
                            phone: 0, // TODO: Add phone usage data
                            braking: driver.accident_count || 0
                        }
                    };
                });
                
                LOG.info(`[Fleet Service] Processed ${result.length} drivers for safety board`);
                if (result.length > 0) {
                    LOG.info(`[Fleet Service] Sample driver: ${JSON.stringify(result[0])}`);
                }
                return result;
            }
            
            LOG.warning('[Fleet Service] Using in-memory DB fallback');
            return [];
        } catch (e) {
            LOG.error("[Fleet Service] Failed to get driver safety board", e.message);
            LOG.error("[Fleet Service] Error stack:", e.stack);
            throw e;
        }
    },

    isFleetVendorRow(vendor) {
        return !!(vendor && (vendor.features_fleet === true || vendor.features_fleet === 1 || vendor.features_fleet === '1'));
    },

    async getManagedFleetVendor(user, preferredVendorId = null) {
        if (!user) return null;
        if (preferredVendorId && user.role === 'super_admin') {
            const v = await db.getVendorById(preferredVendorId);
            return this.isFleetVendorRow(v) ? v : v;
        }
        const owned = await db.getVendorByOwnerId(user.id);
        if (this.isFleetVendorRow(owned)) return owned;
        const mappings = await db.getUserVendorMappings(user.id);
        for (const m of mappings || []) {
            const v = await db.getVendorById(m.vendor_id);
            if (this.isFleetVendorRow(v)) return v;
        }
        if (preferredVendorId) {
            const v = await db.getVendorById(preferredVendorId);
            if (v) return v;
        }
        return owned || null;
    },

    async assertFleetManager(user, preferredVendorId = null) {
        if (!user) {
            const err = new Error('Access denied');
            err.status = 403;
            throw err;
        }
        if (user.role === 'super_admin') {
            if (preferredVendorId) {
                const v = await db.getVendorById(preferredVendorId);
                if (!v) {
                    const err = new Error('Fleet vendor not found');
                    err.status = 404;
                    throw err;
                }
                return v;
            }
            const overview = await db.getFleetOverview();
            if (overview.vendors?.[0]) return db.getVendorById(overview.vendors[0].id);
            const err = new Error('No fleet vendors yet');
            err.status = 404;
            throw err;
        }
        if (String(user.role || '').toLowerCase() !== 'vendor') {
            const err = new Error('Fleet management is for vendors. Switch role or log in as vendor.');
            err.status = 403;
            throw err;
        }
        const vendor = await this.getManagedFleetVendor(user, preferredVendorId);
        if (!vendor) {
            const err = new Error('No fleet vendor mapped to this account');
            err.status = 403;
            throw err;
        }
        return vendor;
    },

    async getOverview() {
        return db.getFleetOverview();
    },

    async getRoster(vendorId) {
        return db.getFleetRoster(vendorId);
    },

    async addRosterDriver(vendorId, payload = {}) {
        const name = String(payload.name || '').trim();
        const mobile = String(payload.mobile || '').trim();
        if (!name || !mobile) {
            throw new Error('name and mobile are required');
        }
        let user = await db.getUserByMobile(mobile);
        if (!user && payload.email) {
            const users = await db.getUsers();
            user = users.find((u) => String(u.email || '').toLowerCase() === String(payload.email).toLowerCase());
        }
        if (!user) {
            user = {
                id: 'usr_' + Math.random().toString(36).substring(2, 11),
                name,
                email: payload.email || `${mobile}@qrqueue.local`,
                mobile,
                role: 'user',
                location_name: payload.location_name || '',
                created_at: new Date(),
            };
            await db.addUser(user);
        } else {
            const role = String(user.role || '').toLowerCase();
            if (role === 'vendor' || role === 'super_admin') {
                throw new Error('This account is a vendor. Drivers must be user accounts.');
            }
            await db.updateUserProfile(user.id, {
                name: name || user.name,
                email: payload.email || user.email,
                mobile,
                location_name: payload.location_name !== undefined ? payload.location_name : user.location_name,
            });
        }
        await db.addUserVendorMapping(user.id, vendorId);
        const roster = await db.getFleetRoster(vendorId);
        return roster.find((d) => String(d.id) === String(user.id)) || { ...user, vendor_id: vendorId };
    },

    async updateRosterDriver(vendorId, userId, payload = {}) {
        const roster = await db.getFleetRoster(vendorId);
        const existing = roster.find((d) => String(d.id) === String(userId));
        if (!existing) throw new Error('Driver is not mapped to this fleet');
        await db.updateUserProfile(userId, {
            name: payload.name,
            email: payload.email,
            mobile: payload.mobile,
            location_name: payload.location_name,
        });
        const next = await db.getFleetRoster(vendorId);
        return next.find((d) => String(d.id) === String(userId));
    },

    async removeRosterDriver(vendorId, userId) {
        await db.removeUserVendorMapping(userId, vendorId);
        return { success: true };
    },

    async getBadRoadConfirmThreshold() {
        try {
            const settingsService = require('./settingsService');
            const settings = await settingsService.getSettings();
            const raw = settings?.fleet_bad_road_confirm_users ?? settings?.fleet_bad_road_threshold ?? '3';
            const n = parseInt(String(raw), 10);
            return Number.isFinite(n) && n > 0 ? n : 3;
        } catch {
            return 3;
        }
    },

    async _ensureBadRoadProbesTable(pool) {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS fleet_bad_road_probes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                driver_id INT NOT NULL,
                latitude DECIMAL(10, 6) NOT NULL,
                longitude DECIMAL(11, 6) NOT NULL,
                rounded_lat DECIMAL(10, 2) NOT NULL,
                rounded_lng DECIMAL(11, 2) NOT NULL,
                speed_kmh DECIMAL(6, 2) NULL,
                confidence DECIMAL(4, 3) NULL,
                auto_detected TINYINT(1) DEFAULT 1,
                confirmed TINYINT(1) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_rounded (rounded_lat, rounded_lng),
                INDEX idx_created (created_at)
            )
        `);
    },

    async getBadRoadNearby(latitude, longitude) {
        try {
            await ensureFleetTablesInitialized();
            if (db.getType() !== 'mysql') return { reports: 0, threshold: 3, incident_logged: false };

            const pool = db.getPool();
            await this._ensureBadRoadProbesTable(pool);
            const threshold = await this.getBadRoadConfirmThreshold();
            const roundedLat = Math.round(latitude * 100) / 100;
            const roundedLng = Math.round(longitude * 100) / 100;

            const [rows] = await pool.query(`
                SELECT COUNT(DISTINCT driver_id) AS reporter_count
                FROM fleet_bad_road_probes
                WHERE rounded_lat = ? AND rounded_lng = ?
                  AND confirmed = 1
                  AND created_at >= DATE_SUB(NOW(), INTERVAL 48 HOUR)
            `, [roundedLat, roundedLng]);

            const [incidents] = await pool.query(`
                SELECT id FROM fleet_hazards
                WHERE hazard_type IN ('bad_road', 'pothole')
                  AND ROUND(latitude, 2) = ? AND ROUND(longitude, 2) = ?
                  AND reported_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                LIMIT 1
            `, [roundedLat, roundedLng]);

            return {
                reports: rows[0]?.reporter_count || 0,
                threshold,
                incident_logged: incidents.length > 0,
                rounded_lat: roundedLat,
                rounded_lng: roundedLng,
            };
        } catch (e) {
            LOG.error('getBadRoadNearby failed', e.message);
            return { reports: 0, threshold: 3, incident_logged: false };
        }
    },

    async reportBadRoadProbe(driverId, probeData) {
        try {
            await ensureFleetTablesInitialized();
            if (db.getType() !== 'mysql') {
                return { success: true, incident_created: false, reporter_count: 1 };
            }

            const pool = db.getPool();
            await this._ensureBadRoadProbesTable(pool);

            const latitude = probeData.latitude;
            const longitude = probeData.longitude;
            const confirmed = probeData.confirmed === true || probeData.confirmed === 1;
            const roundedLat = Math.round(latitude * 100) / 100;
            const roundedLng = Math.round(longitude * 100) / 100;
            const threshold = await this.getBadRoadConfirmThreshold();

            if (confirmed) {
                await pool.query(`
                    INSERT INTO fleet_bad_road_probes
                    (driver_id, latitude, longitude, rounded_lat, rounded_lng, speed_kmh, confidence, auto_detected, confirmed)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
                `, [
                    driverId,
                    latitude,
                    longitude,
                    roundedLat,
                    roundedLng,
                    probeData.speed_kmh || null,
                    probeData.confidence || null,
                    probeData.auto_detected !== false ? 1 : 0,
                ]);
            }

            const [countRows] = await pool.query(`
                SELECT COUNT(DISTINCT driver_id) AS reporter_count
                FROM fleet_bad_road_probes
                WHERE rounded_lat = ? AND rounded_lng = ?
                  AND confirmed = 1
                  AND created_at >= DATE_SUB(NOW(), INTERVAL 48 HOUR)
            `, [roundedLat, roundedLng]);

            const reporterCount = countRows[0]?.reporter_count || 0;
            let incidentCreated = false;
            let hazardId = null;

            if (confirmed && reporterCount >= threshold) {
                const [existing] = await pool.query(`
                    SELECT id FROM fleet_hazards
                    WHERE hazard_type = 'bad_road'
                      AND ROUND(latitude, 2) = ? AND ROUND(longitude, 2) = ?
                      AND reported_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                    LIMIT 1
                `, [roundedLat, roundedLng]);

                if (existing.length === 0) {
                    const description = `Bad road confirmed by ${reporterCount} drivers (auto-detected bumps + user confirm)`;
                    const [result] = await pool.query(`
                        INSERT INTO fleet_hazards
                        (driver_id, hazard_type, latitude, longitude, description, points_awarded)
                        VALUES (?, 'bad_road', ?, ?, ?, ?)
                    `, [driverId, latitude, longitude, description, 8]);
                    hazardId = result.insertId;
                    incidentCreated = true;

                    await pool.query(`
                        INSERT INTO fleet_road_conditions
                        (type, latitude, longitude, description, reported_by, is_active)
                        VALUES ('bad_road', ?, ?, ?, ?, TRUE)
                        ON DUPLICATE KEY UPDATE is_active = TRUE, description = VALUES(description)
                    `, [latitude, longitude, description, driverId]);
                }
            }

            return {
                success: true,
                confirmed,
                reporter_count: reporterCount,
                threshold,
                incident_created: incidentCreated,
                hazard_id: hazardId,
            };
        } catch (e) {
            LOG.error('reportBadRoadProbe failed', e.message);
            throw e;
        }
    },
};

module.exports = fleetService;

