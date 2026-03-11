/**
 * CERT-In Threat Intelligence Service
 * Checks URLs and IPs against known phishing/malware databases
 * 
 * API Status: AVAILABLE (with limitations)
 * - CERT-In has public threat intelligence feeds
 * - Some feeds are available via API (requires registration)
 * - Phishing URL database: https://www.cert-in.org.in/s2cMainServlet?pageid=PUBIN
 * - Integration requires: CERT-In registration, API credentials
 */
const axios = require('axios');
const LOG = require('../../utils/logger');

class CERTInService {
    constructor() {
        this.baseUrl = process.env.CERTIN_API_URL || 'https://www.cert-in.org.in/api';
        this.apiKey = process.env.CERTIN_API_KEY || '';
        
        // Configuration: Enable/disable mock data fallback
        this.useMockData = process.env.CERTIN_USE_MOCK === 'true' || !this.apiKey;
        this.enableRealAPI = process.env.CERTIN_ENABLE_REAL_API === 'true' && this.apiKey;
        
        // Request timeout (5 seconds)
        this.timeout = parseInt(process.env.CERTIN_API_TIMEOUT) || 5000;
    }

    /**
     * Check if a URL or IP is a known threat
     * @param {string} url - URL or IP address to check
     * @returns {Promise<Object>} Threat status result
     */
    async checkUrl(url) {
        try {
            LOG.info(`[CERT-In] ==========================================`);
            LOG.info(`[CERT-In] 🔍 Checking URL: ${url}`);
            LOG.info(`[CERT-In] Configuration:`);
            LOG.info(`[CERT-In]   - Base URL: ${this.baseUrl}`);
            LOG.info(`[CERT-In]   - API Key: ${this.apiKey ? '***' + this.apiKey.slice(-4) : 'NOT SET'}`);
            LOG.info(`[CERT-In]   - Use Mock Data: ${this.useMockData}`);
            LOG.info(`[CERT-In]   - Enable Real API: ${this.enableRealAPI}`);
            LOG.info(`[CERT-In]   - Timeout: ${this.timeout}ms`);
            LOG.info(`[CERT-In] ==========================================`);
            
            // Try real API first if enabled
            if (this.enableRealAPI && !this.useMockData) {
                try {
                    // Extract domain from URL
                    const domain = this._extractDomain(url);
                    const requestPayload = {
                        url: url,
                        domain: domain,
                        type: 'url',
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
                    
                    LOG.info(`[CERT-In] 📤 Making API call to: ${this.baseUrl}/threat/check`);
                    LOG.info(`[CERT-In] 📤 Request Payload:`, JSON.stringify(requestPayload, null, 2));
                    LOG.info(`[CERT-In] 📤 Request Headers:`, JSON.stringify({
                        ...requestConfig.headers,
                        'Authorization': `Bearer ***${this.apiKey ? this.apiKey.slice(-4) : 'NOT SET'}`
                    }, null, 2));
                    LOG.info(`[CERT-In] 📤 Request Timeout: ${this.timeout}ms`);
                    
                    const startTime = Date.now();
                    const response = await axios.post(
                        `${this.baseUrl}/threat/check`,
                        requestPayload,
                        requestConfig
                    );
                    const duration = Date.now() - startTime;
                    
                    LOG.info(`[CERT-In] 📥 Response received in ${duration}ms`);
                    LOG.info(`[CERT-In] 📥 Status Code: ${response.status}`);
                    LOG.info(`[CERT-In] 📥 Response Data:`, JSON.stringify(response.data, null, 2));

                    if (response.data && response.status === 200) {
                        LOG.success(`[CERT-In] ✅ Real API response received successfully`);
                        const result = {
                            isThreat: response.data.isThreat || response.data.threat_detected || false,
                            threatType: response.data.threatType || response.data.threat_type || null,
                            severity: response.data.severity || (response.data.isThreat ? 'high' : 'none'),
                            firstSeen: response.data.firstSeen || response.data.first_seen || null,
                            lastSeen: response.data.lastSeen || response.data.last_seen || null,
                            reports: response.data.reports || response.data.report_count || 0,
                            source: 'CERT-In',
                            apiSource: 'real'
                        };
                        LOG.info(`[CERT-In] ✅ Final Result:`, JSON.stringify(result, null, 2));
                        return result;
                    } else {
                        LOG.warning(`[CERT-In] ⚠️ Unexpected response status: ${response.status}`);
                        LOG.warning(`[CERT-In] Response data:`, JSON.stringify(response.data, null, 2));
                    }
                } catch (apiError) {
                    LOG.error(`[CERT-In] ❌ Real API call failed!`);
                    LOG.error(`[CERT-In] Error Message: ${apiError.message}`);
                    LOG.error(`[CERT-In] Error Code: ${apiError.code || 'N/A'}`);
                    LOG.error(`[CERT-In] Error Response Status: ${apiError.response?.status || 'N/A'}`);
                    LOG.error(`[CERT-In] Error Response Data:`, JSON.stringify(apiError.response?.data || {}, null, 2));
                    LOG.error(`[CERT-In] Error Stack:`, apiError.stack);
                    
                    if (!this.useMockData) {
                        LOG.error(`[CERT-In] ❌ Mock data disabled, throwing error`);
                        throw apiError;
                    }
                    
                    LOG.warning(`[CERT-In] ⚠️ Falling back to mock data for URL: ${url}`);
                }
            } else {
                LOG.info(`[CERT-In] ℹ️ Real API is disabled or mock mode is enabled`);
                LOG.info(`[CERT-In]   - enableRealAPI: ${this.enableRealAPI}`);
                LOG.info(`[CERT-In]   - useMockData: ${this.useMockData}`);
                LOG.info(`[CERT-In]   - API Key present: ${!!this.apiKey}`);
            }

            // Use mock data (either configured or as fallback)
            if (this.useMockData) {
                LOG.info(`[CERT-In] 🎭 Using MOCK data (simulating API delay)...`);
                await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
                const mockResult = this._getMockThreatStatus(url);
                LOG.info(`[CERT-In] 🎭 Mock Result:`, JSON.stringify(mockResult, null, 2));
                LOG.info(`[CERT-In] 🎭 Threat detected: ${mockResult.isThreat}`);
                return {
                    ...mockResult,
                    apiSource: 'mock'
                };
            }

            throw new Error('CERT-In API unavailable and mock data is disabled');
            
        } catch (error) {
            LOG.error(`[CERT-In] Error checking URL:`, error.message);
            
            // If mock is enabled, return mock data even on error
            if (this.useMockData) {
                LOG.info(`[CERT-In] Error occurred, returning mock data as fallback`);
                return {
                    ...this._getMockThreatStatus(url),
                    apiSource: 'mock',
                    error: error.message
                };
            }
            
            return {
                isThreat: false,
                error: error.message,
                source: 'CERT-In',
                apiSource: 'error'
            };
        }
    }

    /**
     * Extract domain from URL
     * @private
     */
    _extractDomain(url) {
        try {
            const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
            return urlObj.hostname;
        } catch (e) {
            return url;
        }
    }

    /**
     * Get mock threat status (fallback)
     * @private
     */
    _getMockThreatStatus(url) {
        const isThreat = this._mockThreatCheck(url);
        
        return {
            isThreat,
            threatType: isThreat ? 'phishing' : null,
            severity: isThreat ? 'high' : 'none',
            firstSeen: isThreat ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() : null,
            lastSeen: isThreat ? new Date().toISOString() : null,
            reports: isThreat ? Math.floor(Math.random() * 100) + 10 : 0,
            source: 'CERT-In'
        };
    }

    /**
     * Mock threat check - Replace with actual API logic
     * @private
     */
    _mockThreatCheck(url) {
        // Mock logic: certain domains/patterns are flagged
        const suspiciousPatterns = [
            'phishing',
            'scam',
            'fraud',
            'malware',
            'bit.ly/suspicious',
            'tinyurl.com/fake'
        ];
        
        const lowerUrl = url.toLowerCase();
        return suspiciousPatterns.some(pattern => lowerUrl.includes(pattern));
    }
}

module.exports = new CERTInService();
