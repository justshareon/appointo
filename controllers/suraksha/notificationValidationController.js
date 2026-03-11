/**
 * Notification Validation Controller
 * Handles notification validation requests
 */
const notificationValidationService = require('../../services/suraksha/notificationValidationService');
const LOG = require('../../utils/logger');

class NotificationValidationController {
    /**
     * Validate notification
     * POST /api/suraksha/notifications/validate
     */
    async validateNotification(req, res) {
        try {
            const userId = req.user?.id;
            const { title, body, data, source, appName } = req.body;

            if (!title && !body) {
                return res.status(400).json({ error: 'Title or body is required' });
            }

            const notification = { title, body, data, source, appName };
            const validationResult = await notificationValidationService.validateNotification(notification);

            // Save validation if suspicious
            if (validationResult.isSuspicious && userId) {
                await notificationValidationService.saveNotificationValidation(userId, notification, validationResult);
            }

            res.json({
                success: true,
                validation: validationResult
            });
        } catch (error) {
            LOG.error('[Notification Validation Controller] Error validating notification:', error);
            res.status(500).json({
                error: 'Failed to validate notification',
                message: error.message
            });
        }
    }

    /**
     * Get user notification validations
     * GET /api/suraksha/notifications/validations
     */
    async getUserValidations(req, res) {
        try {
            const userId = req.user?.id;
            const { isSuspicious, severity, source, userStatus, limit } = req.query;

            if (!userId) {
                return res.status(401).json({ error: 'User authentication required' });
            }

            const validations = await notificationValidationService.getUserValidations(userId, {
                isSuspicious: isSuspicious !== undefined ? isSuspicious === 'true' : undefined,
                severity,
                source,
                userStatus,
                limit: limit ? parseInt(limit) : 50
            });

            res.json({
                success: true,
                count: validations.length,
                validations
            });
        } catch (error) {
            LOG.error('[Notification Validation Controller] Error getting validations:', error);
            res.status(500).json({
                error: 'Failed to get validations',
                message: error.message
            });
        }
    }

    /**
     * Update user status for notification
     * POST /api/suraksha/notifications/validations/:validationId/status
     */
    async updateUserStatus(req, res) {
        try {
            const userId = req.user?.id;
            const { validationId } = req.params;
            const { status } = req.body;

            if (!userId) {
                return res.status(401).json({ error: 'User authentication required' });
            }

            if (!['scam', 'suspicious', 'safe', 'other'].includes(status)) {
                return res.status(400).json({ error: 'Invalid status. Must be: scam, suspicious, safe, or other' });
            }

            const validation = await notificationValidationService.updateUserStatus(userId, validationId, status);

            res.json({
                success: true,
                validation
            });
        } catch (error) {
            LOG.error('[Notification Validation Controller] Error updating status:', error);
            res.status(500).json({
                error: 'Failed to update status',
                message: error.message
            });
        }
    }
}

module.exports = new NotificationValidationController();

