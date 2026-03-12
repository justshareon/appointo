const express = require('express');
const router = express.Router();
const appointmentService = require('../services/appointmentService');
const notificationService = require('../services/notificationService');
const { authenticateToken } = require('../middleware/auth');
const LOG = require('../utils/logger');

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
        res.json(result);
    } catch (err) {
        LOG.error("Failed to book appointment", err.message);
        const statusCode = err.message.includes('cannot book') ? 403 : 500;
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
            notificationService.notify('appointment_status_updated', {
                appointmentId: req.body.appointment_id,
                status: req.body.status,
                userId: req.user.id
            }).catch(err => LOG.error('Appointment status notification failed', err.message));
        res.json(result);
    } catch (err) {
        LOG.error("Failed to update appointment status", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

