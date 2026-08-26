const express = require('express');
const router = express.Router();
const fleetService = require('../services/fleetService');
const { authenticateToken } = require('../middleware/auth');
const LOG = require('../utils/logger');

// Socket.IO instance (set by server.js)
let io = null;
const setIO = (ioInstance) => {
    io = ioInstance;
};

/**
 * GET /api/fleet/queue/active
 * Get active queue for logged-in driver
 */
router.get('/queue/active', authenticateToken, async (req, res) => {
    try {
        const driverId = req.user.id;
        const queue = await fleetService.getActiveQueue(driverId);
        
        if (queue) {
            res.json(queue);
        } else {
            res.json({});
        }
    } catch (err) {
        LOG.error("Failed to get active queue", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/fleet/queue/join
 * Join a queue at a gate
 */
router.post('/queue/join', authenticateToken, async (req, res) => {
    try {
        const driverId = req.user.id;
        const { gate_id, vendor_id } = req.body;
        
        if (!gate_id) {
            return res.status(400).json({ error: 'gate_id is required' });
        }
        
        const result = await fleetService.joinQueue(gate_id, driverId, vendor_id);
        
        // Emit real-time update to all drivers in this gate's queue
        if (io) {
            io.emit('fleet_queue_updated', {
                gate_id,
                driver_id: driverId,
                action: 'joined',
                queue_data: result
            });
        }
        
        res.json(result);
    } catch (err) {
        LOG.error("Failed to join queue", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/fleet/road-conditions
 * Get road conditions near a location
 */
router.get('/road-conditions', authenticateToken, async (req, res) => {
    try {
        const lat = parseFloat(req.query.lat);
        const lng = parseFloat(req.query.lng);
        const radius = parseFloat(req.query.radius) || 5;
        
        if (!lat || !lng) {
            return res.status(400).json({ error: 'lat and lng are required' });
        }
        
        const conditions = await fleetService.getRoadConditions(lat, lng, radius);
        res.json(conditions);
    } catch (err) {
        LOG.error("Failed to get road conditions", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/fleet/hazards/report
 * Report a hazard
 */
router.post('/hazards/report', authenticateToken, async (req, res) => {
    try {
        const driverId = req.user.id;
        // Accept both 'type' and 'hazard_type' for compatibility
        const { type, hazard_type, latitude, longitude, description, image_url } = req.body;
        const hazardType = hazard_type || type;
        
        if (!hazardType || !latitude || !longitude) {
            return res.status(400).json({ error: 'hazard_type (or type), latitude, and longitude are required' });
        }
        
        const result = await fleetService.reportHazard(driverId, {
            hazard_type: hazardType,
            latitude,
            longitude,
            description,
            image_url
        });
        
        // Emit real-time update for new hazard
        if (io) {
            io.emit('fleet_hazard_reported', {
                driver_id: driverId,
                hazard: result,
                location: { latitude, longitude }
            });
            
            // Also emit road conditions update
            io.emit('fleet_road_conditions_updated', {
                latitude,
                longitude
            });
        }
        
        res.json(result);
    } catch (err) {
        LOG.error("Failed to report hazard", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/fleet/bad-road/nearby?lat=&lng=
 * How many drivers confirmed bad road at this coordinate cluster.
 */
router.get('/bad-road/nearby', authenticateToken, async (req, res) => {
    try {
        const lat = parseFloat(req.query.lat);
        const lng = parseFloat(req.query.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return res.status(400).json({ error: 'lat and lng query params required' });
        }
        const info = await fleetService.getBadRoadNearby(lat, lng);
        res.json(info);
    } catch (err) {
        LOG.error('Failed bad-road nearby', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/fleet/bad-road/probe
 * User-confirmed bad road probe; creates incident when threshold drivers agree.
 */
router.post('/bad-road/probe', authenticateToken, async (req, res) => {
    try {
        const driverId = req.user.id;
        const { latitude, longitude, speed_kmh, confidence, confirmed, auto_detected } = req.body;
        if (!latitude || !longitude) {
            return res.status(400).json({ error: 'latitude and longitude are required' });
        }
        const result = await fleetService.reportBadRoadProbe(driverId, {
            latitude,
            longitude,
            speed_kmh,
            confidence,
            confirmed: confirmed !== false,
            auto_detected,
        });
        if (io && result.incident_created) {
            io.emit('fleet_hazard_reported', {
                driver_id: driverId,
                hazard: { hazard_type: 'bad_road', hazard_id: result.hazard_id },
                location: { latitude, longitude },
            });
        }
        res.json(result);
    } catch (err) {
        LOG.error('Failed bad-road probe', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/fleet/drivers/:driverId/stats
 * Get driver statistics
 */
router.get('/drivers/:driverId/stats', authenticateToken, async (req, res) => {
    try {
        const driverId = req.params.driverId;
        const date = req.query.date || null;
        
        // Only allow drivers to see their own stats, or admins
        if (req.user.id !== driverId && req.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const stats = await fleetService.getDriverStats(driverId, date);
        res.json(stats);
    } catch (err) {
        LOG.error("Failed to get driver stats", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/fleet/drivers/:driverId/trips/active
 * Get active trips for a driver
 */
router.get('/drivers/:driverId/trips/active', authenticateToken, async (req, res) => {
    try {
        const driverId = req.params.driverId;
        
        // Only allow drivers to see their own trips, or admins
        if (req.user.id !== driverId && req.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const trips = await fleetService.getActiveTrips(driverId);
        res.json(trips);
    } catch (err) {
        LOG.error("Failed to get active trips", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/fleet/gates
 * Get all active gates
 */
router.get('/gates', authenticateToken, async (req, res) => {
    try {
        const vendorId = req.query.vendor_id || null;
        const gates = await fleetService.getAllGates(vendorId);
        res.json(gates);
    } catch (err) {
        LOG.error("Failed to get gates", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/fleet/queue/arrived
 * Mark driver as arrived at gate
 */
router.post('/queue/arrived', authenticateToken, async (req, res) => {
    try {
        const driverId = req.user.id;
        const { gate_id } = req.body;
        
        const result = await fleetService.markArrived(driverId, gate_id);
        
        // Emit real-time update
        if (io) {
            io.emit('fleet_queue_updated', {
                driver_id: driverId,
                action: 'arrived',
                queue_data: result
            });
        }
        
        res.json(result);
    } catch (err) {
        LOG.error("Failed to mark arrived", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/fleet/operations/stats
 * Get operations dashboard statistics
 */
router.get('/operations/stats', authenticateToken, async (req, res) => {
    try {
        // If email not in token, fetch from database (for old tokens)
        let userEmail = req.user.email;
        if (!userEmail && req.user.id) {
            const db = require('../database');
            const user = await db.getUserById(req.user.id);
            if (user) userEmail = user.email;
        }
        
        LOG.info(`[Fleet Routes] GET /operations/stats - User: ${req.user.id}, Role: ${req.user.role}, Email: ${userEmail || 'undefined'}`);
        
        // Only allow admins or fleet vendors (case-insensitive email check)
        const email = userEmail?.toLowerCase() || '';
        if (req.user.role !== 'super_admin' && String(req.user.role || '').toLowerCase() !== 'vendor') {
            LOG.warning(`[Fleet Routes] Access denied for user ${req.user.id} - role: ${req.user.role}, email: ${userEmail || 'undefined'}`);
            return res.status(403).json({ error: 'Access denied' });
        }
        
        LOG.info('[Fleet Routes] Calling fleetService.getOperationsStats()');
        const stats = await fleetService.getOperationsStats();
        LOG.info(`[Fleet Routes] Operations stats retrieved:`, JSON.stringify(stats));
        res.json(stats);
    } catch (err) {
        LOG.error("[Fleet Routes] Failed to get operations stats", err.message);
        LOG.error("[Fleet Routes] Stack trace:", err.stack);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/fleet/operations/gates
 * Get all gates with real-time queue data
 */
router.get('/operations/gates', authenticateToken, async (req, res) => {
    try {
        // If email not in token, fetch from database (for old tokens)
        let userEmail = req.user.email;
        if (!userEmail && req.user.id) {
            const db = require('../database');
            const user = await db.getUserById(req.user.id);
            if (user) userEmail = user.email;
        }
        
        LOG.info(`[Fleet Routes] GET /operations/gates - User: ${req.user.id}, VendorId: ${req.query.vendor_id || 'none'}`);
        
        // Only allow admins or fleet vendors (case-insensitive email check)
        const email = userEmail?.toLowerCase() || '';
        if (req.user.role !== 'super_admin' && String(req.user.role || '').toLowerCase() !== 'vendor') {
            LOG.warning(`[Fleet Routes] Access denied for user ${req.user.id} - email: ${userEmail || 'undefined'}`);
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const vendorId = req.query.vendor_id || null;
        LOG.info(`[Fleet Routes] Calling fleetService.getAllGatesWithQueueData(${vendorId})`);
        const gates = await fleetService.getAllGatesWithQueueData(vendorId);
        LOG.info(`[Fleet Routes] Retrieved ${gates.length} gates with queue data`);
        res.json(gates);
    } catch (err) {
        LOG.error("[Fleet Routes] Failed to get gates with queue data", err.message);
        LOG.error("[Fleet Routes] Stack trace:", err.stack);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/fleet/operations/alerts
 * Get active alerts/incidents
 */
router.get('/operations/alerts', authenticateToken, async (req, res) => {
    try {
        // If email not in token, fetch from database (for old tokens)
        let userEmail = req.user.email;
        if (!userEmail && req.user.id) {
            const db = require('../database');
            const user = await db.getUserById(req.user.id);
            if (user) userEmail = user.email;
        }
        
        LOG.info(`[Fleet Routes] GET /operations/alerts - User: ${req.user.id}, Limit: ${req.query.limit || 10}`);
        
        // Only allow admins or fleet vendors (case-insensitive email check)
        const email = userEmail?.toLowerCase() || '';
        if (req.user.role !== 'super_admin' && String(req.user.role || '').toLowerCase() !== 'vendor') {
            LOG.warning(`[Fleet Routes] Access denied for user ${req.user.id} - email: ${userEmail || 'undefined'}`);
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const limit = parseInt(req.query.limit) || 10;
        LOG.info(`[Fleet Routes] Calling fleetService.getActiveAlerts(${limit})`);
        const alerts = await fleetService.getActiveAlerts(limit);
        LOG.info(`[Fleet Routes] Retrieved ${alerts.length} active alerts`);
        res.json(alerts);
    } catch (err) {
        LOG.error("[Fleet Routes] Failed to get active alerts", err.message);
        LOG.error("[Fleet Routes] Stack trace:", err.stack);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/fleet/operations/drivers
 * Get driver safety board data
 */
router.get('/operations/drivers', authenticateToken, async (req, res) => {
    try {
        // If email not in token, fetch from database (for old tokens)
        let userEmail = req.user.email;
        if (!userEmail && req.user.id) {
            const db = require('../database');
            const user = await db.getUserById(req.user.id);
            if (user) userEmail = user.email;
        }
        
        LOG.info(`[Fleet Routes] GET /operations/drivers - User: ${req.user.id}, Limit: ${req.query.limit || 10}`);
        
        // Only allow admins or fleet vendors (case-insensitive email check)
        const email = userEmail?.toLowerCase() || '';
        if (req.user.role !== 'super_admin' && String(req.user.role || '').toLowerCase() !== 'vendor') {
            LOG.warning(`[Fleet Routes] Access denied for user ${req.user.id} - email: ${userEmail || 'undefined'}`);
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const limit = parseInt(req.query.limit) || 10;
        LOG.info(`[Fleet Routes] Calling fleetService.getDriverSafetyBoard(${limit})`);
        const drivers = await fleetService.getDriverSafetyBoard(limit);
        LOG.info(`[Fleet Routes] Retrieved ${drivers.length} drivers for safety board`);
        res.json(drivers);
    } catch (err) {
        LOG.error("[Fleet Routes] Failed to get driver safety board", err.message);
        LOG.error("[Fleet Routes] Stack trace:", err.stack);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/fleet/operations/suspicious-locations
 * Get all suspicious locations (10+ devices reported)
 */
router.get('/operations/suspicious-locations', authenticateToken, async (req, res) => {
    try {
        // If email not in token, fetch from database (for old tokens)
        let userEmail = req.user.email;
        if (!userEmail && req.user.id) {
            const db = require('../database');
            const user = await db.getUserById(req.user.id);
            if (user) userEmail = user.email;
        }
        
        LOG.info(`[Fleet Routes] GET /operations/suspicious-locations - User: ${req.user.id}`);
        
        // Only allow admins or fleet vendors (case-insensitive email check)
        const email = userEmail?.toLowerCase() || '';
        if (req.user.role !== 'super_admin' && String(req.user.role || '').toLowerCase() !== 'vendor') {
            LOG.warning(`[Fleet Routes] Access denied for user ${req.user.id} - email: ${userEmail || 'undefined'}`);
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const suspiciousLocationService = require('../services/suspiciousLocationService');
        await suspiciousLocationService.ensureFleetTablesInitialized();
        const limit = parseInt(req.query.limit) || 50;
        const locations = await suspiciousLocationService.getSuspiciousLocations(limit);
        
        LOG.info(`[Fleet Routes] Retrieved ${locations.length} suspicious locations`);
        res.json(locations);
    } catch (err) {
        LOG.error("[Fleet Routes] Failed to get suspicious locations", err.message);
        LOG.error("[Fleet Routes] Stack trace:", err.stack);
        res.status(500).json({ error: err.message });
    }
});

const resolveUserEmail = async (req) => {
    let userEmail = req.user.email;
    if (!userEmail && req.user.id) {
        const db = require('../database');
        const user = await db.getUserById(req.user.id);
        if (user) {
            userEmail = user.email;
            req.user.email = user.email;
            req.user.role = req.user.role || user.role;
        }
    }
    return userEmail;
};

/**
 * GET /api/fleet/overview
 * Super admin: fleet vendors + driver counts (keeps the main admin dashboard light).
 */
router.get('/overview', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Access denied' });
        }
        const data = await fleetService.getOverview();
        res.json(data);
    } catch (err) {
        LOG.error('Failed to get fleet overview', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/fleet/roster
 * Drivers mapped to one fleet vendor (excludes the vendor owner).
 */
router.get('/roster', authenticateToken, async (req, res) => {
    try {
        await resolveUserEmail(req);
        const vendor = await fleetService.assertFleetManager(req.user, req.query.vendor_id || null);
        const drivers = await fleetService.getRoster(vendor.id);
        res.json({ vendor: { id: vendor.id, shop_name: vendor.shop_name }, drivers });
    } catch (err) {
        const status = err.status || 500;
        if (status !== 500) return res.status(status).json({ error: err.message });
        LOG.error('Failed to get fleet roster', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.post('/roster', authenticateToken, async (req, res) => {
    try {
        await resolveUserEmail(req);
        const vendor = await fleetService.assertFleetManager(req.user, req.body.vendor_id || req.query.vendor_id || null);
        const driver = await fleetService.addRosterDriver(vendor.id, req.body || {});
        res.json({ success: true, driver, vendor_id: vendor.id });
    } catch (err) {
        const status = err.status || (err.message && err.message.includes('required') ? 400 : 500);
        if (status !== 500) return res.status(status).json({ error: err.message });
        LOG.error('Failed to add fleet driver', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.put('/roster/:userId', authenticateToken, async (req, res) => {
    try {
        await resolveUserEmail(req);
        const vendor = await fleetService.assertFleetManager(req.user, req.body.vendor_id || req.query.vendor_id || null);
        const driver = await fleetService.updateRosterDriver(vendor.id, req.params.userId, req.body || {});
        res.json({ success: true, driver });
    } catch (err) {
        const status = err.status || 500;
        if (status !== 500) return res.status(status).json({ error: err.message });
        LOG.error('Failed to update fleet driver', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.delete('/roster/:userId', authenticateToken, async (req, res) => {
    try {
        await resolveUserEmail(req);
        const vendor = await fleetService.assertFleetManager(req.user, req.query.vendor_id || null);
        await fleetService.removeRosterDriver(vendor.id, req.params.userId);
        res.json({ success: true });
    } catch (err) {
        const status = err.status || 500;
        if (status !== 500) return res.status(status).json({ error: err.message });
        LOG.error('Failed to remove fleet driver', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = { router, setIO };

