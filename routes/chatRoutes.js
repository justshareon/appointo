const express = require('express');
const router = express.Router();
const chatService = require('../services/chatService');
const notificationService = require('../services/notificationService');
const { authenticateToken } = require('../middleware/auth');
const LOG = require('../utils/logger');

let io = null;
router.setIO = (socketIo) => {
    io = socketIo;
};

/**
 * GET /api/chat/threads
 */
router.get('/threads', authenticateToken, async (req, res) => {
    try {
        const threads = await chatService.listThreads(req.user.id, req.user.role);
        res.json({ threads, retention_days: 10 });
    } catch (err) {
        LOG.error('[Chat] threads failed', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/chat/messages?vendorId=&userId=
 */
router.get('/messages', authenticateToken, async (req, res) => {
    try {
        const result = await chatService.getMessages(req.user.id, req.user.role, {
            vendorId: req.query.vendorId,
            userId: req.query.userId,
        });
        res.json(result);
    } catch (err) {
        LOG.error('[Chat] messages failed', err.message);
        const status = /required|Not allowed|not found/i.test(err.message)
            ? err.message.includes('not found') ? 404 : err.message.includes('Not allowed') ? 403 : 400
            : 500;
        res.status(status).json({ error: err.message });
    }
});

/**
 * POST /api/chat/send
 * body: { vendorId, userId?, body }
 */
router.post('/send', authenticateToken, async (req, res) => {
    try {
        const result = await chatService.sendMessage(req.user.id, req.user.role, req.body || {});
        const msg = result.message;

        const payload = {
            ...msg,
            shop_name: result.shop_name,
        };

        if (io) {
            io.to(`user_${result.peer_user_id}`).emit('chat_message', payload);
            if (result.peer_owner_id) {
                io.to(`user_${result.peer_owner_id}`).emit('chat_message', payload);
            }
            io.to(`vendor_${msg.vendor_id}`).emit('chat_message', payload);
        }

        const notifyTarget =
            String(msg.sender_role) === 'vendor' ? result.peer_user_id : result.peer_owner_id;

        notificationService
            .notify('chat_message', {
                userId: notifyTarget,
                targetUserId: notifyTarget,
                vendorId: msg.vendor_id,
                orderId: msg.id,
                preview: String(msg.body || '').slice(0, 80),
            })
            .catch((e) => LOG.error('[Chat] notify failed', e.message));

        res.json({ success: true, message: msg });
    } catch (err) {
        LOG.error('[Chat] send failed', err.message);
        const status = /required|Not allowed|not found/i.test(err.message)
            ? err.message.includes('not found') ? 404 : err.message.includes('Not allowed') ? 403 : 400
            : 500;
        res.status(status).json({ error: err.message });
    }
});

/**
 * POST /api/chat/broadcast
 * body: { vendorId, body, userIds?: string[], all?: boolean }
 * Vendor (or super admin) sends one message to many customers.
 */
router.post('/broadcast', authenticateToken, async (req, res) => {
    try {
        const result = await chatService.broadcastMessage(req.user.id, req.user.role, req.body || {});

        for (const item of result.results || []) {
            const msg = item.message;
            const payload = { ...msg, shop_name: result.shop_name };
            if (io) {
                io.to(`user_${item.peer_user_id}`).emit('chat_message', payload);
                if (item.peer_owner_id) {
                    io.to(`user_${item.peer_owner_id}`).emit('chat_message', payload);
                }
                io.to(`vendor_${msg.vendor_id}`).emit('chat_message', payload);
            }
            notificationService
                .notify('chat_message', {
                    userId: item.peer_user_id,
                    targetUserId: item.peer_user_id,
                    vendorId: msg.vendor_id,
                    orderId: msg.id,
                    preview: String(msg.body || '').slice(0, 80),
                })
                .catch((e) => LOG.error('[Chat] broadcast notify failed', e.message));
        }

        res.json({ success: true, sent: result.sent, shop_name: result.shop_name });
    } catch (err) {
        LOG.error('[Chat] broadcast failed', err.message);
        const status = /required|Not allowed|not found|Select|No customers/i.test(err.message)
            ? err.message.includes('not found') ? 404 : err.message.includes('Not allowed') ? 403 : 400
            : 500;
        res.status(status).json({ error: err.message });
    }
});

module.exports = router;
