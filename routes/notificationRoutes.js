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
        const scope = String(req.query.scope || 'all');
        const items = await db.getNotificationsByUser(req.user.id, limit);
        const today = new Date().toISOString().slice(0, 10);
        const filtered = scope === 'today'
            ? items.filter((n) => String(n.created_at || '').slice(0, 10) === today)
            : items;
        res.json(filtered);
    } catch (err) {
        LOG.error("Failed to fetch notifications", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/notifications/summary — module-wise counts for header bell
 */
router.get('/summary', authenticateToken, async (req, res) => {
    try {
        const items = await db.getNotificationsByUser(req.user.id, 200);
        const today = new Date().toISOString().slice(0, 10);
        const byModule = {};
        items.forEach((n) => {
            let mod = 'system';
            try {
                const data = typeof n.data_json === 'string' ? JSON.parse(n.data_json || '{}') : (n.data_json || {});
                mod = data.module || (String(n.type || '').startsWith('r_detector') ? 'r_detector' : null)
                    || (String(n.type || '').startsWith('suraksha') ? 'suraksha' : null)
                    || n.type?.split('_')[0] || 'system';
            } catch (_) {
                mod = n.type || 'system';
            }
            if (!byModule[mod]) {
                byModule[mod] = { module: mod, unread: 0, total: 0, today: 0 };
            }
            byModule[mod].total += 1;
            if (!n.is_read) byModule[mod].unread += 1;
            if (String(n.created_at || '').slice(0, 10) === today) byModule[mod].today += 1;
        });
        const todayItems = items.filter((n) => String(n.created_at || '').slice(0, 10) === today);
        res.json({
            summary: Object.values(byModule).sort((a, b) => b.unread - a.unread),
            unreadTotal: items.filter((i) => !i.is_read).length,
            todayCount: todayItems.length,
            today: todayItems.slice(0, 20),
        });
    } catch (err) {
        LOG.error('Failed to fetch notification summary', err.message);
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

