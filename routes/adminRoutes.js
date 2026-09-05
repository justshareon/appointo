/**
 * Admin Routes
 * Routes for super admin functionality
 */
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const cyberFeaturesController = require('../controllers/admin/cyberFeaturesController');
const adminController = require('../controllers/admin/adminController');

// Middleware to attach io to request
const attachSocket = (io) => (req, res, next) => {
    req.io = io;
    if (req.user?.id) {
        req.userRoom = `user_${req.user.id}`;
    }
    next();
};

// Set IO instance (called from server.js)
let ioInstance = null;
router.setIO = (io) => {
    ioInstance = io;
};

// All admin routes require authentication
router.use(authenticateToken);

// Vendor Management
router.get('/vendors', (req, res) => adminController.getVendors(req, res));
router.post('/update-vendor', (req, res) => adminController.updateVendor(req, res));
router.post('/add-vendor', (req, res) => adminController.addVendor(req, res));
router.get('/vendor-categories', (req, res) => adminController.getVendorCategories(req, res));
router.post('/vendor-categories', (req, res) => adminController.addVendorCategory(req, res));
router.get('/vendor-dashboard/:vendorId', (req, res) => adminController.getVendorDashboard(req, res));

// User & Mapping Management
router.get('/users-with-mappings', (req, res) => adminController.getUsersWithMappings(req, res));
router.get('/vendor-picker', (req, res) => adminController.getVendorPickerList(req, res));
router.post('/users', (req, res) => adminController.createUser(req, res));
router.put('/users/:userId', (req, res) => adminController.updateUser(req, res));
router.delete('/users/:userId', (req, res) => adminController.deleteUser(req, res));
router.post('/user-vendor-mapping', (req, res) => adminController.addUserVendorMapping(req, res));
router.delete('/user-vendor-mapping', (req, res) => adminController.removeUserVendorMapping(req, res));

// Cyber Features Management
router.get('/cyber-features', (req, res) => cyberFeaturesController.getCyberFeatures(req, res));
router.post('/cyber-features', attachSocket(ioInstance), (req, res) => cyberFeaturesController.updateCyberFeatures(req, res));
router.post('/cyber-features/toggle/:featureName', attachSocket(ioInstance), (req, res) => cyberFeaturesController.toggleFeature(req, res));

// Trading Data Source Management
const tradingConfigService = require('../services/tradingConfigService');
const stockDataService = require('../services/stockDataService');
const LOG = require('../utils/logger');
const tradingExcelLog = require('../utils/tradingExcelLog');
const path = require('path');
const fs = require('fs');
const config = require('../config/tradingConfig');

const requireSuperAdmin = (req, res, next) => {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'super_admin' && req.user?.email !== 'admin@qrqueue.com') {
        return res.status(403).json({ error: 'Super admin access required' });
    }
    return next();
};

/** Excel sync job is created lazily — admin routes use coreDb, not tradeDb. */
async function ensureTradingExcelReady(req) {
    tradingExcelLog.push('info', 'init_start', 'Ensuring trade Excel job is ready');
    try {
        const { ensureFeature } = require('../database/featureMemoryManager');
        await ensureFeature('trade', { mode: 'basic' });
        tradingExcelLog.push('info', 'init_trade', 'Trade feature module initialized');
    } catch (err) {
        tradingExcelLog.push('warn', 'init_trade', `Trade feature init failed: ${err.message}`);
        LOG.warning('[Admin] Trade feature init (non-fatal):', err.message);
    }
    if (!global.excelFileSyncJob) {
        const ExcelFileSyncJob = require('../jobs/excelFileSyncJob');
        global.excelFileSyncJob = new ExcelFileSyncJob();
        tradingExcelLog.push('info', 'init_job', 'Created ExcelFileSyncJob instance');
        if (req?.app && !global.excelFileSyncJob.endpointsRegistered) {
            global.excelFileSyncJob.registerEndpoints(req.app);
            global.excelFileSyncJob.endpointsRegistered = true;
            tradingExcelLog.push('info', 'init_endpoints', 'Registered /g/refresh sync endpoints');
        }
    } else {
        tradingExcelLog.push('info', 'init_job', 'Reusing existing ExcelFileSyncJob');
    }
    try {
        await stockDataService.initializeTables();
        tradingExcelLog.push('info', 'init_tables', 'Stock tables ensured');
    } catch (err) {
        tradingExcelLog.push('warn', 'init_tables', `Stock tables init: ${err.message}`);
        LOG.warning('[Admin] Stock tables init (non-fatal):', err.message);
    }
    return global.excelFileSyncJob;
}

