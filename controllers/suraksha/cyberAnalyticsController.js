/**
 * Cyber Analytics Controller
 * Handles analytics endpoints
 */
const cyberAnalyticsService = require('../../services/suraksha/cyberAnalyticsService');
const LOG = require('../../utils/logger');

class CyberAnalyticsController {
    /**
     * Get most active alerts
     * GET /api/suraksha/analytics/most-active
     */
    async getMostActiveAlerts(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 10;
            LOG.info(`[Cyber Analytics Controller] Fetching most active alerts, limit: ${limit}`);
            const alerts = cyberAnalyticsService.getMostActiveAlerts(limit);
            LOG.info(`[Cyber Analytics Controller] Returning ${alerts.length} alerts`);
            
            res.json({
                success: true,
                count: alerts.length,
                alerts
            });
        } catch (error) {
            LOG.error('[Cyber Analytics Controller] Error:', error);
            res.status(500).json({ 
                error: 'Failed to fetch active alerts',
                message: error.message 
            });
        }
    }

    /**
     * Get most reported culprits
     * GET /api/suraksha/analytics/culprits
     */
    async getMostReportedCulprits(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 10;
            LOG.info(`[Cyber Analytics Controller] Fetching most reported culprits, limit: ${limit}`);
            const culprits = cyberAnalyticsService.getMostReportedCulprits(limit);
            LOG.info(`[Cyber Analytics Controller] Returning ${culprits.length} culprits`);
            
            res.json({
                success: true,
                count: culprits.length,
                culprits
            });
        } catch (error) {
            LOG.error('[Cyber Analytics Controller] Error:', error);
            res.status(500).json({ 
                error: 'Failed to fetch culprits',
                message: error.message 
            });
        }
    }

    /**
     * Get target demographics
     * GET /api/suraksha/analytics/demographics
     */
    async getTargetDemographics(req, res) {
        try {
            const demographics = cyberAnalyticsService.getTargetDemographics();
            
            res.json({
                success: true,
                ...demographics
            });
        } catch (error) {
            LOG.error('[Cyber Analytics Controller] Error:', error);
            res.status(500).json({ 
                error: 'Failed to fetch demographics',
                message: error.message 
            });
        }
    }

    /**
     * Get case statistics
     * GET /api/suraksha/analytics/statistics
     */
    async getCaseStatistics(req, res) {
        try {
            const statistics = cyberAnalyticsService.getCaseStatistics();
            
            res.json({
                success: true,
                ...statistics
            });
        } catch (error) {
            LOG.error('[Cyber Analytics Controller] Error:', error);
            res.status(500).json({ 
                error: 'Failed to fetch statistics',
                message: error.message 
            });
        }
    }

    /**
     * Get filtered threats
     * GET /api/suraksha/analytics/threats
     */
    async getFilteredThreats(req, res) {
        try {
            const filters = {
                location: req.query.location,
                type: req.query.type,
                category: req.query.category,
                severity: req.query.severity,
                status: req.query.status,
                limit: parseInt(req.query.limit) || 50
            };

            const threats = cyberAnalyticsService.getFilteredThreats(filters);
            
            res.json({
                success: true,
                count: threats.length,
                threats
            });
        } catch (error) {
            LOG.error('[Cyber Analytics Controller] Error:', error);
            res.status(500).json({ 
                error: 'Failed to fetch threats',
                message: error.message 
            });
        }
    }
}

module.exports = new CyberAnalyticsController();

