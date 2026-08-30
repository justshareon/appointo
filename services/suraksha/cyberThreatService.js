/**
 * Cyber Threat Service
 * Handles user-posted cyber threats and alerts
 * Syncs data: Local Database → MySQL
 */
const db = require('../../database');
const { sortTodayRecentFirst, withinRecentDays } = require('../../utils/recentSlice');
const LOG = require('../../utils/logger');

class CyberThreatService {
    constructor() {
        this.initializeLocalDatabase();
        // Ensure MySQL tables on initialization
        if (db.getType && db.getType() === 'mysql' && db.ensureCyberThreatTables) {
            db.ensureCyberThreatTables().catch(err => {
                LOG.error('[Cyber Threat] Error ensuring tables:', err);
            });
        }
    }

    /**
     * Initialize local threat database
     */
    initializeLocalDatabase() {
        if (!db.cyberThreats) {
            db.cyberThreats = [];
        }
        if (!db.threatAlerts) {
            db.threatAlerts = [];
        }
    }

    /**
     * Post a cyber threat (user-reported)
     * @param {string} userId - User ID
     * @param {Object} threatData - Threat information
     * @returns {Promise<Object>} Posted threat
     */
    async postThreat(userId, threatData) {
        try {
            const {
                type,           // 'phone', 'email', 'url', 'upi', 'bank_account', 'other'
                value,          // The actual threat value (phone number, email, etc.)
                title,          // Threat title
                description,    // Detailed description
                severity,       // 'low', 'medium', 'high', 'critical'
                category,       // 'phishing', 'scam', 'malware', 'fraud', 'spam'
                tags,           // Array of tags
                evidence,       // Optional evidence (screenshots, etc.)
                location        // Optional location
            } = threatData;

            if (!type || !value || !title) {
                throw new Error('Type, value, and title are required');
            }

            const threatId = `threat_${Date.now()}_${Math.random().toString(36).substring(7)}`;
            
            const threat = {
                id: threatId,
                user_id: userId,
                type,
                value: this._normalizeValue(value, type),
                title,
                description: description || '',
                severity: severity || 'medium',
                category: category || 'other',
                tags: tags || [],
                evidence: evidence || null,
                location: location || null,
                report_count: 1,
                reported_by: [userId],
                status: 'active',
                verified: false,
                verified_by: null,
                verified_at: null,
                created_at: new Date(),
                updated_at: new Date()
            };

            // Check if similar threat already exists
            const existingThreat = this._findSimilarThreat(threat);
            
            if (existingThreat) {
                // Update existing threat
                existingThreat.report_count = (existingThreat.report_count || 1) + 1;
                existingThreat.reported_by.push(userId);
                existingThreat.updated_at = new Date();
                
                // Update severity if new report is more severe
                if (this._isMoreSevere(severity, existingThreat.severity)) {
                    existingThreat.severity = severity;
                }

                LOG.info(`[Cyber Threat] Updated existing threat: ${existingThreat.id}`);
                
                // Sync to MySQL (async)
                this._syncToMySQL(existingThreat).catch(err => {
                    LOG.error('[Cyber Threat] MySQL sync error:', err);
                });

                return {
                    success: true,
                    threat: existingThreat,
                    isNew: false,
                    message: 'Threat updated (similar threat already exists)'
                };
            }

            // Add new threat
            db.cyberThreats.push(threat);
            
            // Create alert for other users
            await this._createThreatAlert(threat);

            LOG.success(`[Cyber Threat] New threat posted: ${threatId} by user ${userId}`);

            // Sync to MySQL (async)
            this._syncToMySQL(threat).catch(err => {
                LOG.error('[Cyber Threat] MySQL sync error:', err);
            });

            return {
                success: true,
                threat,
                isNew: true,
                message: 'Threat posted successfully. Other users will be alerted.'
            };
        } catch (error) {
            LOG.error(`[Cyber Threat] Error posting threat:`, error);
            throw error;
        }
    }

