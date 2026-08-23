const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const { authenticateToken } = require('../middleware/auth');
const LOG = require('../utils/logger');

/**
 * POST /api/auth/send-otp
 * Send OTP to user's mobile or email
 */
router.post('/send-otp', async (req, res) => {
    try {
        const { mobile, email } = req.body;
        const result = await authService.sendOTP(mobile, email);
        res.json(result);
    } catch (err) {
        LOG.error("Server Error in /send-otp", err.message);
        const statusCode = err.message.includes('not found') ? 404 : 
                          err.message.includes('Invalid') ? 400 : 500;
        res.status(statusCode).json({ error: err.message });
    }
});

/**
 * POST /api/auth/verify-otp
 * Verify OTP and return user token
 */
router.post('/verify-otp', async (req, res) => {
    try {
        const { mobile, email, otp } = req.body;
        const result = await authService.verifyOTP(mobile, email, otp);
        res.json(result);
    } catch (err) {
        LOG.error("Server Error in /verify-otp", err.message);
        const statusCode = err.message.includes('Invalid') ? 401 : 500;
        res.status(statusCode).json({ error: err.message });
    }
});

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post('/register', async (req, res) => {
    try {
        const result = await authService.register(req.body);
        res.json(result);
    } catch (err) {
        LOG.error("Server Error in /register", err.message);
        const statusCode =
            /already registered|required|valid/i.test(err.message) ? 400 : 500;
        res.status(statusCode).json({ error: err.message });
    }
});

/**
 * POST /api/auth/update-role
 * Update user role (requires authentication)
 */
router.post('/update-role', authenticateToken, async (req, res) => {
    try {
        const result = await authService.updateRole(req.user.id, req.body.role);
        res.json(result);
    } catch (err) {
        LOG.error("Server Error in /update-role", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/auth/update-profile
 * Update user profile (requires authentication)
 */
router.post('/update-profile', authenticateToken, async (req, res) => {
    try {
        const result = await authService.updateProfile(req.user.id, req.body);
        res.json(result);
    } catch (err) {
        LOG.error("Server Error in /update-profile", err.message);
        const statusCode = err.message.includes('already registered') ? 400 : 500;
        res.status(statusCode).json({ error: err.message || "Internal server error during profile update." });
    }
});

/**
 * POST /api/auth/logout
 * Logout user (logs the logout event)
 */
router.post('/logout', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const userEmail = req.user?.email;
        const userName = req.user?.name || 'Unknown';
        
        LOG.info(`[LOGOUT] User logout request received - User ID: ${userId}, Email: ${userEmail || 'N/A'}, Name: ${userName}`);
        LOG.info(`[LOGOUT] Logout successful for user: ${userName} (${userId})`);
        
        res.json({ 
            success: true, 
            message: 'Logout successful',
            userId: userId 
        });
    } catch (err) {
        LOG.error("[LOGOUT] Server Error in /logout", err.message);
        // Even if there's an error, logout should succeed on client side
        res.status(200).json({ 
            success: true, 
            message: 'Logout processed (with warnings)',
            warning: err.message 
        });
    }
});

module.exports = router;

