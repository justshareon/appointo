const db = require('../database');
const LOG = require('../utils/logger');

class ChatService {
    async listThreads(userId, userRole) {
        if (userRole === 'vendor') {
            return await db.getChatThreadsForVendorOwner(userId);
        }
        return await db.getChatThreadsForUser(userId);
    }

    async getMessages(requesterId, requesterRole, { vendorId, userId }) {
        if (!vendorId) throw new Error('vendorId is required');

        const vendor = await db.getVendorById(vendorId);
        if (!vendor) throw new Error('Vendor not found');

        let customerId = userId;
        if (requesterRole === 'vendor' || String(vendor.owner_id) === String(requesterId)) {
            if (!customerId) throw new Error('userId is required for vendor chat');
            if (String(vendor.owner_id) !== String(requesterId) && requesterRole !== 'super_admin') {
                throw new Error('Not allowed');
            }
        } else {
            customerId = requesterId;
        }

        const messages = await db.getChatMessages(customerId, vendorId);
        return {
            vendor_id: vendorId,
            user_id: customerId,
            shop_name: vendor.shop_name,
            retention_days: 10,
            messages,
        };
    }

    async sendMessage(requesterId, requesterRole, { vendorId, userId, body }) {
        if (!vendorId) throw new Error('vendorId is required');
        const text = String(body || '').trim();
        if (!text) throw new Error('Message body is required');

        const vendor = await db.getVendorById(vendorId);
        if (!vendor) throw new Error('Vendor not found');

        const isOwner = String(vendor.owner_id) === String(requesterId);
        let customerId;
        let senderRole;

        if (isOwner || requesterRole === 'vendor') {
            if (!isOwner && requesterRole !== 'super_admin') {
                throw new Error('Not allowed');
            }
            if (!userId) throw new Error('userId is required when vendor sends a message');
            customerId = userId;
            senderRole = 'vendor';
        } else {
            customerId = requesterId;
            senderRole = 'user';
        }

        const saved = await db.addChatMessage({
            user_id: customerId,
            vendor_id: vendorId,
            sender_id: requesterId,
            sender_role: senderRole,
            body: text,
        });

        LOG.success(`[Chat] ${senderRole} ${requesterId} → vendor ${vendorId} / user ${customerId}`);
        return {
            message: saved,
            peer_user_id: customerId,
            peer_owner_id: vendor.owner_id,
            shop_name: vendor.shop_name,
        };
    }

    /**
     * Vendor sends the same message to many customers (or all chat threads).
     * body: { vendorId, body, userIds?: string[], all?: boolean }
     */
    async broadcastMessage(requesterId, requesterRole, { vendorId, userIds, all, body }) {
        if (!vendorId) throw new Error('vendorId is required');
        const text = String(body || '').trim();
        if (!text) throw new Error('Message body is required');

        const vendor = await db.getVendorById(vendorId);
        if (!vendor) throw new Error('Vendor not found');

        const isOwner = String(vendor.owner_id) === String(requesterId);
        if (!isOwner && requesterRole !== 'super_admin') {
            throw new Error('Not allowed');
        }

        let targets = [];
        if (all) {
            const threads = await db.getChatThreadsForVendorOwner(vendor.owner_id);
            targets = (threads || [])
                .filter((t) => String(t.vendor_id) === String(vendorId))
                .map((t) => t.user_id)
                .filter(Boolean);
        } else if (Array.isArray(userIds) && userIds.length) {
            targets = [...new Set(userIds.map((id) => String(id)).filter(Boolean))];
        } else {
            throw new Error('Select at least one customer, or choose Send to all');
        }

        if (!targets.length) {
            throw new Error('No customers to message');
        }

        const results = [];
        for (const customerId of targets) {
            const saved = await db.addChatMessage({
                user_id: customerId,
                vendor_id: vendorId,
                sender_id: requesterId,
                sender_role: 'vendor',
                body: text,
            });
            results.push({
                message: saved,
                peer_user_id: customerId,
                peer_owner_id: vendor.owner_id,
                shop_name: vendor.shop_name,
            });
        }

        LOG.success(`[Chat] broadcast by ${requesterId} → ${results.length} customers @ ${vendorId}`);
        return {
            sent: results.length,
            shop_name: vendor.shop_name,
            results,
        };
    }

    async purgeExpired() {
        return await db.purgeExpiredChatMessages();
    }
}

module.exports = new ChatService();
