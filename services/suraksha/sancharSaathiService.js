/**
 * Sanchar Saathi (TAFCOP) Service
 * Checks SIM cards linked to user's Aadhaar and blocks IMEI via CEIR
 * 
 * API Status: AVAILABLE (with authentication)
 * - TAFCOP (Telecom Analytics for Fraud Management and Consumer Protection) has public API
 * - CEIR (Central Equipment Identity Register) has API for IMEI blocking
 * - Integration requires: Aadhaar verification, API credentials from DoT
 * - Public portals: https://www.sancharsaathi.gov.in/ (TAFCOP), https://www.ceir.gov.in/ (CEIR)
 */
const axios = require('axios');
const LOG = require('../../utils/logger');

class SancharSaathiService {
    constructor() {
        this.baseUrl = process.env.SANCHAR_SAATHI_API_URL || 'https://www.sancharsaathi.gov.in/api';
        this.apiKey = process.env.SANCHAR_SAATHI_API_KEY || '';
        this.ceirBaseUrl = process.env.CEIR_API_URL || 'https://www.ceir.gov.in/api';
        this.ceirApiKey = process.env.CEIR_API_KEY || this.apiKey;
        
        // Configuration: Enable/disable mock data fallback
        this.useMockData = process.env.SANCHAR_SAATHI_USE_MOCK === 'true' || !this.apiKey;
        this.enableRealAPI = process.env.SANCHAR_SAATHI_ENABLE_REAL_API === 'true' && this.apiKey;
        
        // Request timeout (5 seconds)
        this.timeout = parseInt(process.env.SANCHAR_SAATHI_API_TIMEOUT) || 5000;
    }

