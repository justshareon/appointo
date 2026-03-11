/**
 * Validation Controller
 * Handles fraud validation requests
 */
const validationService = require('../../services/suraksha/validationService');
const LOG = require('../../utils/logger');

class ValidationController {
    /**
     * Validate input (phone/UPI/URL)
     * POST /api/suraksha/validate
     */
    async validate(req, res) {
        try {
            const { input, type } = req.body;
            const userId = req.user?.id || req.userId; // From JWT middleware
            
            if (!input || !type) {
                return res.status(400).json({ 
                    error: 'Input and type are required' 
                });
            }
            
            if (!['phone', 'upi', 'url', 'bank_account'].includes(type)) {
                return res.status(400).json({ 
                    error: 'Invalid type. Must be: phone, upi, url, or bank_account' 
                });
            }
            
            // Start validation (async)
            const result = await validationService.validateInput(userId, input, type);
            
            LOG.info(`[Validation Controller] ==========================================`);
            LOG.info(`[Validation Controller] Validation complete for ${type}: ${input}`);
            LOG.info(`[Validation Controller] Raw result from service:`, JSON.stringify(result, null, 2));
            
            // Return result directly (since validation is synchronous with mock data)
            const response = {
                requestId: result.requestId,
                status: result.status,
                result: result.result,
                isFraud: result.isFraud,
                timestamp: new Date().toISOString()
            };
            
            LOG.info(`[Validation Controller] Response object to send:`, JSON.stringify(response, null, 2));
            LOG.info(`[Validation Controller] Response has result? ${!!response.result}`);
            LOG.info(`[Validation Controller] Response has status? ${!!response.status}`);
            LOG.info(`[Validation Controller] Response isFraud? ${response.isFraud}`);
            LOG.info(`[Validation Controller] Response result.validations? ${!!response.result?.validations}`);
            LOG.info(`[Validation Controller] Response result.validations length? ${response.result?.validations?.length || 0}`);
            
            // Also emit via WebSocket for real-time updates
            if (req.io && req.userRoom) {
                LOG.info(`[Validation Controller] Emitting WebSocket update to room: ${req.userRoom}`);
                req.io.to(req.userRoom).emit('validation_update', response);
            } else {
                LOG.warning(`[Validation Controller] WebSocket not available (io: ${!!req.io}, userRoom: ${req.userRoom})`);
            }
            
            // Return the result in HTTP response
            LOG.info(`[Validation Controller] Sending HTTP response...`);
            res.json(response);
            LOG.info(`[Validation Controller] HTTP response sent successfully`);
            LOG.info(`[Validation Controller] ==========================================`);
        } catch (error) {
            LOG.error('[Validation Controller] Error:', error);
            res.status(500).json({ 
                error: 'Validation failed',
                message: error.message 
            });
        }
    }

    /**
     * Get validation history
     * GET /api/suraksha/history
     */
    async getHistory(req, res) {
        try {
            const userId = req.user?.id || req.userId;
            const limit = parseInt(req.query.limit) || 50;
            
            const history = await validationService.getValidationHistory(userId, limit);
            
            res.json({
                success: true,
                count: history.length,
                validations: history
            });
        } catch (error) {
            LOG.error('[Validation Controller] History error:', error);
            res.status(500).json({ 
                error: 'Failed to fetch history',
                message: error.message 
            });
        }
    }

    /**
     * Get validation by ID
     * GET /api/suraksha/validation/:requestId
     */
    async getValidation(req, res) {
        try {
            const { requestId } = req.params;
            const userId = req.user?.id || req.userId;
            
            // Get from database
            const db = require('../../database');
            if (db.surakshaValidations) {
                const validation = db.surakshaValidations.find(
                    v => v.id === requestId && v.user_id === userId
                );
                
                if (!validation) {
                    return res.status(404).json({ 
                        error: 'Validation not found' 
                    });
                }
                
                return res.json({
                    success: true,
                    validation
                });
            }
            
            res.status(404).json({ error: 'Validation not found' });
        } catch (error) {
            LOG.error('[Validation Controller] Get validation error:', error);
            res.status(500).json({ 
                error: 'Failed to fetch validation',
                message: error.message 
            });
        }
    }
}

module.exports = new ValidationController();

