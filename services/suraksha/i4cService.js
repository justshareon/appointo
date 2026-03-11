/**
 * I4C (NCRP-CFCFRMS) API Service
 * Handles fraud complaint checking and filing
 * 
 * API Status: PARTIALLY AVAILABLE
 * - NCRP (National Cybercrime Reporting Portal) exists but API access requires government approval
 * - CFCFRMS (Citizen Financial Cyber Fraud Reporting and Management System) has limited public API
 * - Integration requires: Government partnership/approval, API credentials
 */
const axios = require('axios');
const LOG = require('../../utils/logger');

class I4CService {
    constructor() {
        // API endpoint - should be in environment variables
        this.baseUrl = process.env.I4C_API_URL || 'https://cybercrime.gov.in/api';
        this.apiKey = process.env.I4C_API_KEY || '';
        
        // Configuration: Enable/disable mock data fallback
        this.useMockData = process.env.I4C_USE_MOCK === 'true' || !this.apiKey;
        this.enableRealAPI = process.env.I4C_ENABLE_REAL_API === 'true' && this.apiKey;
        
        // Request timeout (5 seconds)
        this.timeout = parseInt(process.env.I4C_API_TIMEOUT) || 5000;
    }

    /**
     * Check if a phone number, UPI ID, or bank account is in active fraud complaint
     * @param {string} input - Phone number, UPI ID, or bank account
     * @param {string} type - 'phone', 'upi', or 'bank_account'
     * @returns {Promise<Object>} Fraud status result
     */
    async checkFraudStatus(input, type) {
        try {
            LOG.info(`[I4C] ==========================================`);
            LOG.info(`[I4C] 🔍 Checking fraud status for ${type}: ${input}`);
            LOG.info(`[I4C] Configuration:`);
            LOG.info(`[I4C]   - Base URL: ${this.baseUrl}`);
            LOG.info(`[I4C]   - API Key: ${this.apiKey ? '***' + this.apiKey.slice(-4) : 'NOT SET'}`);
            LOG.info(`[I4C]   - Use Mock Data: ${this.useMockData}`);
            LOG.info(`[I4C]   - Enable Real API: ${this.enableRealAPI}`);
            LOG.info(`[I4C]   - Timeout: ${this.timeout}ms`);
            LOG.info(`[I4C] ==========================================`);
            
            // Try real API first if enabled
            if (this.enableRealAPI && !this.useMockData) {
                try {
                    const sanitizedInput = this._sanitizeInput(input, type);
                    const requestPayload = {
                        input: sanitizedInput,
                        type: type,
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
                    
                    LOG.info(`[I4C] 📤 Making API call to: ${this.baseUrl}/fraud/check`);
                    LOG.info(`[I4C] 📤 Request Payload:`, JSON.stringify(requestPayload, null, 2));
                    LOG.info(`[I4C] 📤 Request Headers:`, JSON.stringify({
                        ...requestConfig.headers,
                        'Authorization': `Bearer ***${this.apiKey ? this.apiKey.slice(-4) : 'NOT SET'}`
                    }, null, 2));
                    LOG.info(`[I4C] 📤 Request Timeout: ${this.timeout}ms`);
                    
                    const startTime = Date.now();
                    const response = await axios.post(
                        `${this.baseUrl}/fraud/check`,
                        requestPayload,
                        requestConfig
                    );
                    const duration = Date.now() - startTime;
                    
                    LOG.info(`[I4C] 📥 Response received in ${duration}ms`);
                    LOG.info(`[I4C] 📥 Status Code: ${response.status}`);
                    LOG.info(`[I4C] 📥 Response Data:`, JSON.stringify(response.data, null, 2));

                    if (response.data && response.status === 200) {
                        LOG.success(`[I4C] ✅ Real API response received successfully`);
                        const result = {
                            isFraud: response.data.isFraud || response.data.fraud_detected || false,
                            complaintId: response.data.complaintId || response.data.complaint_id || null,
                            complaintDate: response.data.complaintDate || response.data.complaint_date || null,
                            status: response.data.status || (response.data.isFraud ? 'active' : 'none'),
                            details: response.data.details || response.data.complaint_details || null,
                            source: 'I4C-NCRP-CFCFRMS',
                            apiSource: 'real'
                        };
                        LOG.info(`[I4C] ✅ Final Result:`, JSON.stringify(result, null, 2));
                        return result;
                    } else {
                        LOG.warning(`[I4C] ⚠️ Unexpected response status: ${response.status}`);
                        LOG.warning(`[I4C] Response data:`, JSON.stringify(response.data, null, 2));
                    }
                } catch (apiError) {
                    LOG.error(`[I4C] ❌ Real API call failed!`);
                    LOG.error(`[I4C] Error Message: ${apiError.message}`);
                    LOG.error(`[I4C] Error Code: ${apiError.code || 'N/A'}`);
                    LOG.error(`[I4C] Error Response Status: ${apiError.response?.status || 'N/A'}`);
                    LOG.error(`[I4C] Error Response Data:`, JSON.stringify(apiError.response?.data || {}, null, 2));
                    LOG.error(`[I4C] Error Stack:`, apiError.stack);
                    
                    // If API is required (not using mock), throw error
                    if (!this.useMockData) {
                        LOG.error(`[I4C] ❌ Mock data disabled, throwing error`);
                        throw apiError;
                    }
                    
                    // Otherwise, fall through to mock data
                    LOG.warning(`[I4C] ⚠️ Falling back to mock data for ${type}: ${input}`);
                }
            } else {
                LOG.info(`[I4C] ℹ️ Real API is disabled or mock mode is enabled`);
                LOG.info(`[I4C]   - enableRealAPI: ${this.enableRealAPI}`);
                LOG.info(`[I4C]   - useMockData: ${this.useMockData}`);
                LOG.info(`[I4C]   - API Key present: ${!!this.apiKey}`);
            }

            // Use mock data (either configured or as fallback)
            if (this.useMockData) {
                LOG.info(`[I4C] 🎭 Using MOCK data (simulating API delay)...`);
                await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500)); // Simulate delay
                const mockResult = this._getMockFraudStatus(input, type);
                LOG.info(`[I4C] 🎭 Mock Result:`, JSON.stringify(mockResult, null, 2));
                LOG.info(`[I4C] 🎭 Fraud detected: ${mockResult.isFraud}`);
                return {
                    ...mockResult,
                    apiSource: 'mock'
                };
            }

            // If we reach here, API failed and mock is disabled
            throw new Error('I4C API unavailable and mock data is disabled');
            
        } catch (error) {
            LOG.error(`[I4C] Error checking fraud status:`, error.message);
            
            // If mock is enabled, return mock data even on error
            if (this.useMockData) {
                LOG.info(`[I4C] Error occurred, returning mock data as fallback`);
                return {
                    ...this._getMockFraudStatus(input, type),
                    apiSource: 'mock',
                    error: error.message
                };
            }
            
            return {
                isFraud: false,
                error: error.message,
                source: 'I4C-NCRP-CFCFRMS',
                apiSource: 'error'
            };
        }
    }

    /**
     * File a fraud complaint via NCRP-CFCFRMS API
     * @param {Object} complaintData - Complaint details
     * @returns {Promise<Object>} Complaint filing result
     */
    async fileComplaint(complaintData) {
        try {
            LOG.info(`[I4C] ==========================================`);
            LOG.info(`[I4C] 📝 Filing complaint for user: ${complaintData.userId}`);
            LOG.info(`[I4C] Configuration:`);
            LOG.info(`[I4C]   - Base URL: ${this.baseUrl}`);
            LOG.info(`[I4C]   - API Key: ${this.apiKey ? '***' + this.apiKey.slice(-4) : 'NOT SET'}`);
            LOG.info(`[I4C]   - Use Mock Data: ${this.useMockData}`);
            LOG.info(`[I4C]   - Enable Real API: ${this.enableRealAPI}`);
            LOG.info(`[I4C]   - Timeout: ${this.timeout}ms`);
            LOG.info(`[I4C] ==========================================`);
            
            // Try real API first if enabled
            if (this.enableRealAPI && !this.useMockData) {
                try {
                    const requestPayload = {
                        userId: complaintData.userId,
                        input: complaintData.input,
                        type: complaintData.type,
                        amount: complaintData.amount,
                        description: complaintData.description || 'Fraud complaint filed via Suraksha app',
                        beneficiary: complaintData.beneficiary || complaintData.input,
                        transactionDate: complaintData.transactionDate || new Date().toISOString(),
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
                    
                    LOG.info(`[I4C] 📤 Making API call to: ${this.baseUrl}/complaint/file`);
                    LOG.info(`[I4C] 📤 Request Payload:`, JSON.stringify(requestPayload, null, 2));
                    LOG.info(`[I4C] 📤 Request Headers:`, JSON.stringify({
                        ...requestConfig.headers,
                        'Authorization': `Bearer ***${this.apiKey ? this.apiKey.slice(-4) : 'NOT SET'}`
                    }, null, 2));
                    LOG.info(`[I4C] 📤 Request Timeout: ${this.timeout}ms`);
                    
                    const startTime = Date.now();
                    const response = await axios.post(
                        `${this.baseUrl}/complaint/file`,
                        requestPayload,
                        requestConfig
                    );
                    const duration = Date.now() - startTime;
                    
                    LOG.info(`[I4C] 📥 Response received in ${duration}ms`);
                    LOG.info(`[I4C] 📥 Status Code: ${response.status}`);
                    LOG.info(`[I4C] 📥 Response Data:`, JSON.stringify(response.data, null, 2));

                    if (response.data && response.status === 200) {
                        LOG.success(`[I4C] ✅ Real API response received successfully`);
                        const result = {
                            success: true,
                            complaintId: response.data.complaintId || response.data.complaint_id,
                            status: response.data.status || 'filed',
                            message: response.data.message || 'Complaint filed successfully. Beneficiary accounts will be frozen automatically.',
                            filedAt: response.data.filedAt || new Date().toISOString(),
                            estimatedResolution: response.data.estimatedResolution || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                            apiSource: 'real'
                        };
                        LOG.info(`[I4C] ✅ Final Result:`, JSON.stringify(result, null, 2));
                        return result;
                    } else {
                        LOG.warning(`[I4C] ⚠️ Unexpected response status: ${response.status}`);
                        LOG.warning(`[I4C] Response data:`, JSON.stringify(response.data, null, 2));
                    }
                } catch (apiError) {
                    LOG.error(`[I4C] ❌ Real API call failed!`);
                    LOG.error(`[I4C] Error Message: ${apiError.message}`);
                    LOG.error(`[I4C] Error Code: ${apiError.code || 'N/A'}`);
                    LOG.error(`[I4C] Error Response Status: ${apiError.response?.status || 'N/A'}`);
                    LOG.error(`[I4C] Error Response Data:`, JSON.stringify(apiError.response?.data || {}, null, 2));
                    LOG.error(`[I4C] Error Stack:`, apiError.stack);
                    
                    if (!this.useMockData) {
                        LOG.error(`[I4C] ❌ Mock data disabled, throwing error`);
                        throw apiError;
                    }
                    
                    LOG.warning(`[I4C] ⚠️ Falling back to mock data for complaint filing`);
                }
            } else {
                LOG.info(`[I4C] ℹ️ Real API is disabled or mock mode is enabled`);
                LOG.info(`[I4C]   - enableRealAPI: ${this.enableRealAPI}`);
                LOG.info(`[I4C]   - useMockData: ${this.useMockData}`);
                LOG.info(`[I4C]   - API Key present: ${!!this.apiKey}`);
            }

            // Use mock data
            if (this.useMockData) {
                LOG.info(`[I4C] 🎭 Using MOCK data (simulating API delay)...`);
                await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
                const complaintId = `CFC-${Date.now()}-${Math.random().toString(36).substring(7)}`;
                const result = {
                    success: true,
                    complaintId,
                    status: 'filed',
                    message: 'Complaint filed successfully. Beneficiary accounts will be frozen automatically.',
                    filedAt: new Date().toISOString(),
                    estimatedResolution: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                    apiSource: 'mock'
                };
                LOG.info(`[I4C] 🎭 Mock Result:`, JSON.stringify(result, null, 2));
                return result;
            }

            throw new Error('I4C API unavailable and mock data is disabled');
            
        } catch (error) {
            LOG.error(`[I4C] Error filing complaint:`, error.message);
            
            if (this.useMockData) {
                LOG.info(`[I4C] Error occurred, returning mock data as fallback`);
                const complaintId = `CFC-${Date.now()}-${Math.random().toString(36).substring(7)}`;
                return {
                    success: true,
                    complaintId,
                    status: 'filed',
                    message: 'Complaint filed successfully (mock mode).',
                    filedAt: new Date().toISOString(),
                    apiSource: 'mock',
                    error: error.message
                };
            }
            
            return {
                success: false,
                error: error.message,
                apiSource: 'error'
            };
        }
    }

    /**
     * Sanitize input before sending to API
     * @private
     */
    _sanitizeInput(input, type) {
        if (type === 'phone') {
            // Remove all non-digits
            return input.replace(/\D/g, '');
        }
        return input.trim();
    }

    /**
     * Get mock fraud status (fallback)
     * @private
     */
    _getMockFraudStatus(input, type) {
        const isFraud = this._mockFraudCheck(input, type);
        
        // Mock users who reported this fraud
        const mockUsers = isFraud ? [
            {
                id: 'usr_1',
                name: 'Rajesh Kumar',
                mobile: '9876543210',
                email: 'rajesh.kumar@example.com',
                reportedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
                amount: 25000,
                isVictim: true
            },
            {
                id: 'usr_2',
                name: 'Priya Sharma',
                mobile: '9876543211',
                email: 'priya.sharma@example.com',
                reportedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
                amount: 15000,
                isVictim: true
            },
            {
                id: 'usr_3',
                name: 'Amit Patel',
                mobile: '9876543212',
                email: 'amit.patel@example.com',
                reportedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
                amount: 35000,
                isVictim: true
            }
        ] : [];
        
        return {
            isFraud,
            complaintId: isFraud ? `CFC-${Date.now()}` : null,
            complaintDate: isFraud ? new Date().toISOString() : null,
            status: isFraud ? 'active' : 'none',
            details: isFraud ? {
                amount: mockUsers.reduce((sum, u) => sum + u.amount, 0),
                reportedBy: mockUsers.length > 1 ? `${mockUsers.length} users` : '1 user',
                lastUpdated: new Date().toISOString(),
                userCount: mockUsers.length,
                users: mockUsers
            } : null,
            source: 'I4C-NCRP-CFCFRMS'
        };
    }

    /**
     * Mock fraud check - Replace with actual API logic
     * @private
     */
    _mockFraudCheck(input, type) {
        // Mock logic: certain patterns are flagged as fraud
        if (type === 'phone') {
            return input.endsWith('9999') || input.endsWith('1111');
        } else if (type === 'upi') {
            return input.includes('fraud') || input.includes('scam');
        } else if (type === 'bank_account') {
            return input.endsWith('0000');
        }
        return false;
    }
}

module.exports = new I4CService();
