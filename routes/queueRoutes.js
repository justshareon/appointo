const express = require('express');
const queueService = require('../services/queueService');
const notificationService = require('../services/notificationService');
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
            if (!result?.alreadyIn) {
                notificationService.notify('queue_joined', {
                    userId: req.user.id,
                    vendorId: req.body.vendor_id
                }).catch(err => LOG.error('Queue notification failed', err.message));
            }
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
            if (result?.removed) {
                notificationService.notify('queue_left', {
                    userId: req.user.id,
                    vendorId: req.body.vendor_id
                }).catch(err => LOG.error('Queue leave notification failed', err.message));
            }
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
            notificationService.notify('queue_deleted', {
                queueId: req.body.queue_id,
                userId: req.user.id,
                vendorId: req.body.vendor_id
            }).catch(err => LOG.error('Queue delete notification failed', err.message));
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
            notificationService.notify('queue_status_updated', {
                queueId: req.body.queue_id,
                status: req.body.status,
                userId: req.user.id,
                vendorId: result?.vendorId || req.body.vendor_id
            }).catch(err => LOG.error('Queue status notification failed', err.message));
            res.json(result);
        } catch (err) {
            LOG.error("Failed to update status", err.message);
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};

module.exports = createQueueRoutes;

