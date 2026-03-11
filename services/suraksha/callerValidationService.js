/**
 * Caller Validation Service
 * Validates incoming calls against government databases and local spam database
 * Similar to Truecaller functionality
 */
const i4cService = require('./i4cService');
const sancharSaathiService = require('./sancharSaathiService');
const db = require('../../database');
const LOG = require('../../utils/logger');
const axios = require('axios');

class CallerValidationService {
    constructor() {
        // Government API configuration
        this.traiDndUrl = process.env.TRAI_DND_API_URL || 'https://www.trai.gov.in/api';
        this.traiApiKey = process.env.TRAI_API_KEY || '';
        this.useTraiDnd = process.env.TRAI_ENABLE_DND_CHECK === 'true' && this.traiApiKey;
        
        // Truecaller API (optional, commercial)
        this.truecallerApiKey = process.env.TRUECALLER_API_KEY || '';
        this.useTruecaller = process.env.TRUECALLER_ENABLE === 'true' && this.truecallerApiKey;
        
        // Local database for spam numbers
        this.initializeLocalDatabase();
    }

    /**
     * Initialize local spam database
     */
    initializeLocalDatabase() {
        if (!db.spamNumbers) {
            db.spamNumbers = [];
        }
        if (!db.callHistory) {
            db.callHistory = [];
        }
        if (!db.communityReports) {
            db.communityReports = [];
        }
    }

    /**
     * Validate incoming call
     * @param {string} phoneNumber - Incoming phone number
     * @param {string} userId - User ID (optional)
     * @returns {Promise<Object>} Call validation result
     */
    async validateCall(phoneNumber, userId = null) {
        try {
            LOG.info(`[Caller Validation] ==========================================`);
            LOG.info(`[Caller Validation] 📞 Validating call from: ${phoneNumber}`);
            LOG.info(`[Caller Validation] User ID: ${userId || 'Anonymous'}`);
            LOG.info(`[Caller Validation] ==========================================`);
            
            // Normalize phone number (remove +, spaces, etc.)
            const normalizedNumber = this._normalizePhoneNumber(phoneNumber);
            LOG.info(`[Caller Validation] 📝 Normalized phone number: ${normalizedNumber}`);
            
            LOG.info(`[Caller Validation] 🔍 Checking ${6} sources in parallel:`);
            LOG.info(`[Caller Validation]   1. Local Database`);
            LOG.info(`[Caller Validation]   2. Sanchar Saathi`);
            LOG.info(`[Caller Validation]   3. I4C (NCRP-CFCFRMS)`);
            LOG.info(`[Caller Validation]   4. TRAI DND Registry`);
            LOG.info(`[Caller Validation]   5. Truecaller API`);
            LOG.info(`[Caller Validation]   6. Pattern Detection`);
            
            // Check multiple sources in parallel
            const validationPromises = [
                this._checkLocalDatabase(normalizedNumber),
                this._checkSancharSaathi(normalizedNumber),
                this._checkI4C(normalizedNumber),
                this._checkTraiDnd(normalizedNumber),
                this._checkTruecaller(normalizedNumber),
                this._checkPattern(normalizedNumber)
            ];

            const results = await Promise.allSettled(validationPromises);
            
            LOG.info(`[Caller Validation] ✅ All checks completed`);
            LOG.info(`[Caller Validation] Results summary:`, JSON.stringify(results.map((r, i) => ({
                source: ['Local DB', 'Sanchar Saathi', 'I4C', 'TRAI DND', 'Truecaller', 'Pattern'][i],
                status: r.status,
                isSpam: r.status === 'fulfilled' ? r.value?.isSpam : false,
                error: r.status === 'rejected' ? r.reason?.message : null
            })), null, 2));
            
            // Aggregate results
            const validationResult = this._aggregateResults(normalizedNumber, results);
            
            LOG.info(`[Caller Validation] 📊 Aggregated Result:`, JSON.stringify(validationResult, null, 2));
            
            // Store call in history
            await this._storeCallHistory(normalizedNumber, validationResult, userId);
            
            LOG.info(`[Caller Validation] ✅ Validation complete. Final status: ${validationResult.isSpam ? 'SPAM' : 'SAFE'}`);
            
            return validationResult;
        } catch (error) {
            LOG.error(`[Caller Validation] ❌ Error validating call:`, error);
            LOG.error(`[Caller Validation] Error stack:`, error.stack);
            return this._getDefaultResult(phoneNumber, 'error');
        }
    }

