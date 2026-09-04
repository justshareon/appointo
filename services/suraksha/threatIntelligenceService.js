/**
 * Threat Intelligence Service
 * Scans internet for cyber threats and attacks daily
 */
const db = require('../../database');
const LOG = require('../../utils/logger');
const axios = require('axios');
const { parseString } = require('xml2js');

class ThreatIntelligenceService {
    constructor() {
        // Threat intelligence sources (RSS feeds, APIs)
        this.sources = [
            {
                name: 'CISA Alerts',
                url: 'https://www.cisa.gov/news-events/cybersecurity-advisories/rss.xml',
                type: 'rss',
                enabled: true
            },
            {
                name: 'US-CERT',
                url: 'https://www.us-cert.gov/ncas/alerts.xml',
                type: 'rss',
                enabled: true
            },
            {
                name: 'Krebs on Security',
                url: 'https://krebsonsecurity.com/feed/',
                type: 'rss',
                enabled: true
            },
            {
                name: 'Bleeping Computer',
                url: 'https://www.bleepingcomputer.com/feed/',
                type: 'rss',
                enabled: true
            },
            {
                name: 'The Hacker News',
                url: 'https://feeds.feedburner.com/TheHackersNews',
                type: 'rss',
                enabled: true
            }
        ];

        // Keywords to identify cyber threats
        this.threatKeywords = [
            'cyber attack', 'data breach', 'ransomware', 'phishing', 'malware',
            'vulnerability', 'exploit', 'zero-day', 'APT', 'DDoS',
            'cybercrime', 'hack', 'security flaw', 'cyber threat', 'scam',
            'fraud', 'identity theft', 'social engineering', 'trojan',
            'spyware', 'adware', 'botnet', 'cryptojacking', 'cyber espionage'
        ];
    }

    /**
     * Scan all sources for threats
     * @param {boolean} force - Force scan even if recently scanned
     * @returns {Promise<Array>} Found threats
     */
    async scanThreats(force = false) {
        try {
            // Check if we recently scanned (within last 4 hours) unless forced
            if (!force && db.threatIntelligence && db.threatIntelligence.length > 0) {
                const lastThreat = db.threatIntelligence
                    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
                const lastScanTime = new Date(lastThreat.createdAt);
                const hoursSinceLastScan = (Date.now() - lastScanTime.getTime()) / (1000 * 60 * 60);
                
                if (hoursSinceLastScan < 4) {
                    LOG.info(`[Threat Intelligence] Skipping scan - last scan was ${hoursSinceLastScan.toFixed(1)} hours ago`);
                    return [];
                }
            }

            LOG.info('[Threat Intelligence] Starting threat scan...');
            const allThreats = [];

            for (const source of this.sources) {
                if (!source.enabled) continue;

                try {
                    const threats = await this._scanSource(source);
                    allThreats.push(...threats);
                    LOG.info(`[Threat Intelligence] Found ${threats.length} threats from ${source.name}`);
                } catch (error) {
                    LOG.error(`[Threat Intelligence] Error scanning ${source.name}:`, error.message);
                }
            }

            // Remove duplicates and validate
            const uniqueThreats = this._deduplicateThreats(allThreats);
            const validatedThreats = await this._validateThreats(uniqueThreats);

            LOG.info(`[Threat Intelligence] Scan complete: ${validatedThreats.length} unique threats found`);
            return validatedThreats;
        } catch (error) {
            LOG.error('[Threat Intelligence] Error scanning threats:', error);
            throw error;
        }
    }

