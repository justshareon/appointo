/**
 * Subscription Service
 * Manages app subscriptions, payments, and feature access
 */
const db = require('../database');
const LOG = require('../utils/logger');

class SubscriptionService {
    constructor() {
        // Supported payment providers
        this.providers = {
            google_play: {
                name: 'Google Play',
                icon: 'google-play',
                enabled: true
            },
            apple_app_store: {
                name: 'Apple App Store',
                icon: 'apple',
                enabled: true
            },
            razorpay: {
                name: 'Razorpay',
                icon: 'credit-card',
                enabled: true
            },
            paytm: {
                name: 'Paytm',
                icon: 'wallet',
                enabled: true
            },
            phonepe: {
                name: 'PhonePe',
                icon: 'mobile-payment',
                enabled: true
            }
        };
    }

    /**
     * Get user subscriptions
     * @param {string} userId - User ID
     * @returns {Promise<Array>} User subscriptions
     */
    async getUserSubscriptions(userId) {
        try {
            if (!db.subscriptions) {
                db.subscriptions = [];
            }

            const subscriptions = db.subscriptions.filter(s => s.user_id === userId);
            return subscriptions;
        } catch (error) {
            LOG.error('[Subscription Service] Error getting subscriptions:', error);
            throw error;
        }
    }

    /**
     * Create or update subscription
     * @param {string} userId - User ID
     * @param {Object} subscriptionData - Subscription data
     * @returns {Promise<Object>} Created/updated subscription
     */
    async createOrUpdateSubscription(userId, subscriptionData) {
        try {
            if (!db.subscriptions) {
                db.subscriptions = [];
            }

            const {
                provider,
                subscription_id,
                plan_id,
                plan_name,
                price,
                currency,
                billing_period,
                status,
                auto_renew,
                start_date,
                end_date,
                payment_method,
                features
            } = subscriptionData;

            // Check if subscription exists
            let subscription = db.subscriptions.find(
                s => s.user_id === userId && 
                (s.subscription_id === subscription_id || s.provider === provider)
            );

            if (subscription) {
                // Update existing
                Object.assign(subscription, {
                    plan_id,
                    plan_name,
                    price,
                    currency,
                    billing_period,
                    status,
                    auto_renew: auto_renew !== undefined ? auto_renew : subscription.auto_renew,
                    end_date,
                    payment_method,
                    features,
                    updated_at: new Date().toISOString()
                });
            } else {
                // Create new
                subscription = {
                    id: `sub_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                    user_id: userId,
                    provider,
                    subscription_id: subscription_id || `sub_${Date.now()}`,
                    plan_id,
                    plan_name,
                    price,
                    currency: currency || 'INR',
                    billing_period: billing_period || 'monthly',
                    status: status || 'active',
                    auto_renew: auto_renew !== undefined ? auto_renew : true,
                    start_date: start_date || new Date().toISOString(),
                    end_date,
                    payment_method,
                    features: features || [],
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
                db.subscriptions.push(subscription);
            }

            LOG.info(`[Subscription Service] Subscription ${subscription.status} for user ${userId}: ${plan_name}`);
            return subscription;
        } catch (error) {
            LOG.error('[Subscription Service] Error creating/updating subscription:', error);
            throw error;
        }
    }

    /**
     * Cancel subscription
     * @param {string} userId - User ID
     * @param {string} subscriptionId - Subscription ID
     * @returns {Promise<Object>} Updated subscription
     */
    async cancelSubscription(userId, subscriptionId) {
        try {
            const subscription = db.subscriptions.find(
                s => s.user_id === userId && (s.id === subscriptionId || s.subscription_id === subscriptionId)
            );

            if (!subscription) {
                throw new Error('Subscription not found');
            }

            subscription.status = 'cancelled';
            subscription.auto_renew = false;
            subscription.cancelled_at = new Date().toISOString();
            subscription.updated_at = new Date().toISOString();

            LOG.info(`[Subscription Service] Subscription cancelled: ${subscriptionId}`);
            return subscription;
        } catch (error) {
            LOG.error('[Subscription Service] Error cancelling subscription:', error);
            throw error;
        }
    }

    /**
     * Enable/disable auto-renew
     * @param {string} userId - User ID
     * @param {string} subscriptionId - Subscription ID
     * @param {boolean} autoRenew - Auto-renew status
     * @returns {Promise<Object>} Updated subscription
     */
    async setAutoRenew(userId, subscriptionId, autoRenew) {
        try {
            const subscription = db.subscriptions.find(
                s => s.user_id === userId && (s.id === subscriptionId || s.subscription_id === subscriptionId)
            );

            if (!subscription) {
                throw new Error('Subscription not found');
            }

            subscription.auto_renew = autoRenew;
            subscription.updated_at = new Date().toISOString();

            LOG.info(`[Subscription Service] Auto-renew ${autoRenew ? 'enabled' : 'disabled'} for subscription: ${subscriptionId}`);
            return subscription;
        } catch (error) {
            LOG.error('[Subscription Service] Error setting auto-renew:', error);
            throw error;
        }
    }

    /**
     * Get subscription statistics
     * @param {string} userId - User ID
     * @returns {Promise<Object>} Statistics
     */
    async getSubscriptionStats(userId) {
        try {
            const subscriptions = await this.getUserSubscriptions(userId);
            
            const stats = {
                total: subscriptions.length,
                active: subscriptions.filter(s => s.status === 'active').length,
                cancelled: subscriptions.filter(s => s.status === 'cancelled').length,
                expired: subscriptions.filter(s => s.status === 'expired').length,
                totalMonthlyCost: subscriptions
                    .filter(s => s.status === 'active' && s.billing_period === 'monthly')
                    .reduce((sum, s) => sum + (s.price || 0), 0),
                totalYearlyCost: subscriptions
                    .filter(s => s.status === 'active' && s.billing_period === 'yearly')
                    .reduce((sum, s) => sum + (s.price || 0), 0),
                byProvider: {}
            };

            // Count by provider
            subscriptions.forEach(sub => {
                if (!stats.byProvider[sub.provider]) {
                    stats.byProvider[sub.provider] = 0;
                }
                if (sub.status === 'active') {
                    stats.byProvider[sub.provider]++;
                }
            });

            return stats;
        } catch (error) {
            LOG.error('[Subscription Service] Error getting stats:', error);
            throw error;
        }
    }

    /**
     * Get available payment providers
     * @returns {Object} Available providers
     */
    getAvailableProviders() {
        return this.providers;
    }
}

module.exports = new SubscriptionService();

