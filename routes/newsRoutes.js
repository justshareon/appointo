const express = require('express');
const router = express.Router();
const settingsService = require('../services/settingsService');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const LOG = require('../utils/logger');

const isValidEmail = (email) => /\S+@\S+\.\S+/.test(String(email || '').trim());
const isValidPhone = (phone) => /^\+?\d{8,15}$/.test(String(phone || '').trim());

const parseSubscribers = (raw) => {
    if (!raw) return [];
    return String(raw)
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
};

/**
 * POST /api/news/subscribe
 * Add a subscriber email/phone for news updates
 */
router.post('/subscribe', async (req, res) => {
    try {
        const { email, phone } = req.body || {};
        const value = email || phone;
        if (!value || (!isValidEmail(value) && !isValidPhone(value))) {
            return res.status(400).json({ error: 'invalid_email_or_phone' });
        }
        const settings = await settingsService.getSettings();
        const list = parseSubscribers(settings.news_subscribers);
        if (!list.includes(value)) list.push(value);
        await settingsService.updateSettings({ news_subscribers: list.join(',') });
        return res.json({ success: true });
    } catch (err) {
        LOG.error('[News] Subscribe failed', err.message);
        res.status(500).json({ error: err.message || 'subscribe_failed' });
    }
});

/**
 * POST /api/news/cache/clear
 * Clear cached news (super_admin)
 */
router.post('/cache/clear', authenticateToken, async (req, res) => {
    if (req.user.role !== 'super_admin') return res.sendStatus(403);
    try {
        await db.clearNewsCache();
        await settingsService.updateSettings({ news_cache_last_updated: '' });
        return res.json({ success: true });
    } catch (err) {
        LOG.error('[News] Clear cache failed', err.message);
        res.status(500).json({ error: err.message || 'cache_clear_failed' });
    }
});

module.exports = router;

