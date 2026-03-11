/**
 * Cyber Threat Controller
 * Handles user-posted cyber threats and alerts
 */
const cyberThreatService = require('../../services/suraksha/cyberThreatService');
const LOG = require('../../utils/logger');

class CyberThreatController {
    /**
     * Post a cyber threat
     * POST /api/suraksha/threats/post
     */
    async postThreat(req, res) {
        try {
            const userId = req.user?.id || req.userId;
            
            if (!userId) {
                return res.status(401).json({ 
                    error: 'Authentication required' 
                });
            }

            const threatData = req.body;
            const result = await cyberThreatService.postThreat(userId, threatData);

            // Emit real-time alert to all users (except the reporter)
            if (req.io) {
                req.io.emit('cyber_threat_alert', {
                    threat: result.threat,
                    message: `New ${result.threat.severity} threat reported: ${result.threat.title}`,
                    timestamp: new Date().toISOString()
                });
            }

            res.json(result);
        } catch (error) {
            LOG.error('[Cyber Threat Controller] Post error:', error);
            res.status(500).json({ 
                error: 'Failed to post threat',
                message: error.message 
            });
        }
    }

    /**
     * Search for threats
     * POST /api/suraksha/threats/search
     */
    async searchThreats(req, res) {
        try {
            const { value, type } = req.body;

            if (!value || !type) {
                return res.status(400).json({ 
                    error: 'Value and type are required' 
                });
            }

            const result = await cyberThreatService.searchThreats(value, type);
            res.json(result);
        } catch (error) {
            LOG.error('[Cyber Threat Controller] Search error:', error);
            res.status(500).json({ 
                error: 'Failed to search threats',
                message: error.message 
            });
        }
    }

    /**
     * Get active threats
     * GET /api/suraksha/threats/active
     */
    async getActiveThreats(req, res) {
        try {
            const filters = {
                type: req.query.type,
                severity: req.query.severity,
                category: req.query.category,
                verified: req.query.verified === 'true',
                limit: parseInt(req.query.limit) || 50
            };

            const threats = await cyberThreatService.getActiveThreats(filters);
            
            res.json({
                success: true,
                count: threats.length,
                threats
            });
        } catch (error) {
            LOG.error('[Cyber Threat Controller] Get active threats error:', error);
            res.status(500).json({ 
                error: 'Failed to fetch threats',
                message: error.message 
            });
        }
    }

    /**
     * Get test data by type (for Node.js console/search)
     * GET /api/suraksha/test-data?type=phone|upi|url|email|all
     * Returns all test data with full details for the specified type
     */
    async getTestData(req, res) {
        try {
            const type = req.query.type; // phone, upi, url, email, or 'all'
            const search = req.query.search; // Optional search term
            
            if (!type) {
                return res.status(400).json({
                    success: false,
                    error: 'Type parameter is required',
                    message: 'Please specify type: phone, upi, url, email, or all',
                    example: '/api/suraksha/test-data?type=phone'
                });
            }

            const validTypes = ['phone', 'upi', 'url', 'email', 'bank_account', 'all'];
            if (!validTypes.includes(type)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid type',
                    message: `Type must be one of: ${validTypes.join(', ')}`,
                    received: type
                });
            }

            // If type is 'all', return all types
            if (type === 'all') {
                const allTypes = ['phone', 'upi', 'url', 'email'];
                const allData = [];
                
                for (const t of allTypes) {
                    const result = await this._getTestDataForType(t, search);
                    allData.push(...result);
                }
                
                return res.json({
                    success: true,
                    type: 'all',
                    search: search || null,
                    count: allData.length,
                    data: allData,
                    byType: {
                        phone: allData.filter(d => d.type === 'phone').length,
                        upi: allData.filter(d => d.type === 'upi').length,
                        url: allData.filter(d => d.type === 'url').length,
                        email: allData.filter(d => d.type === 'email').length
                    }
                });
            }

            const allData = await this._getTestDataForType(type, search);
            
            LOG.info(`[Test Data] Returning ${allData.length} ${type} entries${search ? ` (filtered by: ${search})` : ''}`);