function getTradingExcelDiagnostics(syncJob) {
    const configured = config.excelFile?.filePath;
    const candidate = configured
        ? path.resolve(__dirname, '..', configured.replace(/^\.\//, ''))
        : path.resolve(__dirname, '../India_Stock_Market_Tracker_v1.0.xlsx');
    const filePath = syncJob?.getLocalExcelPath?.() || candidate;
    const db = require('../database');
    return {
        platform: process.platform,
        dbType: typeof db.getType === 'function' ? db.getType() : process.env.DB_TYPE || 'unknown',
        mysqlPool: !!db.getPool?.(),
        excelFilePath: filePath,
        excelFileExists: fs.existsSync(filePath),
        preferLocal: config.excelFile?.preferLocal !== false,
        openBeforeSync: config.excelFile?.openBeforeSync !== false,
        excelOpenEnabled: process.platform === 'win32' && process.env.EXCEL_OPEN_BEFORE_SYNC !== 'false',
        googleSheetsId: process.env.GOOGLE_SHEETS_ID ? 'set' : 'missing',
        uploadedFile: (() => {
            try {
                const u = require('../services/tradingExcelUploadService').getLastUploaded();
                return u ? { fileName: u.fileName, sizeBytes: u.sizeBytes, uploadedAt: u.uploadedAt } : null;
            } catch (_) {
                return null;
            }
        })(),
        syncJobRunning: !!syncJob?.isRunning,
        ...(syncJob?.getStatus?.() || {}),
    };
}

function tradingExcelErrorPayload(error, syncJob) {
    return {
        success: false,
        error: error?.message || 'Trading Excel operation failed',
        step: error?.tradingExcelStep || error?.step || 'unknown',
        diagnostics: error?.diagnostics || getTradingExcelDiagnostics(syncJob),
        logs: tradingExcelLog.getRecent(25),
    };
}

/**
 * GET /api/admin/trading-config
 * Get current trading data source configuration
 */
router.get('/trading-config', async (req, res) => {
    try {
        const config = tradingConfigService.getConfig();
        res.json({ success: true, data: config });
    } catch (error) {
        LOG.error('[Admin] Error getting trading config:', error);
        res.status(500).json({ error: error.message || 'Failed to get trading config' });
    }
});

/**
 * POST /api/admin/trading-config/yahoo-finance
 * Enable/disable Yahoo Finance data source
 * Body: { enabled: true/false }
 */
router.post('/trading-config/yahoo-finance', async (req, res) => {
    try {
        const { enabled } = req.body;
        const updatedBy = req.user?.email || req.user?.id || 'admin';
        
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ error: 'enabled must be a boolean value' });
        }

        const result = await tradingConfigService.updateYahooFinanceSetting(enabled, updatedBy);
        res.json({ success: true, ...result });
    } catch (error) {
        LOG.error('[Admin] Error updating Yahoo Finance setting:', error);
        res.status(500).json({ error: error.message || 'Failed to update setting' });
    }
});

/**
 * POST /api/admin/trading-data/seed-sample
 * Seed sample stock data for testing (DEPRECATED - Use Excel file or CSV import instead)
 * Body: { count: number (optional, default: 50) }
 */
router.post('/trading-data/seed-sample', async (req, res) => {
    try {
        LOG.warning('[Admin] Sample data seeding is deprecated. Use Excel file sync or CSV import instead.');
        res.status(410).json({ 
            success: false, 
            message: 'Sample data seeding is disabled. Please use Excel file sync or CSV import.',
            suggestion: 'Use POST /api/admin/trading-data/import-csv to import data from CSV file'
        });
    } catch (error) {
        LOG.error('[Admin] Error in seed-sample endpoint:', error);
        res.status(500).json({ error: error.message || 'Failed to process request' });
    }
});

