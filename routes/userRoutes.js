const express = require('express');
const router = express.Router();
const db = require('../database');
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

module.exports = router;

