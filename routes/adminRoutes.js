const express = require('express');
const router = express.Router();
const adminService = require('../services/adminService');
const { authenticateToken } = require('../middleware/auth');
const LOG = require('../utils/logger');

/**
 * Middleware to check super admin access
 */
const requireSuperAdmin = (req, res, next) => {
    if (!adminService.isSuperAdmin(req.user)) {
        return res.sendStatus(403);
    }
    next();
};

/**
 * GET /api/admin/vendors
 * Get all vendors (admin view)
 */
router.get('/vendors', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
        const vendors = await adminService.getVendors(req.query);
        res.json(vendors);
    } catch (err) {
        LOG.error("Admin fetch vendors failed", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/admin/update-vendor
 * Update vendor field
 */
router.post('/update-vendor', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
        const result = await adminService.updateVendor(req.body.vendorId, req.body.field, req.body.value);
        res.json(result);
    } catch (err) {
        LOG.error("Admin update vendor failed", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/admin/add-vendor
 * Add vendor
 */
router.post('/add-vendor', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
        const result = await adminService.addVendor(req.body);
        res.json(result);
    } catch (err) {
        LOG.error('Failed to add vendor', err.message);
        const statusCode = err.message.includes('required') ? 400 : 500;
        res.status(statusCode).json({ error: err.message });
    }
});

/**
 * GET /api/admin/vendor-dashboard/:vendorId
 * Get vendor dashboard data
 */
router.get('/vendor-dashboard/:vendorId', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
        const result = await adminService.getVendorDashboard(req.params.vendorId);
        res.json(result);
    } catch (err) {
        LOG.error("Admin fetch vendor dashboard failed", err.message);
        const statusCode = err.message.includes('not found') ? 404 : 500;
        res.status(statusCode).json({ error: err.message });
    }
});

module.exports = router;