/**
 * POST /api/admin/trading-data/import-csv
 * Import stock data from CSV file (downloaded from Google Sheets)
 * Body: { csvData: string (CSV content) }
 */
router.post('/trading-data/import-csv', async (req, res) => {
    try {
        const { csvData } = req.body;
        
        if (!csvData) {
            return res.status(400).json({ error: 'csvData is required' });
        }

        const csvImportService = require('../services/csvImportService');
        const result = await csvImportService.importFromCSV(csvData);
        
        res.json({ 
            success: true, 
            message: `Imported ${result.inserted} stock records from CSV`,
            data: result 
        });
    } catch (error) {
        LOG.error('[Admin] Error importing CSV:', error);
        res.status(500).json({ error: error.message || 'Failed to import CSV data' });
    }
});

/**
 * DELETE /api/admin/trading-data/clear
 * Clear all stock data (for testing)
 */
router.delete('/trading-data/clear', async (req, res) => {
    try {
        await stockDataService.truncateLiveData();
        const pool = require('../database').getPool();
        if (pool) {
            await pool.query('TRUNCATE TABLE stock_data_history');
        }
        res.json({ success: true, message: 'All stock data cleared' });
    } catch (error) {
        LOG.error('[Admin] Error clearing stock data:', error);
        res.status(500).json({ error: error.message || 'Failed to clear data' });
    }
});

/**
 * GET /api/admin/trading-data/status
 * MySQL + in-memory counts and Excel sync job health
 */
router.get('/trading-data/status', requireSuperAdmin, async (req, res) => {
    try {
        const syncJob = await ensureTradingExcelReady(req);
        const mysqlCount = await stockDataService.getMysqlLiveCount();
        const memoryCount = (stockDataService.getInMemoryDb().live_stock_data || []).length;
        const diagnostics = getTradingExcelDiagnostics(syncJob);
        tradingExcelLog.push('info', 'status', `mysql=${mysqlCount} memory=${memoryCount} fileExists=${diagnostics.excelFileExists}`);
        res.json({
            success: true,
            mysqlCount,
            memoryCount,
            pendingPreview: syncJob?.getPendingPreview?.()?.length || 0,
            sync: syncJob?.getStatus?.() || null,
            diagnostics,
            logs: tradingExcelLog.getRecent(25),
        });
    } catch (error) {
        LOG.error('[Admin] trading-data/status:', error);
        tradingExcelLog.push('error', 'status', error.message);
        res.status(500).json(tradingExcelErrorPayload(error, global.excelFileSyncJob));
    }
});

/**
 * POST /api/admin/trading-data/load-excel
 * Close/reopen Excel (optional), read workbook, preview in memory — no DB write until save.
 * Body: { restartExcel?: boolean, openExcel?: boolean }
 */
router.post('/trading-data/load-excel', requireSuperAdmin, async (req, res) => {
    const started = Date.now();
    let syncJob;
    try {
        syncJob = await ensureTradingExcelReady(req);
        const {
            restartExcel = false,
            openExcel = false,
            useUploadedFile = false,
            filePath,
        } = req.body || {};
        tradingExcelLog.push('info', 'load_start', 'Admin load-excel requested', {
            restartExcel,
            openExcel,
            useUploadedFile,
            user: req.user?.email || req.user?.id,
        });
        const preview = await syncJob.loadPreviewForAdmin({
            restartExcel,
            openExcel,
            useUploadedFile,
            filePath,
        });
        const memoryCount = (stockDataService.getInMemoryDb().live_stock_data || []).length;
        const ms = Date.now() - started;
        tradingExcelLog.push('info', 'load_done', `Preview ready: ${preview?.total || 0} rows in ${ms}ms`, {
            memoryCount,
            counts: preview?.counts,
        });
        res.json({
            success: true,
            preview,
            memoryCount,
            durationMs: ms,
            diagnostics: getTradingExcelDiagnostics(syncJob),
            logs: tradingExcelLog.getRecent(25),
        });
    } catch (error) {
        const ms = Date.now() - started;
        LOG.error('[Admin] load-excel:', error);
        tradingExcelLog.attachError(error, error.tradingExcelStep || 'load_failed', {
            durationMs: ms,
            ...getTradingExcelDiagnostics(syncJob || global.excelFileSyncJob),
        });
        res.status(500).json(tradingExcelErrorPayload(error, syncJob || global.excelFileSyncJob));
    }
});

