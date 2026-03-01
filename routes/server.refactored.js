const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const db = require('./database');
require('dotenv').config();

// Import utilities and middleware
const LOG = require('./utils/logger');
const requestLogger = require('./middleware/requestLogger');

// Import route modules
const authRoutes = require('./routes/authRoutes');
const vendorRoutes = require('./routes/vendorRoutes');
const productRoutes = require('./routes/productRoutes');
const queueRoutes = require('./routes/queueRoutes');
const appointmentRoutes = require('./routes/appointmentRoutes');
const orderRoutes = require('./routes/orderRoutes');
const matchmakingRoutes = require('./routes/matchmakingRoutes');
const adminRoutes = require('./routes/adminRoutes');
const historyRoutes = require('./routes/historyRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const analyticsRoutes = require('./analyticsRoutes');

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