    /**
     * Search for threats (Local → API → Mock)
     * @param {string} value - Value to search
     * @param {string} type - Type of threat
     * @returns {Promise<Object>} Search results
     */
    async searchThreats(value, type) {
        try {
            const normalizedValue = this._normalizeValue(value, type);
            
            LOG.info(`[Cyber Threat] Searching threats: ${type} - ${normalizedValue}`);

            // 1. Search Local Database FIRST (fastest)
            const localResults = await this._searchLocalDatabase(normalizedValue, type);
            
            if (localResults.length > 0) {
                LOG.info(`[Cyber Threat] Found ${localResults.length} threats in local database`);
                return {
                    found: true,
                    source: 'local_database',
                    threats: localResults,
                    total: localResults.length
                };
            }

            // 2. Search Government APIs (if enabled)
            const apiResults = await this._searchGovernmentAPIs(normalizedValue, type);
            
            if (apiResults.length > 0) {
                LOG.info(`[Cyber Threat] Found ${apiResults.length} threats in government databases`);
                
                // Store in local database for future searches
                apiResults.forEach(threat => {
                    this._storeThreatFromAPI(threat);
                });

                return {
                    found: true,
                    source: 'government_api',
                    threats: apiResults,
                    total: apiResults.length
                };
            }

            // 3. Return mock data (if nothing found)
            LOG.info(`[Cyber Threat] No threats found, returning empty result`);
            return {
                found: false,
                source: 'none',
                threats: [],
                total: 0
            };
        } catch (error) {
            LOG.error(`[Cyber Threat] Search error:`, error);
            return {
                found: false,
                source: 'error',
                threats: [],
                error: error.message
            };
        }
    }

    /**
     * Get all active threats
     * @param {Object} filters - Filter options
     * @returns {Promise<Array>} Active threats
     */
    async getActiveThreats(filters = {}) {
        try {
            let threats = db.cyberThreats.filter(t => t.status === 'active');

            // Apply filters
            if (filters.type) {
                threats = threats.filter(t => t.type === filters.type);
            }
            if (filters.severity) {
                threats = threats.filter(t => t.severity === filters.severity);
            }
            if (filters.category) {
                threats = threats.filter(t => t.category === filters.category);
            }
            if (filters.verified !== undefined) {
                threats = threats.filter(t => t.verified === filters.verified);
            }

            // Sort by report count and severity
            threats.sort((a, b) => {
                const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
                if (severityOrder[b.severity] !== severityOrder[a.severity]) {
                    return severityOrder[b.severity] - severityOrder[a.severity];
                }
                return (b.report_count || 0) - (a.report_count || 0);
            });

            const capped = Math.min(parseInt(filters.limit, 10) || 24, 40);
            const recent = withinRecentDays(threats, 14, ['created_at', 'updated_at', 'last_reported']);
            return sortTodayRecentFirst(recent, capped, ['created_at', 'updated_at', 'last_reported']);
        } catch (error) {
            LOG.error(`[Cyber Threat] Get active threats error:`, error);
            return [];
        }
    }

    /**
     * Get threat alerts for user
     * @param {string} userId - User ID
     * @returns {Promise<Array>} Threat alerts
     */
    async getUserAlerts(userId) {
        try {
            return db.threatAlerts
                .filter(alert => alert.user_id === userId && !alert.read)
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                .slice(0, 20);
        } catch (error) {
            LOG.error(`[Cyber Threat] Get user alerts error:`, error);
            return [];
        }
    }

    /**
     * Mark alert as read
     * @param {string} alertId - Alert ID
     * @param {string} userId - User ID
     */
    async markAlertRead(alertId, userId) {
        const alert = db.threatAlerts.find(a => a.id === alertId && a.user_id === userId);
        if (alert) {
            alert.read = true;
            alert.read_at = new Date();
        }
    }

