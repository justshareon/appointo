const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const notificationService = require('../services/notificationService');
const { authenticateToken } = require('../middleware/auth');
const LOG = require('../utils/logger');

/**
 * POST /api/orders/create
 */
router.post('/create', authenticateToken, async (req, res) => {
    try {
        const result = await orderService.createOrder(req.user.id, req.body);
        notificationService.notify('order_created', {
            userId: req.user.id,
            vendorId: req.body.vendor_id,
            orderId: result?.order?.id,
            totalAmount: req.body.total_amount,
            itemsCount: Array.isArray(req.body.items) ? req.body.items.length : 0,
            paymentGateway: req.body.payment_gateway,
            fulfillmentStatus: 'received',
            currentLocation: 'Shop counter',
        }).catch(err => LOG.error('Order notification failed', err.message));

        notificationService.notify('order_received', {
            userId: req.user.id,
            vendorId: req.body.vendor_id,
            orderId: result?.order?.id,
            currentLocation: 'Shop counter',
        }).catch(err => LOG.error('Order received notification failed', err.message));

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

/**
 * POST /api/orders/:id/tracking
 * Vendor updates fulfillment status and/or location
 */
router.post('/:id/tracking', authenticateToken, async (req, res) => {
    try {
        const result = await orderService.updateTracking(req.user.id, req.params.id, {
            fulfillment_status: req.body.fulfillment_status,
            current_location: req.body.current_location,
        });

        const order = result.order || {};
        if (result.statusChanged) {
            notificationService.notify('order_status_updated', {
                userId: order.user_id,
                vendorId: order.vendor_id,
                orderId: order.id,
                status: order.fulfillment_status,
                currentLocation: order.current_location,
            }).catch(err => LOG.error('Order status notify failed', err.message));
        }
        if (result.locationChanged) {
            notificationService.notify('order_location_updated', {
                userId: order.user_id,
                vendorId: order.vendor_id,
                orderId: order.id,
                status: order.fulfillment_status,
                currentLocation: order.current_location,
            }).catch(err => LOG.error('Order location notify failed', err.message));
        }

        res.json(result);
    } catch (err) {
        LOG.error('Failed to update order tracking', err.message);
        const statusCode = err.message.includes('not found') ? 404 :
                          err.message.includes('Not allowed') ? 403 :
                          err.message.includes('Invalid') ? 400 : 500;
        res.status(statusCode).json({ error: err.message });
    }
});

module.exports = router;
