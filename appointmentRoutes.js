const express = require('express');
const router = express.Router();
const appointmentService = require('../services/appointmentService');
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
        res.json(result);
    } catch (err) {
        LOG.error("Failed to update appointment status", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

