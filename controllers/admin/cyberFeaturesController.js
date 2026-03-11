/**
 * Admin Cyber Features Controller
 * Allows super users to enable/disable cyber-related features
 */
const db = require('../../database');
const settingsService = require('../../services/settingsService');
const LOG = require('../../utils/logger');

class CyberFeaturesController {
    /**
     * Get all cyber feature settings
     * GET /api/admin/cyber-features
     */
    async getCyberFeatures(req, res) {
        try {
            // Check if user is super admin
            if (req.user?.role !== 'super_admin') {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Only super admins can access this endpoint'
                });
            }

            const settings = await settingsService.getSettings();
            
            const cyberFeatures = {
                enable_cyber: settings.enable_cyber || false,
                auto_validate_calls: settings.auto_validate_calls || false,
                auto_validate_links: settings.auto_validate_links || false,
                auto_validate_sms: settings.auto_validate_sms || false,
                auto_validate_emails: settings.auto_validate_emails || false,
                auto_scan_enabled: settings.auto_scan_enabled || false,
                threat_scan_interval: settings.threat_scan_interval || 5,
                // Feature flags
                enable_threat_intelligence: settings.enable_threat_intelligence !== false,
                enable_notification_validation: settings.enable_notification_validation !== false,
                enable_mobile_security_scan: settings.enable_mobile_security_scan !== false,
                enable_subscription_management: settings.enable_subscription_management !== false,
                enable_auto_validation: settings.enable_auto_validation !== false,
                enable_suraksha: settings.enable_suraksha !== false,
                enable_caller_validation: settings.enable_caller_validation !== false
            };

            res.json({
                success: true,
                features: cyberFeatures
            });
        } catch (error) {
            LOG.error('[Admin Cyber Features] Error getting features:', error);
            res.status(500).json({
                error: 'Failed to get cyber features',
                message: error.message
            });
        }
    }

    /**
     * Update cyber feature settings
     * POST /api/admin/cyber-features
     */
    async updateCyberFeatures(req, res) {
        try {
            // Check if user is super admin
            if (req.user?.role !== 'super_admin') {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Only super admins can update cyber features'
                });
            }

            const {
                enable_cyber,
                auto_validate_calls,
                auto_validate_links,
                auto_validate_sms,
                auto_validate_emails,
                auto_scan_enabled,
                threat_scan_interval,
                enable_threat_intelligence,
                enable_notification_validation,
                enable_mobile_security_scan,
                enable_subscription_management,
                enable_auto_validation,
                enable_suraksha,
                enable_caller_validation
            } = req.body;

            // Get current settings
            const currentSettings = await settingsService.getSettings();
            
            // Build update object
            const updates = {};
            
            if (enable_cyber !== undefined) updates.enable_cyber = enable_cyber;
            if (auto_validate_calls !== undefined) updates.auto_validate_calls = auto_validate_calls;
            if (auto_validate_links !== undefined) updates.auto_validate_links = auto_validate_links;
            if (auto_validate_sms !== undefined) updates.auto_validate_sms = auto_validate_sms;
            if (auto_validate_emails !== undefined) updates.auto_validate_emails = auto_validate_emails;
            if (auto_scan_enabled !== undefined) updates.auto_scan_enabled = auto_scan_enabled;
            if (threat_scan_interval !== undefined) {
                const interval = Math.max(1, Math.min(24, parseInt(threat_scan_interval)));
                updates.threat_scan_interval = interval;
            }
            if (enable_threat_intelligence !== undefined) updates.enable_threat_intelligence = enable_threat_intelligence;
            if (enable_notification_validation !== undefined) updates.enable_notification_validation = enable_notification_validation;
            if (enable_mobile_security_scan !== undefined) updates.enable_mobile_security_scan = enable_mobile_security_scan;
            if (enable_subscription_management !== undefined) updates.enable_subscription_management = enable_subscription_management;
            if (enable_auto_validation !== undefined) updates.enable_auto_validation = enable_auto_validation;
            if (enable_suraksha !== undefined) updates.enable_suraksha = enable_suraksha;
            if (enable_caller_validation !== undefined) updates.enable_caller_validation = enable_caller_validation;

            // Merge with current settings
            const updatedSettings = { ...currentSettings, ...updates };

            // Update in local database (in-memory) and MySQL via settings service
            // settingsService.updateSettings handles both local and MySQL
            await settingsService.updateSettings(updatedSettings);

            LOG.info(`[Admin Cyber Features] Updated by ${req.user?.id}:`, updates);

            // Emit settings update via WebSocket
            if (req.io) {
                req.io.emit('settings_updated', updatedSettings);
                req.io.emit('cyber_features_updated', {
                    updatedBy: req.user?.id,
                    updates,
                    timestamp: new Date().toISOString()
                });
            }

            res.json({
                success: true,
                message: 'Cyber features updated successfully',
                updates,
                settings: updatedSettings
            });
        } catch (error) {
            LOG.error('[Admin Cyber Features] Error updating features:', error);
            res.status(500).json({
                error: 'Failed to update cyber features',
                message: error.message
            });
        }
    }

    /**
     * Toggle a single cyber feature
     * POST /api/admin/cyber-features/toggle/:featureName
     */
    async toggleFeature(req, res) {
        try {
            // Check if user is super admin
            if (req.user?.role !== 'super_admin') {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Only super admins can toggle cyber features'
                });
            }

            const { featureName } = req.params;
            const { enabled } = req.body;

            if (enabled === undefined) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'enabled parameter is required'
                });
            }

            const validFeatures = [
                'enable_cyber',
                'auto_validate_calls',
                'auto_validate_links',
                'auto_validate_sms',
                'auto_validate_emails',
                'auto_scan_enabled',
                'enable_threat_intelligence',
                'enable_notification_validation',
                'enable_mobile_security_scan',
                'enable_subscription_management',
                'enable_auto_validation',
                'enable_suraksha',
                'enable_caller_validation'
            ];

            if (!validFeatures.includes(featureName)) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: `Invalid feature name. Valid features: ${validFeatures.join(', ')}`
                });
            }

            // Get current settings
            const currentSettings = await settingsService.getSettings();
            
            // Update the feature
            const updates = { [featureName]: enabled };
            const updatedSettings = { ...currentSettings, ...updates };

            // Update in local database and MySQL via settings service
            // settingsService.updateSettings handles both local and MySQL
            await settingsService.updateSettings(updatedSettings);

            LOG.info(`[Admin Cyber Features] Toggled ${featureName} to ${enabled} by ${req.user?.id}`);

            // Emit update
            if (req.io) {
                req.io.emit('settings_updated', updatedSettings);
                req.io.emit('cyber_features_updated', {
                    feature: featureName,
                    enabled,
                    updatedBy: req.user?.id,
                    timestamp: new Date().toISOString()
                });
            }

            res.json({
                success: true,
                message: `${featureName} ${enabled ? 'enabled' : 'disabled'}`,
                feature: featureName,
                enabled
            });
        } catch (error) {
            LOG.error('[Admin Cyber Features] Error toggling feature:', error);
            res.status(500).json({
                error: 'Failed to toggle feature',
                message: error.message
            });
        }
    }
}

module.exports = new CyberFeaturesController();

