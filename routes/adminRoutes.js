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

module.exports = router;
