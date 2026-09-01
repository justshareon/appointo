const db = require('../database');
const LOG = require('../utils/logger');
const { ensureFeatureSettings } = require('../utils/defaultFeatureSettings');

/**
 * Settings Service
 * Handles system settings business logic
 */
class SettingsService {
    /**
     * Get system settings
     */
    async getSettings() {
        const raw = await db.getSettings() || {};
        return ensureFeatureSettings(raw);
    }

    /**
     * Update system settings
     */
    async updateSettings(settings) {
        await db.updateSettings(settings);
        return { success: true };
    }
}

module.exports = new SettingsService();