    /**
     * Check SIM cards linked to user's Aadhaar/UID
     * @param {string} uid - Aadhaar number or user ID
     * @returns {Promise<Object>} SIM card information
     */
    async checkSIMs(uid) {
        try {
            LOG.info(`[Sanchar Saathi] ==========================================`);
            LOG.info(`[Sanchar Saathi] 🔍 Checking SIMs for UID: ${uid}`);
            LOG.info(`[Sanchar Saathi] Configuration:`);
            LOG.info(`[Sanchar Saathi]   - Base URL: ${this.baseUrl}`);
            LOG.info(`[Sanchar Saathi]   - API Key: ${this.apiKey ? '***' + this.apiKey.slice(-4) : 'NOT SET'}`);
            LOG.info(`[Sanchar Saathi]   - Use Mock Data: ${this.useMockData}`);
            LOG.info(`[Sanchar Saathi]   - Enable Real API: ${this.enableRealAPI}`);
            LOG.info(`[Sanchar Saathi]   - Timeout: ${this.timeout}ms`);
            LOG.info(`[Sanchar Saathi] ==========================================`);
            
            // Try real API first if enabled
            if (this.enableRealAPI && !this.useMockData) {
                try {
                    const requestPayload = {
                        uid: uid,
                        timestamp: new Date().toISOString()
                    };
                    const requestConfig = {
                        headers: {
                            'Authorization': `Bearer ${this.apiKey ? '***' + this.apiKey.slice(-4) : 'NOT SET'}`,
                            'Content-Type': 'application/json',
                            'User-Agent': 'Suraksha-App/1.0'
                        },
                        timeout: this.timeout
                    };
                    
                    LOG.info(`[Sanchar Saathi] 📤 Making API call to: ${this.baseUrl}/tafcop/check`);
                    LOG.info(`[Sanchar Saathi] 📤 Request Payload:`, JSON.stringify(requestPayload, null, 2));
                    LOG.info(`[Sanchar Saathi] 📤 Request Headers:`, JSON.stringify({
                        ...requestConfig.headers,
                        'Authorization': `Bearer ***${this.apiKey ? this.apiKey.slice(-4) : 'NOT SET'}`
                    }, null, 2));
                    LOG.info(`[Sanchar Saathi] 📤 Request Timeout: ${this.timeout}ms`);
                    
                    const startTime = Date.now();
                    const response = await axios.post(
                        `${this.baseUrl}/tafcop/check`,
                        requestPayload,
                        requestConfig
                    );
                    const duration = Date.now() - startTime;
                    
                    LOG.info(`[Sanchar Saathi] 📥 Response received in ${duration}ms`);
                    LOG.info(`[Sanchar Saathi] 📥 Status Code: ${response.status}`);
                    LOG.info(`[Sanchar Saathi] 📥 Response Data:`, JSON.stringify(response.data, null, 2));

                    if (response.data && response.status === 200) {
                        LOG.success(`[Sanchar Saathi] ✅ Real API response received successfully`);
                        const result = {
                            totalSIMs: response.data.totalSIMs || response.data.total_sims || 0,
                            sims: response.data.sims || response.data.sim_cards || [],
                            lastChecked: response.data.lastChecked || new Date().toISOString(),
                            source: 'Sanchar-Saathi-TAFCOP',
                            apiSource: 'real'
                        };
                        LOG.info(`[Sanchar Saathi] ✅ Final Result:`, JSON.stringify(result, null, 2));
                        return result;
                    } else {
                        LOG.warning(`[Sanchar Saathi] ⚠️ Unexpected response status: ${response.status}`);
                        LOG.warning(`[Sanchar Saathi] Response data:`, JSON.stringify(response.data, null, 2));
                    }
                } catch (apiError) {
                    LOG.error(`[Sanchar Saathi] ❌ Real API call failed!`);
                    LOG.error(`[Sanchar Saathi] Error Message: ${apiError.message}`);
                    LOG.error(`[Sanchar Saathi] Error Code: ${apiError.code || 'N/A'}`);
                    LOG.error(`[Sanchar Saathi] Error Response Status: ${apiError.response?.status || 'N/A'}`);
                    LOG.error(`[Sanchar Saathi] Error Response Data:`, JSON.stringify(apiError.response?.data || {}, null, 2));
                    LOG.error(`[Sanchar Saathi] Error Stack:`, apiError.stack);
                    
                    if (!this.useMockData) {
                        LOG.error(`[Sanchar Saathi] ❌ Mock data disabled, throwing error`);
                        throw apiError;
                    }
                    
                    LOG.warning(`[Sanchar Saathi] ⚠️ Falling back to mock data for UID: ${uid}`);
                }
            } else {
                LOG.info(`[Sanchar Saathi] ℹ️ Real API is disabled or mock mode is enabled`);
                LOG.info(`[Sanchar Saathi]   - enableRealAPI: ${this.enableRealAPI}`);
                LOG.info(`[Sanchar Saathi]   - useMockData: ${this.useMockData}`);
                LOG.info(`[Sanchar Saathi]   - API Key present: ${!!this.apiKey}`);
            }

            // Use mock data (either configured or as fallback)
            if (this.useMockData) {
                LOG.info(`[Sanchar Saathi] 🎭 Using MOCK data (simulating API delay)...`);
                await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
                const mockResult = this._getMockSIMCheck(uid);
                LOG.info(`[Sanchar Saathi] 🎭 Mock Result:`, JSON.stringify(mockResult, null, 2));
                LOG.info(`[Sanchar Saathi] 🎭 Total SIMs: ${mockResult.totalSIMs}`);
                return {
                    ...mockResult,
                    apiSource: 'mock'
                };
            }

            throw new Error('Sanchar Saathi API unavailable and mock data is disabled');
            
        } catch (error) {
            LOG.error(`[Sanchar Saathi] Error checking SIMs:`, error.message);
            
            // If mock is enabled, return mock data even on error
            if (this.useMockData) {
                LOG.info(`[Sanchar Saathi] Error occurred, returning mock data as fallback`);
                return {
                    ...this._getMockSIMCheck(uid),
                    apiSource: 'mock',
                    error: error.message
                };
            }
            
            return {
                totalSIMs: 0,
                sims: [],
                error: error.message,
                source: 'Sanchar-Saathi-TAFCOP',
                apiSource: 'error'
            };
        }
    }

