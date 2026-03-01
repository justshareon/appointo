const express = require('express');
const queueService = require('../services/queueService');
const { authenticateToken } = require('../middleware/auth');
const LOG = require('../utils/logger');

/**
 * Create queue routes with io instance
 */
const createQueueRoutes = (io) => {
    const router = express.Router();

    /**
     * POST /api/queue/join
     * Join queue for a vendor
     */
    router.post('/join', authenticateToken, async (req, res) => {
        try {
            const result = await queueService.joinQueue(req.user.id, req.body.vendor_id, io);
            res.json(result);
        } catch (err) {
            LOG.error("Failed to join queue", err.message);
            const statusCode = err.message.includes('cannot join') ? 403 : 500;
            res.status(statusCode).json({ error: err.message });
        }
    });

    /**
     * POST /api/queue/leave
     * Leave queue
     */
    router.post('/leave', authenticateToken, async (req, res) => {
        try {
            const result = await queueService.leaveQueue(req.user.id, req.body.vendor_id, io);
            res.json(result);
        } catch (err) {
            LOG.error("Failed to leave queue", err.message);
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /api/queue/delete
     * Delete queue item
     */
    router.post('/delete', authenticateToken, async (req, res) => {
        try {
            const result = await queueService.deleteQueueItem(req.body.queue_id, req.body.vendor_id, io);
            res.json(result);
        } catch (err) {
            LOG.error("Failed to delete queue item", err.message);
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /api/queue/update-status
     * Update queue status
     */
    router.post('/update-status', authenticateToken, async (req, res) => {
        try {
            const result = await queueService.updateStatus(req.body.queue_id, req.body.status, io);
            res.json(result);
        } catch (err) {
            LOG.error("Failed to update status", err.message);
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};

module.exports = createQueueRoutes;

