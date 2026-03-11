/**
 * Cyber Tools Routes
 * Security tools and utilities endpoints
 */
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const axios = require('axios');
const LOG = require('../utils/logger');

/**
 * POST /api/cyber/check-email-breach
 * Check if email was in data breach (using Have I Been Pwned API)
 */
router.post('/check-email-breach', authenticateToken, async (req, res) => {
    try {
        const { email } = req.body;

        if (!email || !email.includes('@')) {
            return res.status(400).json({ 
                error: 'Valid email address is required' 
            });
        }

        // Use Have I Been Pwned API (requires API key for full access)
        const hibpApiKey = process.env.HIBP_API_KEY || '';
        const useMock = process.env.HIBP_USE_MOCK === 'true' || !hibpApiKey;

        if (useMock) {
            // Mock response for testing
            const mockBreached = email.includes('breached') || email.includes('test');
            return res.json({
                breached: mockBreached,
                breaches: mockBreached ? [
                    {
                        name: 'Example Data Breach',
                        domain: 'example.com',
                        breachDate: '2023-01-15',
                        addedDate: '2023-02-01',
                        description: 'Sample breach for testing'
                    }
                ] : [],
                apiSource: 'mock'
            });
        }

        // Real API call to Have I Been Pwned
        try {
            const response = await axios.get(
                `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}`,
                {
                    headers: {
                        'hibp-api-key': hibpApiKey,
                        'User-Agent': 'Suraksha-Cyber-Service'
                    },
                    timeout: 5000
                }
            );

            return res.json({
                breached: response.data && response.data.length > 0,
                breaches: response.data || [],
                apiSource: 'real'
            });
        } catch (apiError) {
            if (apiError.response?.status === 404) {
                // Email not found in breaches
                return res.json({
                    breached: false,
                    breaches: [],
                    apiSource: 'real'
                });
            }

            LOG.warning(`[Cyber Tools] HIBP API error: ${apiError.message}`);
            throw apiError;
        }
    } catch (error) {
        LOG.error('[Cyber Tools] Email breach check error:', error);
        res.status(500).json({ 
            error: 'Failed to check email breach',
            message: error.message 
        });
    }
});

/**
 * GET /api/cyber/security-tips
 * Get security tips
 */
router.get('/security-tips', authenticateToken, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 5;

        // Get tips from database or return default tips
        const db = require('../database');
        const tips = db.cyberSecurityTips || getDefaultSecurityTips();

        // Return limited tips
        const limitedTips = tips.slice(0, limit);

        res.json({
            success: true,
            count: limitedTips.length,
            tips: limitedTips
        });
    } catch (error) {
        LOG.error('[Cyber Tools] Get security tips error:', error);
        res.status(500).json({ 
            error: 'Failed to fetch security tips',
            message: error.message 
        });
    }
});

/**
 * Default security tips
 */
function getDefaultSecurityTips() {
    return [
        {
            id: 1,
            title: 'Use Strong, Unique Passwords',
            description: 'Create passwords with at least 12 characters, mixing letters, numbers, and symbols. Use a password manager to generate and store unique passwords for each account.',
            category: 'Password',
            priority: 'high',
            icon: 'lock'
        },
        {
            id: 2,
            title: 'Enable Two-Factor Authentication',
            description: 'Add an extra layer of security to your accounts with 2FA. This prevents unauthorized access even if your password is compromised.',
            category: 'Authentication',
            priority: 'high',
            icon: 'shield-check'
        },
        {
            id: 3,
            title: 'Keep Software Updated',
            description: 'Regularly update your operating system and apps to patch security vulnerabilities. Enable automatic updates when possible.',
            category: 'Updates',
            priority: 'high',
            icon: 'update'
        },
        {
            id: 4,
            title: 'Be Wary of Phishing Emails',
            description: 'Never click links or download attachments from suspicious emails. Verify sender identity before responding to requests for sensitive information.',
            category: 'Phishing',
            priority: 'medium',
            icon: 'email-alert'
        },
        {
            id: 5,
            title: 'Use VPN on Public WiFi',
            description: 'Protect your data when using public WiFi networks with a VPN. Avoid accessing sensitive accounts on unsecured networks.',
            category: 'Network',
            priority: 'medium',
            icon: 'wifi'
        },
        {
            id: 6,
            title: 'Backup Your Data Regularly',
            description: 'Keep regular backups of important data to protect against ransomware and data loss. Use cloud storage or external drives.',
            category: 'Backup',
            priority: 'high',
            icon: 'backup-restore'
        },
        {
            id: 7,
            title: 'Review App Permissions',
            description: 'Regularly review and revoke unnecessary app permissions. Only grant permissions that apps actually need to function.',
            category: 'Privacy',
            priority: 'medium',
            icon: 'shield-account'
        },
        {
            id: 8,
            title: 'Check for Data Breaches',
            description: 'Regularly check if your email or phone was involved in data breaches. Change passwords immediately if found in a breach.',
            category: 'Breach',
            priority: 'medium',
            icon: 'alert-circle'
        }
    ];
}

module.exports = router;