    /**
     * Check local spam database
     * @private
     */
    async _checkLocalDatabase(phoneNumber) {
        LOG.info(`[Caller Validation] 🔍 [Local DB] Checking phone: ${phoneNumber}`);
        LOG.info(`[Caller Validation] 🔍 [Local DB] Spam numbers in DB: ${db.spamNumbers?.length || 0}`);
        LOG.info(`[Caller Validation] 🔍 [Local DB] Community reports in DB: ${db.communityReports?.length || 0}`);
        LOG.info(`[Caller Validation] 🔍 [Local DB] Cyber threats in DB: ${db.cyberThreats?.length || 0}`);
        
        const spamNumber = db.spamNumbers.find(s => s.phone_number === phoneNumber);
        const communityReport = db.communityReports.find(r => r.phone_number === phoneNumber);
        
        // Also check cyber threats database
        const cyberThreat = db.cyberThreats?.find(t => 
            t.type === 'phone' && 
            t.value === phoneNumber && 
            t.status === 'active'
        );
        
        LOG.info(`[Caller Validation] 🔍 [Local DB] Found spam number: ${!!spamNumber}`);
        LOG.info(`[Caller Validation] 🔍 [Local DB] Found community report: ${!!communityReport}`);
        LOG.info(`[Caller Validation] 🔍 [Local DB] Found cyber threat: ${!!cyberThreat}`);
        
        if (spamNumber || communityReport || cyberThreat) {
            const isScam = spamNumber?.is_scam || communityReport?.is_scam || cyberThreat?.category === 'scam' || cyberThreat?.category === 'fraud';
            const isTelemarketing = spamNumber?.is_telemarketing || cyberThreat?.category === 'spam';
            const reportCount = (spamNumber?.report_count || 0) + (communityReport?.report_count || 0) + (cyberThreat?.report_count || 0);
            const tags = [
                ...(spamNumber?.tags || []),
                ...(communityReport?.tags || []),
                ...(cyberThreat?.tags || []),
                ...(cyberThreat ? [cyberThreat.category, cyberThreat.severity] : [])
            ].filter(Boolean);
            
            return {
                source: 'local_database',
                isSpam: true,
                isScam,
                isTelemarketing,
                callerName: spamNumber?.caller_name || communityReport?.caller_name || cyberThreat?.title || null,
                reportCount,
                lastReported: spamNumber?.last_reported || communityReport?.reported_at || cyberThreat?.created_at || null,
                tags: [...new Set(tags)], // Remove duplicates
                threatId: cyberThreat?.id || null
            };
        }
        
        return { source: 'local_database', isSpam: false };
    }

    /**
     * Check Sanchar Saathi for fraud numbers
     * @private
     */
    async _checkSancharSaathi(phoneNumber) {
        try {
            LOG.info(`[Caller Validation] 🔍 [Sanchar Saathi] Checking phone: ${phoneNumber}`);
            // Use existing Sanchar Saathi service
            // Note: This would need to be adapted for phone number checking
            // For now, check if number matches known fraud patterns
            const fraudPatterns = db.spamNumbers.filter(s => s.is_scam && s.source === 'sanchar_saathi');
            LOG.info(`[Caller Validation] 🔍 [Sanchar Saathi] Fraud patterns in DB: ${fraudPatterns.length}`);
            const match = fraudPatterns.find(s => s.phone_number === phoneNumber);
            
            if (match) {
                LOG.info(`[Caller Validation] ✅ [Sanchar Saathi] Match found - Fraud detected`);
                return {
                    source: 'sanchar_saathi',
                    isSpam: true,
                    isScam: true,
                    callerName: 'Fraud Number',
                    tags: ['fraud', 'government_reported']
                };
            }
            
            LOG.info(`[Caller Validation] ✅ [Sanchar Saathi] No match found - Safe`);
            return { source: 'sanchar_saathi', isSpam: false };
        } catch (error) {
            LOG.error(`[Caller Validation] ❌ [Sanchar Saathi] Check failed: ${error.message}`);
            LOG.error(`[Caller Validation] ❌ [Sanchar Saathi] Error stack:`, error.stack);
            return { source: 'sanchar_saathi', isSpam: false, error: error.message };
        }
    }

