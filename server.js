const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const db = require('./database');
require('dotenv').config();

// Import utilities and middleware
const LOG = require('./utils/logger');
const requestLogger = require('./middleware/requestLogger');

// Optional: Trading/Real Estate DB setup helper (auto-creates missing tables like live_stock_data)
const { setupDatabase: setupTradingRealestateDatabase } = require('./setup_trading_realestate_db');

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
const userRoutes = require('./routes/userRoutes');
const activityRoutes = require('./routes/activityRoutes');
const dealsRoutes = require('./routes/dealsRoutes');
const analyticsRoutes = require('./analyticsRoutes');
const fleetRoutes = require('./routes/fleetRoutes');
const surakshaRoutes = require('./routes/surakshaRoutes');
const cyberToolsRoutes = require('./routes/cyberToolsRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const trustScoreRoutes = require('./routes/trustScoreRoutes');
const tradingRoutes = require('./routes/tradingRoutes');
const tradingDiagnostics = require('./routes/tradingDiagnostics');
const notificationRoutes = require('./routes/notificationRoutes');
const cron = require('node-cron');
const newsCacheService = require('./services/newsCacheService');
const settingsService = require('./services/settingsService');
const newsRoutes = require('./routes/newsRoutes');
const notificationService = require('./services/notificationService');

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

// Setup Threat Intelligence Job (every 5 hours)
const ThreatIntelligenceJob = require('./jobs/threatIntelligenceJob');
const threatIntelligenceJob = new ThreatIntelligenceJob(io);
threatIntelligenceJob.schedule();
LOG.info('[Server] ✅ Threat Intelligence job scheduled (every 5 hours)');

// Setup Database Sync Service
const databaseSyncService = require('./services/databaseSyncService');
databaseSyncService.startPeriodicSync();
LOG.info('[Server] ✅ Database sync service started (every 30 minutes)');

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

// Initialize Feature Engineering Service (for stock analytics)
const featureEngineeringService = require('./services/featureEngineeringService');
featureEngineeringService.initializeTables().catch(err => {
    LOG.warning('[Server] Feature engineering tables initialization skipped:', err.message);
});
LOG.info('[Server] ✅ Feature engineering service initialized');

// Setup Trading Data Refresh Job (only if Yahoo Finance is enabled)
const config = require('./config/tradingConfig');
if (config.dataSources.useYahooFinance) {
    const TradingDataRefreshJob = require('./jobs/tradingDataRefreshJob');
    const tradingDataRefreshJob = new TradingDataRefreshJob();
    tradingDataRefreshJob.start();
    LOG.info('[Server] ✅ Trading data refresh job started (BOD/EOD + 10min refresh)');
} else {
    // Setup Excel File Sync Job (when Yahoo Finance is disabled)
    try {
        const ExcelFileSyncJob = require('./jobs/excelFileSyncJob');
        const excelFileSyncJob = new ExcelFileSyncJob();
        
        // ✅ ADD THIS LINE - Register endpoints with Express app
        excelFileSyncJob.registerEndpoints(app);
        
        excelFileSyncJob.start();
        // Store reference globally for status endpoint
        global.excelFileSyncJob = excelFileSyncJob;
        LOG.info('[Server] ✅ Excel file sync job started (every 35 minutes)');
        LOG.info('[Server] ✅ Excel sync endpoints registered: /g/refresh, /g/sync-status, /g/force-sync');
        LOG.info(`[Server] Data Source: Google Sheets -> MySQL/In-Memory (Yahoo Finance disabled)`);
    } catch (error) {
        LOG.error('[Server] Failed to start Excel file sync job:', error.message);
        LOG.warning('[Server] Server will continue running without Excel sync');
    }
    
    // Setup Mutual Fund Sync Job
    try {
        const MutualFundSyncJob = require('./jobs/mutualFundSyncJob');
        const mutualFundSyncJob = new MutualFundSyncJob();
        mutualFundSyncJob.start();
        // Store reference globally for status endpoint
        global.mutualFundSyncJob = mutualFundSyncJob;
        LOG.info('[Server] ✅ Mutual fund sync job started (every 25 minutes)');
        LOG.info(`[Server] Data Source: Equity & Mutual Fund Investment Tracker.xlsx -> MySQL/In-Memory`);
    } catch (error) {
        LOG.error('[Server] Failed to start mutual fund sync job:', error.message);
        LOG.warning('[Server] Server will continue running without mutual fund sync');
    }
    
    // Setup Corporate Actions Sync Job
    try {
        const CorporateActionsSyncJob = require('./jobs/corporateActionsSyncJob');
        const corporateActionsSyncJob = new CorporateActionsSyncJob();
        corporateActionsSyncJob.start();
        // Store reference globally for status endpoint
        global.corporateActionsSyncJob = corporateActionsSyncJob;
        LOG.info('[Server] ✅ Corporate actions sync job started (daily at 6 AM)');
        LOG.info(`[Server] Data Source: CF-CA-equities-*.csv -> MySQL/In-Memory`);
    } catch (error) {
        LOG.error('[Server] Failed to start corporate actions sync job:', error.message);
        LOG.warning('[Server] Server will continue running without corporate actions sync');
    }
    
    // Setup Board Meetings Sync Job
    try {
        const BoardMeetingsSyncJob = require('./jobs/boardMeetingsSyncJob');
        const boardMeetingsSyncJob = new BoardMeetingsSyncJob();
        boardMeetingsSyncJob.start();
        // Store reference globally for status endpoint
        global.boardMeetingsSyncJob = boardMeetingsSyncJob;
        LOG.info('[Server] ✅ Board meetings sync job started (daily at 6:30 AM)');
        LOG.info(`[Server] Data Source: CF-BM-equities-*.csv -> MySQL/In-Memory`);
    } catch (error) {
        LOG.error('[Server] Failed to start board meetings sync job:', error.message);
        LOG.warning('[Server] Server will continue running without board meetings sync');
    }
    
    // Check database status (no auto-seeding)
    setTimeout(async () => {
        try {
            const stockDataService = require('./services/stockDataService');
            const allStocks = await stockDataService.getAllStocks();
            LOG.info(`[Server] Database has ${allStocks.length} stock records`);
            if (allStocks.length === 0) {
                LOG.info('[Server] Database is empty - waiting for Excel file sync or manual data import');
            }
            
            const mutualFundDataService = require('./services/mutualFundDataService');
            const allFunds = await mutualFundDataService.getAllFunds();
            LOG.info(`[Server] Database has ${allFunds.length} mutual fund records`);
        } catch (error) {
            LOG.warning('[Server] Could not check database:', error.message);
        }
    }, 8000); // Wait 8 seconds for database connection
}

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

// Periodic task: Auto-complete queues from previous days every hour
setInterval(async () => {
    try {
        const affectedVendorIds = await db.autoCompleteQueues();
        if (affectedVendorIds.length > 0) {
            LOG.info(`Auto-completed queues for vendors: ${affectedVendorIds.join(', ')}`);
            
            for (const vId of affectedVendorIds) {
                const updatedQueue = await db.getQueueByVendor(vId);
                io.to(`vendor_${vId}`).emit('queue_updated', updatedQueue);
            }
        }
    } catch (e) {
        LOG.error("Auto-complete queues task failed", e.message);
    }
}, 3600000); // Run every hour (3600000 ms)

// Periodic task: Sync ALL users and vendors every 5 minutes (ensures MySQL stays in sync with in-memory DB)
setInterval(async () => {
    try {
        if (db.getType() === 'mysql' && db.ensureAllUsersAndVendors) {
            await db.ensureAllUsersAndVendors();
        }
    } catch (e) {
        LOG.error("All users and vendors sync task failed", e.message);
    }
}, 300000); // Run every 5 minutes (300000 ms)

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

// Subscription Routes
app.use('/api/subscriptions', subscriptionRoutes);
LOG.success('[Server] ✅ Subscription routes registered at /api/subscriptions');

// Matchmaking Routes (vendor-specific routes are in vendorRoutes)
app.use('/api', matchmakingRoutes);

// History Routes
app.use('/api/history', historyRoutes);

// Activity Routes (public activities endpoint)
app.use('/api', activityRoutes);

// User Routes (for admin/testing - get all users)
app.use('/api', userRoutes);

// Settings Routes (with socket support)
settingsRoutes.setIO(io);
app.use('/api/settings', settingsRoutes);
LOG.success('[Server] ✅ Settings routes registered at /api/settings');

// Notification Routes
app.use('/api/notifications', notificationRoutes);
app.use('/api/news', newsRoutes);
LOG.success('[Server] ✅ Notification routes registered at /api/notifications');

// Admin Routes (with socket support)
adminRoutes.setIO(io);
app.use('/api/admin', adminRoutes);
LOG.success('[Server] ✅ Admin routes registered at /api/admin');

// Fleet Routes
LOG.info('[Server] Registering Fleet routes...');
fleetRoutes.setIO(io); // Pass Socket.IO instance to fleet routes
app.use('/api/fleet', fleetRoutes.router);
LOG.success('[Server] ✅ Fleet routes registered at /api/fleet');
LOG.info('[Server] Available Fleet endpoints:');
LOG.info('[Server]   GET  /api/fleet/operations/stats');
LOG.info('[Server]   GET  /api/fleet/operations/gates');
LOG.info('[Server]   GET  /api/fleet/operations/alerts');

// Suraksha Routes (Cyber Safety)
LOG.info('[Server] Registering Suraksha routes...');
surakshaRoutes.setIO(io); // Pass Socket.IO instance to Suraksha routes
app.use('/api/suraksha', surakshaRoutes);
app.use('/api/trust-score', trustScoreRoutes);
app.use('/api/trading', tradingRoutes);
app.use('/api/trading', tradingDiagnostics);
app.use('/api/trading', require('./routes/tradingDataTrace'));

// Also register data-trace as a standalone route for easier access
app.use('/api/trading-data-trace', require('./routes/tradingDataTrace'));
LOG.success('[Server] ✅ Trading routes registered at /api/trading');
LOG.success('[Server] ✅ Suraksha routes registered at /api/suraksha');
LOG.info('[Server] Available Suraksha endpoints:');
LOG.info('[Server]   POST /api/suraksha/validate');
LOG.info('[Server]   GET  /api/suraksha/history');
LOG.info('[Server]   POST /api/suraksha/report');
LOG.info('[Server]   POST /api/suraksha/device/block');
LOG.info('[Server]   GET  /api/suraksha/auto-validation/detections');
LOG.info('[Server]   GET  /api/suraksha/auto-validation/stats');
LOG.info('[Server]   POST /api/suraksha/auto-validation/detection');
LOG.info('[Server]   GET  /api/suraksha/device/sims');
LOG.info('[Server]   POST /api/suraksha/caller/validate');
LOG.info('[Server]   POST /api/suraksha/caller/report');
LOG.info('[Server]   GET  /api/suraksha/caller/history');
LOG.info('[Server]   POST /api/suraksha/threats/post');
LOG.info('[Server]   POST /api/suraksha/threats/search');
LOG.info('[Server]   GET  /api/suraksha/threats/active');
LOG.info('[Server]   GET  /api/suraksha/threats/alerts');
LOG.info('[Server]   POST /api/suraksha/threats/alerts/:alertId/read');
LOG.info('[Server]   GET  /api/suraksha/analytics/most-active');
LOG.info('[Server]   GET  /api/suraksha/analytics/culprits');
LOG.info('[Server]   GET  /api/suraksha/analytics/demographics');
LOG.info('[Server]   GET  /api/suraksha/analytics/statistics');
LOG.info('[Server]   GET  /api/suraksha/analytics/threats');

// Cyber Tools Routes
LOG.info('[Server] Registering Cyber Tools routes...');
app.use('/api/cyber', cyberToolsRoutes);
LOG.success('[Server] ✅ Cyber Tools routes registered at /api/cyber');
LOG.info('[Server] Available Cyber Tools endpoints:');
LOG.info('[Server]   POST /api/cyber/check-email-breach');
LOG.info('[Server]   GET  /api/cyber/security-tips');

LOG.info('[Server]   GET  /api/fleet/operations/drivers');
LOG.info('[Server]   GET  /api/fleet/operations/suspicious-locations');
LOG.info('[Server]   GET  /api/fleet/queue/active');
LOG.info('[Server]   POST /api/fleet/queue/join');
LOG.info('[Server]   POST /api/fleet/hazards/report');
LOG.info('[Server]   GET  /api/fleet/gates');
LOG.info('[Server]   GET  /api/fleet/drivers/:driverId/stats');
LOG.info('[Server]   GET  /api/fleet/drivers/:driverId/trips/active');

// Analytics Routes
app.use('/api/analytics', analyticsRoutes);

// Deals Routes
app.use('/api', dealsRoutes);

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

// Initialize ALL users and vendors on server start (if MySQL) - comprehensive sync
if (db.getType() === 'mysql' && db.ensureAllUsersAndVendors) {
    setTimeout(async () => {
        try {
            LOG.info('[Server] Starting comprehensive users and vendors sync...');
            await db.ensureAllUsersAndVendors();
            LOG.success('[Server] ✅ All users and vendors synced to MySQL');
        } catch (e) {
            LOG.warning("Users and vendors initialization on startup failed", e.message);
        }
    }, 3000); // Wait 3 seconds for DB connection to be ready
}

// Ensure cyber threat tables on startup (if MySQL)
if (db.getType() === 'mysql' && db.ensureCyberThreatTables) {
    setTimeout(async () => {
        try {
            await db.ensureCyberThreatTables();
        } catch (e) {
            LOG.warning("Cyber threat tables initialization on startup failed", e.message);
        }
    }, 3500); // Run after basic DB initialization
}

// Ensure trading/real-estate + corporate actions + mutual fund tables exist on startup (if MySQL)
if (db.getType() === 'mysql') {
    setTimeout(async () => {
        try {
            // Allow disabling via env flag if ever needed
            if (process.env.AUTO_SETUP_TRADING_DB === 'false') {
                LOG.info('[Server] Trading/real-estate DB auto-setup disabled via AUTO_SETUP_TRADING_DB=false');
                return;
            }

            // TiDB Cloud serverless requires secure (SSL) connections; our standalone
            // setup_trading_realestate_db script opens a separate, non-SSL connection.
            // When using TiDB Cloud, skip this script and rely on per-service initializeTables()
            // which use the main pooled connection (already configured for SSL).
            const dbHost = process.env.DB_HOST || '';
            const isTiDBCloud = dbHost.includes('tidbcloud.com');

            if (isTiDBCloud) {
                LOG.info('[Server] Detected TiDB Cloud; skipping setup_trading_realestate_db auto-run (use per-service initializeTables instead)');
            } else {
                LOG.info('[Server] Ensuring trading/real-estate tables exist (setup_trading_realestate_db)...');
                await setupTradingRealestateDatabase();
                LOG.success('[Server] Trading/real-estate tables verified/created successfully on startup');
            }

            // Also ensure corporate actions and mutual fund tables via their services
            try {
                const mutualFundDataService = require('./services/mutualFundDataService');
                await mutualFundDataService.initializeTables();
                LOG.success('[Server] Mutual fund tables verified/created successfully on startup');
            } catch (e) {
                LOG.warning('[Server] Mutual fund tables initialization on startup failed', e.message);
            }

            try {
                const corporateActionsDataService = require('./services/corporateActionsDataService');
                await corporateActionsDataService.initializeTables();
                LOG.success('[Server] Corporate actions tables verified/created successfully on startup');
            } catch (e) {
                LOG.warning('[Server] Corporate actions tables initialization on startup failed', e.message);
            }
        } catch (e) {
            LOG.warning('[Server] Trading/real-estate DB setup on startup failed', e.message);
        }
    }, 4000); // Run after other MySQL initializers
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
