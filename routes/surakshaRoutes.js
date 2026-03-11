/**
 * Suraksha Routes
 * Fraud validation and reporting endpoints
 */
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const rateLimiter = require('../middleware/rateLimiter');
const validationController = require('../controllers/suraksha/validationController');
const reportController = require('../controllers/suraksha/reportController');
const deviceController = require('../controllers/suraksha/deviceController');
const callerValidationController = require('../controllers/suraksha/callerValidationController');
const cyberThreatController = require('../controllers/suraksha/cyberThreatController');
const cyberAnalyticsController = require('../controllers/suraksha/cyberAnalyticsController');
const autoValidationController = require('../controllers/suraksha/autoValidationController');
const mobileSecurityScanController = require('../controllers/suraksha/mobileSecurityScanController');
const notificationValidationController = require('../controllers/suraksha/notificationValidationController');
const threatIntelligenceController = require('../controllers/suraksha/threatIntelligenceController');
const LOG = require('../utils/logger');

// Middleware to attach io and userRoom to request
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

// Public routes (no authentication required)
/**
 * GET /api/suraksha/threats/active
 * Get all active threats (PUBLIC - read-only)
 */
router.get('/threats/active', (req, res) => cyberThreatController.getActiveThreats(req, res));

/**
 * POST /api/suraksha/threats/search
 * Search for threats (PUBLIC - read-only)
 */
router.post('/threats/search', (req, res) => cyberThreatController.searchThreats(req, res));

/**
 * GET /api/suraksha/test-data?type=phone|upi|url|email&search=optional
 * Get test data by type with full details (PUBLIC - for Node.js console/search)
 */
router.get('/test-data', (req, res) => cyberThreatController.getTestData(req, res));

/**
 * POST /api/suraksha/auto-validation/detection
 * Log auto-validation detection (PUBLIC - can be called from notification handler)
 */
router.post('/auto-validation/detection', (req, res) => autoValidationController.logDetection(req, res));

// Apply authentication and rate limiting to all other routes
router.use(authenticateToken);
router.use(attachSocket(ioInstance));

/**
 * POST /api/suraksha/validate
 * Validate input (phone/UPI/URL) for fraud
 */
router.post('/validate', 
    rateLimiter({ windowMs: 60000, max: 10 }), // 10 requests per minute
    (req, res) => validationController.validate(req, res)
);

/**
 * GET /api/suraksha/history
 * Get validation history
 */
router.get('/history', (req, res) => validationController.getHistory(req, res));

/**
 * GET /api/suraksha/validation/:requestId
 * Get specific validation result
 */
router.get('/validation/:requestId', (req, res) => validationController.getValidation(req, res));

/**
 * POST /api/suraksha/report
 * File a fraud complaint (requires authentication)
 */
router.post('/report', authenticateToken, (req, res) => reportController.fileComplaint(req, res));

/**
 * GET /api/suraksha/reports
 * Get user's fraud reports
 */
router.get('/reports', (req, res) => reportController.getReports(req, res));

/**
 * POST /api/suraksha/report/:reportId/send
 * Send saved complaint to government API
 */
router.post('/report/:reportId/send', (req, res) => reportController.sendToGovernment(req, res));

/**
 * POST /api/suraksha/report/:reportId/reminder
 * Send reminder to government for already sent complaint
 */
router.post('/report/:reportId/reminder', (req, res) => reportController.sendReminder(req, res));

/**
 * POST /api/suraksha/device/block
 * Block lost/stolen phone IMEI
 */
router.post('/device/block', (req, res) => deviceController.blockIMEI(req, res));

/**
 * GET /api/suraksha/device/sims
 * Check SIM cards linked to user's Aadhaar
 */
router.get('/device/sims', (req, res) => deviceController.checkSIMs(req, res));

/**
 * GET /api/suraksha/device
 * Get user's registered devices
 */
router.get('/device', (req, res) => deviceController.getDevices(req, res));

/**
 * POST /api/suraksha/caller/validate
 * Validate incoming call (Truecaller-like feature)
 */
router.post('/caller/validate', (req, res) => callerValidationController.validateCall(req, res));

/**
 * POST /api/suraksha/caller/report
 * Report spam number
 */
router.post('/caller/report', (req, res) => callerValidationController.reportSpam(req, res));

/**
 * GET /api/suraksha/caller/history
 * Get call validation history
 */
router.get('/caller/history', (req, res) => callerValidationController.getCallHistory(req, res));

/**
 * POST /api/suraksha/threats/post
 * Post a cyber threat (user-reported)
 */
router.post('/threats/post', (req, res) => cyberThreatController.postThreat(req, res));


/**
 * GET /api/suraksha/threats/alerts
 * Get user threat alerts
 */
router.get('/threats/alerts', (req, res) => cyberThreatController.getUserAlerts(req, res));

/**
 * POST /api/suraksha/threats/alerts/:alertId/read
 * Mark alert as read
 */
router.post('/threats/alerts/:alertId/read', (req, res) => cyberThreatController.markAlertRead(req, res));