    /**
     * Scan a single source
     * @private
     */
    async _scanSource(source) {
        try {
            const response = await axios.get(source.url, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (source.type === 'rss') {
                return this._parseRSS(response.data, source);
            }

            return [];
        } catch (error) {
            LOG.warning(`[Threat Intelligence] Failed to fetch ${source.name}:`, error.message);
            return [];
        }
    }

    /**
     * Parse RSS feed
     * @private
     */
    async _parseRSS(xmlData, source) {
        return new Promise((resolve, reject) => {
            parseString(xmlData, (err, result) => {
                if (err) {
                    reject(err);
                    return;
                }

                const items = result?.rss?.channel?.[0]?.item || [];
                const threats = [];

                for (const item of items) {
                    const title = item.title?.[0] || '';
                    const description = item.description?.[0] || '';
                    const link = item.link?.[0] || '';
                    const pubDate = item.pubDate?.[0] || new Date().toISOString();

                    // Check if content contains threat keywords
                    const content = `${title} ${description}`.toLowerCase();
                    const matchedKeywords = this.threatKeywords.filter(keyword =>
                        content.includes(keyword.toLowerCase())
                    );

                    if (matchedKeywords.length > 0) {
                        threats.push({
                            title: title,
                            description: description.substring(0, 500), // Limit description
                            link: link,
                            source: source.name,
                            sourceUrl: source.url,
                            publishedDate: pubDate,
                            keywords: matchedKeywords,
                            severity: this._determineSeverity(content, matchedKeywords),
                            category: this._determineCategory(matchedKeywords),
                            verified: false, // Will be verified by admin/users
                            createdAt: new Date().toISOString()
                        });
                    }
                }

                resolve(threats);
            });
        });
    }

    /**
     * Determine threat severity
     * @private
     */
    _determineSeverity(content, keywords) {
        const criticalKeywords = ['zero-day', 'exploit', 'data breach', 'ransomware', 'APT'];
        const highKeywords = ['vulnerability', 'malware', 'phishing', 'DDoS', 'hack'];
        
        if (keywords.some(k => criticalKeywords.includes(k.toLowerCase()))) {
            return 'critical';
        }
        if (keywords.some(k => highKeywords.includes(k.toLowerCase()))) {
            return 'high';
        }
        return 'medium';
    }

    /**
     * Determine threat category
     * @private
     */
    _determineCategory(keywords) {
        if (keywords.some(k => ['ransomware', 'malware', 'trojan', 'spyware'].includes(k.toLowerCase()))) {
            return 'malware';
        }
        if (keywords.some(k => ['phishing', 'scam', 'fraud', 'social engineering'].includes(k.toLowerCase()))) {
            return 'phishing';
        }
        if (keywords.some(k => ['data breach', 'hack', 'exploit'].includes(k.toLowerCase()))) {
            return 'breach';
        }
        if (keywords.some(k => ['vulnerability', 'zero-day', 'security flaw'].includes(k.toLowerCase()))) {
            return 'vulnerability';
        }
        return 'general';
    }

    /**
     * Remove duplicate threats
     * @private
     */
    _deduplicateThreats(threats) {
        const seen = new Set();
        const unique = [];

        for (const threat of threats) {
            const key = `${threat.title}_${threat.source}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(threat);
            }
        }

        return unique;
    }

    /**
     * Validate threats (check if already exists, verify content)
     * @private
     */
    async _validateThreats(threats) {
        if (!db.threatIntelligence) {
            db.threatIntelligence = [];
        }

        const validated = [];

        for (const threat of threats) {
            // Check if threat already exists
            const exists = db.threatIntelligence.find(t =>
                t.title === threat.title && t.source === threat.source
            );

            if (!exists) {
                // Create unique ID
                threat.id = `threat_${Date.now()}_${Math.random().toString(36).substring(7)}`;
                threat.status = 'new'; // new, verified, dismissed
                threat.viewCount = 0;
                threat.alertSent = false;
                validated.push(threat);
            }
        }

        return validated;
    }

    /**
     * Save threats to database
     * @param {Array} threats - Threats to save
     * @returns {Promise<Object>} Save result
     */
    async saveThreats(threats) {
        try {
            if (!db.threatIntelligence) {
                db.threatIntelligence = [];
            }

            let saved = 0;
            let alertsToSend = [];

            for (const threat of threats) {
                db.threatIntelligence.push(threat);
                saved++;

                // Alert once per threat — skip if already notified
                if (
                    ['critical', 'high'].includes(threat.severity) &&
                    !threat.alertSent
                ) {
                    threat.alertSent = true;
                    alertsToSend.push(threat);
                }
            }

            // Keep only last 1000 threats
            if (db.threatIntelligence.length > 1000) {
                db.threatIntelligence = db.threatIntelligence
                    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                    .slice(0, 1000);
            }

            LOG.info(`[Threat Intelligence] Saved ${saved} new threats, ${alertsToSend.length} require alerts`);

            return {
                saved,
                alerts: alertsToSend
            };
        } catch (error) {
            LOG.error('[Threat Intelligence] Error saving threats:', error);
            throw error;
        }
    }

    /**
     * Get threats for feed
     * @param {Object} filters - Filter options
     * @returns {Promise<Array>} Threats
     */
    async getThreats(filters = {}) {
        try {
            let threats = db.threatIntelligence || [];

            // If no threats in DB, return empty array (will be populated by daily scan)
            if (!threats || threats.length === 0) {
                LOG.info('[Threat Intelligence] No threats in database, returning empty array');
                return [];
            }

            // Filter by severity
            if (filters.severity) {
                threats = threats.filter(t => t.severity === filters.severity);
            }

            // Filter by category
            if (filters.category) {
                threats = threats.filter(t => t.category === filters.category);
            }

            // Filter by status (if provided, otherwise show all)
            if (filters.status) {
                threats = threats.filter(t => t.status === filters.status);
            }

            // Filter by date range
            if (filters.startDate) {
                threats = threats.filter(t => new Date(t.createdAt) >= new Date(filters.startDate));
            }
            if (filters.endDate) {
                threats = threats.filter(t => new Date(t.createdAt) <= new Date(filters.endDate));
            }

            // Sort by date (newest first)
            threats.sort((a, b) => {
                const dateA = new Date(a.createdAt || a.publishedDate || 0);
                const dateB = new Date(b.createdAt || b.publishedDate || 0);
                return dateB - dateA;
            });

            // Limit results
            if (filters.limit) {
                threats = threats.slice(0, parseInt(filters.limit));
            }

            LOG.info(`[Threat Intelligence] Returning ${threats.length} threats (filtered from ${db.threatIntelligence?.length || 0} total)`);
            return threats;
        } catch (error) {
            LOG.error('[Threat Intelligence] Error getting threats:', error);
            throw error;
        }
    }

    /**
     * Verify threat (mark as verified)
     * @param {string} threatId - Threat ID
     * @param {string} userId - User ID who verified
     * @returns {Promise<Object>} Updated threat
     */
    async verifyThreat(threatId, userId) {
        try {
            const threat = db.threatIntelligence.find(t => t.id === threatId);
            if (!threat) {
                throw new Error('Threat not found');
            }

            threat.status = 'verified';
            threat.verifiedBy = userId;
            threat.verifiedAt = new Date().toISOString();
            threat.updatedAt = new Date().toISOString();

            LOG.info(`[Threat Intelligence] Threat ${threatId} verified by user ${userId}`);
            return threat;
        } catch (error) {
            LOG.error('[Threat Intelligence] Error verifying threat:', error);
            throw error;
        }
    }

    /**
     * Mark threat as dismissed
     * @param {string} threatId - Threat ID
     * @param {string} userId - User ID
     * @returns {Promise<Object>} Updated threat
     */
    async dismissThreat(threatId, userId) {
        try {
            const threat = db.threatIntelligence.find(t => t.id === threatId);
            if (!threat) {
                throw new Error('Threat not found');
            }

            threat.status = 'dismissed';
            threat.dismissedBy = userId;
            threat.dismissedAt = new Date().toISOString();
            threat.updatedAt = new Date().toISOString();

            return threat;
        } catch (error) {
            LOG.error('[Threat Intelligence] Error dismissing threat:', error);
            throw error;
        }
    }
}

module.exports = new ThreatIntelligenceService();

