const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');
const LOG = require('../utils/logger');

/**
 * GET /api/notifications
 * Get notifications for logged-in user
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        const limit = req.query.limit || 50;
        const items = await db.getNotificationsByUser(req.user.id, limit);
        res.json(items);
    } catch (err) {
        LOG.error("Failed to fetch notifications", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/notifications/:id/read
 * Mark notification as read
 */
router.post('/:id/read', authenticateToken, async (req, res) => {
    try {
        const result = await db.markNotificationRead(req.params.id, req.user.id);
        res.json(result);
    } catch (err) {
        LOG.error("Failed to mark notification read", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/notifications/:id
 * Delete notification
 */
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const result = await db.deleteNotification(req.params.id, req.user.id);
        res.json(result);
    } catch (err) {
        LOG.error("Failed to delete notification", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

