const db = require('../database');
const LOG = require('../utils/logger');

/**
 * Admin Service
 * Handles admin-related business logic
 */
class AdminService {
    /**
     * Check if user is super admin
     */
    isSuperAdmin(user) {
        return user && user.role === 'super_admin';
    }

    /**
     * Get all vendors (admin view)
     */
    async getVendors(query) {
        const page = parseInt(query.page) || 1;
        const limit = parseInt(query.limit) || 10;
        const sortBy = query.sortBy || 'newest';
        const search = query.search || '';

        // Super admin should see ALL vendors including Trade and Offer
        // getVendors(activeOnly, page, limit, sortBy, searchQuery, includeTradeOffer)
        const result = await db.getVendors(false, page, limit, sortBy, search, true);
        
        // Ensure result is in expected format
        if (Array.isArray(result)) {
            return {
                vendors: result,
                total: result.length,
                page: page,
                limit: limit
            };
        }
        
        return result;
    }

    /**
     * Get vendor by ID
     */
    async getVendorById(vendorId) {
        return await db.getVendorById(vendorId);
    }

    /**
     * Update vendor field
     */
    async updateVendor(vendorId, field, value) {
        await db.updateVendor(vendorId, field, value);
        return { success: true };
    }

    /**
     * Add vendor
     */
    async addVendor(vendorData) {
        const { shop_name, category, owner_mobile, owner_name, owner_email } = vendorData;

        if (!shop_name || !owner_mobile) {
            throw new Error('shop_name and owner_mobile are required');
        }

        let owner = await db.getUserByMobile(owner_mobile);
        if (!owner) {
            const ownerId = 'usr_' + Math.random().toString(36).substring(2, 11);
            owner = {
                id: ownerId,
                name: owner_name || 'Vendor Owner',
                email: owner_email || `vendor_${owner_mobile}@qrqueue.local`,
                mobile: owner_mobile,
                role: 'vendor',
                created_at: new Date()
            };
            await db.addUser(owner);
        } else if (owner.role !== 'vendor') {
            await db.updateUserRole(owner.id, 'vendor');
            owner.role = 'vendor';
        }

        const vendor = {
            id: 'v_' + Math.random().toString(36).substring(2, 10),
            owner_id: owner.id,
            shop_name,
            category: category || 'General',
            is_active: true,
            is_promoted: false,
            latitude: 0,
            longitude: 0,
            features_matchmaking: false
        };

        await db.addVendor(vendor);
        LOG.success(`Admin added vendor ${vendor.shop_name} for mobile ${owner_mobile}`);
        return { success: true, vendor, owner };
    }

    /**
     * Get vendor dashboard data
     */
    async getVendorDashboard(vendorId) {
        try {
            // Get vendor first
            const vendor = await db.getVendorById(vendorId);
            
            if (!vendor) {
                throw new Error("Vendor not found");
            }

            // For trade/cyber/trust vendors, they might not have queues/appointments
            // So we handle errors gracefully
            let queue = [];
            let appointments = [];

            try {
                queue = await db.getQueueByVendor(vendorId) || [];
            } catch (err) {
                LOG.warning(`[Admin Service] Error fetching queue for ${vendorId}:`, err.message);
                queue = [];
            }

            try {
                appointments = await db.getAppointmentsByVendor(vendorId) || [];
            } catch (err) {
                LOG.warning(`[Admin Service] Error fetching appointments for ${vendorId}:`, err.message);
                appointments = [];
            }

            return {
                profile: vendor,
                queue: queue,
                appointments: appointments
            };
        } catch (err) {
            LOG.error(`[Admin Service] Error in getVendorDashboard for ${vendorId}:`, err.message);
            throw err;
        }
    }
}

module.exports = new AdminService();

