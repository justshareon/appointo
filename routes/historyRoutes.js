const express = require('express');
const router = express.Router();
const historyService = require('../services/historyService');
const { authenticateToken } = require('../middleware/auth');
const LOG = require('../utils/logger');

/**
 * GET /api/history/user
 * Get user history
 */
router.get('/user', authenticateToken, async (req, res) => {
    try {
        const history = await historyService.getUserHistory(req.user.id);
        res.json(history);
    } catch (err) {
        LOG.error("Failed to fetch user history", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/history/vendor
 * Get vendor history
 */
router.get('/vendor', authenticateToken, async (req, res) => {
    try {
        const history = await historyService.getVendorHistory(req.user.id);
        res.json(history);
    } catch (err) {
        LOG.error("Failed to fetch vendor history", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

