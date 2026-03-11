const express = require('express');
const router = express.Router();
const historyService = require('../services/historyService');
const { authenticateToken } = require('../middleware/auth');
const LOG = require('../utils/logger');

/**
 * GET /api/activities
 * Get activities (public endpoint)
 */
router.get('/activities', async (req, res) => {
    try {
        const activities = await historyService.getActivities();
        res.json(activities);
    } catch (err) {
        LOG.error("Failed to fetch activities", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/activities
 * Create a new activity (requires authentication)
 */
router.post('/activities', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id || req.userId;
        const { type, user_name, message, metadata } = req.body;
        
        if (!type || !message) {
            return res.status(400).json({ error: 'Type and message are required' });
        }
        
        const activityData = {
            type,
            user_id: userId,
            user_name: user_name || req.user?.name || req.user?.email || 'Anonymous',
            message,
            metadata: metadata || {}
        };
        
        const activity = await historyService.createActivity(activityData);
        res.json({ success: true, activity });
    } catch (err) {
        LOG.error("Failed to create activity", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