    /**
     * Block IMEI via CEIR API
     * @param {string} imei - IMEI number to block
     * @param {Object} userInfo - User information
     * @returns {Promise<Object>} Blocking result
     */
    async blockIMEI(imei, userInfo) {
        try {
            LOG.info(`[CEIR] ==========================================`);
            LOG.info(`[CEIR] 🔒 Blocking IMEI: ${imei}`);
            LOG.info(`[CEIR] Configuration:`);
            LOG.info(`[CEIR]   - CEIR Base URL: ${this.ceirBaseUrl}`);
            LOG.info(`[CEIR]   - CEIR API Key: ${this.ceirApiKey ? '***' + this.ceirApiKey.slice(-4) : 'NOT SET'}`);
            LOG.info(`[CEIR]   - Use Mock Data: ${this.useMockData}`);
            LOG.info(`[CEIR]   - Enable Real API: ${this.enableRealAPI}`);
            LOG.info(`[CEIR]   - Timeout: ${this.timeout}ms`);
            LOG.info(`[CEIR] ==========================================`);
            
            // Validate IMEI format
            if (!/^\d{15}$/.test(imei)) {
                LOG.error(`[CEIR] ❌ Invalid IMEI format: ${imei} (must be 15 digits)`);
                throw new Error('Invalid IMEI format. Must be 15 digits.');
            }
            
            // Try real API first if enabled
            if (this.enableRealAPI && !this.useMockData) {
                try {
                    const requestPayload = {
                        imei: imei,
                        userId: userInfo.userId,
                        reason: userInfo.reason || 'Lost/Stolen',
                        aadhaar: userInfo.aadhaar,
                        timestamp: new Date().toISOString()
                    };
                    const requestConfig = {
                        headers: {
                            'Authorization': `Bearer ${this.ceirApiKey ? '***' + this.ceirApiKey.slice(-4) : 'NOT SET'}`,
                            'Content-Type': 'application/json',
                            'User-Agent': 'Suraksha-App/1.0'
                        },
                        timeout: this.timeout
                    };
                    
                    LOG.info(`[CEIR] 📤 Making API call to: ${this.ceirBaseUrl}/block`);
                    LOG.info(`[CEIR] 📤 Request Payload:`, JSON.stringify(requestPayload, null, 2));
                    LOG.info(`[CEIR] 📤 Request Headers:`, JSON.stringify({
                        ...requestConfig.headers,
                        'Authorization': `Bearer ***${this.ceirApiKey ? this.ceirApiKey.slice(-4) : 'NOT SET'}`
                    }, null, 2));
                    LOG.info(`[CEIR] 📤 Request Timeout: ${this.timeout}ms`);
                    
                    const startTime = Date.now();
                    const response = await axios.post(
                        `${this.ceirBaseUrl}/block`,
                        requestPayload,
                        requestConfig
                    );
                    const duration = Date.now() - startTime;
                    
                    LOG.info(`[CEIR] 📥 Response received in ${duration}ms`);
                    LOG.info(`[CEIR] 📥 Status Code: ${response.status}`);
                    LOG.info(`[CEIR] 📥 Response Data:`, JSON.stringify(response.data, null, 2));

                    if (response.data && response.status === 200) {
                        LOG.success(`[CEIR] ✅ Real API response received successfully`);
                        const result = {
                            success: true,
                            imei: imei,
                            blockedAt: response.data.blockedAt || response.data.blocked_at || new Date().toISOString(),
                            status: response.data.status || 'blocked',
                            message: response.data.message || 'IMEI blocked successfully across all Indian networks',
                            networks: response.data.networks || ['Airtel', 'Jio', 'Vi', 'BSNL'],
                            source: 'CEIR',
                            apiSource: 'real'
                        };
                        LOG.info(`[CEIR] ✅ Final Result:`, JSON.stringify(result, null, 2));
                        return result;
                    } else {
                        LOG.warning(`[CEIR] ⚠️ Unexpected response status: ${response.status}`);
                        LOG.warning(`[CEIR] Response data:`, JSON.stringify(response.data, null, 2));
                    }
                } catch (apiError) {
                    LOG.error(`[CEIR] ❌ Real API call failed!`);
                    LOG.error(`[CEIR] Error Message: ${apiError.message}`);
                    LOG.error(`[CEIR] Error Code: ${apiError.code || 'N/A'}`);
                    LOG.error(`[CEIR] Error Response Status: ${apiError.response?.status || 'N/A'}`);
                    LOG.error(`[CEIR] Error Response Data:`, JSON.stringify(apiError.response?.data || {}, null, 2));
                    LOG.error(`[CEIR] Error Stack:`, apiError.stack);
                    
                    if (!this.useMockData) {
                        LOG.error(`[CEIR] ❌ Mock data disabled, throwing error`);
                        throw apiError;
                    }
                    
                    LOG.warning(`[CEIR] ⚠️ Falling back to mock data for IMEI blocking`);
                }
            } else {
                LOG.info(`[CEIR] ℹ️ Real API is disabled or mock mode is enabled`);
                LOG.info(`[CEIR]   - enableRealAPI: ${this.enableRealAPI}`);
                LOG.info(`[CEIR]   - useMockData: ${this.useMockData}`);
                LOG.info(`[CEIR]   - API Key present: ${!!this.ceirApiKey}`);
            }

            // Use mock data (either configured or as fallback)
            if (this.useMockData) {
                LOG.info(`[CEIR] 🎭 Using MOCK data (simulating API delay)...`);
                await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
                const result = {
                    success: true,
                    imei: imei,
                    blockedAt: new Date().toISOString(),
                    status: 'blocked',
                    message: 'IMEI blocked successfully across all Indian networks',
                    networks: ['Airtel', 'Jio', 'Vi', 'BSNL'],
                    source: 'CEIR',
                    apiSource: 'mock'
                };
                LOG.info(`[CEIR] 🎭 Mock Result:`, JSON.stringify(result, null, 2));
                return result;
            }

            throw new Error('CEIR API unavailable and mock data is disabled');
            
        } catch (error) {
            LOG.error(`[CEIR] Error blocking IMEI:`, error.message);
            
            if (this.useMockData) {
                LOG.info(`[CEIR] Error occurred, returning mock data as fallback`);
                return {
                    success: true,
                    imei: imei,
                    blockedAt: new Date().toISOString(),
                    status: 'blocked',
                    message: 'IMEI blocked successfully (mock mode)',
                    networks: ['Airtel', 'Jio', 'Vi', 'BSNL'],
                    source: 'CEIR',
                    apiSource: 'mock',
                    error: error.message
                };
            }
            
            return {
                success: false,
                error: error.message,
                source: 'CEIR',
                apiSource: 'error'
            };
        }
    }