    /**
     * Check I4C for scam numbers
     * @private
     */
    async _checkI4C(phoneNumber) {
        try {
            LOG.info(`[Caller Validation] 🔍 [I4C] Checking phone: ${phoneNumber}`);
            // Use existing I4C service to check if number is in fraud database
            // (I4C service already has detailed logging)
            const fraudCheck = await i4cService.checkFraudStatus(phoneNumber, 'phone');
            
            LOG.info(`[Caller Validation] 📥 [I4C] Response received:`, JSON.stringify(fraudCheck, null, 2));
            
            if (fraudCheck.isFraud) {
                LOG.info(`[Caller Validation] ✅ [I4C] Fraud detected!`);
                return {
                    source: 'i4c_ncrp',
                    isSpam: true,
                    isScam: true,
                    callerName: 'Scam Number',
                    complaintId: fraudCheck.complaintId,
                    tags: ['scam', 'fraud', 'government_reported']
                };
            }
            
            LOG.info(`[Caller Validation] ✅ [I4C] No fraud detected - Safe`);
            return { source: 'i4c_ncrp', isSpam: false };
        } catch (error) {
            LOG.error(`[Caller Validation] ❌ [I4C] Check failed: ${error.message}`);
            LOG.error(`[Caller Validation] ❌ [I4C] Error stack:`, error.stack);
            return { source: 'i4c_ncrp', isSpam: false, error: error.message };
        }
    }

    /**
     * Check TRAI DND registry
     * @private
     */
    async _checkTraiDnd(phoneNumber) {
        LOG.info(`[Caller Validation] 🔍 [TRAI DND] Checking phone: ${phoneNumber}`);
        LOG.info(`[Caller Validation] 🔍 [TRAI DND] Configuration:`);
        LOG.info(`[Caller Validation] 🔍 [TRAI DND]   - Base URL: ${this.traiDndUrl}`);
        LOG.info(`[Caller Validation] 🔍 [TRAI DND]   - API Key: ${this.traiApiKey ? '***' + this.traiApiKey.slice(-4) : 'NOT SET'}`);
        LOG.info(`[Caller Validation] 🔍 [TRAI DND]   - Enabled: ${this.useTraiDnd}`);
        
        if (!this.useTraiDnd) {
            LOG.info(`[Caller Validation] ⏭️ [TRAI DND] Skipped (not enabled)`);
            return { source: 'trai_dnd', isSpam: false, skipped: true };
        }

        try {
            const requestConfig = {
                params: { phone_number: phoneNumber },
                headers: {
                    'Authorization': `Bearer ${this.traiApiKey ? '***' + this.traiApiKey.slice(-4) : 'NOT SET'}`,
                    'User-Agent': 'Suraksha-Caller-Validation'
                },
                timeout: 3000
            };
            
            LOG.info(`[Caller Validation] 📤 [TRAI DND] Making API call to: ${this.traiDndUrl}/dnd/check`);
            LOG.info(`[Caller Validation] 📤 [TRAI DND] Request Params:`, JSON.stringify(requestConfig.params, null, 2));
            LOG.info(`[Caller Validation] 📤 [TRAI DND] Request Headers:`, JSON.stringify({
                ...requestConfig.headers,
                'Authorization': `Bearer ***${this.traiApiKey ? this.traiApiKey.slice(-4) : 'NOT SET'}`
            }, null, 2));
            LOG.info(`[Caller Validation] 📤 [TRAI DND] Request Timeout: 3000ms`);
            
            const startTime = Date.now();
            const response = await axios.get(
                `${this.traiDndUrl}/dnd/check`,
                requestConfig
            );
            const duration = Date.now() - startTime;
            
            LOG.info(`[Caller Validation] 📥 [TRAI DND] Response received in ${duration}ms`);
            LOG.info(`[Caller Validation] 📥 [TRAI DND] Status Code: ${response.status}`);
            LOG.info(`[Caller Validation] 📥 [TRAI DND] Response Data:`, JSON.stringify(response.data, null, 2));

            if (response.data && response.data.is_dnd_registered) {
                LOG.info(`[Caller Validation] ✅ [TRAI DND] DND registered - Telemarketing detected`);
                return {
                    source: 'trai_dnd',
                    isSpam: true,
                    isTelemarketing: true,
                    callerName: response.data.caller_name || 'Telemarketing',
                    tags: ['telemarketing', 'dnd_registered', 'government_reported']
                };
            }

            LOG.info(`[Caller Validation] ✅ [TRAI DND] Not in DND registry - Safe`);
            return { source: 'trai_dnd', isSpam: false };
        } catch (error) {
            LOG.error(`[Caller Validation] ❌ [TRAI DND] Check failed!`);
            LOG.error(`[Caller Validation] ❌ [TRAI DND] Error Message: ${error.message}`);
            LOG.error(`[Caller Validation] ❌ [TRAI DND] Error Code: ${error.code || 'N/A'}`);
            LOG.error(`[Caller Validation] ❌ [TRAI DND] Error Response Status: ${error.response?.status || 'N/A'}`);
            LOG.error(`[Caller Validation] ❌ [TRAI DND] Error Response Data:`, JSON.stringify(error.response?.data || {}, null, 2));
            LOG.error(`[Caller Validation] ❌ [TRAI DND] Error Stack:`, error.stack);
            return { source: 'trai_dnd', isSpam: false, error: error.message };
        }
    }

