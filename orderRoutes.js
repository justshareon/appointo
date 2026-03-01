const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const { authenticateToken } = require('../middleware/auth');
const LOG = require('../utils/logger');

/**
 * POST /api/orders/create
 * Create order
 */
router.post('/create', authenticateToken, async (req, res) => {
    try {
        const result = await orderService.createOrder(req.user.id, req.body);
        res.json(result);
    } catch (err) {
        LOG.error("Failed to create order", err.message);
        const statusCode = err.message.includes('not found') ? 404 : 
                          err.message.includes('required') ? 400 :
                          err.message.includes('disabled') ? 403 : 500;
        res.status(statusCode).json({ error: err.message });
    }
});

/**
 * GET /api/orders/vendor
 * Get orders for vendor
 */
router.get('/vendor', authenticateToken, async (req, res) => {
    try {
        const orders = await orderService.getVendorOrders(req.user.id);
        res.json(orders);
    } catch (err) {
        LOG.error("Failed to fetch vendor orders", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/orders/user
 * Get orders for user
 */
router.get('/user', authenticateToken, async (req, res) => {
    try {
        const orders = await orderService.getUserOrders(req.user.id);
        res.json(orders);
    } catch (err) {
        LOG.error("Failed to fetch user orders", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