    /**
     * Get mock SIM check (fallback)
     * @private
     */
    _getMockSIMCheck(uid) {
        const sims = this._mockSIMCheck(uid);
        
        return {
            totalSIMs: sims.length,
            sims: sims,
            lastChecked: new Date().toISOString(),
            source: 'Sanchar-Saathi-TAFCOP'
        };
    }

    /**
     * Mock SIM check - Replace with actual API logic
     * @private
     */
    _mockSIMCheck(uid) {
        // Mock: Return 2-3 SIM cards
        const count = Math.floor(Math.random() * 2) + 2;
        const sims = [];
        
        for (let i = 0; i < count; i++) {
            sims.push({
                mobileNumber: `9${Math.floor(Math.random() * 1000000000)}`,
                operator: ['Airtel', 'Jio', 'Vi', 'BSNL'][Math.floor(Math.random() * 4)],
                status: i === count - 1 ? 'new' : 'existing', // Last one is "new" for testing
                issuedDate: new Date(Date.now() - (count - i) * 30 * 24 * 60 * 60 * 1000).toISOString(),
                circle: ['Delhi', 'Mumbai', 'Bangalore', 'Pune'][Math.floor(Math.random() * 4)]
            });
        }
        
        return sims;
    }
}

module.exports = new SancharSaathiService();