    /**
     * Update a threat
     * @param {string} threatId - Threat ID
     * @param {string} userId - User ID
     * @param {Object} threatData - Updated threat data
     * @returns {Promise<Object>} Update result
     */
    async updateThreat(threatId, userId, threatData) {
        try {
            const threat = db.cyberThreats.find(t => t.id === threatId);
            
            if (!threat) {
                throw new Error('Threat not found');
            }

            // Only allow user to update their own threats
            if (threat.user_id !== userId) {
                throw new Error('You can only update your own threats');
            }

            // Update threat fields
            if (threatData.title) threat.title = threatData.title;
            if (threatData.description !== undefined) threat.description = threatData.description;
            if (threatData.severity) threat.severity = threatData.severity;
            if (threatData.category) threat.category = threatData.category;
            if (threatData.location !== undefined) threat.location = threatData.location;
            if (threatData.evidence) threat.evidence = threatData.evidence;
            if (threatData.tags) threat.tags = threatData.tags;
            threat.updated_at = new Date();

            // Sync to MySQL (async)
            this._syncToMySQL(threat).catch(err => {
                LOG.error('[Cyber Threat] MySQL sync error:', err);
            });

            LOG.info(`[Cyber Threat] Threat updated: ${threatId} by user ${userId}`);

            return {
                success: true,
                threat,
                message: 'Threat updated successfully'
            };
        } catch (error) {
            LOG.error(`[Cyber Threat] Error updating threat:`, error);
            throw error;
        }
    }

    /**
     * Delete a threat
     * @param {string} threatId - Threat ID
     * @param {string} userId - User ID
     * @returns {Promise<Object>} Delete result
     */
    async deleteThreat(threatId, userId) {
        try {
            const threatIndex = db.cyberThreats.findIndex(t => t.id === threatId);
            
            if (threatIndex === -1) {
                throw new Error('Threat not found');
            }

            const threat = db.cyberThreats[threatIndex];

            // Only allow user to delete their own threats
            if (threat.user_id !== userId) {
                throw new Error('You can only delete your own threats');
            }

            // Remove threat
            db.cyberThreats.splice(threatIndex, 1);

            // Remove related alerts
            db.threatAlerts = db.threatAlerts.filter(a => a.threat_id !== threatId);

            LOG.info(`[Cyber Threat] Threat deleted: ${threatId} by user ${userId}`);

            return {
                success: true,
                message: 'Threat deleted successfully'
            };
        } catch (error) {
            LOG.error(`[Cyber Threat] Error deleting threat:`, error);
            throw error;
        }
    }

    /**
     * Search local database
     * @private
     */
    _searchLocalDatabase(value, type) {
        return db.cyberThreats.filter(threat => {
            if (threat.type !== type) return false;
            if (threat.status !== 'active') return false;
            
            // Exact match
            if (threat.value === value) return true;
            
            // Partial match for phone numbers
            if (type === 'phone' && threat.value.includes(value)) return true;
            
            return false;
        });
    }

    /**
     * Search government APIs
     * @private
     */
    async _searchGovernmentAPIs(value, type) {
        const results = [];

        try {
            // Search I4C for fraud/scam
            if (type === 'phone' || type === 'upi' || type === 'bank_account') {
                const i4cService = require('./i4cService');
                const i4cResult = await i4cService.checkFraudStatus(value, type);
                
                if (i4cResult.isFraud) {
                    results.push({
                        id: `api_i4c_${Date.now()}`,
                        type,
                        value,
                        title: 'Fraud Complaint Reported',
                        description: `This ${type} has been reported in I4C fraud database`,
                        severity: 'high',
                        category: 'fraud',
                        source: 'i4c_ncrp',
                        verified: true,
                        verified_by: 'government',
                        report_count: 1,
                        created_at: new Date()
                    });
                }
            }

            // Search CERT-In for URLs
            if (type === 'url') {
                const certInService = require('./certInService');
                const certResult = await certInService.checkUrl(value);
                
                if (certResult.isThreat) {
                    results.push({
                        id: `api_certin_${Date.now()}`,
                        type,
                        value,
                        title: 'Known Threat URL',
                        description: `This URL is flagged in CERT-In threat intelligence`,
                        severity: certResult.severity === 'high' ? 'high' : 'medium',
                        category: 'malware',
                        source: 'cert_in',
                        verified: true,
                        verified_by: 'government',
                        report_count: 1,
                        created_at: new Date()
                    });
                }
            }
        } catch (error) {
            LOG.warning(`[Cyber Threat] Government API search error:`, error.message);
        }

        return results;
    }

