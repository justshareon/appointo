const express = require('express');
const router = express.Router();
const matchmakingService = require('../services/matchmakingService');
const { authenticateToken } = require('../middleware/auth');
const LOG = require('../utils/logger');

/**
 * GET /api/matchmaking/presets
 * Get matchmaking presets
 */
router.get('/matchmaking/presets', authenticateToken, async (req, res) => {
    try {
        const presets = await matchmakingService.getPresets();
        res.json(presets);
    } catch (err) {
        LOG.error("Failed to fetch matchmaking presets", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/vendors/self/matchmaking/template
 * Get my matchmaking template
 */
router.get('/vendors/self/matchmaking/template', authenticateToken, async (req, res) => {
    try {
        const template = await matchmakingService.getMyTemplate(req.user.id);
        // Return null if no vendor profile exists (not an error)
        if (template === null) {
            return res.json(null);
        }
        res.json(template);
    } catch (err) {
        LOG.error("Failed to fetch own matchmaking template", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/vendors/self/matchmaking/template
 * Save matchmaking template
 */
router.post('/vendors/self/matchmaking/template', authenticateToken, async (req, res) => {
    try {
        const result = await matchmakingService.saveTemplate(req.user.id, req.body);
        res.json(result);
    } catch (err) {
        LOG.error("Failed to save matchmaking template", err.message);
        const statusCode = err.message.includes('not found') ? 404 : 500;
        res.status(statusCode).json({ error: err.message });
    }
});

// Backward-compatible aliases
router.get('/vendors/me/matchmaking/template', authenticateToken, async (req, res) => {
    try {
        const template = await matchmakingService.getMyTemplate(req.user.id);
        // Return null if no vendor profile exists (not an error)
        if (template === null) {
            return res.json(null);
        }
        res.json(template);
    } catch (err) {
        LOG.error("Failed to fetch own matchmaking template (me alias)", err.message);
        res.status(500).json({ error: err.message });
    }
});

router.post('/vendors/me/matchmaking/template', authenticateToken, async (req, res) => {
    try {
        const result = await matchmakingService.saveTemplate(req.user.id, req.body);
        res.json(result);
    } catch (err) {
        LOG.error("Failed to save matchmaking template (me alias)", err.message);
        const statusCode = err.message.includes('not found') ? 404 : 500;
        res.status(statusCode).json({ error: err.message });
    }
});

/**
 * GET /api/vendors/me/matchmaking/results
 * Get matchmaking results for vendor
 */
router.get('/vendors/me/matchmaking/results', authenticateToken, async (req, res) => {
    try {
        const results = await matchmakingService.getMyResults(req.user.id);
        // Always return an array (empty if no vendor profile)
        res.json(results || []);
    } catch (err) {
        LOG.error("Failed to fetch matchmaking results", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/matchmaking/submit
 * Submit matchmaking answers
 */
router.post('/matchmaking/submit', authenticateToken, async (req, res) => {
    try {
        const result = await matchmakingService.submitAnswers(req.user.id, req.body);
        res.json(result);
    } catch (err) {
        LOG.error("Failed to submit matchmaking answers", err.message);
        const statusCode = err.message.includes('required') ? 400 :
                          err.message.includes('not available') ? 404 : 500;
        res.status(statusCode).json({ error: err.message });
    }
});

/**
 * GET /api/matchmaking/me
 * Get user matchmaking submissions
 */
router.get('/matchmaking/me', authenticateToken, async (req, res) => {
    try {
        const submissions = await matchmakingService.getMySubmissions(req.user.id);
        res.json(submissions);
    } catch (err) {
        LOG.error("Failed to fetch user matchmaking submissions", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

