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
        if (field === 'category') {
            throw new Error('Category cannot be changed once the vendor is created');
        }
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
                location_name: vendorData.location_name || '',
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
            location_name: vendorData.location_name || owner.location_name || '',
            features_products: true,
            features_payments: true,
            features_appointments: true,
            features_queue: true,
            features_matchmaking: false,
            visibility_list: true,
            visibility_top_rated: true,
            visibility_feed: true,
        };

        await db.addVendor(vendor);
        if (category) {
            try {
                await db.addVendorCategory(category);
            } catch (e) {
                LOG.warning(`[Admin] Category catalog update skipped: ${e.message}`);
            }
        }
        LOG.success(`Admin added vendor ${vendor.shop_name} for mobile ${owner_mobile}`);
        return { success: true, vendor, owner };
    }

    /**
     * List permanent vendor categories (defaults + custom)
     */
    async getVendorCategories() {
        return await db.getVendorCategories();
    }

    /**
     * Add a vendor category (add-only; cannot rename later)
     */
    async addVendorCategory(name) {
        return await db.addVendorCategory(name);
    }

    /**
     * Get vendor dashboard data
     */
    async getVendorDashboard(vendorId) {
        try {
            const vendor = await db.getVendorById(vendorId);
            if (!vendor) {
                throw new Error("Vendor not found");
            }

            let queue = [];
            let appointments = [];
            let products = [];
            let orders = [];

            try {
                queue = await db.getQueueByVendor(vendorId) || [];
            } catch (err) {
                LOG.warning(`[Admin Service] Error fetching queue for ${vendorId}:`, err.message);
            }

            try {
                appointments = await db.getAppointmentsByVendor(vendorId) || [];
            } catch (err) {
                LOG.warning(`[Admin Service] Error fetching appointments for ${vendorId}:`, err.message);
            }

            try {
                products = await db.getProductsByVendor(vendorId) || [];
            } catch (err) {
                LOG.warning(`[Admin Service] Error fetching products for ${vendorId}:`, err.message);
            }

            try {
                if (typeof db.getOrdersByVendorId === 'function') {
                    orders = await db.getOrdersByVendorId(vendorId) || [];
                } else if (typeof db.getAllOrders === 'function') {
                    const all = await db.getAllOrders() || [];
                    orders = all.filter((o) => String(o.vendor_id) === String(vendorId));
                }
            } catch (err) {
                LOG.warning(`[Admin Service] Error fetching orders for ${vendorId}:`, err.message);
            }

            const todayStr = new Date().toISOString().slice(0, 10);
            const openAppts = appointments.filter((a) => ['pending', 'confirmed'].includes(String(a.status || '').toLowerCase()));
            const running = openAppts.filter((a) => String(a.date || '').slice(0, 10) === todayStr);
            const todayDone = appointments.filter((a) => String(a.date || '').slice(0, 10) === todayStr && String(a.status).toLowerCase() === 'completed');
            const isPaid = (o) => {
                const st = String(o.status || '').toLowerCase();
                const fs = String(o.fulfillment_status || '').toLowerCase();
                return ['paid', 'completed', 'success', 'done'].includes(st)
                    || ['delivered', 'completed', 'paid'].includes(fs)
                    || !!(o.payment_ref)
                    || Number(o.total_amount) > 0;
            };
            const paidOrders = orders.filter(isPaid);
            const liveQueue = queue.filter((q) => String(q.status || '').toLowerCase() === 'waiting');
            const todayQueueDone = queue.filter((q) => {
                if (!['done', 'completed'].includes(String(q.status || '').toLowerCase())) return false;
                const d = q.joined_at ? new Date(q.joined_at).toISOString().slice(0, 10) : '';
                return d === todayStr;
            });
            const todayOrders = orders.filter((o) => {
                const d = o.created_at ? new Date(o.created_at).toISOString().slice(0, 10) : '';
                return d === todayStr;
            });

            return {
                profile: vendor,
                queue,
                appointments,
                products,
                orders,
                stats: {
                    live_queue_count: liveQueue.length,
                    appointments_open: openAppts.length,
                    appointments_running: running.length,
                    appointments_total: appointments.length,
                    today_pending_appointments: running.length,
                    today_completed_appointments: todayDone.length,
                    product_count: products.length,
                    orders_count: orders.length,
                    payments_done: paidOrders.length,
                    payments_amount: paidOrders.reduce((s, o) => s + (Number(o.total_amount) || 0), 0),
                    today_processed: todayDone.length + todayQueueDone.length + todayOrders.length,
                },
            };
        } catch (err) {
            LOG.error(`[Admin Service] Error in getVendorDashboard for ${vendorId}:`, err.message);
            throw err;
        }
    }

    /**
     * Get users with vendor mappings (admin view)
     */
    async getUsersWithMappings(query = {}) {
        const page = parseInt(query.page, 10) || 1;
        const limit = parseInt(query.limit, 10) || 10;
        const search = query.search || '';
        const filterField = query.filterField || 'all';
        return db.getUsersWithVendorMappingsPaginated({ page, limit, search, filterField });
    }

    async getVendorPickerList(query = {}) {
        const page = parseInt(query.page, 10) || 1;
        const limit = parseInt(query.limit, 10) || 10;
        const search = query.search || '';
        const filterField = query.filterField || 'all';
        const excludeUserId = query.excludeUserId || null;
        return db.getVendorPickerList({ page, limit, search, filterField, excludeUserId });
    }

    /**
     * Create user (admin)
     */
    async createUser(userData) {
        const { name, email, mobile, role, location_name } = userData;
        if (!name || !mobile) {
            throw new Error('name and mobile are required');
        }

        const user = {
            id: userData.id || ('usr_' + Math.random().toString(36).substring(2, 11)),
            name,
            email: email || `${mobile}@qrqueue.local`,
            mobile,
            role: role || 'user',
            location_name: location_name || '',
            created_at: new Date()
        };

        await db.addUser(user);
        LOG.success(`Admin created user ${user.id} (${user.name})`);
        return { success: true, user };
    }

    /**
     * Update user (admin)
     */
    async updateUser(userId, userData) {
        const user = await db.getUserById(userId);
        if (!user) throw new Error('User not found');

        if (userData.name !== undefined || userData.email !== undefined || userData.location_name !== undefined) {
            await db.updateUserProfile(userId, {
                name: userData.name,
                email: userData.email,
                location_name: userData.location_name
            });
        }
        if (userData.role !== undefined) {
            await db.updateUserRole(userId, userData.role);
        }

        const updated = await db.getUserById(userId);
        return { success: true, user: updated };
    }

    /**
     * Delete user (admin)
     */
    async deleteUser(userId) {
        const user = await db.getUserById(userId);
        if (!user) throw new Error('User not found');
        if (user.role === 'super_admin') {
            throw new Error('Cannot delete super admin user');
        }
        await db.deleteUser(userId);
        LOG.success(`Admin deleted user ${userId}`);
        return { success: true };
    }

    /**
     * Add user-vendor mapping
     */
    async addUserVendorMapping(userId, vendorId) {
        const user = await db.getUserById(userId);
        if (!user) throw new Error('User not found');
        const vendor = await db.getVendorById(vendorId);
        if (!vendor) throw new Error('Vendor not found');
        const mapping = await db.addUserVendorMapping(userId, vendorId);
        return { success: true, mapping };
    }

    /**
     * Remove user-vendor mapping
     */
    async removeUserVendorMapping(userId, vendorId) {
        await db.removeUserVendorMapping(userId, vendorId);
        return { success: true };
    }

    /**
     * Get mapped vendors for a user
     */
    async getMappedVendorsForUser(userId) {
        return await db.getMappedVendorsForUser(userId);
    }
}

module.exports = new AdminService();