            res.json({
                success: true,
                type,
                search: search || null,
                count: allData.length,
                data: allData,
                summary: {
                    total: allData.length,
                    bySeverity: {
                        critical: allData.filter(t => t.severity === 'critical').length,
                        high: allData.filter(t => t.severity === 'high').length,
                        medium: allData.filter(t => t.severity === 'medium').length,
                        low: allData.filter(t => t.severity === 'low').length
                    },
                    byCategory: allData.reduce((acc, t) => {
                        acc[t.category] = (acc[t.category] || 0) + 1;
                        return acc;
                    }, {})
                }
            });
        } catch (error) {
            LOG.error('[Cyber Threat Controller] Get test data error:', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to fetch test data',
                message: error.message 
            });
        }
    }

    /**
     * Helper method to get test data for a specific type
     * @private
     */
    async _getTestDataForType(type, search = null) {
        try {
            // Get all threats of this type
            let threats = await cyberThreatService.getActiveThreats({ 
                type, 
                limit: 1000 
            });

            // Apply search filter if provided
            if (search) {
                const searchLower = search.toLowerCase();
                threats = threats.filter(t => 
                    t.value?.toLowerCase().includes(searchLower) ||
                    t.title?.toLowerCase().includes(searchLower) ||
                    t.description?.toLowerCase().includes(searchLower) ||
                    t.tags?.some(tag => tag.toLowerCase().includes(searchLower))
                );
            }

            // Also include spam numbers for phone type
            const db = require('../../database');
            let additionalData = [];
            
            if (type === 'phone' && db.spamNumbers) {
                additionalData = db.spamNumbers.map(spam => ({
                    id: spam.id,
                    type: 'phone',
                    value: spam.phone_number,
                    title: spam.caller_name || 'Spam Number',
                    description: `Reported ${spam.report_count || 0} times`,
                    severity: spam.is_scam ? 'high' : 'medium',
                    category: spam.is_scam ? 'scam' : (spam.is_telemarketing ? 'telemarketing' : 'spam'),
                    tags: spam.tags || [],
                    report_count: spam.report_count || 0,
                    source: 'spam_database',
                    is_spam: spam.is_spam,
                    is_scam: spam.is_scam,
                    is_telemarketing: spam.is_telemarketing,
                    created_at: spam.created_at,
                    updated_at: spam.updated_at
                }));
            }

            // Combine and deduplicate by value
            const allData = [...threats];
            additionalData.forEach(item => {
                if (!allData.find(t => t.value === item.value && t.type === item.type)) {
                    allData.push(item);
                }
            });

            // Sort by severity and report count
            allData.sort((a, b) => {
                const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
                const severityDiff = (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
                if (severityDiff !== 0) return severityDiff;
                return (b.report_count || 0) - (a.report_count || 0);
            });

            return allData;
        } catch (error) {
            LOG.error('[Cyber Threat Controller] Get test data for type error:', error);
            return [];
        }
    }

    /**
     * Get user alerts
     * GET /api/suraksha/threats/alerts
     */
    async getUserAlerts(req, res) {
        try {
            const userId = req.user?.id || req.userId;
            
            if (!userId) {
                return res.status(401).json({ 
                    error: 'Authentication required' 
                });
            }

            const alerts = await cyberThreatService.getUserAlerts(userId);
            
            res.json({
                success: true,
                count: alerts.length,
                alerts
            });
        } catch (error) {
            LOG.error('[Cyber Threat Controller] Get alerts error:', error);
            res.status(500).json({ 
                error: 'Failed to fetch alerts',
                message: error.message 
            });
        }
    }

    /**
     * Mark alert as read
     * POST /api/suraksha/threats/alerts/:alertId/read
     */
    async markAlertRead(req, res) {
        try {
            const userId = req.user?.id || req.userId;
            const { alertId } = req.params;
            
            if (!userId) {
                return res.status(401).json({ 
                    error: 'Authentication required' 
                });
            }

            await cyberThreatService.markAlertRead(alertId, userId);
            
            res.json({
                success: true,
                message: 'Alert marked as read'
            });
        } catch (error) {
            LOG.error('[Cyber Threat Controller] Mark alert read error:', error);
            res.status(500).json({ 
                error: 'Failed to mark alert as read',
                message: error.message 
            });
        }
    }

    /**
     * Update a cyber threat
     * PUT /api/suraksha/threats/:threatId
     */
    async updateThreat(req, res) {
        try {
            const userId = req.user?.id || req.userId;
            const { threatId } = req.params;
            
            if (!userId) {
                return res.status(401).json({ 
                    error: 'Authentication required' 
                });
            }

            const threatData = req.body;
            const result = await cyberThreatService.updateThreat(threatId, userId, threatData);

            res.json(result);
        } catch (error) {
            LOG.error('[Cyber Threat Controller] Update error:', error);
            res.status(500).json({ 
                error: 'Failed to update threat',
                message: error.message 
            });
        }
    }

    /**
     * Delete a cyber threat
     * DELETE /api/suraksha/threats/:threatId
     */
    async deleteThreat(req, res) {
        try {
            const userId = req.user?.id || req.userId;
            const { threatId } = req.params;
            
            if (!userId) {
                return res.status(401).json({ 
                    error: 'Authentication required' 
                });
            }

            const result = await cyberThreatService.deleteThreat(threatId, userId);

            res.json(result);
        } catch (error) {
            LOG.error('[Cyber Threat Controller] Delete error:', error);
            res.status(500).json({ 
                error: 'Failed to delete threat',
                message: error.message 
            });
        }
    }
}

module.exports = new CyberThreatController();

