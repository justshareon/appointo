const db = require('../database');
const LOG = require('../utils/logger');

/**
 * Appointment Service
 * Handles appointment-related business logic
 */
class AppointmentService {
    /**
     * Get appointments for user
     */
    async getMyAppointments(userId) {
        return await db.getAppointmentsByUser(userId) || [];
    }

    async getByVendor(vendorId, ownerId) {
        if (!vendorId && !ownerId) return [];
        let id = vendorId;
        if (!id && ownerId) {
            const vendor = await db.getVendorByOwnerId(ownerId);
            id = vendor?.id;
        }
        if (!id) return [];
        return await db.getAppointmentsByVendor(id) || [];
    }

    /**
     * Book appointment (customer self-book)
     */
    async bookAppointment(userId, appointmentData) {
        const { vendor_id } = appointmentData;

        // Check ownership: Vendor cannot book appointment with their own shop
        const vendor = await db.getVendorById(vendor_id);
        if (vendor && vendor.owner_id === userId) {
            throw new Error("You cannot book an appointment with your own shop.");
        }

        await db.addAppointment({
            vendor_id,
            user_id: userId,
            date: appointmentData.date,
            time: appointmentData.time,
            status: 'pending',
            notes: appointmentData.notes || appointmentData.service_name || null,
            created_at: new Date()
        });

        // Link user → vendor so products appear on Home / Cart
        try {
            await db.addUserVendorMapping(userId, vendor_id);
        } catch (e) {
            LOG.warning(`[Appointment] mapping skip for ${userId}→${vendor_id}: ${e.message}`);
        }

        return { success: true };
    }

    /**
     * Vendor (shop owner) books an appointment for a customer in one step.
     */
    async bookForCustomer(ownerId, data = {}) {
        const vendorId = data.vendor_id;
        const customerId = data.user_id || data.customer_id;
        const date = data.date;
        const time = data.time;

        if (!vendorId || !customerId || !date || !time) {
            throw new Error('vendor_id, user_id, date and time are required');
        }

        const vendor = await db.getVendorById(vendorId);
        if (!vendor) throw new Error('Vendor not found');
        if (String(vendor.owner_id) !== String(ownerId)) {
            throw new Error('Only the shop owner can book for customers');
        }

        const customer = await db.getUserById(customerId);
        if (!customer) throw new Error('Customer not found');

        const notes =
            data.notes ||
            data.service_name ||
            `Booked by shop for ${customer.name || 'customer'}`;

        await db.addAppointment({
            vendor_id: vendorId,
            user_id: customerId,
            date,
            time,
            status: 'pending',
            notes,
            created_at: new Date()
        });

        try {
            await db.addUserVendorMapping(customerId, vendorId);
        } catch (e) {
            LOG.warning(`[Appointment] mapping skip for ${customerId}→${vendorId}: ${e.message}`);
        }

        // Seed chat so vendor can keep talking to this customer
        try {
            if (typeof db.addChatMessage === 'function') {
                await db.addChatMessage({
                    vendor_id: vendorId,
                    user_id: customerId,
                    sender_id: ownerId,
                    sender_role: 'vendor',
                    body: `Appointment booked for you: ${date} at ${time}. Reply here if you need to change it.`,
                });
            }
        } catch (e) {
            LOG.warning(`[Appointment] chat seed skip: ${e.message}`);
        }

        return {
            success: true,
            vendor_id: vendorId,
            user_id: customerId,
            date,
            time,
            shop_name: vendor.shop_name,
            user_name: customer.name,
        };
    }

    /**
     * Delete appointment
     */
    async deleteAppointment(appointmentId) {
        await db.deleteAppointmentById(appointmentId);
        return { success: true };
    }

    /**
     * Update appointment status
     */
    async updateStatus(appointmentId, status) {
        const result = await db.updateAppointmentStatus(appointmentId, status);
        if (result && typeof result === 'object') return { success: true, ...result };
        return { success: !!result };
    }
}

module.exports = new AppointmentService();

