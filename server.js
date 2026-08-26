require('./loadEnv');

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const db = require('./database');
const featureMemory = require('./database/featureMemoryManager');
const { coreDb, tradeDb, fleetDb, cyberDb, trustScoreDb, matchmakingDb, queueDb, appointmentsDb, offerDb, shoppingDb, chatDb, newsDb, healthDb, realestateDb, featureDb } = require('./middleware/featureDbMiddleware');

// Import utilities and middleware
const LOG = require('./utils/logger');
const requestLogger = require('./middleware/requestLogger');

// Core routes only at boot. Feature route modules load on first request.
const authRoutes = require('./routes/authRoutes');
const vendorRoutes = require('./routes/vendorRoutes');
const productRoutes = require('./routes/productRoutes');
const queueRoutes = require('./routes/queueRoutes');
const appointmentRoutes = require('./routes/appointmentRoutes');
const orderRoutes = require('./routes/orderRoutes');
const chatRoutes = require('./routes/chatRoutes');
const adminRoutes = require('./routes/adminRoutes');
const historyRoutes = require('./routes/historyRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const userRoutes = require('./routes/userRoutes');
const activityRoutes = require('./routes/activityRoutes');
const analyticsRoutes = require('./analyticsRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const cron = require('node-cron');
const newsCacheService = require('./services/newsCacheService');
const settingsService = require('./services/settingsService');
const newsRoutes = require('./routes/newsRoutes');
const notificationService = require('./services/notificationService');
const { setupSyncRoutes } = require('./routes/syncRoutes');
const { startAutoSync, syncOnStartup } = require('./services/autoSyncService');
const ensureSyncOnLoadMiddleware = require('./middleware/ensureSyncOnLoad');

function lazyRouter(loader) {
    let router = null;
    return (req, res, next) => {
        if (!router) router = loader();
        return router(req, res, next);
    };
}

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

// Attach Socket.IO to notification service for in-app notifications
notificationService.setIO(io);

//app.use(express.json({ limit: '50mb' }));
//app.use(express.urlencoded({ limit: '50mb', extended: true }));

// In your main server file (likely app.js or server.js)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware
app.use(cors());
app.use(express.json());
// Disable ETags globally to prevent 304 responses (trading routes need fresh data)
app.set('etag', false);
app.use(requestLogger);
app.use(ensureSyncOnLoadMiddleware);

// Root route for health check
app.get('/', (req, res) => {
    res.json({ 
        status: "alive", 
        mode: db.getType(),
        database: process.env.DB_HOST || 'local'
    });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    LOG.info(`New client connected: ${socket.id}`);
    socket.on('join_vendor_room', (vendorId) => {
        socket.join(`vendor_${vendorId}`);
        LOG.success(`Socket joined vendor room: ${vendorId}`);
    });
    socket.on('join_user_room', (userId) => {
        socket.join(`user_${userId}`);
        LOG.success(`Socket joined user room: ${userId}`);
    });
    socket.on('disconnect', () => {
        LOG.warning(`Client disconnected: ${socket.id}`);
    });
});

// Setup Suraksha Socket.IO handlers
const setupSurakshaSocket = require('./sockets/surakshaSocket');
setupSurakshaSocket(io);

featureMemory.bindRuntime({ app, io });
LOG.info(`[Server] Feature lazy-init enabled (idle reclaim ${Math.round(featureMemory.IDLE_MS / 60000)} min)`);

// Daily news cache refresh (configurable via settings)
const scheduleNewsRefresh = async () => {
    try {
        const settings = await settingsService.getSettings();
        const enabled = settings.news_cache_auto_refresh !== false;
        const cronExpr = settings.news_cache_cron || '0 */3 * * *';
        if (!enabled) {
            LOG.info('[Server] News cache auto-refresh disabled');
            return;
        }
        if (!cron.validate(cronExpr)) {
            LOG.warning(`[Server] Invalid news cache cron: ${cronExpr}, using default 0 */3 * * *`);
        }
        cron.schedule(cron.validate(cronExpr) ? cronExpr : '0 */3 * * *', async () => {
            try {
                await newsCacheService.refreshNews(50, settings);
                LOG.success('[Server] News cache refreshed by cron');
            } catch (e) {
                LOG.warning('[Server] News cache cron refresh failed', e.message);
            }
        });
        LOG.info(`[Server] News cache auto-refresh scheduled: ${cronExpr}`);
    } catch (e) {
        LOG.warning('[Server] Failed to schedule news cache refresh', e.message);
    }
};
scheduleNewsRefresh();

// Purge chat messages older than 10 days (hourly)
cron.schedule('15 * * * *', async () => {
    try {
        const chatService = require('./services/chatService');
        await chatService.purgeExpired();
    } catch (e) {
        LOG.warning('[Chat] retention purge failed', e.message);
    }
});
LOG.info('[Server] Chat retention purge scheduled hourly (keep 10 days)');

// Feature jobs, seed, and MySQL pools start on first open (see featureMemoryManager).
// Seed users/vendors run once via coreDb middleware — do not re-upsert every 5 minutes.

// ============================================
// FEATURE ROUTES - Modularized by Feature
// ============================================

// Authentication Routes
app.use('/api/auth', ...coreDb, authRoutes);

// Vendor Routes
app.use('/api/vendors', ...coreDb, vendorRoutes);

// Product Routes (public product endpoints)
app.use('/api/products', ...shoppingDb, productRoutes);

// Queue Routes (requires io instance)
app.use('/api/queue', ...queueDb, queueRoutes(io));

// Appointment Routes
if (typeof appointmentRoutes.setIO === 'function') appointmentRoutes.setIO(io);
app.use('/api/appointments', ...appointmentsDb, appointmentRoutes);

// Order Routes
app.use('/api/orders', ...shoppingDb, orderRoutes);

// Chat Routes (user ↔ vendor, 10-day retention)
if (typeof chatRoutes.setIO === 'function') chatRoutes.setIO(io);
app.use('/api/chat', ...chatDb, chatRoutes);

// Subscription Routes
app.use('/api/subscriptions', ...coreDb, subscriptionRoutes);
LOG.success('[Server] ✅ Subscription routes registered at /api/subscriptions');

app.use('/api', ...matchmakingDb, lazyRouter(() => require('./routes/matchmakingRoutes')));

// History Routes
app.use('/api/history', ...featureDb('queue', 'appointments'), historyRoutes);

// Activity Routes (public activities endpoint)
app.use('/api', ...coreDb, activityRoutes);

// User Routes (for admin/testing - get all users)
app.use('/api', ...coreDb, userRoutes);

// Settings Routes (with socket support)
settingsRoutes.setIO(io);
app.use('/api/settings', ...coreDb, settingsRoutes);
LOG.success('[Server] ✅ Settings routes registered at /api/settings');

// Notification Routes
app.use('/api/notifications', ...coreDb, notificationRoutes);
app.use('/api/news', ...newsDb, newsRoutes);
LOG.success('[Server] ✅ Notification routes registered at /api/notifications');

// Admin Routes (with socket support)
adminRoutes.setIO(io);
app.use('/api/admin', ...coreDb, adminRoutes);
LOG.success('[Server] ✅ Admin routes registered at /api/admin');

app.use('/api/fleet', ...fleetDb, lazyRouter(() => {
    const fleetRoutes = require('./routes/fleetRoutes');
    fleetRoutes.setIO(io);
    return fleetRoutes.router;
}));
app.use('/api/suraksha', ...cyberDb, lazyRouter(() => {
    const surakshaRoutes = require('./routes/surakshaRoutes');
    if (typeof surakshaRoutes.setIO === 'function') surakshaRoutes.setIO(io);
    return surakshaRoutes;
}));
app.use('/api/trust-score', ...trustScoreDb, lazyRouter(() => require('./routes/trustScoreRoutes')));
app.use('/api/trading', ...tradeDb, lazyRouter(() => require('./routes/tradingRoutes')));
app.use('/api/trading', ...tradeDb, lazyRouter(() => require('./routes/tradingDiagnostics')));
app.use('/api/trading', ...tradeDb, lazyRouter(() => require('./routes/tradingDataTrace')));
app.use('/api/trading-data-trace', ...tradeDb, lazyRouter(() => require('./routes/tradingDataTrace')));
app.use('/api/cyber', ...cyberDb, lazyRouter(() => require('./routes/cyberToolsRoutes')));
app.use('/api/health-predict', ...healthDb, lazyRouter(() => require('./routes/healthPredictRoutes')));
app.use('/api/realestate', ...realestateDb, lazyRouter(() => require('./routes/realestateRoutes')));
app.use('/api', ...offerDb, lazyRouter(() => require('./routes/dealsRoutes')));

// ========== SYNC ROUTES ==========
const syncRouter = require('express').Router();
setupSyncRoutes(syncRouter);
app.use('/api/sync', syncRouter);

// Feature DB pools / in-memory seed / jobs are lazy — first open only.

const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
    const dbMode = db.getType();
    console.log("\n========================================");
    LOG.success(`QR Queue Server Started [Mode: ${dbMode.toUpperCase()}]`);
    LOG.info(`Listening on: http://localhost:${PORT}`);
    LOG.info(`DB_TYPE=${dbMode} | DB_HOST=${process.env.DB_HOST || '(none)'} | DB_NAME=${process.env.DB_NAME || '(none)'}`);
    
    // Enable auto-sync if in MySQL mode
    if (dbMode === 'mysql') {
        LOG.warning('MySQL mode: APIs wait on the remote DB. Slow local loads usually mean network + SQL, not Node.');
        LOG.warning('For faster local, set DB_TYPE=inmemory in backend/.env and restart.');
        
        // Optional: Sync on startup (disable if taking too long)
        const autoSyncOnStartup = process.env.AUTO_SYNC_ON_STARTUP !== 'false';
        if (autoSyncOnStartup) {
            syncOnStartup(true);
        }
        
        // Start periodic auto-sync (every 30 minutes by default)
        const syncIntervalMinutes = parseInt(process.env.SYNC_INTERVAL_MINUTES) || 30;
        startAutoSync(syncIntervalMinutes);
        LOG.info(`[AutoSync] Enabled: syncing every ${syncIntervalMinutes} minutes`);
    } else if (process.env.DB_HOST || process.env.DB_NAME) {
        LOG.info('In-memory mode with MySQL configured: mirroring seed so you can switch DB_TYPE=mysql later.');
        if (process.env.AUTO_SYNC_ON_STARTUP !== 'false') {
            syncOnStartup(true);
        }
        const mirrorInterval = parseInt(process.env.SYNC_INTERVAL_MINUTES, 10) || 30;
        startAutoSync(mirrorInterval);
        LOG.info(`[AutoSync] In-memory -> MySQL every ${mirrorInterval} minutes`);
    } else {
        LOG.info('In-memory mode: core seed only at boot. Feature seed/jobs start on first open.');
    }
    LOG.info(`Unused features reclaim memory + DB pools after ${Math.round(featureMemory.IDLE_MS / 60000)} min (FEATURE_IDLE_MINUTES)`);
    featureMemory.startWatchdog();
    try {
        if (typeof db.persistNewsSettings === 'function') {
            await db.persistNewsSettings();
        }
        if (typeof db.persistUiChromeSettings === 'function') {
            await db.persistUiChromeSettings();
        }
    } catch (e) {
        LOG.warning('[Server] persistNewsSettings/persistUiChromeSettings failed: ' + (e.message || e));
    }
    if (dbMode === 'inmemory') {
        LOG.info(`Seed Users -> Super Admin: 9999999999 | Vendor: 8888888888 | User: 7777777777 | Test Vendor: 3333333333`);
    }
    console.log("========================================\n");
});
