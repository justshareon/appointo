/**
 * Device Controller
 * Handles IMEI blocking and SIM monitoring
 */
const sancharSaathiService = require('../../services/suraksha/sancharSaathiService');
const validationService = require('../../services/suraksha/validationService');
const LOG = require('../../utils/logger');

class DeviceController {
    /**
     * Block lost/stolen phone IMEI
     * POST /api/suraksha/device/block
     */
    async blockIMEI(req, res) {
        try {
            const userId = req.user?.id || req.userId;
            const { imei, reason, aadhaar } = req.body;
            
            if (!imei) {
                return res.status(400).json({ 
                    error: 'IMEI is required' 
                });
            }
            
            // Validate IMEI format (15 digits)
            if (!/^\d{15}$/.test(imei)) {
                return res.status(400).json({ 
                    error: 'Invalid IMEI format. Must be 15 digits.' 
                });
            }
            
            // Block via CEIR
            const result = await sancharSaathiService.blockIMEI(imei, {
                userId,
                reason: reason || 'Lost/Stolen',
                aadhaar
            });
            
            if (result.success) {
                // Save device record
                await this._saveDevice(userId, imei, true);
                
                // Emit notification
                if (req.io && req.userRoom) {
                    req.io.to(req.userRoom).emit('imei_blocked', {
                        imei,
                        status: result.status,
                        message: result.message,
                        timestamp: new Date().toISOString()
                    });
                }
            }
            
            res.json(result);
        } catch (error) {
            LOG.error('[Device Controller] Block IMEI error:', error);
            res.status(500).json({ 
                error: 'Failed to block IMEI',
                message: error.message 
            });
        }
    }

    /**
     * Check SIM cards linked to user's Aadhaar
     * GET /api/suraksha/device/sims
     */
    async checkSIMs(req, res) {
        try {
            const userId = req.user?.id || req.userId;
            const { aadhaar } = req.query;
            
            const result = await validationService.checkNewSIMs(userId, aadhaar);
            
            // Emit alert if new SIMs detected
            if (result.newSIMs > 0 && req.io && req.userRoom) {
                req.io.to(req.userRoom).emit('fraud_alert', {
                    type: 'new_sim',
                    message: `${result.newSIMs} new SIM card(s) detected`,
                    sims: result.alerts,
                    timestamp: new Date().toISOString()
                });
            }
            
            res.json({
                success: true,
                ...result
            });
        } catch (error) {
            LOG.error('[Device Controller] Check SIMs error:', error);
            res.status(500).json({ 
                error: 'Failed to check SIMs',
                message: error.message 
            });
        }
    }

    /**
     * Get user's devices
     * GET /api/suraksha/device
     */
    async getDevices(req, res) {
        try {
            const userId = req.user?.id || req.userId;
            
            const db = require('../../database');
            if (db.surakshaDevices) {
                const devices = db.surakshaDevices.filter(d => d.user_id === userId);
                return res.json({
                    success: true,
                    count: devices.length,
                    devices
                });
            }
            
            res.json({
                success: true,
                count: 0,
                devices: []
            });
        } catch (error) {
            LOG.error('[Device Controller] Get devices error:', error);
            res.status(500).json({ 
                error: 'Failed to fetch devices',
                message: error.message 
            });
        }
    }

    /**
     * Save device to database
     * @private
     */
    async _saveDevice(userId, imei, isBlocked) {
        const db = require('../../database');
        if (!db.surakshaDevices) {
            db.surakshaDevices = [];
        }
        
        const existing = db.surakshaDevices.find(
            d => d.user_id === userId && d.imei === imei
        );
        
        if (existing) {
            existing.is_blocked = isBlocked;
            existing.blocked_at = isBlocked ? new Date() : null;
            existing.updated_at = new Date();
        } else {
            db.surakshaDevices.push({
                id: `device_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                user_id: userId,
                imei,
                is_blocked: isBlocked,
                blocked_at: isBlocked ? new Date() : null,
                created_at: new Date(),
                updated_at: new Date()
            });
        }
    }
}

module.exports = new DeviceController();

