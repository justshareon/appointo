/**
 * Auto Validation Controller
 * Handles auto-validation detection logging and retrieval
 */
const db = require('../../database');
const LOG = require('../../utils/logger');

class AutoValidationController {
    /**
     * Log auto-validation detection
     * POST /api/suraksha/auto-validation/detection
     */
    async logDetection(req, res) {
        try {
            const { type, value, isThreat, severity, details, user_id, detected_at } = req.body;

            if (!type || !value) {
                return res.status(400).json({ 
                    error: 'Type and value are required' 
                });
            }

            // Only save if it's actually a threat (optimization)
            if (!isThreat && severity !== 'critical' && severity !== 'high') {
                return res.json({
                    success: true,
                    message: 'Not a threat, not saved',
                    saved: false
                });
            }

            const detection = {
                id: `auto_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                user_id: user_id || req.user?.id || null,
                type, // 'call', 'url', 'sms', 'email', 'notification'
                value,
                is_threat: isThreat || false,
                severity: severity || 'low', // 'low', 'medium', 'high', 'critical'
                details: details || {},
                detected_at: detected_at || new Date().toISOString(),
                created_at: new Date()
            };

            // Store in in-memory database
            if (!db.autoValidationDetections) {
                db.autoValidationDetections = [];
            }
            db.autoValidationDetections.push(detection);

            // Keep only last 1000 detections per user
            if (detection.user_id) {
                const userDetections = db.autoValidationDetections.filter(d => d.user_id === detection.user_id);
                if (userDetections.length > 1000) {
                    const toRemove = userDetections.slice(0, userDetections.length - 1000);
                    toRemove.forEach(det => {
                        const index = db.autoValidationDetections.findIndex(d => d.id === det.id);
                        if (index > -1) db.autoValidationDetections.splice(index, 1);
                    });
                }
            }

            LOG.info(`[Auto Validation] Detection logged: ${type} - ${value} (Threat: ${isThreat})`);

            res.json({
                success: true,
                detection
            });
        } catch (error) {
            LOG.error('[Auto Validation Controller] Error logging detection:', error);
            res.status(500).json({ 
                error: 'Failed to log detection',
                message: error.message 
            });
        }
    }

    /**
     * Get auto-validation detections
     * GET /api/suraksha/auto-validation/detections
     */
    async getDetections(req, res) {
        try {
            const userId = req.user?.id;
            const { type, isThreat, limit = 50 } = req.query;

            let detections = db.autoValidationDetections || [];

            // Filter by user if authenticated
            if (userId) {
                detections = detections.filter(d => d.user_id === userId);
            }

            // Filter by type if provided
            if (type) {
                detections = detections.filter(d => d.type === type);
            }

            // Filter by threat status if provided
            if (isThreat !== undefined) {
                const threatFilter = isThreat === 'true' || isThreat === true;
                detections = detections.filter(d => d.is_threat === threatFilter);
            }

            // Sort by detected_at (newest first)
            detections.sort((a, b) => new Date(b.detected_at) - new Date(a.detected_at));

            // Limit results
            detections = detections.slice(0, parseInt(limit));

            res.json({
                success: true,
                count: detections.length,
                detections
            });
        } catch (error) {
            LOG.error('[Auto Validation Controller] Error getting detections:', error);
            res.status(500).json({ 
                error: 'Failed to get detections',
                message: error.message 
            });
        }
    }

    /**
     * Get auto-validation statistics
     * GET /api/suraksha/auto-validation/stats
     */
    async getStats(req, res) {
        try {
            const userId = req.user?.id;
            const detections = db.autoValidationDetections || [];

            let userDetections = detections;
            if (userId) {
                userDetections = detections.filter(d => d.user_id === userId);
            }

            const stats = {
                total: userDetections.length,
                threats: userDetections.filter(d => d.is_threat).length,
                safe: userDetections.filter(d => !d.is_threat).length,
                byType: {
                    call: userDetections.filter(d => d.type === 'call').length,
                    url: userDetections.filter(d => d.type === 'url').length,
                    sms: userDetections.filter(d => d.type === 'sms').length,
                    email: userDetections.filter(d => d.type === 'email').length,
                    notification: userDetections.filter(d => d.type === 'notification').length
                },
                bySeverity: {
                    critical: userDetections.filter(d => d.severity === 'critical').length,
                    high: userDetections.filter(d => d.severity === 'high').length,
                    medium: userDetections.filter(d => d.severity === 'medium').length,
                    low: userDetections.filter(d => d.severity === 'low').length
                },
                recentThreats: userDetections
                    .filter(d => d.is_threat)
                    .sort((a, b) => new Date(b.detected_at) - new Date(a.detected_at))
                    .slice(0, 10)
            };

            res.json({
                success: true,
                stats
            });
        } catch (error) {
            LOG.error('[Auto Validation Controller] Error getting stats:', error);
            res.status(500).json({ 
                error: 'Failed to get stats',
                message: error.message 
            });
        }
    }
}

module.exports = new AutoValidationController();

