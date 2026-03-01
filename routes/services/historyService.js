const db = require('../database');
const LOG = require('../utils/logger');

/**
 * History Service
 * Handles history-related business logic
 */
class HistoryService {
    /**
     * Get user history
     */
    async getUserHistory(userId) {
        return await db.getUserHistory(userId) || [];
    }

    /**
     * Get vendor history
     */
    async getVendorHistory(userId) {
        const vendor = await db.getVendorByOwnerId(userId);
        if (!vendor) return [];
        return await db.getVendorHistory(vendor.id) || [];
    }

    /**
     * Get activities
     */
    async getActivities() {
        return await db.getActivities() || [];
    }
}

module.exports = new HistoryService();

