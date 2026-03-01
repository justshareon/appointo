const db = require('../database');
const LOG = require('../utils/logger');

/**
 * Settings Service
 * Handles system settings business logic
 */
class SettingsService {
    /**
     * Get system settings
     */
    async getSettings() {
        return await db.getSettings() || {};
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

