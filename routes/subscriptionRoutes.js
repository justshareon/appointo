/**
 * Subscription Routes
 * Handles subscription and payment management
 */
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const subscriptionController = require('../controllers/subscriptionController');

// All routes require authentication
router.use(authenticateToken);

/**
 * GET /api/subscriptions
 * Get user subscriptions
 */
router.get('/', (req, res) => subscriptionController.getUserSubscriptions(req, res));

/**
 * POST /api/subscriptions
 * Create or update subscription
 */
router.post('/', (req, res) => subscriptionController.createOrUpdateSubscription(req, res));

/**
 * POST /api/subscriptions/:subscriptionId/cancel
 * Cancel subscription
 */
router.post('/:subscriptionId/cancel', (req, res) => subscriptionController.cancelSubscription(req, res));

/**
 * POST /api/subscriptions/:subscriptionId/auto-renew
 * Set auto-renew status
 */
router.post('/:subscriptionId/auto-renew', (req, res) => subscriptionController.setAutoRenew(req, res));

/**
 * GET /api/subscriptions/stats
 * Get subscription statistics
 */
router.get('/stats', (req, res) => subscriptionController.getStats(req, res));

/**
 * GET /api/subscriptions/providers
 * Get available payment providers
 */
router.get('/providers', (req, res) => subscriptionController.getProviders(req, res));

module.exports = router;