router.post('/trading-data/upload-excel', requireSuperAdmin, async (req, res) => {
    try {
        const tradingExcelUploadService = require('../services/tradingExcelUploadService');
        const { fileName, dataBase64 } = req.body || {};
        const upload = tradingExcelUploadService.saveUpload({ fileName, dataBase64 });
        tradingExcelLog.push('info', 'upload_ok', `Saved ${upload.fileName} (${upload.sizeBytes} bytes)`);
        res.json({
            success: true,
            upload,
            diagnostics: getTradingExcelDiagnostics(global.excelFileSyncJob),
            logs: tradingExcelLog.getRecent(25),
        });
    } catch (error) {
        LOG.error('[Admin] upload-excel:', error);
        tradingExcelLog.attachError(error, 'upload_failed');
        res.status(400).json(tradingExcelErrorPayload(error, global.excelFileSyncJob));
    }
});

router.post('/trading-data/upload-and-load', requireSuperAdmin, async (req, res) => {
    const started = Date.now();
    let syncJob;
    try {
        syncJob = await ensureTradingExcelReady(req);
        const tradingExcelUploadService = require('../services/tradingExcelUploadService');
        const { fileName, dataBase64 } = req.body || {};
        const upload = tradingExcelUploadService.saveUpload({ fileName, dataBase64 });
        const preview = await syncJob.loadPreviewFromFilePath(upload.filePath, { label: 'upload' });
        const memoryCount = (stockDataService.getInMemoryDb().live_stock_data || []).length;
        res.json({
            success: true,
            upload,
            preview,
            memoryCount,
            durationMs: Date.now() - started,
            diagnostics: getTradingExcelDiagnostics(syncJob),
            logs: tradingExcelLog.getRecent(25),
        });
    } catch (error) {
        LOG.error('[Admin] upload-and-load:', error);
        tradingExcelLog.attachError(error, error.tradingExcelStep || 'upload_load_failed');
        res.status(500).json(tradingExcelErrorPayload(error, syncJob || global.excelFileSyncJob));
    }
});

router.post('/trading-data/load-and-save', requireSuperAdmin, async (req, res) => {
    const started = Date.now();
    let syncJob;
    try {
        syncJob = await ensureTradingExcelReady(req);
        const { fileName, dataBase64 } = req.body || {};
        if (dataBase64) {
            const tradingExcelUploadService = require('../services/tradingExcelUploadService');
            const upload = tradingExcelUploadService.saveUpload({ fileName, dataBase64 });
            await syncJob.loadPreviewFromFilePath(upload.filePath, { label: 'upload' });
        }
        const result = await syncJob.persistCleanedData(req.body?.data);
        const memoryCount = (stockDataService.getInMemoryDb().live_stock_data || []).length;
        res.json({
            success: true,
            message: `Saved ${result.inserted} stock rows`,
            memoryCount,
            durationMs: Date.now() - started,
            diagnostics: getTradingExcelDiagnostics(syncJob),
            logs: tradingExcelLog.getRecent(25),
            ...result,
        });
    } catch (error) {
        LOG.error('[Admin] load-and-save:', error);
        tradingExcelLog.attachError(error, error.tradingExcelStep || 'load_save_failed');
        res.status(500).json(tradingExcelErrorPayload(error, syncJob || global.excelFileSyncJob));
    }
});

/**
 * POST /api/admin/trading-data/save-excel
 * Persist preview (or body.data) to in-memory + MySQL.
 */
