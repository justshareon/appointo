const express = require('express');
const router = express.Router();
const appointmentService = require('../services/appointmentService');
const notificationService = require('../services/notificationService');
const { authenticateToken } = require('../middleware/auth');
const LOG = require('../utils/logger');

let io = null;
router.setIO = (socketIo) => {
    io = socketIo;
};

async function broadcastAppointmentChange(vendorId, userId) {
    if (!io) return;
    try {
        const db = require('../database');
        if (vendorId && typeof db.getQueueByVendor === 'function') {
            const updatedQueue = await db.getQueueByVendor(vendorId);
            io.to(`vendor_${vendorId}`).emit('queue_updated', updatedQueue);
            io.to(`vendor_${vendorId}`).emit('appointments_updated');
        }
        io.emit('appointments_updated');
        if (userId) {
            io.to(`user_${userId}`).emit('appointments_updated');
            io.to(`user_${userId}`).emit('queue_updated');
        }
    } catch (err) {
        LOG.error('Appointment socket broadcast failed', err.message);
    }
}

/**
 * GET /api/appointments/me
 * Get appointments for logged-in user
 */
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const appointments = await appointmentService.getMyAppointments(req.user.id);
        res.json(appointments);
    } catch (err) {
        LOG.error("Failed to fetch appointments", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/appointments/shop/:vendorId
 * Shop appointments for the vendor dashboard (uses appointments feature DB).
 */
router.get('/shop/:vendorId', authenticateToken, async (req, res) => {
    try {
        const vendorId = req.params.vendorId;
        const appointments = await appointmentService.getByVendor(vendorId, req.user.id);
        LOG.info(`[Appointments] Shop ${vendorId} returned ${appointments.length} rows for user ${req.user.id}`);
        res.json(appointments || []);
    } catch (err) {
        LOG.error("Failed to fetch shop appointments", err.message);
        res.status(500).json({ error: err.message });
    }
});

router.get('/mine-shop', authenticateToken, async (req, res) => {
    try {
        const db = require('../database');
        const vendor = await db.getVendorByOwnerId(req.user.id);
        const vendorId = vendor?.id;
        const appointments = await appointmentService.getByVendor(vendorId, req.user.id);
        LOG.info(`[Appointments] mine-shop vendor=${vendorId} count=${appointments.length}`);
        res.json(appointments || []);
    } catch (err) {
        LOG.error("Failed to fetch mine-shop appointments", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/appointments/book
 * Book appointment
 */
router.post('/book', authenticateToken, async (req, res) => {
    try {
        const result = await appointmentService.bookAppointment(req.user.id, req.body);
        notificationService.notify('appointment_booked', {
            userId: req.user.id,
            vendorId: req.body.vendor_id,
            date: req.body.date,
            time: req.body.time
        }).catch(err => LOG.error('Appointment notification failed', err.message));
        await broadcastAppointmentChange(req.body.vendor_id, req.user.id);
        res.json(result);
    } catch (err) {
        LOG.error("Failed to book appointment", err.message);
        const statusCode = err.message.includes('cannot book') ? 403 : 500;
        res.status(statusCode).json({ error: err.message });
    }
});

/**
 * POST /api/appointments/book-for-user
 * Shop owner creates an appointment for a customer (one-tap from chat / queue).
 */
router.post('/book-for-user', authenticateToken, async (req, res) => {
    try {
        const result = await appointmentService.bookForCustomer(req.user.id, req.body);
        const customerId = result.user_id || req.body.user_id || req.body.customer_id;
        notificationService.notify('appointment_booked', {
            userId: customerId,
            vendorId: req.body.vendor_id,
            date: req.body.date,
            time: req.body.time,
            bookedByVendor: true,
        }).catch(err => LOG.error('Appointment notification failed', err.message));
        await broadcastAppointmentChange(req.body.vendor_id, customerId);
        res.json(result);
    } catch (err) {
        LOG.error("Failed to book appointment for user", err.message);
        const msg = err.message || '';
        const statusCode =
            msg.includes('Only the shop owner') || msg.includes('required') || msg.includes('not found')
                ? (msg.includes('Only the shop owner') ? 403 : 400)
                : 500;
        res.status(statusCode).json({ error: err.message });
    }
});

/**
 * POST /api/appointments/delete
 * Delete appointment
 */
router.post('/delete', authenticateToken, async (req, res) => {
    try {
        const result = await appointmentService.deleteAppointment(req.body.appointment_id);
            notificationService.notify('appointment_deleted', {
                appointmentId: req.body.appointment_id,
                userId: req.user.id
            }).catch(err => LOG.error('Appointment delete notification failed', err.message));
        res.json(result);
    } catch (err) {
        LOG.error("Failed to delete appointment", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/appointments/update-status
 * Update appointment status
 */
router.post('/update-status', authenticateToken, async (req, res) => {
    try {
        const result = await appointmentService.updateStatus(req.body.appointment_id, req.body.status);
        const vendorId = result?.vendorId;
        const customerId = result?.userId;
        notificationService.notify('appointment_status_updated', {
            appointmentId: req.body.appointment_id,
            status: req.body.status,
            userId: customerId || req.user.id,
            vendorId,
            targetUserId: req.user.id
        }).catch(err => LOG.error('Appointment status notification failed', err.message));
        await broadcastAppointmentChange(vendorId, customerId);
        res.json(result);
    } catch (err) {
        LOG.error("Failed to update appointment status", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

