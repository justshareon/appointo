/**
 * Admin Controller
 * Handles admin-related HTTP requests
 */
const adminService = require('../../services/adminService');
const LOG = require('../../utils/logger');
const notificationService = require('../../services/notificationService');

class AdminController {
    /**
     * Check if user is super admin
     */
    checkSuperAdmin(req, res, next) {
        if (!adminService.isSuperAdmin(req.user)) {
            return res.status(403).json({ error: 'Forbidden: Super admin access required' });
        }
        next();
    }

    /**
     * GET /api/admin/vendors
     * Get all vendors (admin view with pagination)
     */
    async getVendors(req, res) {
        try {
            if (!adminService.isSuperAdmin(req.user)) {
                return res.status(403).json({ error: 'Forbidden: Super admin access required' });
            }

            const vendors = await adminService.getVendors(req.query);
            res.json(vendors);
        } catch (err) {
            LOG.error("Admin fetch vendors failed", err.message);
            res.status(500).json({ error: err.message });
        }
    }

    /**
     * POST /api/admin/update-vendor
     * Update vendor field
     */
    async updateVendor(req, res) {
        try {
            if (!adminService.isSuperAdmin(req.user)) {
                return res.status(403).json({ error: 'Forbidden: Super admin access required' });
            }

            const { vendorId, field, value } = req.body;
            if (!vendorId || !field) {
                return res.status(400).json({ error: 'vendorId and field are required' });
            }

            const result = await adminService.updateVendor(vendorId, field, value);
            notificationService.notify('vendor_updated', {
                userId: req.user?.id || req.user?.email,
                vendorId
            }).catch(err => LOG.error('Admin vendor update notification failed', err.message));
            res.json(result);
        } catch (err) {
            LOG.error("Admin update vendor failed", err.message);
            res.status(500).json({ error: err.message });
        }
    }

    /**
     * POST /api/admin/add-vendor
     * Add new vendor
     */
    async addVendor(req, res) {
        try {
            if (!adminService.isSuperAdmin(req.user)) {
                return res.status(403).json({ error: 'Forbidden: Super admin access required' });
            }

            const result = await adminService.addVendor(req.body);
            notificationService.notify('vendor_created', {
                userId: req.user?.id || req.user?.email,
                vendorId: result?.vendor_id || result?.id
            }).catch(err => LOG.error('Admin vendor create notification failed', err.message));
            res.json(result);
        } catch (err) {
            LOG.error("Admin add vendor failed", err.message);
            const statusCode = err.message.includes('required') ? 400 : 500;
            res.status(statusCode).json({ error: err.message });
        }
    }

    /**
     * GET /api/admin/vendor-dashboard/:vendorId
     * Get vendor dashboard data
     * Allows: Super admins (any vendor) OR vendors accessing their own dashboard
     */
    async getVendorDashboard(req, res) {
        try {
            const { vendorId } = req.params;
            const user = req.user;
            
            // Check if user is super admin
            const isSuperAdmin = adminService.isSuperAdmin(user);
            
            if (!isSuperAdmin) {
                // For non-super admins, check if they own this vendor
                // Use adminService to get vendor (avoids direct database import)
                const vendor = await adminService.getVendorById(vendorId);
                
                if (!vendor) {
                    return res.status(404).json({ error: 'Vendor not found' });
                }
                
                // Check if user is the owner of this vendor
                const userId = user.id || user.user_id || '';
                const isOwner = vendor.owner_id === userId;
                
                // Also check pattern matching for service-based vendors (trust, cyber, etc.)
                // This handles cases where vendor ID matches user pattern (e.g., v_trust1 for usr_trustvendor1)
                const userEmail = user.email || '';
                const vendorIdLower = vendorId.toLowerCase();
                const userIdLower = userId.toLowerCase();
                const userEmailLower = userEmail.toLowerCase();
                
                // Pattern matching: if vendorId contains part of userId or email (e.g., v_trust1 for trust1/trustvendor1 user)
                const userIdWithoutPrefix = userIdLower.replace('usr_', '');
                const userEmailPrefix = userEmailLower.split('@')[0];
                const patternMatch = 
                    vendorIdLower.includes(userIdWithoutPrefix) ||
                    vendorIdLower.includes(userEmailPrefix) ||
                    (vendorIdLower === `v_${userIdWithoutPrefix}`) ||
                    (vendorIdLower === `v_${userEmailPrefix}`) ||
                    (userIdWithoutPrefix.includes('trust') && vendorIdLower.includes('trust')) ||
                    (userEmailPrefix.includes('trust') && vendorIdLower.includes('trust')) ||
                    (userIdWithoutPrefix.includes('trade') && vendorIdLower.includes('trade')) ||
                    (userEmailPrefix.includes('trade') && vendorIdLower.includes('trade')) ||
                    (userIdWithoutPrefix.includes('cyber') && vendorIdLower.includes('cyber')) ||
                    (userEmailPrefix.includes('cyber') && vendorIdLower.includes('cyber'));
                
                if (!isOwner && !patternMatch) {
                    LOG.warn(`[Admin] Access denied for user ${userId} to vendor ${vendorId}. Owner: ${vendor.owner_id}, Pattern match: ${patternMatch}`);
                    return res.status(403).json({ error: 'Forbidden: Super admin access required or access your own vendor dashboard' });
                }
                
                LOG.info(`[Admin] Access granted for user ${userId} to vendor ${vendorId}. Owner: ${vendor.owner_id}, Pattern match: ${patternMatch}`);
            }

            const dashboard = await adminService.getVendorDashboard(vendorId);
            res.json(dashboard);
        } catch (err) {
            LOG.error(`[Admin Controller] Vendor dashboard failed for ${req.params.vendorId}:`, err);
            LOG.error(`[Admin Controller] Error stack:`, err.stack);
            const statusCode = err.message && err.message.includes('not found') ? 404 : 500;
            res.status(statusCode).json({ 
                error: err.message || 'Internal server error',
                vendorId: req.params.vendorId
            });
        }
    }

