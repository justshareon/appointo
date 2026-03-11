const db = require('../database');
const LOG = require('../utils/logger');

/**
 * Matchmaking Service
 * Handles matchmaking-related business logic
 */
class MatchmakingService {
    /**
     * Get matchmaking presets
     */
    async getPresets() {
        return await db.getMatchmakingPresets() || [];
    }

    /**
     * Get vendor matchmaking template
     */
    async getVendorTemplate(vendorId) {
        const vendor = await db.getVendorById(vendorId);
        if (!vendor || vendor.features_matchmaking === false) {
            throw new Error("Matchmaking is not enabled for this vendor.");
        }

        const template = await db.getVendorMatchmakingTemplate(vendorId);
        if (!template || template.is_active === false) {
            throw new Error("No active matchmaking template found.");
        }

        return {
            vendor_id: vendorId,
            template_name: template.template_name,
            selected_preset: template.selected_preset,
            scoring: template.scoring,
            questions: template.questions
        };
    }

    /**
     * Get my matchmaking template (for logged-in vendor)
     */
    async getMyTemplate(userId) {
        const vendor = await db.getVendorByOwnerId(userId);
        if (!vendor) {
            // Return null instead of throwing error - allows frontend to handle gracefully
            return null;
        }
        return await db.getVendorMatchmakingTemplate(vendor.id) || null;
    }

    /**
     * Save matchmaking template
     */
    async saveTemplate(userId, templateData) {
        const vendor = await db.getVendorByOwnerId(userId);
        if (!vendor) {
            throw new Error("Vendor profile not found");
        }

        const saved = await db.saveVendorMatchmakingTemplate(vendor.id, templateData || {});
        await db.updateVendor(vendor.id, 'features_matchmaking', true);
        return { success: true, template: saved };
    }

    /**
     * Get matchmaking results for vendor
     */
    async getMyResults(userId) {
        const vendor = await db.getVendorByOwnerId(userId);
        if (!vendor) {
            // Return empty array instead of throwing error - allows frontend to handle gracefully
            return [];
        }
        return await db.getVendorMatchmakingResults(vendor.id) || [];
    }

    /**
     * Submit matchmaking answers
     */
    async submitAnswers(userId, submissionData) {
        const { vendor_id, answers } = submissionData;

        if (!vendor_id || !answers || typeof answers !== 'object') {
            throw new Error('vendor_id and answers are required');
        }

        const vendor = await db.getVendorById(vendor_id);
        if (!vendor || vendor.features_matchmaking === false) {
            throw new Error("Matchmaking is not available for this vendor.");
        }

        const user = await db.getUserById(userId);
        const saved = await db.submitMatchmakingAnswers({
            vendor_id,
            user_id: userId,
            answers,
            user_name: user?.name || 'User'
        });

        return { success: true, result: saved };
    }

    /**
     * Get user matchmaking submissions
     */
    async getMySubmissions(userId) {
        return await db.getUserMatchmakingSubmissions(userId) || [];
    }
}

module.exports = new MatchmakingService();

