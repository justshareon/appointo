/**
 * Cyber Analytics Service
 * Provides analytics for cyber threats: most active alerts, culprits, target demographics, case counts
 */
const db = require('../../database');
const LOG = require('../../utils/logger');

class CyberAnalyticsService {
    /**
     * Get most active cyber alerts
     * @param {number} limit - Number of alerts to return
     * @returns {Array} Most active alerts
     */
    getMostActiveAlerts(limit = 10) {
        try {
            const threats = db.cyberThreats || [];
            LOG.info(`[Cyber Analytics] Total threats in DB: ${threats.length}`);
            
            // Sort by report_count and severity
            const activeThreats = threats
                .filter(t => {
                    const isActive = t.status === 'active';
                    if (!isActive) {
                        LOG.debug(`[Cyber Analytics] Filtered out threat ${t.id} - status: ${t.status}`);
                    }
                    return isActive;
                })
                .sort((a, b) => {
                    const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
                    const severityDiff = (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
                    if (severityDiff !== 0) return severityDiff;
                    return (b.report_count || 0) - (a.report_count || 0);
                })
                .slice(0, limit)
                .map(threat => ({
                    id: threat.id,
                    type: threat.type,
                    value: threat.value,
                    title: threat.title,
                    severity: threat.severity,
                    category: threat.category,
                    reportCount: threat.report_count || 0,
                    location: threat.location || 'Unknown',
                    createdAt: threat.created_at,
                    tags: threat.tags || []
                }));

            LOG.info(`[Cyber Analytics] Active threats found: ${activeThreats.length}`);
            return activeThreats;
        } catch (error) {
            LOG.error('[Cyber Analytics] Error getting active alerts:', error);
            return [];
        }
    }

    /**
     * Get most reported culprits (phone numbers, emails, URLs)
     * @param {number} limit - Number of culprits to return
     * @returns {Array} Most reported culprits
     */
    getMostReportedCulprits(limit = 10) {
        try {
            const threats = db.cyberThreats || [];
            LOG.info(`[Cyber Analytics] Total threats for culprits: ${threats.length}`);
            
            // Group by value and count reports
            const culpritMap = {};
            
            threats.forEach(threat => {
                if (threat.status === 'active') {
                    const key = `${threat.type}_${threat.value}`;
                    if (!culpritMap[key]) {
                        culpritMap[key] = {
                            type: threat.type,
                            value: threat.value,
                            title: threat.title,
                            reportCount: 0,
                            severity: threat.severity,
                            category: threat.category,
                            locations: new Set(),
                            firstReported: threat.created_at,
                            lastReported: threat.updated_at
                        };
                    }
                    culpritMap[key].reportCount += threat.report_count || 1;
                    if (threat.location) {
                        culpritMap[key].locations.add(threat.location);
                    }
                    if (new Date(threat.updated_at) > new Date(culpritMap[key].lastReported)) {
                        culpritMap[key].lastReported = threat.updated_at;
                    }
                }
            });

            // Convert to array and sort
            const culprits = Object.values(culpritMap)
                .map(c => ({
                    ...c,
                    locations: Array.from(c.locations)
                }))
                .sort((a, b) => b.reportCount - a.reportCount)
                .slice(0, limit);

            LOG.info(`[Cyber Analytics] Culprits found: ${culprits.length}`);
            return culprits;
        } catch (error) {
            LOG.error('[Cyber Analytics] Error getting culprits:', error);
            return [];
        }
    }

    /**
     * Get target demographics (which types of users are being targeted)
     * @returns {Object} Target demographics
     */
    getTargetDemographics() {
        try {
            const threats = db.cyberThreats || [];
            const activeThreats = threats.filter(t => t.status === 'active');

            // Analyze by threat type
            const byType = {};
            const byCategory = {};
            const byLocation = {};
            const bySeverity = {};

            activeThreats.forEach(threat => {
                // By type
                byType[threat.type] = (byType[threat.type] || 0) + (threat.report_count || 1);
                
                // By category
                byCategory[threat.category] = (byCategory[threat.category] || 0) + (threat.report_count || 1);
                
                // By location
                const location = threat.location || 'Unknown';
                byLocation[location] = (byLocation[location] || 0) + (threat.report_count || 1);
                
                // By severity
                bySeverity[threat.severity] = (bySeverity[threat.severity] || 0) + (threat.report_count || 1);
            });

            // Calculate percentages
            const totalReports = activeThreats.reduce((sum, t) => sum + (t.report_count || 1), 0);

            return {
                byType: Object.entries(byType).map(([type, count]) => ({
                    type,
                    count,
                    percentage: totalReports > 0 ? Math.round((count / totalReports) * 100) : 0
                })).sort((a, b) => b.count - a.count),
                byCategory: Object.entries(byCategory).map(([category, count]) => ({
                    category,
                    count,
                    percentage: totalReports > 0 ? Math.round((count / totalReports) * 100) : 0
                })).sort((a, b) => b.count - a.count),
                byLocation: Object.entries(byLocation).map(([location, count]) => ({
                    location,
                    count,
                    percentage: totalReports > 0 ? Math.round((count / totalReports) * 100) : 0
                })).sort((a, b) => b.count - a.count),
                bySeverity: Object.entries(bySeverity).map(([severity, count]) => ({
                    severity,
                    count,
                    percentage: totalReports > 0 ? Math.round((count / totalReports) * 100) : 0
                })).sort((a, b) => b.count - a.count),
                totalReports
            };
        } catch (error) {
            LOG.error('[Cyber Analytics] Error getting demographics:', error);
            return {
                byType: [],
                byCategory: [],
                byLocation: [],
                bySeverity: [],
                totalReports: 0
            };
        }
    }

    /**
     * Get case statistics
     * @returns {Object} Case statistics
     */
    getCaseStatistics() {
        try {
            const threats = db.cyberThreats || [];
            const allThreats = threats.length;
            const activeThreats = threats.filter(t => t.status === 'active').length;
            const resolvedThreats = threats.filter(t => t.status === 'resolved').length;
            const falsePositives = threats.filter(t => t.status === 'false_positive').length;
            const verifiedThreats = threats.filter(t => t.verified).length;
            
            const totalReports = threats.reduce((sum, t) => sum + (t.report_count || 1), 0);
            
            // Get today's cases
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayCases = threats.filter(t => {
                const created = new Date(t.created_at);
                created.setHours(0, 0, 0, 0);
                return created.getTime() === today.getTime();
            }).length;

            // Get this week's cases
            const weekAgo = new Date(today);
            weekAgo.setDate(weekAgo.getDate() - 7);
            const weekCases = threats.filter(t => new Date(t.created_at) >= weekAgo).length;

            // Get this month's cases
            const monthAgo = new Date(today);
            monthAgo.setMonth(monthAgo.getMonth() - 1);
            const monthCases = threats.filter(t => new Date(t.created_at) >= monthAgo).length;

            return {
                total: allThreats,
                active: activeThreats,
                resolved: resolvedThreats,
                falsePositives,
                verified: verifiedThreats,
                totalReports,
                today: todayCases,
                thisWeek: weekCases,
                thisMonth: monthCases,
                averageReportsPerThreat: allThreats > 0 ? Math.round(totalReports / allThreats) : 0
            };
        } catch (error) {
            LOG.error('[Cyber Analytics] Error getting statistics:', error);
            return {
                total: 0,
                active: 0,
                resolved: 0,
                falsePositives: 0,
                verified: 0,
                totalReports: 0,
                today: 0,
                thisWeek: 0,
                thisMonth: 0,
                averageReportsPerThreat: 0
            };
        }
    }

    /**
     * Get filtered threats
     * @param {Object} filters - Filter options
     * @returns {Array} Filtered threats
     */
    getFilteredThreats(filters = {}) {
        try {
            let threats = db.cyberThreats || [];

            // Apply filters
            if (filters.location) {
                threats = threats.filter(t => 
                    (t.location || 'Unknown').toLowerCase().includes(filters.location.toLowerCase())
                );
            }

            if (filters.type) {
                threats = threats.filter(t => t.type === filters.type);
            }

            if (filters.category) {
                threats = threats.filter(t => t.category === filters.category);
            }

            if (filters.severity) {
                threats = threats.filter(t => t.severity === filters.severity);
            }

            if (filters.status) {
                threats = threats.filter(t => t.status === filters.status);
            } else {
                // Default to active only
                threats = threats.filter(t => t.status === 'active');
            }

            // Sort by report count and severity
            threats.sort((a, b) => {
                const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
                const severityDiff = (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
                if (severityDiff !== 0) return severityDiff;
                return (b.report_count || 0) - (a.report_count || 0);
            });

            return threats.slice(0, filters.limit || 50);
        } catch (error) {
            LOG.error('[Cyber Analytics] Error getting filtered threats:', error);
            return [];
        }
    }
}

module.exports = new CyberAnalyticsService();

