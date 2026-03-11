/**
 * Caller Validation Controller
 * Handles incoming call validation requests
 */
const callerValidationService = require('../../services/suraksha/callerValidationService');
const LOG = require('../../utils/logger');

class CallerValidationController {
    /**
     * Validate incoming call
     * POST /api/suraksha/caller/validate
     */
    async validateCall(req, res) {
        try {
            const { phoneNumber } = req.body;
            const userId = req.user?.id || req.userId;

            if (!phoneNumber) {
                return res.status(400).json({ 
                    error: 'Phone number is required' 
                });
            }

            // Validate phone number format
            const phoneRegex = /^[\d\s\-\+\(\)]{10,15}$/;
            if (!phoneRegex.test(phoneNumber)) {
                return res.status(400).json({ 
                    error: 'Invalid phone number format' 
                });
            }

            // Validate call
            const result = await callerValidationService.validateCall(phoneNumber, userId);

            // Emit real-time update via WebSocket if available
            if (req.io && req.userRoom) {
                req.io.to(req.userRoom).emit('call_validated', {
                    phoneNumber: result.phoneNumber,
                    isSpam: result.isSpam,
                    isScam: result.isScam,
                    callerName: result.callerName,
                    confidence: result.confidence,
                    timestamp: new Date().toISOString()
                });
            }

            res.json({
                success: true,
                ...result
            });
        } catch (error) {
            LOG.error('[Caller Validation Controller] Error:', error);
            res.status(500).json({ 
                error: 'Failed to validate call',
                message: error.message 
            });
        }
    }

    /**
     * Report spam number
     * POST /api/suraksha/caller/report
     */
    async reportSpam(req, res) {
        try {
            const { phoneNumber, callerName, isScam, isTelemarketing, tags } = req.body;
            const userId = req.user?.id || req.userId;

            if (!phoneNumber) {
                return res.status(400).json({ 
                    error: 'Phone number is required' 
                });
            }

            const result = await callerValidationService.reportSpamNumber(
                phoneNumber,
                userId,
                {
                    callerName,
                    isScam: isScam || false,
                    isTelemarketing: isTelemarketing || false,
                    tags: tags || []
                }
            );

            res.json(result);
        } catch (error) {
            LOG.error('[Caller Validation Controller] Report error:', error);
            res.status(500).json({ 
                error: 'Failed to report spam number',
                message: error.message 
            });
        }
    }

    /**
     * Get call history
     * GET /api/suraksha/caller/history
     */
    async getCallHistory(req, res) {
        try {
            const userId = req.user?.id || req.userId;
            const limit = parseInt(req.query.limit) || 50;

            const history = await callerValidationService.getCallHistory(userId, limit);

            res.json({
                success: true,
                count: history.length,
                calls: history
            });
        } catch (error) {
            LOG.error('[Caller Validation Controller] History error:', error);
            res.status(500).json({ 
                error: 'Failed to fetch call history',
                message: error.message 
            });
        }
    }
}

module.exports = new CallerValidationController();

