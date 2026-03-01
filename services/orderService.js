const db = require('../database');
const LOG = require('../utils/logger');

/**
 * Order Service
 * Handles order-related business logic
 */
class OrderService {
    /**
     * Create order
     */
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
            items_json: JSON.stringify(items),
            created_at: new Date()
        };

        await db.addOrder(order);
        return { success: true };
    }

    /**
     * Get orders for vendor
     */
    async getVendorOrders(userId) {
        return await db.getOrdersByVendorOwner(userId) || [];
    }

    /**
     * Get orders for user
     */
    async getUserOrders(userId) {
        return await db.getOrdersByUser(userId) || [];
    }
}

module.exports = new OrderService();

