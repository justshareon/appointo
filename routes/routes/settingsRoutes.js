const express = require('express');
const router = express.Router();
const settingsService = require('../services/settingsService');
const { authenticateToken } = require('../middleware/auth');
const LOG = require('../utils/logger');

/**
 * GET /api/settings
 * Get system settings
 */
router.get('/', async (req, res) => {
    try {
        const settings = await settingsService.getSettings();
        res.json(settings);
    } catch (err) {
        LOG.error("Failed to fetch settings", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/settings
 * Update system settings (requires authentication and super_admin role)
 * Socket.IO instance will be set via setIO() method
 */
let socketIO = null;

router.setIO = (io) => {
    socketIO = io;
};

router.post('/', authenticateToken, async (req, res) => {
    if (req.user.role !== 'super_admin') return res.sendStatus(403);
    try {
        const result = await settingsService.updateSettings(req.body);
        // Broadcast settings update to all connected clients
        if (socketIO) {
            socketIO.emit('settings_updated', result);
        }
        res.json(result);
    } catch (err) {
        LOG.error("Failed to update settings", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

