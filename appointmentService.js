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

    /**
     * Book appointment
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
            created_at: new Date()
        });

        return { success: true };
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
        await db.updateAppointmentStatus(appointmentId, status);
        return { success: true };
    }
}

module.exports = new AppointmentService();

