/**
 * Subscription Controller
 * Handles subscription management requests
 */
const subscriptionService = require('../services/subscriptionService');
const LOG = require('../utils/logger');

class SubscriptionController {
    /**
     * Get user subscriptions
     * GET /api/subscriptions
     */
    async getUserSubscriptions(req, res) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ error: 'User authentication required' });
            }

            const subscriptions = await subscriptionService.getUserSubscriptions(userId);
            res.json({
                success: true,
                count: subscriptions.length,
                subscriptions
            });
        } catch (error) {
            LOG.error('[Subscription Controller] Error getting subscriptions:', error);
            res.status(500).json({
                error: 'Failed to get subscriptions',
                message: error.message
            });
        }
    }

    /**
     * Create or update subscription
     * POST /api/subscriptions
     */
    async createOrUpdateSubscription(req, res) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ error: 'User authentication required' });
            }

            const subscription = await subscriptionService.createOrUpdateSubscription(userId, req.body);
            res.json({
                success: true,
                subscription
            });
        } catch (error) {
            LOG.error('[Subscription Controller] Error creating/updating subscription:', error);
            res.status(500).json({
                error: 'Failed to create/update subscription',
                message: error.message
            });
        }
    }

    /**
     * Cancel subscription
     * POST /api/subscriptions/:subscriptionId/cancel
     */
    async cancelSubscription(req, res) {
        try {
            const userId = req.user?.id;
            const { subscriptionId } = req.params;

            if (!userId) {
                return res.status(401).json({ error: 'User authentication required' });
            }

            const subscription = await subscriptionService.cancelSubscription(userId, subscriptionId);
            res.json({
                success: true,
                subscription
            });
        } catch (error) {
            LOG.error('[Subscription Controller] Error cancelling subscription:', error);
            res.status(500).json({
                error: 'Failed to cancel subscription',
                message: error.message
            });
        }
    }

    /**
     * Set auto-renew
     * POST /api/subscriptions/:subscriptionId/auto-renew
     */
    async setAutoRenew(req, res) {
        try {
            const userId = req.user?.id;
            const { subscriptionId } = req.params;
            const { autoRenew } = req.body;

            if (!userId) {
                return res.status(401).json({ error: 'User authentication required' });
            }

            const subscription = await subscriptionService.setAutoRenew(userId, subscriptionId, autoRenew);
            res.json({
                success: true,
                subscription
            });
        } catch (error) {
            LOG.error('[Subscription Controller] Error setting auto-renew:', error);
            res.status(500).json({
                error: 'Failed to set auto-renew',
                message: error.message
            });
        }
    }

    /**
     * Get subscription statistics
     * GET /api/subscriptions/stats
     */
    async getStats(req, res) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ error: 'User authentication required' });
            }

            const stats = await subscriptionService.getSubscriptionStats(userId);
            res.json({
                success: true,
                stats
            });
        } catch (error) {
            LOG.error('[Subscription Controller] Error getting stats:', error);
            res.status(500).json({
                error: 'Failed to get stats',
                message: error.message
            });
        }
    }

    /**
     * Get available payment providers
     * GET /api/subscriptions/providers
     */
    async getProviders(req, res) {
        try {
            const providers = subscriptionService.getAvailableProviders();
            res.json({
                success: true,
                providers
            });
        } catch (error) {
            LOG.error('[Subscription Controller] Error getting providers:', error);
            res.status(500).json({
                error: 'Failed to get providers',
                message: error.message
            });
        }
    }
}

module.exports = new SubscriptionController();