    /**
     * GET /api/admin/users-with-mappings
     */
    async getUsersWithMappings(req, res) {
        try {
            if (!adminService.isSuperAdmin(req.user)) {
                return res.status(403).json({ error: 'Forbidden: Super admin access required' });
            }
            const data = await adminService.getUsersWithMappings();
            res.json(data);
        } catch (err) {
            LOG.error('Admin get users with mappings failed', err.message);
            res.status(500).json({ error: err.message });
        }
    }

    /**
     * POST /api/admin/users
     */
    async createUser(req, res) {
        try {
            if (!adminService.isSuperAdmin(req.user)) {
                return res.status(403).json({ error: 'Forbidden: Super admin access required' });
            }
            const result = await adminService.createUser(req.body);
            res.json(result);
        } catch (err) {
            LOG.error('Admin create user failed', err.message);
            const statusCode = err.message.includes('required') ? 400 : 500;
            res.status(statusCode).json({ error: err.message });
        }
    }

    /**
     * PUT /api/admin/users/:userId
     */
    async updateUser(req, res) {
        try {
            if (!adminService.isSuperAdmin(req.user)) {
                return res.status(403).json({ error: 'Forbidden: Super admin access required' });
            }
            const result = await adminService.updateUser(req.params.userId, req.body);
            res.json(result);
        } catch (err) {
            LOG.error('Admin update user failed', err.message);
            const statusCode = err.message.includes('not found') ? 404 : 500;
            res.status(statusCode).json({ error: err.message });
        }
    }

    /**
     * DELETE /api/admin/users/:userId
     */
    async deleteUser(req, res) {
        try {
            if (!adminService.isSuperAdmin(req.user)) {
                return res.status(403).json({ error: 'Forbidden: Super admin access required' });
            }
            const result = await adminService.deleteUser(req.params.userId);
            res.json(result);
        } catch (err) {
            LOG.error('Admin delete user failed', err.message);
            const statusCode = err.message.includes('not found') ? 404 : 500;
            res.status(statusCode).json({ error: err.message });
        }
    }

    /**
     * POST /api/admin/user-vendor-mapping
     */
    async addUserVendorMapping(req, res) {
        try {
            if (!adminService.isSuperAdmin(req.user)) {
                return res.status(403).json({ error: 'Forbidden: Super admin access required' });
            }
            const { userId, vendorId } = req.body;
            if (!userId || !vendorId) {
                return res.status(400).json({ error: 'userId and vendorId are required' });
            }
            const result = await adminService.addUserVendorMapping(userId, vendorId);
            res.json(result);
        } catch (err) {
            LOG.error('Admin add mapping failed', err.message);
            const statusCode = err.message.includes('not found') ? 404 : 500;
            res.status(statusCode).json({ error: err.message });
        }
    }

    /**
     * DELETE /api/admin/user-vendor-mapping
     */
    async removeUserVendorMapping(req, res) {
        try {
            if (!adminService.isSuperAdmin(req.user)) {
                return res.status(403).json({ error: 'Forbidden: Super admin access required' });
            }
            const { userId, vendorId } = req.body?.userId ? req.body : req.query;
            if (!userId || !vendorId) {
                return res.status(400).json({ error: 'userId and vendorId are required' });
            }
            const result = await adminService.removeUserVendorMapping(userId, vendorId);
            res.json(result);
        } catch (err) {
            LOG.error('Admin remove mapping failed', err.message);
            res.status(500).json({ error: err.message });
        }
    }
}

module.exports = new AdminController();