    /**
     * Store threat from API in local database
     * @private
     */
    _storeThreatFromAPI(threat) {
        // Check if already exists
        const exists = db.cyberThreats.find(t => 
            t.value === threat.value && 
            t.type === threat.type && 
            t.source === threat.source
        );

        if (!exists) {
            db.cyberThreats.push({
                ...threat,
                id: threat.id || `api_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                created_at: new Date(),
                updated_at: new Date()
            });
        }
    }

    /**
     * Find similar threat
     * @private
     */
    _findSimilarThreat(newThreat) {
        return db.cyberThreats.find(existing => {
            // Exact match
            if (existing.value === newThreat.value && existing.type === newThreat.type) {
                return true;
            }

            // Similar match for phone numbers (same last 6 digits)
            if (newThreat.type === 'phone' && existing.type === 'phone') {
                const newLast6 = newThreat.value.slice(-6);
                const existingLast6 = existing.value.slice(-6);
                if (newLast6 === existingLast6) {
                    return true;
                }
            }

            return false;
        });
    }

    /**
     * Check if severity is more severe
     * @private
     */
    _isMoreSevere(severity1, severity2) {
        const order = { low: 1, medium: 2, high: 3, critical: 4 };
        return order[severity1] > order[severity2];
    }

    /**
     * Create threat alert for users
     * @private
     */
    async _createThreatAlert(threat) {
        // Create alerts for all users (in real app, would be more targeted)
        // For now, store alert that can be fetched by users
        const alert = {
            id: `alert_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            threat_id: threat.id,
            user_id: null, // null = broadcast to all users
            type: 'threat_alert',
            title: `New ${threat.severity} threat reported: ${threat.title}`,
            message: `A ${threat.category} threat has been reported. Be cautious.`,
            threat_data: threat,
            read: false,
            created_at: new Date()
        };

        db.threatAlerts.push(alert);
    }

    /**
     * Normalize value based on type
     * @private
     */
    _normalizeValue(value, type) {
        if (type === 'phone') {
            return value.replace(/\D/g, '').slice(-10);
        }
        return value.trim().toLowerCase();
    }

    /**
     * Sync threat to MySQL (async)
     * @private
     */
    async _syncToMySQL(threat) {
        try {
            const dbType = db.getType();
            
            if (dbType === 'mysql') {
                // Insert or update in MySQL
                const query = `
                    INSERT INTO cyber_threats (
                        id, user_id, type, value, title, description, severity, 
                        category, tags, report_count, status, verified, 
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        report_count = report_count + 1,
                        updated_at = ?
                `;

                await db.query(query, [
                    threat.id,
                    threat.user_id,
                    threat.type,
                    threat.value,
                    threat.title,
                    threat.description,
                    threat.severity,
                    threat.category,
                    JSON.stringify(threat.tags),
                    threat.report_count,
                    threat.status,
                    threat.verified ? 1 : 0,
                    threat.created_at,
                    threat.updated_at,
                    threat.updated_at
                ]);

                LOG.success(`[Cyber Threat] Synced to MySQL: ${threat.id}`);
            }
        } catch (error) {
            LOG.error(`[Cyber Threat] MySQL sync error:`, error);
            // Don't throw - sync failure shouldn't break the flow
        }
    }
}

module.exports = new CyberThreatService();

