const express = require('express');
const router = express.Router();
const historyService = require('../services/historyService');
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

module.exports = router;