    /**
     * Check Truecaller API (optional, commercial)
     * @private
     */
    async _checkTruecaller(phoneNumber) {
        LOG.info(`[Caller Validation] 🔍 [Truecaller] Checking phone: ${phoneNumber}`);
        LOG.info(`[Caller Validation] 🔍 [Truecaller] Configuration:`);
        LOG.info(`[Caller Validation] 🔍 [Truecaller]   - API URL: https://api.truecaller.com/v1/search`);
        LOG.info(`[Caller Validation] 🔍 [Truecaller]   - API Key: ${this.truecallerApiKey ? '***' + this.truecallerApiKey.slice(-4) : 'NOT SET'}`);
        LOG.info(`[Caller Validation] 🔍 [Truecaller]   - Enabled: ${this.useTruecaller}`);
        
        if (!this.useTruecaller) {
            LOG.info(`[Caller Validation] ⏭️ [Truecaller] Skipped (not enabled)`);
            return { source: 'truecaller', isSpam: false, skipped: true };
        }

        try {
            const requestConfig = {
                params: { phone: phoneNumber },
                headers: {
                    'Authorization': `Bearer ${this.truecallerApiKey ? '***' + this.truecallerApiKey.slice(-4) : 'NOT SET'}`,
                    'User-Agent': 'Suraksha-App'
                },
                timeout: 3000
            };
            
            LOG.info(`[Caller Validation] 📤 [Truecaller] Making API call to: https://api.truecaller.com/v1/search`);
            LOG.info(`[Caller Validation] 📤 [Truecaller] Request Params:`, JSON.stringify(requestConfig.params, null, 2));
            LOG.info(`[Caller Validation] 📤 [Truecaller] Request Headers:`, JSON.stringify({
                ...requestConfig.headers,
                'Authorization': `Bearer ***${this.truecallerApiKey ? this.truecallerApiKey.slice(-4) : 'NOT SET'}`
            }, null, 2));
            LOG.info(`[Caller Validation] 📤 [Truecaller] Request Timeout: 3000ms`);
            
            const startTime = Date.now();
            const response = await axios.get(
                `https://api.truecaller.com/v1/search`,
                requestConfig
            );
            const duration = Date.now() - startTime;
            
            LOG.info(`[Caller Validation] 📥 [Truecaller] Response received in ${duration}ms`);
            LOG.info(`[Caller Validation] 📥 [Truecaller] Status Code: ${response.status}`);
            LOG.info(`[Caller Validation] 📥 [Truecaller] Response Data:`, JSON.stringify(response.data, null, 2));

            if (response.data) {
                const isSpam = response.data.spamScore > 50;
                LOG.info(`[Caller Validation] ✅ [Truecaller] Response received. Spam Score: ${response.data.spamScore || 0}, Is Spam: ${isSpam}`);
                return {
                    source: 'truecaller',
                    isSpam: isSpam,
                    callerName: response.data.name || null,
                    callerType: response.data.type || null,
                    spamScore: response.data.spamScore || 0,
                    tags: response.data.tags || []
                };
            }

            LOG.info(`[Caller Validation] ✅ [Truecaller] No data returned - Safe`);
            return { source: 'truecaller', isSpam: false };
        } catch (error) {
            LOG.error(`[Caller Validation] ❌ [Truecaller] Check failed!`);
            LOG.error(`[Caller Validation] ❌ [Truecaller] Error Message: ${error.message}`);
            LOG.error(`[Caller Validation] ❌ [Truecaller] Error Code: ${error.code || 'N/A'}`);
            LOG.error(`[Caller Validation] ❌ [Truecaller] Error Response Status: ${error.response?.status || 'N/A'}`);
            LOG.error(`[Caller Validation] ❌ [Truecaller] Error Response Data:`, JSON.stringify(error.response?.data || {}, null, 2));
            LOG.error(`[Caller Validation] ❌ [Truecaller] Error Stack:`, error.stack);
            return { source: 'truecaller', isSpam: false, error: error.message };
        }
    }

