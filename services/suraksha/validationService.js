/**
 * Suraksha Validation Service
 * Orchestrates fraud checking across multiple government APIs
 */
const i4cService = require('./i4cService');
const certInService = require('./certInService');
const sancharSaathiService = require('./sancharSaathiService');
const db = require('../../database');
const { sortTodayRecentFirst, withinRecentDays } = require('../../utils/recentSlice');
const LOG = require('../../utils/logger');

class ValidationService {
    /**
     * Validate input (phone/UPI/URL) against all fraud databases
     * @param {string} userId - User ID
     * @param {string} input - Input to validate
     * @param {string} type - 'phone', 'upi', 'url', or 'bank_account'
     * @returns {Promise<Object>} Validation result
     */
    async validateInput(userId, input, type) {
        try {
            LOG.info(`[Suraksha] Validating ${type}: ${input} for user: ${userId}`);
            
            // Create validation request record
            const requestId = `val_${Date.now()}_${Math.random().toString(36).substring(7)}`;
            
            // Store initial request
            await this._saveValidationRequest(requestId, userId, input, type, 'pending');
            
            // Run validations in parallel based on type
            const validations = [];
            
            LOG.info(`[Suraksha] ==========================================`);
            LOG.info(`[Suraksha] Starting validation for ${type}: ${input}`);
            LOG.info(`[Suraksha] User ID: ${userId}`);
            LOG.info(`[Suraksha] Request ID: ${requestId}`);
            LOG.info(`[Suraksha] ==========================================`);
            
            if (type === 'phone' || type === 'upi' || type === 'bank_account') {
                // Check I4C for fraud complaints
                LOG.info(`[Suraksha] 📞 Calling I4C API for ${type} validation...`);
                validations.push(
                    i4cService.checkFraudStatus(input, type)
                        .then(result => {
                            LOG.info(`[Suraksha] ✅ I4C API response received:`, JSON.stringify(result, null, 2));
                            return { source: 'I4C', result };
                        })
                        .catch(err => {
                            LOG.error(`[Suraksha] ❌ I4C API error:`, err.message);
                            LOG.error(`[Suraksha] I4C Error stack:`, err.stack);
                            return { source: 'I4C', error: err.message };
                        })
                );
            }
            
            if (type === 'url') {
                // Check CERT-In for threats
                LOG.info(`[Suraksha] 🌐 Calling CERT-In API for URL validation...`);
                validations.push(
                    certInService.checkUrl(input)
                        .then(result => {
                            LOG.info(`[Suraksha] ✅ CERT-In API response received:`, JSON.stringify(result, null, 2));
                            return { source: 'CERT-In', result };
                        })
                        .catch(err => {
                            LOG.error(`[Suraksha] ❌ CERT-In API error:`, err.message);
                            LOG.error(`[Suraksha] CERT-In Error stack:`, err.stack);
                            return { source: 'CERT-In', error: err.message };
                        })
                );
            }
            
            LOG.info(`[Suraksha] ⏳ Waiting for ${validations.length} validation(s) to complete...`);
            
            // Wait for all validations to complete
            const results = await Promise.all(validations);
            
            LOG.info(`[Suraksha] ✅ All validations completed. Results:`, JSON.stringify(results, null, 2));
            LOG.info(`[Suraksha] Results count: ${results.length}`);
            if (results.length > 0) {
                LOG.info(`[Suraksha] First result:`, JSON.stringify(results[0], null, 2));
                LOG.info(`[Suraksha] First result.source: ${results[0]?.source}`);
                LOG.info(`[Suraksha] First result.result:`, JSON.stringify(results[0]?.result, null, 2));
                LOG.info(`[Suraksha] First result.result.isFraud: ${results[0]?.result?.isFraud}`);
            }
            
            // Determine overall status
            const isFraud = results.some(r => 
                r.result?.isFraud === true || 
                r.result?.isThreat === true
            );
            
            const status = isFraud ? 'fraud' : 'safe';
            const resultData = {
                input,
                type,
                validations: results,
                overallStatus: status,
                timestamp: new Date().toISOString()
            };
            
            // Update validation request with results
            await this._updateValidationRequest(requestId, status, resultData);
            
            return {
                requestId,
                status,
                result: resultData,
                isFraud
            };
        } catch (error) {
            LOG.error(`[Suraksha] Validation error:`, error.message);
            throw error;
        }
    }

    /**
     * Check for new SIM cards (periodic monitoring)
     * @param {string} userId - User ID
     * @param {string} aadhaar - Aadhaar number (optional)
     * @returns {Promise<Object>} SIM check result
     */
    async checkNewSIMs(userId, aadhaar) {
        try {
            LOG.info(`[Suraksha] Checking new SIMs for user: ${userId}`);
            
            const result = await sancharSaathiService.checkSIMs(aadhaar || userId);
            
            // Check if there are new SIMs (compare with last check)
            const lastCheck = await this._getLastSIMCheck(userId);
            const newSIMs = result.sims.filter(sim => {
                if (!lastCheck) return true;
                const simDate = new Date(sim.issuedDate);
                const lastCheckDate = new Date(lastCheck.lastChecked);
                return simDate > lastCheckDate;
            });
            
            if (newSIMs.length > 0) {
                // Store alert
                await this._saveSIMAlert(userId, newSIMs);
            }
            
            // Update last check time
            await this._updateLastSIMCheck(userId, result.lastChecked);
            
            return {
                totalSIMs: result.totalSIMs,
                newSIMs: newSIMs.length,
                sims: result.sims,
                alerts: newSIMs
            };
        } catch (error) {
            LOG.error(`[Suraksha] SIM check error:`, error.message);
            throw error;
        }
    }

    /**
     * Save validation request to database
     * @private
     */
    async _saveValidationRequest(requestId, userId, input, type, status) {
        // Using in-memory DB for now - replace with MySQL
        if (!db.surakshaValidations) {
            db.surakshaValidations = [];
        }
        
        db.surakshaValidations.push({
            id: requestId,
            user_id: userId,
            input_value: input,
            type,
            status,
            result_data: null,
            created_at: new Date(),
            updated_at: new Date()
        });
    }

    /**
     * Update validation request with results
     * @private
     */
    async _updateValidationRequest(requestId, status, resultData) {
        if (db.surakshaValidations) {
            const request = db.surakshaValidations.find(v => v.id === requestId);
            if (request) {
                request.status = status;
                request.result_data = resultData;
                request.updated_at = new Date();
            }
        }
    }

    /**
     * Get last SIM check time
     * @private
     */
    async _getLastSIMCheck(userId) {
        // Mock - replace with actual DB query
        return null;
    }

    /**
     * Update last SIM check time
     * @private
     */
    async _updateLastSIMCheck(userId, lastChecked) {
        // Mock - replace with actual DB query
        return true;
    }

    /**
     * Save SIM alert
     * @private
     */
    async _saveSIMAlert(userId, newSIMs) {
        // Mock - replace with actual DB query
        LOG.info(`[Suraksha] New SIMs detected for user ${userId}:`, newSIMs);
        return true;
    }

    /**
     * Get validation history for user
     */
    async getValidationHistory(userId, limit = 24) {
        const capped = Math.min(parseInt(limit, 10) || 24, 40);
        if (db.surakshaValidations) {
            const rows = withinRecentDays(
                db.surakshaValidations.filter((v) => v.user_id === userId),
                30,
                ['created_at', 'updated_at']
            );
            return sortTodayRecentFirst(rows, capped, ['created_at', 'updated_at']);
        }
        return [];
    }
}

module.exports = new ValidationService();

