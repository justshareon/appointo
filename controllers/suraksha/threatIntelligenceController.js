/**
 * Threat Intelligence Controller
 * Handles threat intelligence requests
 */
const threatIntelligenceService = require('../../services/suraksha/threatIntelligenceService');
const databaseSyncService = require('../../services/databaseSyncService');
const LOG = require('../../utils/logger');

class ThreatIntelligenceController {
    /**
     * Scan threats (manual trigger)
     * POST /api/suraksha/threat-intelligence/scan
     */
    async scanThreats(req, res) {
        try {
            LOG.info('[Threat Intelligence Controller] Manual scan triggered');
            const threats = await threatIntelligenceService.scanThreats();
            const result = await threatIntelligenceService.saveThreats(threats);

            // Sync to MySQL if enabled
            if (result.saved > 0) {
                databaseSyncService.syncToMySQL().catch(err => {
                    LOG.error('[Threat Intelligence Controller] Sync error:', err);
                });
            }

            // Emit alerts via WebSocket if available
            if (req.io && result.alerts.length > 0) {
                req.io.emit('threat_intelligence_alert', {
                    count: result.alerts.length,
                    threats: result.alerts
                });
            }

            res.json({
                success: true,
                scanned: threats.length,
                saved: result.saved,
                alerts: result.alerts.length
            });
        } catch (error) {
            LOG.error('[Threat Intelligence Controller] Error scanning threats:', error);
            res.status(500).json({
                error: 'Failed to scan threats',
                message: error.message
            });
        }
    }

    /**
     * Get threats feed
     * GET /api/suraksha/threat-intelligence/feed
     */
    async getThreatFeed(req, res) {
        try {
            const { severity, category, status, limit, startDate, endDate } = req.query;

            const threats = await threatIntelligenceService.getThreats({
                severity,
                category,
                status,
                limit: limit ? parseInt(limit) : 50,
                startDate,
                endDate
            });

            res.json({
                success: true,
                count: threats.length,
                threats
            });
        } catch (error) {
            LOG.error('[Threat Intelligence Controller] Error getting feed:', error);
            res.status(500).json({
                error: 'Failed to get threat feed',
                message: error.message
            });
        }
    }

    /**
     * Verify threat
     * POST /api/suraksha/threat-intelligence/:threatId/verify
     */
    async verifyThreat(req, res) {
        try {
            const userId = req.user?.id;
            const { threatId } = req.params;

            if (!userId) {
                return res.status(401).json({ error: 'User authentication required' });
            }

            const threat = await threatIntelligenceService.verifyThreat(threatId, userId);

            res.json({
                success: true,
                threat
            });
        } catch (error) {
            LOG.error('[Threat Intelligence Controller] Error verifying threat:', error);
            res.status(500).json({
                error: 'Failed to verify threat',
                message: error.message
            });
        }
    }

    /**
     * Dismiss threat
     * POST /api/suraksha/threat-intelligence/:threatId/dismiss
     */
    async dismissThreat(req, res) {
        try {
            const userId = req.user?.id;
            const { threatId } = req.params;

            if (!userId) {
                return res.status(401).json({ error: 'User authentication required' });
            }

            const threat = await threatIntelligenceService.dismissThreat(threatId, userId);

            res.json({
                success: true,
                threat
            });
        } catch (error) {
            LOG.error('[Threat Intelligence Controller] Error dismissing threat:', error);
            res.status(500).json({
                error: 'Failed to dismiss threat',
                message: error.message
            });
        }
    }
}

module.exports = new ThreatIntelligenceController();