router.post('/trading-data/save-excel', requireSuperAdmin, async (req, res) => {
    const started = Date.now();
    let syncJob;
    try {
        syncJob = await ensureTradingExcelReady(req);
        tradingExcelLog.push('info', 'save_start', 'Admin save-excel requested', {
            user: req.user?.email || req.user?.id,
            pendingPreview: syncJob?.getPendingPreview?.()?.length || 0,
        });
        const result = await syncJob.persistCleanedData(req.body?.data);
        const memoryCount = (stockDataService.getInMemoryDb().live_stock_data || []).length;
        const ms = Date.now() - started;
        tradingExcelLog.push('info', 'save_done', `Saved ${result.inserted} rows (${result.storage}) in ${ms}ms`, {
            memoryCount,
            archived: result.archived,
        });
        res.json({
            success: true,
            message: `Saved ${result.inserted} stock rows`,
            memoryCount,
            durationMs: ms,
            diagnostics: getTradingExcelDiagnostics(syncJob),
            logs: tradingExcelLog.getRecent(25),
            ...result,
        });
    } catch (error) {
        const ms = Date.now() - started;
        LOG.error('[Admin] save-excel:', error);
        tradingExcelLog.attachError(error, error.tradingExcelStep || 'save_failed', {
            durationMs: ms,
            ...getTradingExcelDiagnostics(syncJob || global.excelFileSyncJob),
        });
        res.status(500).json(tradingExcelErrorPayload(error, syncJob || global.excelFileSyncJob));
    }
});

// RERA public filings (Trust Score) — preview then save
const reraFilingsService = require('../services/trustScore/reraFilingsService');
const reraFilingsLog = require('../utils/reraFilingsLog');

async function ensureTrustReraReady() {
    reraFilingsLog.push('info', 'init_start', 'Ensuring trust score feature is ready');
    try {
        const fcm = require('../database/featureConnectionManager');
        if (fcm.isMysqlEnabled && fcm.isMysqlEnabled()) {
            await fcm.acquireForSync('trust_score');
        }
        const { ensureFeature } = require('../database/featureMemoryManager');
        await ensureFeature('trust_score', { mode: 'basic' });
        reraFilingsLog.push('info', 'init_trust', 'Trust score feature module initialized');
    } catch (err) {
        reraFilingsLog.push('warn', 'init_trust', `Trust feature init: ${err.message}`);
        LOG.warning('[Admin] Trust feature init (non-fatal):', err.message);
    }
}

function reraFilingsErrorPayload(error) {
    return {
        success: false,
        error: error.message,
        step: error.reraFilingsStep || 'unknown',
        diagnostics: error.diagnostics || reraFilingsService.getDiagnostics(),
        logs: reraFilingsLog.getRecent(25),
    };
}

router.get('/rera-filings/status', requireSuperAdmin, async (req, res) => {
    try {
        await ensureTrustReraReady();
        const status = await reraFilingsService.getStatus();
        reraFilingsLog.push('info', 'status', `mysql=${status.mysqlCount} memory=${status.memoryCount} pending=${status.pendingPreview}`);
        res.json({
            success: true,
            ...status,
            dataSourceLabel: reraFilingsService.DATA_SOURCE_LABEL,
            filingAsOf: reraFilingsService.FILING_AS_OF,
            logs: reraFilingsLog.getRecent(25),
        });
    } catch (error) {
        LOG.error('[Admin] rera-filings/status:', error);
        reraFilingsLog.attachError(error, 'status_failed');
        res.status(500).json(reraFilingsErrorPayload(error));
    }
});

router.post('/rera-filings/load', requireSuperAdmin, async (req, res) => {
    const started = Date.now();
    try {
        await ensureTrustReraReady();
        const { useReraApi = false } = req.body || {};
        reraFilingsLog.push('info', 'load_start', 'Admin load RERA filings', {
            user: req.user?.email || req.user?.id,
            useReraApi,
        });
        const preview = await reraFilingsService.loadPreview({ useReraApi });
        const status = await reraFilingsService.getStatus();
        const ms = Date.now() - started;
        res.json({
            success: true,
            preview,
            memoryCount: status.memoryCount,
            durationMs: ms,
            diagnostics: status.diagnostics,
            logs: reraFilingsLog.getRecent(25),
        });
    } catch (error) {
        LOG.error('[Admin] rera-filings/load:', error);
        reraFilingsLog.attachError(error, error.reraFilingsStep || 'load_failed');
        res.status(500).json(reraFilingsErrorPayload(error));
    }
});

