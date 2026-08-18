const express = require('express');
const router = express.Router();
const db = require('../database');
const adminService = require('../services/adminService');
const { authenticateToken } = require('../middleware/auth');
const LOG = require('../utils/logger');

// Get all users (for admin/testing purposes)
router.get('/users', async (req, res) => {
    try {
        const users = await db.getUsers();
        LOG.info(`[API /users] Returning ${users.length} users`);
        res.json(users);
    } catch (err) {
        LOG.error("Failed to fetch users", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/users/me/mapped-vendors
 * Returns vendors mapped to the logged-in user
 */
router.get('/users/me/mapped-vendors', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id || req.user?.user_id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Super admin sees all active vendors
        if (adminService.isSuperAdmin(req.user)) {
            const all = await db.getVendors(true, 1, 1000, 'newest', '', true);
            const vendors = Array.isArray(all) ? all : (all.vendors || []);
            return res.json({ vendors, hasMappings: true, isSuperAdmin: true });
        }

        const result = await db.getMappedVendorsForUser(userId);
        res.json(result);
    } catch (err) {
        LOG.error('[API /users/me/mapped-vendors] Failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
