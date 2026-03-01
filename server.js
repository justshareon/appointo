const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const db = require('database');
require('dotenv').config();

// Import utilities and middleware
const LOG = require('logger');
const requestLogger = require('requestLogger');

// Import route modules
const authRoutes = require('authRoutes');
const vendorRoutes = require('vendorRoutes');
const productRoutes = require('productRoutes');
const queueRoutes = require('queueRoutes');
const appointmentRoutes = require('appointmentRoutes');
const orderRoutes = require('orderRoutes');
const matchmakingRoutes = require('matchmakingRoutes');
const adminRoutes = require('adminRoutes');
const historyRoutes = require('historyRoutes');
const settingsRoutes = require('settingsRoutes');
const analyticsRoutes = require('analyticsRoutes');
const fleetRoutes = require('fleetRoutes');

// Import services
const dealsService = require('./dealsService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(requestLogger);

// Root route for health check
app.get('/', (req, res) => {
    res.json({ 
        status: "alive", 
        mode: db.getType(),
        database: process.env.DB_HOST || 'local'
    });
});

// DEV: Get all users for testing
app.get('/api/users', async (req, res) => {
    try {
        const users = await db.getUsers();
        LOG.info(`[API /users] Returning ${users.length} users`);
        res.json(users);
    } catch (err) {
        LOG.error("Failed to fetch users", err.message);
        res.status(500).json({ error: err.message });
    }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    LOG.info(`New client connected: ${socket.id}`);
    socket.on('join_vendor_room', (vendorId) => {
        socket.join(`vendor_${vendorId}`);
        LOG.success(`Socket joined vendor room: ${vendorId}`);
    });
    socket.on('disconnect', () => {
        LOG.warning(`Client disconnected: ${socket.id}`);
    });
});

// Periodic task: Auto-expire appointments every minute
setInterval(async () => {
    try {
        const affectedVendorIds = await db.autoExpireAppointments();
        if (affectedVendorIds.length > 0) {
            LOG.info(`Auto-expired appointments for vendors: ${affectedVendorIds.join(', ')}`);
            
            for (const vId of affectedVendorIds) {
                const updatedQueue = await db.getQueueByVendor(vId);
                io.to(`vendor_${vId}`).emit('queue_updated', updatedQueue);
                io.to(`vendor_${vId}`).emit('appointments_updated');
                io.emit('appointments_updated');
            }
        }
    } catch (e) {
        LOG.error("Auto-expire task failed", e.message);
    }
}, 60000);

// Periodic task: Update fleet queue positions and wait times every 30 seconds
setInterval(async () => {
    try {
        if (db.getType() === 'mysql' && db.getPool) {
            const pool = db.getPool();
            
            // Get all active queues
            const [queues] = await pool.query(`
                SELECT DISTINCT gate_id FROM fleet_queues WHERE status = 'waiting'
            `);
            
            for (const row of queues) {
                const gateId = row.gate_id;
                
                // Recalculate positions for all drivers in this gate's queue
                const [queueRows] = await pool.query(`
                    SELECT driver_id, joined_at FROM fleet_queues 
                    WHERE gate_id = ? AND status = 'waiting'
                    ORDER BY joined_at ASC
                `, [gateId]);
                
                // Update positions and wait times
                for (let i = 0; i < queueRows.length; i++) {
                    const position = i + 1;
                    const avgProcessingTime = 3;
                    const [gateInfo] = await pool.query(`SELECT estimated_wait_time FROM fleet_gates WHERE gate_id = ?`, [gateId]);
                    const baseWaitTime = gateInfo[0]?.estimated_wait_time || 10;
                    const estimatedWaitTime = Math.max(5, baseWaitTime + ((position - 1) * avgProcessingTime));
                    
                    await pool.query(`
                        UPDATE fleet_queues 
                        SET position = ?, estimated_wait_time = ?
                        WHERE driver_id = ? AND gate_id = ? AND status = 'waiting'
                    `, [position, estimatedWaitTime, queueRows[i].driver_id, gateId]);
                }
                
                // Emit update to all drivers in this queue
                if (queueRows.length > 0) {
                    io.emit('fleet_queue_updated', {
                        gate_id: gateId,
                        action: 'position_updated',
                        queue_count: queueRows.length
                    });
                }
            }
        }
    } catch (e) {
        LOG.error("Fleet queue update task failed", e.message);
    }
}, 30000); // Every 30 seconds

// ============================================
// FEATURE ROUTES - Modularized by Feature
// ============================================

// Authentication Routes
app.use('/api/auth', authRoutes);

// Vendor Routes
app.use('/api/vendors', vendorRoutes);

// Product Routes (public product endpoints)
app.use('/api/products', productRoutes);

// Queue Routes (requires io instance)
app.use('/api/queue', queueRoutes(io));

// Appointment Routes
app.use('/api/appointments', appointmentRoutes);

// Order Routes
app.use('/api/orders', orderRoutes);

// Matchmaking Routes (vendor-specific routes are in vendorRoutes)
app.use('/api', matchmakingRoutes);

// Admin Routes
app.use('/api/admin', adminRoutes);

// History Routes
app.use('/api/history', historyRoutes);
app.get('/api/activities', async (req, res) => {
    try {
        const historyService = require('./services/historyService');
        const activities = await historyService.getActivities();
        res.json(activities);
    } catch (err) {
        LOG.error("Failed to fetch activities", err.message);
        res.status(500).json({ error: err.message });
    }
});

// Settings Routes
app.use('/api/settings', settingsRoutes);

// Fleet Routes
LOG.info('[Server] Registering Fleet routes...');
fleetRoutes.setIO(io); // Pass Socket.IO instance to fleet routes
app.use('/api/fleet', fleetRoutes.router);
LOG.success('[Server] ✅ Fleet routes registered at /api/fleet');
LOG.info('[Server] Available Fleet endpoints:');
LOG.info('[Server]   GET  /api/fleet/operations/stats');
LOG.info('[Server]   GET  /api/fleet/operations/gates');
LOG.info('[Server]   GET  /api/fleet/operations/alerts');
LOG.info('[Server]   GET  /api/fleet/operations/drivers');
LOG.info('[Server]   GET  /api/fleet/operations/suspicious-locations');
LOG.info('[Server]   GET  /api/fleet/queue/active');
LOG.info('[Server]   POST /api/fleet/queue/join');
LOG.info('[Server]   POST /api/fleet/hazards/report');
LOG.info('[Server]   GET  /api/fleet/gates');
LOG.info('[Server]   GET  /api/fleet/drivers/:driverId/stats');
LOG.info('[Server]   GET  /api/fleet/drivers/:driverId/trips/active');

// Admin Settings Update (with socket broadcast)
app.post('/api/admin/settings', require('./middleware/auth').authenticateToken, async (req, res) => {
    if (req.user.role !== 'super_admin') return res.sendStatus(403);
    try {
        const settingsService = require('./services/settingsService');
        const updated = await settingsService.updateSettings(req.body);
        io.emit('settings_updated', updated);
        res.json(updated);
    } catch (err) {
        LOG.error("Failed to update settings", err.message);
        res.status(500).json({ error: err.message });
    }
});

// Analytics Routes
app.use('/api/analytics', analyticsRoutes);

// Deals Routes
app.get('/api/deals', async (req, res) => {
    try {
        const filters = {
            company_id: req.query.company_id ? parseInt(req.query.company_id) : null,
            category_id: req.query.category_id ? parseInt(req.query.category_id) : null,
            min_discount_percentage: req.query.min_discount ? parseFloat(req.query.min_discount) : null,
            limit: req.query.limit ? parseInt(req.query.limit) : 100
        };
        const deals = await dealsService.getDealsFromDB(filters);
        res.json(deals);
    } catch (err) {
        LOG.error("Failed to fetch deals", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/deals/sync/:companyId', require('./middleware/auth').authenticateToken, async (req, res) => {
    if (req.user.role !== 'super_admin') return res.sendStatus(403);
    try {
        await dealsService.syncCompanyDeals(parseInt(req.params.companyId));
        res.json({ success: true, message: 'Deals synced successfully' });
    } catch (err) {
        LOG.error("Failed to sync deals", err.message);
        res.status(500).json({ error: err.message });
    }
});

// Auto-sync deals every 30 minutes
const SYNC_INTERVAL_MS = (process.env.DEALS_SYNC_INTERVAL_MINUTES || 30) * 60 * 1000;
setInterval(() => {
    dealsService.autoSyncAllCompanies();
}, SYNC_INTERVAL_MS);

// Initial sync on server start (after 1 minute delay)
setTimeout(() => {
    LOG.info("Starting initial deals sync...");
    dealsService.autoSyncAllCompanies();
}, 60000);

// Start server
// Initialize fleet tables on server start (if MySQL)
if (db.getType() === 'mysql' && db.ensureFleetTables) {
    setTimeout(async () => {
        try {
            await db.ensureFleetTables();
        } catch (e) {
            LOG.warning("Fleet tables initialization on startup failed", e.message);
        }
    }, 2000); // Wait 2 seconds for DB connection to be ready
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log("\n========================================");
    LOG.success(`QR Queue Server Started [Mode: ${db.getType().toUpperCase()}]`);
    LOG.info(`Listening on: http://localhost:${PORT}`);
    LOG.info(`DB Methods available: ${Object.keys(db).join(', ')}`);
    LOG.info(`Deals auto-sync interval: ${SYNC_INTERVAL_MS / 60000} minutes`);
    if (db.getType() === 'inmemory') {
        LOG.info(`Seed Users -> Super Admin: 9999999999 | Vendor: 8888888888 | User: 7777777777 | Test Vendor: 3333333333`);
    }
    console.log("========================================\n");
});