router.post('/rera-filings/save', requireSuperAdmin, async (req, res) => {
    const started = Date.now();
    try {
        await ensureTrustReraReady();
        reraFilingsLog.push('info', 'save_start', 'Admin save RERA filings', {
            user: req.user?.email || req.user?.id,
            pendingPreview: reraFilingsService.getPendingPreview()?.length || 0,
        });
        const result = await reraFilingsService.saveToDatabase(req.body?.data);
        const status = await reraFilingsService.getStatus();
        const ms = Date.now() - started;
        reraFilingsLog.push('info', 'save_done', `Saved ${result.total} projects (${result.storage}) in ${ms}ms`);
        res.json({
            success: true,
            message: `Saved ${result.total} RERA filing records`,
            memoryCount: status.memoryCount,
            durationMs: ms,
            diagnostics: status.diagnostics,
            logs: reraFilingsLog.getRecent(25),
            ...result,
        });
    } catch (error) {
        LOG.error('[Admin] rera-filings/save:', error);
        reraFilingsLog.attachError(error, error.reraFilingsStep || 'save_failed');
        res.status(500).json(reraFilingsErrorPayload(error));
    }
});

// Database Sync Management
const bidirectionalSyncService = require('../services/bidirectionalSyncService');

/**
 * POST /api/admin/sync/to-mysql
 * Sync all data from in-memory database to MySQL
 */
router.post('/sync/to-mysql', async (req, res) => {
    try {
        const result = await bidirectionalSyncService.syncToMySQL();
        if (result.success) {
            res.json({ 
                success: true, 
                message: 'Sync to MySQL completed successfully',
                result: result.result,
                lastSyncTime: result.lastSyncTime
            });
        } else {
            res.status(500).json({ 
                success: false, 
                error: result.error || 'Sync failed',
                message: result.message
            });
        }
    } catch (error) {
        LOG.error('[Admin] Error syncing to MySQL:', error);
        res.status(500).json({ error: error.message || 'Failed to sync to MySQL' });
    }
});

/**
 * POST /api/admin/sync/from-mysql
 * Sync all data from MySQL to in-memory database
 */
router.post('/sync/from-mysql', async (req, res) => {
    try {
        const result = await bidirectionalSyncService.syncFromMySQL();
        if (result.success) {
            res.json({ 
                success: true, 
                message: 'Sync from MySQL completed successfully',
                result: result.result,
                lastSyncTime: result.lastSyncTime
            });
        } else {
            res.status(500).json({ 
                success: false, 
                error: result.error || 'Sync failed',
                message: result.message
            });
        }
    } catch (error) {
        LOG.error('[Admin] Error syncing from MySQL:', error);
        res.status(500).json({ error: error.message || 'Failed to sync from MySQL' });
    }
});

/**
 * POST /api/admin/sync/bidirectional
 * Full bidirectional sync (MySQL → In-Memory → MySQL)
 */
router.post('/sync/bidirectional', async (req, res) => {
    try {
        const result = await bidirectionalSyncService.syncBidirectional();
        if (result.success) {
            res.json({ 
                success: true, 
                message: 'Bidirectional sync completed successfully',
                fromMySQL: result.fromMySQL,
                toMySQL: result.toMySQL
            });
        } else {
            res.status(500).json({ 
                success: false, 
                error: 'Bidirectional sync failed',
                fromMySQL: result.fromMySQL,
                toMySQL: result.toMySQL
            });
        }
    } catch (error) {
        LOG.error('[Admin] Error in bidirectional sync:', error);
        res.status(500).json({ error: error.message || 'Failed to perform bidirectional sync' });
    }
});

/**
 * GET /api/admin/sync/status
 * Get current sync status
 */
router.get('/sync/status', async (req, res) => {
    try {
        const status = bidirectionalSyncService.getSyncStatus();
        res.json({ 
            success: true, 
            status: status
        });
    } catch (error) {
        LOG.error('[Admin] Error getting sync status:', error);
        res.status(500).json({ error: error.message || 'Failed to get sync status' });
    }
});

/**
 * POST /api/admin/client-errors
 * Report UI screen crashes / render errors (any authenticated user).
 */
