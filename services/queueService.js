const db = require('../database');
const LOG = require('../utils/logger');

/**
 * Queue Service
 * Handles queue management business logic
 */
class QueueService {
    /**
     * Join queue for a vendor
     */
    async joinQueue(userId, vendorId, io) {
        // Parallelize checks
        const [vendor, existing] = await Promise.all([
            db.getVendorById(vendorId),
            db.getQueueByVendor(vendorId)
        ]);

        if (vendor && vendor.owner_id === userId) {
            throw new Error("You cannot join the queue of your own shop.");
        }

        const alreadyIn = existing.some(q => q.user_id === userId);
        if (alreadyIn) {
            return { success: true, alreadyIn: true };
        }

        // Add to queue
        await db.addQueueItem({
            vendor_id: vendorId,
            user_id: userId,
            status: "waiting",
            joined_at: new Date()
        });

        // Update socket room in background
        db.getQueueByVendor(vendorId).then(updatedQueue => {
            io.to(`vendor_${vendorId}`).emit('queue_updated', updatedQueue);
        }).catch(e => LOG.error("Background queue update failed", e.message));

        LOG.success(`User ${userId} joined queue ${vendorId}`);
        return { success: true };
    }

    /**
     * Leave queue
     */
    async leaveQueue(userId, vendorId, io) {
        const removed = await db.removeQueueItem(userId, vendorId);

        if (removed) {
            // Update socket room in background
            db.getQueueByVendor(vendorId).then(updatedQueue => {
                io.to(`vendor_${vendorId}`).emit('queue_updated', updatedQueue);
            }).catch(e => LOG.error("Background queue update failed", e.message));
            LOG.success(`User ${userId} left queue ${vendorId}`);
        }

        return { success: true, removed };
    }

    /**
     * Delete queue item (vendor action)
     */
    async deleteQueueItem(queueId, vendorId, io) {
        await db.deleteQueueItemById(queueId);

        if (vendorId) {
            const updatedQueue = await db.getQueueByVendor(vendorId);
            io.to(`vendor_${vendorId}`).emit('queue_updated', updatedQueue);
        }

        return { success: true };
    }

    /**
     * Update queue status
     */
    async updateStatus(queueId, status, io) {
        const vId = await db.updateQueueStatus(queueId, status);
        
        if (vId) {
            const updatedQueue = await db.getQueueByVendor(vId);
            io.to(`vendor_${vId}`).emit('queue_updated', updatedQueue);
        }

        return { success: true };
    }
}

module.exports = new QueueService();

