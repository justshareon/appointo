const db = require('../database');
const LOG = require('../utils/logger');

/**
 * History Service
 * Handles history-related business logic
 */
class HistoryService {
    /**
     * Get user history
     */
    async getUserHistory(userId) {
        const [queueRows, appointmentRows] = await Promise.all([
            Promise.resolve().then(() => db.getUserHistory(userId)).catch(() => []),
            Promise.resolve().then(() => db.getAppointmentsByUser ? db.getAppointmentsByUser(userId) : []).catch(() => []),
        ]);
        const queues = Array.isArray(queueRows) ? queueRows : [];
        const appointments = Array.isArray(appointmentRows) ? appointmentRows : [];
        const visits = queues.map((q) => ({
            ...q,
            id: q.id != null ? `q-${q.id}` : `q-${q.vendor_id}-${q.joined_at}`,
            shop_name: q.shop_name || 'Shop',
            joined_at: q.joined_at,
            status: q.status,
            source: 'queue',
        }));
        for (const a of appointments) {
            visits.push({
                id: a.id != null ? `a-${a.id}` : `a-${a.vendor_id}-${a.date}-${a.time}`,
                vendor_id: a.vendor_id,
                shop_name: a.shop_name || 'Shop',
                joined_at: a.created_at || (a.date ? `${a.date} ${a.time || ''}`.trim() : null),
                status: a.status,
                source: 'appointment',
            });
        }
        visits.sort((a, b) => new Date(b.joined_at || 0).getTime() - new Date(a.joined_at || 0).getTime());
        return visits;
    }

    /**
     * Get vendor history
     */
    async getVendorHistory(userId) {
        const vendor = await db.getVendorByOwnerId(userId);
        if (!vendor) return [];
        return await db.getVendorHistory(vendor.id) || [];
    }

    /**
     * Get activities
     */
    async getActivities() {
        return await db.getActivities() || [];
    }

    /**
     * Create activity
     */
    async createActivity(activityData) {
        return await db.createActivity(activityData);
    }
}

module.exports = new HistoryService();

