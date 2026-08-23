const db = require('../database');
const LOG = require('../utils/logger');

const ALLOWED_FULFILLMENT = new Set([
    'received',
    'preparing',
    'ready',
    'out_for_delivery',
    'delivered',
    'cancelled',
]);

/**
 * Order Service
 * Handles order-related business logic + fulfillment tracking
 */
class OrderService {
    async createOrder(userId, orderData) {
        const { vendor_id, items, total_amount, payment_gateway, payment_ref } = orderData;

        if (!vendor_id || !Array.isArray(items) || !items.length) {
            throw new Error("vendor_id and items are required");
        }

        const vendor = await db.getVendorById(vendor_id);
        if (!vendor) {
            throw new Error("Vendor not found");
        }

        if (vendor.features_payments === false) {
            throw new Error("Payments are disabled for this vendor");
        }

        const order = {
            vendor_id,
            user_id: userId,
            total_amount: Number(total_amount || 0),
            payment_gateway: payment_gateway || 'unknown',
            payment_ref: payment_ref || '',
            status: 'paid',
            fulfillment_status: 'received',
            current_location: 'Shop counter',
            location_updated_at: new Date(),
            items_json: JSON.stringify(items),
            created_at: new Date()
        };

        const saved = await db.addOrder(order);
        LOG.success(`Order created for vendor ${vendor_id} by user ${userId}`);
        return { success: true, order: saved };
    }

    async getVendorOrders(userId) {
        return await db.getOrdersByVendorOwner(userId) || [];
    }

    async getUserOrders(userId) {
        return await db.getOrdersByUser(userId) || [];
    }

    /**
     * Vendor updates fulfillment status and/or current product location
     */
    async updateTracking(userId, orderId, { fulfillment_status, current_location } = {}) {
        const order = await db.getOrderById(orderId);
        if (!order) throw new Error('Order not found');

        const vendor = await db.getVendorById(order.vendor_id);
        if (!vendor || String(vendor.owner_id) !== String(userId)) {
            throw new Error('Not allowed to update this order');
        }

        if (fulfillment_status != null && !ALLOWED_FULFILLMENT.has(String(fulfillment_status))) {
            throw new Error('Invalid fulfillment status');
        }

        const updated = await db.updateOrderTracking(orderId, {
            fulfillment_status,
            current_location,
        });

        return {
            success: true,
            order: updated,
            statusChanged: fulfillment_status != null && fulfillment_status !== order.fulfillment_status,
            locationChanged: current_location != null && current_location !== order.current_location,
            previous: {
                fulfillment_status: order.fulfillment_status,
                current_location: order.current_location,
            },
        };
    }
}

module.exports = new OrderService();
