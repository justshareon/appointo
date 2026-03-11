/**
 * Notification Validation Service
 * Validates notifications and detects suspicious patterns
 */
const db = require('../../database');
const LOG = require('../../utils/logger');
const surakshaService = require('./validationService');
const callerValidationService = require('./callerValidationService');

class NotificationValidationService {
    constructor() {
        // Suspicious patterns
        this.suspiciousPatterns = {
            // Urgency patterns
            urgency: [
                /urgent/i,
                /immediate/i,
                /act now/i,
                /limited time/i,
                /expires? (today|now|soon)/i,
                /last chance/i,
                /don't miss/i
            ],
            // Financial scams
            financial: [
                /(win|won|prize|reward|lottery|jackpot)/i,
                /(free money|cash|payment|refund)/i,
                /(click here|claim now|verify account)/i,
                /(suspended|blocked|locked|frozen)/i,
                /(update|verify|confirm) (your|payment|account|card)/i
            ],
            // Phishing patterns
            phishing: [
                /(verify|update|confirm) (your|account|password|details)/i,
                /(click|tap) (here|below|link)/i,
                /(http|https):\/\/[^\s]+/i, // URLs
                /(bit\.ly|tinyurl|short\.link)/i, // Shortened URLs
                /(login|sign in|account)/i
            ],
            // Spam patterns
            spam: [
                /(congratulations|you've been selected)/i,
                /(limited offer|special deal|exclusive)/i,
                /(act fast|hurry|don't wait)/i,
                /(unsubscribe|opt out)/i
            ],
            // YouTube specific
            youtube: [
                /(new video|uploaded|live now)/i,
                /(subscribe|like|comment)/i,
                /(watch now|click to watch)/i
            ]
        };

        // Known safe sources
        this.safeSources = [
            'com.android.systemui',
            'com.google.android.gms',
            'com.android.settings'
        ];
    }

    /**
     * Validate notification and detect suspicious patterns
     * @param {Object} notification - Notification data
     * @returns {Promise<Object>} Validation result with reasons
     */
    async validateNotification(notification) {
        try {
            const { title, body, data, source } = notification;
            const notificationText = `${title || ''} ${body || ''}`.toLowerCase();
            
            const result = {
                isSuspicious: false,
                severity: 'low',
                reasons: [],
                detectedThreats: [],
                confidence: 0
            };

            // Check if source is safe
            if (source && this.safeSources.includes(source)) {
                return { ...result, isSuspicious: false, reasons: ['Known safe source'] };
            }

            // Extract potential threats (phone, URL, email)
            const phoneRegex = /[\d\s\-\+\(\)]{10,15}/g;
            const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|bit\.ly\/[^\s]+|tinyurl\.com\/[^\s]+)/gi;
            const emailRegex = /[\w\.-]+@[\w\.-]+\.\w+/g;
            
            const phones = (notificationText.match(phoneRegex) || []).filter(p => p.replace(/\D/g, '').length >= 10);
            const urls = notificationText.match(urlRegex) || [];
            const emails = notificationText.match(emailRegex) || [];

            // Validate extracted items
            const threatPromises = [];
            
            // Validate phone numbers
            for (const phone of phones) {
                threatPromises.push(
                    callerValidationService.validateCall(phone.replace(/\D/g, ''))
                        .then(res => ({ type: 'phone', value: phone, result: res }))
                        .catch(() => ({ type: 'phone', value: phone, result: null }))
                );
            }

            // Validate URLs
            for (const url of urls) {
                threatPromises.push(
                    surakshaService.validateInput({ type: 'url', value: url })
                        .then(res => ({ type: 'url', value: url, result: res }))
                        .catch(() => ({ type: 'url', value: url, result: null }))
                );
            }

            // Validate emails
            for (const email of emails) {
                threatPromises.push(
                    surakshaService.validateInput({ type: 'email', value: email })
                        .then(res => ({ type: 'email', value: email, result: res }))
                        .catch(() => ({ type: 'email', value: email, result: null }))
                );
            }

            const threatResults = await Promise.all(threatPromises);
            
            // Check for suspicious patterns
            const patternChecks = this._checkSuspiciousPatterns(notificationText, source);
            result.reasons.push(...patternChecks.reasons);
            
            // Check detected threats
            const suspiciousThreats = threatResults.filter(t => 
                t.result && (t.result.isFraud || t.result.isThreat || t.result.isScam)
            );
            
            if (suspiciousThreats.length > 0) {
                result.isSuspicious = true;
                result.detectedThreats = suspiciousThreats.map(t => ({
                    type: t.type,
                    value: t.value,
                    reason: t.result?.reason || 'Detected as threat by validation service'
                }));
                result.reasons.push(`${suspiciousThreats.length} suspicious ${suspiciousThreats.length === 1 ? 'item' : 'items'} detected`);
            }

            // Determine severity
            if (patternChecks.severity === 'critical' || suspiciousThreats.some(t => t.result?.severity === 'critical')) {
                result.severity = 'critical';
                result.confidence = 90;
            } else if (patternChecks.severity === 'high' || suspiciousThreats.some(t => t.result?.severity === 'high')) {
                result.severity = 'high';
                result.confidence = 75;
            } else if (patternChecks.severity === 'medium' || patternChecks.reasons.length > 2) {
                result.severity = 'medium';
                result.confidence = 60;
            } else if (patternChecks.reasons.length > 0) {
                result.severity = 'low';
                result.confidence = 40;
            }

            // Mark as suspicious if any reason found
            if (result.reasons.length > 0 || suspiciousThreats.length > 0) {
                result.isSuspicious = true;
            }

            return result;
        } catch (error) {
            LOG.error('[Notification Validation Service] Error validating notification:', error);
            return {
                isSuspicious: false,
                severity: 'low',
                reasons: ['Validation error'],
                detectedThreats: [],
                confidence: 0
            };
        }
    }

    /**
     * Check for suspicious patterns in notification text
     * @private
     */
    _checkSuspiciousPatterns(text, source) {
        const result = {
            reasons: [],
            severity: 'low'
        };

        // Check urgency patterns
        if (this.suspiciousPatterns.urgency.some(pattern => pattern.test(text))) {
            result.reasons.push('Contains urgency language (act now, limited time, etc.)');
            result.severity = 'medium';
        }

        // Check financial scam patterns
        if (this.suspiciousPatterns.financial.some(pattern => pattern.test(text))) {
            result.reasons.push('Contains financial scam indicators (prize, free money, etc.)');
            result.severity = 'high';
        }

        // Check phishing patterns
        if (this.suspiciousPatterns.phishing.some(pattern => pattern.test(text))) {
            result.reasons.push('Contains phishing indicators (verify account, click link, etc.)');
            result.severity = 'high';
        }

        // Check spam patterns
        if (this.suspiciousPatterns.spam.some(pattern => pattern.test(text))) {
            result.reasons.push('Contains spam indicators');
            result.severity = 'low';
        }

        // YouTube specific checks
        if (source && source.includes('youtube')) {
            if (this.suspiciousPatterns.youtube.some(pattern => pattern.test(text))) {
                // YouTube notifications are generally safe, but check for suspicious links
                if (/(bit\.ly|tinyurl|short\.link)/i.test(text)) {
                    result.reasons.push('YouTube notification contains suspicious shortened URL');
                    result.severity = 'medium';
                }
            }
        }

        // Check for multiple suspicious indicators
        if (result.reasons.length >= 3) {
            result.severity = 'high';
        }

        return result;
    }

    /**
     * Save notification validation
     * @param {string} userId - User ID
     * @param {Object} notification - Notification data
     * @param {Object} validationResult - Validation result
     * @returns {Promise<Object>} Saved validation
     */
    async saveNotificationValidation(userId, notification, validationResult) {
        try {
            if (!db.notificationValidations) {
                db.notificationValidations = [];
            }

            const validation = {
                id: `notif_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                user_id: userId,
                source: notification.source || 'unknown',
                app_name: notification.appName || notification.source || 'Unknown App',
                title: notification.title,
                body: notification.body,
                data: notification.data || {},
                is_suspicious: validationResult.isSuspicious,
                severity: validationResult.severity,
                reasons: validationResult.reasons,
                detected_threats: validationResult.detectedThreats,
                confidence: validationResult.confidence,
                user_status: null, // Will be set by user
                user_action: null, // scam, suspicious, safe, other
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            db.notificationValidations.push(validation);

            // Keep only last 1000 validations per user
            const userValidations = db.notificationValidations.filter(v => v.user_id === userId);
            if (userValidations.length > 1000) {
                const toRemove = userValidations.slice(0, userValidations.length - 1000);
                toRemove.forEach(v => {
                    const index = db.notificationValidations.findIndex(nv => nv.id === v.id);
                    if (index > -1) db.notificationValidations.splice(index, 1);
                });
            }

            LOG.info(`[Notification Validation] Saved validation for user ${userId}: ${validationResult.isSuspicious ? 'SUSPICIOUS' : 'SAFE'}`);
            return validation;
        } catch (error) {
            LOG.error('[Notification Validation Service] Error saving validation:', error);
            throw error;
        }
    }

    /**
     * Update user status for notification
     * @param {string} userId - User ID
     * @param {string} validationId - Validation ID
     * @param {string} status - User status (scam, suspicious, safe, other)
     * @returns {Promise<Object>} Updated validation
     */
    async updateUserStatus(userId, validationId, status) {
        try {
            const validation = db.notificationValidations.find(
                v => v.id === validationId && v.user_id === userId
            );

            if (!validation) {
                throw new Error('Validation not found');
            }

            validation.user_status = status;
            validation.user_action = status;
            validation.updated_at = new Date().toISOString();

            LOG.info(`[Notification Validation] User ${userId} marked notification ${validationId} as ${status}`);
            return validation;
        } catch (error) {
            LOG.error('[Notification Validation Service] Error updating status:', error);
            throw error;
        }
    }

    /**
     * Get notification validations for user
     * @param {string} userId - User ID
     * @param {Object} filters - Filter options
     * @returns {Promise<Array>} Validations
     */
    async getUserValidations(userId, filters = {}) {
        try {
            let validations = db.notificationValidations || [];
            validations = validations.filter(v => v.user_id === userId);

            if (filters.isSuspicious !== undefined) {
                validations = validations.filter(v => v.is_suspicious === filters.isSuspicious);
            }

            if (filters.severity) {
                validations = validations.filter(v => v.severity === filters.severity);
            }

            if (filters.source) {
                validations = validations.filter(v => v.source === filters.source);
            }

            if (filters.userStatus) {
                validations = validations.filter(v => v.user_status === filters.userStatus);
            }

            // Sort by created_at (newest first)
            validations.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

            // Limit results
            if (filters.limit) {
                validations = validations.slice(0, parseInt(filters.limit));
            }

            return validations;
        } catch (error) {
            LOG.error('[Notification Validation Service] Error getting validations:', error);
            throw error;
        }
    }
}

module.exports = new NotificationValidationService();