/**
 * PUT /api/suraksha/threats/:threatId
 * Update a cyber threat
 */
router.put('/threats/:threatId', (req, res) => cyberThreatController.updateThreat(req, res));

/**
 * DELETE /api/suraksha/threats/:threatId
 * Delete a cyber threat
 */
router.delete('/threats/:threatId', (req, res) => cyberThreatController.deleteThreat(req, res));

/**
 * GET /api/suraksha/analytics/most-active
 * Get most active cyber alerts
 */
router.get('/analytics/most-active', (req, res) => cyberAnalyticsController.getMostActiveAlerts(req, res));

/**
 * GET /api/suraksha/analytics/culprits
 * Get most reported culprits
 */
router.get('/analytics/culprits', (req, res) => cyberAnalyticsController.getMostReportedCulprits(req, res));

/**
 * GET /api/suraksha/analytics/demographics
 * Get target demographics
 */
router.get('/analytics/demographics', (req, res) => cyberAnalyticsController.getTargetDemographics(req, res));

/**
 * GET /api/suraksha/analytics/statistics
 * Get case statistics
 */
router.get('/analytics/statistics', (req, res) => cyberAnalyticsController.getCaseStatistics(req, res));

/**
 * GET /api/suraksha/analytics/threats
 * Get filtered threats
 */
router.get('/analytics/threats', (req, res) => cyberAnalyticsController.getFilteredThreats(req, res));

/**
 * GET /api/suraksha/auto-validation/detections
 * Get auto-validation detections (requires authentication)
 */
router.get('/auto-validation/detections', async (req, res) => {
    try {
        await autoValidationController.getDetections(req, res);
    } catch (error) {
        LOG.error('[Suraksha Routes] Error in auto-validation/detections:', error);
        res.status(500).json({ error: 'Internal server error', message: error.message });
    }
});

/**
 * GET /api/suraksha/auto-validation/stats
 * Get auto-validation statistics (requires authentication)
 */
router.get('/auto-validation/stats', async (req, res) => {
    try {
        await autoValidationController.getStats(req, res);
    } catch (error) {
        LOG.error('[Suraksha Routes] Error in auto-validation/stats:', error);
        res.status(500).json({ error: 'Internal server error', message: error.message });
    }
});

/**
 * POST /api/suraksha/security-scan/start
 * Start mobile security scan
 */
router.post('/security-scan/start', authenticateToken, attachSocket(ioInstance), (req, res) => mobileSecurityScanController.startScan(req, res));

/**
 * GET /api/suraksha/security-scan/results
 * Get scan results
 */
router.get('/security-scan/results', authenticateToken, (req, res) => mobileSecurityScanController.getScanResults(req, res));

/**
 * GET /api/suraksha/security-scan/statistics
 * Get scan statistics
 */
router.get('/security-scan/statistics', authenticateToken, (req, res) => mobileSecurityScanController.getStatistics(req, res));

/**
 * DELETE /api/suraksha/security-scan/results
 * Delete scan results (bulk)
 */
router.delete('/security-scan/results', authenticateToken, (req, res) => mobileSecurityScanController.deleteScanResults(req, res));

/**
 * GET /api/suraksha/security-scan/storage
 * Get storage usage
 */
router.get('/security-scan/storage', authenticateToken, (req, res) => mobileSecurityScanController.getStorageUsage(req, res));

/**
 * POST /api/suraksha/notifications/validate
 * Validate notification
 */
router.post('/notifications/validate', authenticateToken, (req, res) => notificationValidationController.validateNotification(req, res));

/**
 * GET /api/suraksha/notifications/validations
 * Get user notification validations
 */
router.get('/notifications/validations', authenticateToken, (req, res) => notificationValidationController.getUserValidations(req, res));

/**
 * POST /api/suraksha/notifications/validations/:validationId/status
 * Update user status for notification
 */
router.post('/notifications/validations/:validationId/status', authenticateToken, (req, res) => notificationValidationController.updateUserStatus(req, res));

/**
 * POST /api/suraksha/threat-intelligence/scan
 * Scan threats from internet (manual trigger)
 */
router.post('/threat-intelligence/scan', authenticateToken, attachSocket(ioInstance), (req, res) => threatIntelligenceController.scanThreats(req, res));

/**
 * GET /api/suraksha/threat-intelligence/feed
 * Get threat feed
 */
router.get('/threat-intelligence/feed', authenticateToken, (req, res) => threatIntelligenceController.getThreatFeed(req, res));

/**
 * POST /api/suraksha/threat-intelligence/:threatId/verify
 * Verify threat
 */
router.post('/threat-intelligence/:threatId/verify', authenticateToken, (req, res) => threatIntelligenceController.verifyThreat(req, res));

/**
 * POST /api/suraksha/threat-intelligence/:threatId/dismiss
 * Dismiss threat
 */
router.post('/threat-intelligence/:threatId/dismiss', authenticateToken, (req, res) => threatIntelligenceController.dismissThreat(req, res));

module.exports = router;