router.post('/client-errors', (req, res) => {
    try {
        const { recordClientError } = require('../services/clientErrorService');
        const entry = recordClientError({
            ...req.body,
            userId: req.user?.id || req.userId || null,
            userRole: req.user?.role || null,
        });
        res.json({ success: true, id: entry.id });
    } catch (error) {
        LOG.error('[Admin] client-errors error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/admin/sync/status — sync_module_state + sync_runs for APS dashboard
 */
router.get('/sync/status', requireSuperAdmin, async (req, res) => {
    try {
        const syncStatus = require('../services/syncStatusService');
        const { isSyncRunning } = require('../services/autoSyncService');
        const { isMysqlConfigured } = require('../utils/resolveDbType');
        const moduleState = await syncStatus.getModuleState();
        const latestRun = await syncStatus.getLatestRun();
        const complete = await syncStatus.isSyncComplete();
        res.json({
            isSyncing: isSyncRunning(),
            complete,
            needsSync: !complete,
            mysqlConfigured: isMysqlConfigured(),
            buildVersion: syncStatus.getBuildVersion?.() || process.env.BUILD_VERSION || 'local',
            summary: moduleState.summary,
            modules: moduleState.modules,
            latestRun,
        });
    } catch (error) {
        LOG.error('[Admin] sync/status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/admin/sync/all — one sync attempt (resume-aware)
 */
router.post('/sync/all', requireSuperAdmin, async (req, res) => {
    try {
        const { runSyncAttempt, isSyncRunning } = require('../services/autoSyncService');
        if (isSyncRunning()) {
            return res.status(409).json({ status: 'in_progress', message: 'Sync already in progress' });
        }
        const forceFull = req.query.forceFull === 'true' || req.body?.forceFull === true;
        runSyncAttempt('super-admin', { forceFull }).catch((err) => {
            LOG.error('[Admin] sync/all background error:', err.message);
        });
        res.json({ status: 'started', message: 'Sync started', forceFull });
    } catch (error) {
        LOG.error('[Admin] sync/all error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/admin/sync/until-complete — retry until all modules SUCCESS
 */
router.post('/sync/until-complete', requireSuperAdmin, async (req, res) => {
    try {
        const { syncUntilComplete, isSyncRunning } = require('../services/autoSyncService');
        if (isSyncRunning()) {
            return res.status(409).json({ status: 'in_progress', message: 'Sync already in progress' });
        }
        syncUntilComplete('super-admin-dashboard').catch((err) => {
            LOG.error('[Admin] sync/until-complete error:', err.message);
        });
        res.json({ status: 'started', message: 'Sync will run until all modules complete' });
    } catch (error) {
        LOG.error('[Admin] sync/until-complete error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/admin/system-health
 * Cross-module diagnostics for super-admin APS dashboard
 */
router.get('/system-health', requireSuperAdmin, async (req, res) => {
    try {
        const { getSystemHealth } = require('../services/systemHealthService');
        const health = await getSystemHealth();
        res.json(health);
    } catch (error) {
        LOG.error('[Admin] system-health error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/admin/pool-config — per-feature MySQL pool limits (super-admin)
 */
router.get('/pool-config', requireSuperAdmin, async (req, res) => {
    try {
        const poolConfig = require('../utils/poolConfig');
        const fcm = require('../database/featureConnectionManager');
        const config = await poolConfig.getPoolConfig();
        const stats = fcm.getPoolStats();
        res.json({
            success: true,
            config,
            stats,
            summary: poolConfig.summarizePoolRows(stats),
            issues: poolConfig.validatePoolHealthRows(stats),
        });
    } catch (error) {
        LOG.error('[Admin] pool-config GET error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/admin/pool-config — update limits and recycle pools
 */
router.put('/pool-config', requireSuperAdmin, async (req, res) => {
    try {
        const poolConfig = require('../utils/poolConfig');
        const fcm = require('../database/featureConnectionManager');
        const config = await poolConfig.updatePoolConfig(req.body || {});
        await fcm.applyConfiguredLimits();
        const stats = fcm.getPoolStats();
        res.json({
            success: true,
            config,
            stats,
            summary: poolConfig.summarizePoolRows(stats),
            issues: poolConfig.validatePoolHealthRows(stats),
        });
    } catch (error) {
        LOG.error('[Admin] pool-config PUT error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/admin/pool-config/optimize — bump sub-5 limits to recommended default
 */
router.post('/pool-config/optimize', requireSuperAdmin, async (req, res) => {
    try {
        const poolConfig = require('../utils/poolConfig');
        const fcm = require('../database/featureConnectionManager');
        const current = await poolConfig.getPoolConfig();
        const featureLimits = { ...(current.featureLimits || {}) };
        const nextFeatures = {};
        (current.features || []).forEach((row) => {
            if ((row.limit || 0) < poolConfig.RECOMMENDED) {
                nextFeatures[row.id] = poolConfig.RECOMMENDED;
            }
        });
        const patch = {
            defaultLimit: Math.max(current.defaultLimit || 0, poolConfig.RECOMMENDED),
            minLimit: Math.max(current.minLimit || 0, poolConfig.ABS_MIN),
            featureLimits: { ...featureLimits, ...nextFeatures },
        };
        const config = await poolConfig.updatePoolConfig(patch);
        await fcm.applyConfiguredLimits();
        const stats = fcm.getPoolStats();
        res.json({
            success: true,
            config,
            stats,
            summary: poolConfig.summarizePoolRows(stats),
            issues: poolConfig.validatePoolHealthRows(stats),
            optimized: Object.keys(nextFeatures).length,
        });
    } catch (error) {
        LOG.error('[Admin] pool-config optimize error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/admin/offer-sources — RSS/API URLs used for offer extraction
 */
router.get('/offer-sources', requireSuperAdmin, async (req, res) => {
    try {
        const offerSourcesService = require('../services/offerSourcesService');
        const data = await offerSourcesService.getOfferSources();
        res.json({ success: true, ...data });
    } catch (error) {
        LOG.error('[Admin] offer-sources GET error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/admin/offer-sources — update offer feed URLs (stored in trade_news_sources)
 */
router.put('/offer-sources', requireSuperAdmin, async (req, res) => {
    try {
        const offerSourcesService = require('../services/offerSourcesService');
        const data = await offerSourcesService.updateOfferSources(req.body?.sources || []);
        res.json({ success: true, ...data });
    } catch (error) {
        LOG.error('[Admin] offer-sources PUT error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/admin/module-urls/modules — module list only (no URLs)
 */
router.get('/module-urls/modules', requireSuperAdmin, async (req, res) => {
    try {
        const moduleExternalUrlsService = require('../services/moduleExternalUrlsService');
        const data = moduleExternalUrlsService.listModules();
        res.json({ success: true, ...data });
    } catch (error) {
        LOG.error('[Admin] module-urls modules error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/admin/module-urls/:moduleId — URLs for one module (lazy load)
 */
router.get('/module-urls/:moduleId', requireSuperAdmin, async (req, res) => {
    try {
        const moduleExternalUrlsService = require('../services/moduleExternalUrlsService');
        const data = await moduleExternalUrlsService.getModuleUrls(req.params.moduleId);
        res.json({ success: true, ...data });
    } catch (error) {
        LOG.error('[Admin] module-urls GET error:', error);
        res.status(error.message?.includes('Unknown') ? 404 : 500).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/admin/module-urls/:moduleId — update URLs for one module
 */
router.put('/module-urls/:moduleId', requireSuperAdmin, async (req, res) => {
    try {
        const moduleExternalUrlsService = require('../services/moduleExternalUrlsService');
        const data = await moduleExternalUrlsService.updateModuleUrls(req.params.moduleId, req.body?.sources || []);
        res.json({ success: true, ...data });
    } catch (error) {
        LOG.error('[Admin] module-urls PUT error:', error);
        res.status(error.message?.includes('Unknown') ? 404 : 500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/admin/commute-preferences — all users commute prefs (super-admin)
 */
router.get('/commute-preferences', requireSuperAdmin, async (req, res) => {
    try {
        const commuteService = require('../services/rDetectorCommuteService');
        const limit = parseInt(req.query.limit, 10) || 100;
        const preferences = await commuteService.getAllUserPreferences(limit);
        res.json({ success: true, count: preferences.length, preferences });
    } catch (error) {
        LOG.error('[Admin] commute-preferences error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