    /**
     * Check for suspicious patterns
     * @private
     */
    async _checkPattern(phoneNumber) {
        LOG.info(`[Caller Validation] 🔍 [Pattern Detection] Checking phone: ${phoneNumber}`);
        const patterns = this._detectSuspiciousPatterns(phoneNumber);
        
        LOG.info(`[Caller Validation] 🔍 [Pattern Detection] Patterns detected: ${patterns.length}`);
        if (patterns.length > 0) {
            LOG.info(`[Caller Validation] 🔍 [Pattern Detection] Pattern details:`, JSON.stringify(patterns, null, 2));
            const isSpam = patterns.some(p => p.severity === 'high');
            LOG.info(`[Caller Validation] ✅ [Pattern Detection] Suspicious patterns found. Is Spam: ${isSpam}`);
            return {
                source: 'pattern_detection',
                isSpam: isSpam,
                suspiciousPatterns: patterns,
                tags: ['suspicious_pattern']
            };
        }

        LOG.info(`[Caller Validation] ✅ [Pattern Detection] No suspicious patterns - Safe`);
        return { source: 'pattern_detection', isSpam: false };
    }

    /**
     * Detect suspicious number patterns
     * @private
     */
    _detectSuspiciousPatterns(phoneNumber) {
        const patterns = [];
        const digits = phoneNumber.replace(/\D/g, '');

        // Sequential numbers (e.g., 1234567890)
        if (/012345|123456|234567|345678|456789|567890/.test(digits)) {
            patterns.push({ type: 'sequential', severity: 'high' });
        }

        // Repeated digits (e.g., 1111111111, 9999999999)
        if (/^(\d)\1{7,}$/.test(digits)) {
            patterns.push({ type: 'repeated', severity: 'medium' });
        }

        // All same digit groups (e.g., 1111-2222-3333)
        if (/^(\d{4})\1/.test(digits)) {
            patterns.push({ type: 'repeated_groups', severity: 'medium' });
        }

        // Suspicious prefixes (e.g., +91-0, invalid country codes)
        if (/^\+91[1-9]0/.test(phoneNumber)) {
            patterns.push({ type: 'invalid_prefix', severity: 'high' });
        }

        return patterns;
    }

    /**
     * Aggregate validation results from multiple sources
     * @private
     */
    _aggregateResults(phoneNumber, results) {
        const aggregated = {
            phoneNumber,
            validatedAt: new Date().toISOString(),
            isSpam: false,
            isScam: false,
            isTelemarketing: false,
            callerName: null,
            callerType: null,
            confidence: 0,
            sources: [],
            tags: [],
            spamScore: 0,
            recommendations: []
        };

        let spamCount = 0;
        let totalSources = 0;

        results.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value) {
                const value = result.value;
                if (value.skipped) return;

                totalSources++;
                
                if (value.isSpam) {
                    spamCount++;
                    aggregated.isSpam = true;
                    
                    if (value.isScam) aggregated.isScam = true;
                    if (value.isTelemarketing) aggregated.isTelemarketing = true;
                    
                    if (value.callerName && !aggregated.callerName) {
                        aggregated.callerName = value.callerName;
                    }
                    
                    if (value.tags) {
                        aggregated.tags.push(...value.tags);
                    }
                    
                    if (value.spamScore) {
                        aggregated.spamScore = Math.max(aggregated.spamScore, value.spamScore);
                    }
                } else if (value.callerName && !aggregated.callerName) {
                    aggregated.callerName = value.callerName;
                }

                aggregated.sources.push({
                    source: value.source,
                    isSpam: value.isSpam || false,
                    confidence: value.confidence || (value.isSpam ? 80 : 20)
                });
            }
        });

        // Calculate confidence based on sources
        if (totalSources > 0) {
            aggregated.confidence = Math.round((spamCount / totalSources) * 100);
        }

        // Generate recommendations
        if (aggregated.isSpam) {
            if (aggregated.isScam) {
                aggregated.recommendations.push('⚠️ This is a scam number. Do not answer or call back.');
            } else if (aggregated.isTelemarketing) {
                aggregated.recommendations.push('📞 This is a telemarketing number. You can block it.');
            } else {
                aggregated.recommendations.push('⚠️ This number is marked as spam. Proceed with caution.');
            }
        } else {
            aggregated.recommendations.push('✅ This number appears safe.');
        }

        // Remove duplicate tags
        aggregated.tags = [...new Set(aggregated.tags)];

        return aggregated;
    }

    /**
     * Store call in history
     * @private
     */
    async _storeCallHistory(phoneNumber, validationResult, userId) {
        const callRecord = {
            id: `call_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            phone_number: phoneNumber,
            user_id: userId,
            validated_at: validationResult.validatedAt,
            is_spam: validationResult.isSpam,
            is_scam: validationResult.isScam,
            is_telemarketing: validationResult.isTelemarketing,
            caller_name: validationResult.callerName,
            confidence: validationResult.confidence,
            spam_score: validationResult.spamScore,
            tags: validationResult.tags,
            sources: validationResult.sources,
            created_at: new Date()
        };

        db.callHistory.push(callRecord);
        
        // Keep only last 1000 calls per user
        if (userId) {
            const userCalls = db.callHistory.filter(c => c.user_id === userId);
            if (userCalls.length > 1000) {
                const toRemove = userCalls.slice(0, userCalls.length - 1000);
                toRemove.forEach(call => {
                    const index = db.callHistory.findIndex(c => c.id === call.id);
                    if (index > -1) db.callHistory.splice(index, 1);
                });
            }
        }

        return callRecord;
    }

    /**
     * Report spam number (community reporting)
     */
    async reportSpamNumber(phoneNumber, userId, reportData) {
        try {
            const normalizedNumber = this._normalizePhoneNumber(phoneNumber);
            
            // Check if already reported
            let existingReport = db.communityReports.find(r => r.phone_number === normalizedNumber);
            
            if (existingReport) {
                existingReport.report_count = (existingReport.report_count || 0) + 1;
                existingReport.last_reported = new Date();
                existingReport.reported_by.push(userId);
            } else {
                const newReport = {
                    id: `report_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                    phone_number: normalizedNumber,
                    caller_name: reportData.callerName || null,
                    is_scam: reportData.isScam || false,
                    is_telemarketing: reportData.isTelemarketing || false,
                    tags: reportData.tags || [],
                    report_count: 1,
                    reported_by: [userId],
                    reported_at: new Date(),
                    last_reported: new Date(),
                    source: 'community'
                };
                
                db.communityReports.push(newReport);
                
                // Also add to spam numbers if not exists
                const existingSpam = db.spamNumbers.find(s => s.phone_number === normalizedNumber);
                if (!existingSpam) {
                    db.spamNumbers.push({
                        id: `spam_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                        phone_number: normalizedNumber,
                        caller_name: reportData.callerName || null,
                        is_scam: reportData.isScam || false,
                        is_telemarketing: reportData.isTelemarketing || false,
                        tags: reportData.tags || [],
                        report_count: 1,
                        source: 'community',
                        created_at: new Date(),
                        updated_at: new Date()
                    });
                }
            }

            LOG.success(`[Caller Validation] Spam number reported: ${normalizedNumber}`);
            return { success: true, message: 'Spam number reported successfully' };
        } catch (error) {
            LOG.error(`[Caller Validation] Error reporting spam:`, error);
            throw error;
        }
    }

    /**
     * Get call history for user
     */
    async getCallHistory(userId, limit = 50) {
        if (!userId) return [];
        
        return db.callHistory
            .filter(c => c.user_id === userId)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, limit);
    }

    /**
     * Normalize phone number
     * @private
     */
    _normalizePhoneNumber(phoneNumber) {
        // Remove +, spaces, dashes, parentheses
        let normalized = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
        
        // Handle Indian numbers (+91 prefix)
        if (normalized.startsWith('91') && normalized.length === 12) {
            normalized = normalized.substring(2);
        }
        
        // Remove leading 0 if present
        if (normalized.startsWith('0') && normalized.length === 11) {
            normalized = normalized.substring(1);
        }
        
        return normalized;
    }

    /**
     * Get default result on error
     * @private
     */
    _getDefaultResult(phoneNumber, status) {
        return {
            phoneNumber,
            validatedAt: new Date().toISOString(),
            isSpam: false,
            isScam: false,
            isTelemarketing: false,
            callerName: null,
            confidence: 0,
            sources: [],
            tags: [],
            status,
            recommendations: ['Unable to validate. Proceed with caution.']
        };
    }
}

module.exports = new CallerValidationService();

