/**
 * RERA Maharashtra Integration Service
 * Fetches project details, complaints, builder info, and validates salespersons
 * 
 * API Endpoints Used:
 * - GET https://maharera.mahaonline.gov.in/api/projects/{reraNumber}
 *   Headers: Authorization: Bearer {RERA_API_KEY}
 * 
 * - GET https://maharera.mahaonline.gov.in/api/complaints?rera={reraNumber}
 *   Headers: Authorization: Bearer {RERA_API_KEY}
 * 
 * - GET https://maharera.mahaonline.gov.in/api/builders?name={builderName}
 *   Headers: Authorization: Bearer {RERA_API_KEY}
 * 
 * - GET https://maharera.mahaonline.gov.in/api/salespersons/{reraNumber}
 *   Headers: Authorization: Bearer {RERA_API_KEY}
 * 
 * Environment Variables Required:
 * - RERA_MAHARASHTRA_URL: Base URL for RERA API
 * - RERA_API_KEY: API key for authentication
 * - RERA_USE_API: Set to 'true' to use API, otherwise uses mock data
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const LOG = require('../../utils/logger');
const { API_CONFIG } = require('./apiConfig');
const apiConfigService = require('./apiConfigService');

class RERAService {
    constructor() {
        // Default config from env (fallback)
        const reraConfig = API_CONFIG.RERA;
        this.baseUrl = reraConfig.baseUrl;
        this.apiKey = reraConfig.apiKey;
        this.useAPI = reraConfig.useAPI;
        this.endpoints = reraConfig.endpoints;
        this.authHeader = reraConfig.authentication.format.replace('{RERA_API_KEY}', this.apiKey || '');
        
        // Load from database on initialization
        this.loadConfigFromDB();
    }

    /**
     * Load configuration from database
     */
    async loadConfigFromDB() {
        try {
            const config = await apiConfigService.getConfigByType('RERA');
            if (config && config.is_enabled) {
                this.baseUrl = config.base_url || this.baseUrl;
                this.apiKey = config.api_key || this.apiKey;
                this.useAPI = config.use_api !== undefined ? config.use_api : this.useAPI;
                this.authType = config.auth_type || 'Bearer';
                this.authHeader = config.auth_header || 'Authorization';
                
                LOG.info(`[RERA Service] Loaded config from DB: ${config.authority_name}`);
                LOG.info(`[RERA Service] Base URL: ${this.baseUrl}`);
                LOG.info(`[RERA Service] Use API: ${this.useAPI}`);
                LOG.info(`[RERA Service] API Key: ${this.apiKey ? '***' + this.apiKey.slice(-4) : 'Not Set'}`);
            } else {
                LOG.info(`[RERA Service] Using default config (no DB config found or disabled)`);
            }
        } catch (error) {
            LOG.warning(`[RERA Service] Failed to load config from DB, using defaults: ${error.message}`);
        }
    }

    /**
     * Get project details by RERA number
     */
    async getProjectDetails(reraNumber) {
        try {
            if (this.useAPI) {
                return await this.getProjectDetailsViaAPI(reraNumber);
            } else {
                // Return mock data for development
                return this.getMockProjectDetails(reraNumber);
            }
        } catch (error) {
            LOG.error('[RERA Service] Error fetching project details:', error);
            return this.getMockProjectDetails(reraNumber);
        }
    }

    /**
     * Get project details via RERA API
     * API Call: GET https://maharera.mahaonline.gov.in/api/projects/{reraNumber}
     * Headers: Authorization: Bearer {RERA_API_KEY}
     */
    async getProjectDetailsViaAPI(reraNumber) {
        try {
            // Reload config from DB before each API call (in case it was updated)
            await this.loadConfigFromDB();
            
            const url = `${this.baseUrl}${this.endpoints.getProject.replace('{reraNumber}', reraNumber)}`;
            LOG.info(`[RERA API] Calling: ${url}`);
            LOG.info(`[RERA API] Using API Key: ${this.apiKey ? '***' + this.apiKey.slice(-4) : 'Not Set'}`);
            
            const headers = {};
            if (this.apiKey) {
                if (this.authType === 'Bearer') {
                    headers[this.authHeader] = `Bearer ${this.apiKey}`;
                } else if (this.authType === 'API_Key') {
                    headers[this.authHeader] = this.apiKey;
                } else if (this.authType === 'Basic') {
                    // Basic auth would need username:password format
                    headers[this.authHeader] = `Basic ${Buffer.from(this.apiKey).toString('base64')}`;
                }
            }
            
            const response = await axios.get(url, {
                headers,
                timeout: 30000 // 30 second timeout
            });
            
            LOG.info(`[RERA API] Response status: ${response.status}`);
            LOG.info(`[RERA API] Response data keys: ${Object.keys(response.data || {}).join(', ')}`);
            
            return this.parseRERAResponse(response.data);
        } catch (error) {
            LOG.error('[RERA Service] API call failed:', error.message);
            LOG.error('[RERA Service] Error details:', {
                url: error.config?.url,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            });
            throw error;
        }
    }


    /**
     * Get RERA complaints for a project
     */
    async getProjectComplaints(reraNumber) {
        try {
            if (this.useAPI) {
                const response = await axios.get(`${this.baseUrl}/api/complaints?rera=${reraNumber}`);
                return response.data.complaints || [];
            } else {
                const reg = String(reraNumber || '').trim().toUpperCase();
                try {
                    const reraFilingsService = require('./reraFilingsService');
                    const filing = reraFilingsService.findFilingByRera(reg);
                    const seed = reraFilingsService.findSeedProjectByRera(reg);
                    const merged = filing
                        ? reraFilingsService.mergeFilingWithSeed(filing)
                        : seed;
                    const count = Number(merged?.reraComplaintsCount || 0);
                    if (count <= 0) return [];
                    const types = ['Delay', 'Quality', 'Documentation', 'Refund'];
                    return Array.from({ length: count }, (_, i) => ({
                        id: `c${i + 1}`,
                        type: types[i % types.length],
                        status: i === count - 1 && count > 1 ? 'Resolved' : 'Pending',
                        date: '2023-05-15',
                    }));
                } catch (_) {
                    return [];
                }
            }
        } catch (error) {
            LOG.error('[RERA Service] Error fetching complaints:', error);
            return [];
        }
    }

    /**
     * Get builder information from RERA
     * API Call: GET https://maharera.mahaonline.gov.in/api/builders?name={builderName}
     * Headers: Authorization: Bearer {RERA_API_KEY}
     */
    async getBuilderInfo(builderName) {
        try {
            if (this.useAPI) {
                const url = `${this.baseUrl}${this.endpoints.getBuilder.replace('{builderName}', encodeURIComponent(builderName))}`;
                LOG.info(`[RERA API] Fetching builder info: ${url}`);
                
                const headers = {};
                if (this.apiKey) {
                    headers['Authorization'] = `Bearer ${this.apiKey}`;
                }
                
                const response = await axios.get(url, {
                    headers,
                    timeout: 30000
                });
                
                LOG.info(`[RERA API] Builder info response status: ${response.status}`);
                return response.data;
            } else {
                LOG.info(`[RERA Service] Using mock builder info for ${builderName}`);
                return this.getMockBuilderInfo(builderName);
            }
        } catch (error) {
            LOG.error('[RERA Service] Error fetching builder info:', error.message);
            return this.getMockBuilderInfo(builderName);
        }
    }

    /**
     * Validate salesperson by RERA number
     * API Call: GET https://maharera.mahaonline.gov.in/api/salespersons/{reraNumber}
     * Headers: Authorization: Bearer {RERA_API_KEY}
     */
    async validateSalesperson(reraNumber) {
        try {
            if (this.useAPI) {
                const url = `${this.baseUrl}${this.endpoints.validateSalesperson.replace('{reraNumber}', reraNumber)}`;
                LOG.info(`[RERA API] Validating salesperson: ${url}`);
                
                const headers = {};
                if (this.apiKey) {
                    headers['Authorization'] = `Bearer ${this.apiKey}`;
                }
                
                const response = await axios.get(url, {
                    headers,
                    timeout: 30000
                });
                
                LOG.info(`[RERA API] Salesperson validation response status: ${response.status}`);
                return {
                    valid: response.data.status === 'Active',
                    name: response.data.name,
                    registrationDate: response.data.registrationDate,
                    expiryDate: response.data.expiryDate,
                    reraNumber: reraNumber
                };
            } else {
                // Mock validation for development
                LOG.info(`[RERA Service] Using mock salesperson validation for ${reraNumber}`);
                return {
                    valid: true,
                    name: 'John Doe',
                    registrationDate: '2020-01-15',
                    expiryDate: '2025-01-15',
                    reraNumber: reraNumber
                };
            }
        } catch (error) {
            LOG.error('[RERA Service] Error validating salesperson:', error.message);
            LOG.error('[RERA Service] Validation error details:', {
                url: error.config?.url,
                status: error.response?.status
            });
            return { valid: false, error: error.message, reraNumber: reraNumber };
        }
    }

    /**
     * Parse RERA API response
     */
    parseRERAResponse(data) {
        return {
            reraNumber: data.rera_number,
            projectName: data.project_name,
            builderName: data.builder_name,
            address: data.address,
            status: data.status,
            registrationDate: data.registration_date,
            validityDate: data.validity_date,
            totalUnits: data.total_units,
            totalArea: data.total_area,
            // Map all fields from RERA API response
        };
    }

    /**
     * Mock data for development
     */
    getMockProjectDetails(reraNumber) {
        const reg = String(reraNumber || '').toUpperCase();
        try {
            const reraFilingsService = require('./reraFilingsService');
            const filing = reraFilingsService.findFilingByRera(reg);
            const seed = reraFilingsService.findSeedProjectByRera(reg);
            if (filing || seed) {
                const merged = filing
                    ? reraFilingsService.mergeFilingWithSeed(filing)
                    : seed;
                return {
                    reraNumber: reg,
                    projectName: merged.name || merged.projectName || `Project ${reg}`,
                    builderName: merged.builderName || '',
                    address: merged.address || merged.location || '',
                    status: merged.projectStatus || merged.status || 'Ongoing',
                    registrationDate: merged.launchDate || '2020-01-15',
                    validityDate: merged.expectedCompletionDate || '2026-12-31',
                    totalUnits: merged.numberOfUnits || 0,
                    totalArea: merged.totalArea || '',
                    totalAmountCollected: merged.totalAmountCollected,
                    loanAmountSanctioned: merged.loanAmountSanctioned,
                    estimatedProjectCost: merged.estimatedProjectCost,
                    escrowReserveDeposited: merged.escrowReserveDeposited,
                    escrowReservePercentRequired: merged.escrowReservePercentRequired || 70,
                    bankName: merged.bankName,
                    documentsFiled: merged.documentsFiled ?? 10,
                    reraComplaintsCount: merged.reraComplaintsCount ?? 0,
                    completion: merged.completion ?? 0,
                    dataSource: 'public_rera_filing_march_2026',
                };
            }
        } catch (_) {}

        const base = {
            reraNumber: reg,
            projectName: 'Sunshine Towers',
            builderName: 'Lodha Group',
            address: 'Andheri East, Mumbai',
            status: 'Ongoing',
            registrationDate: '2020-01-15',
            validityDate: '2025-01-15',
            totalUnits: 320,
            totalArea: '2,50,000 sq. ft.',
            totalAmountCollected: '₹1,200 Crores',
            loanAmountSanctioned: '₹500 Crores',
            estimatedProjectCost: '₹1,500 Crores',
            escrowReserveDeposited: '₹840 Crores',
            escrowReservePercentRequired: 70,
            bankName: 'HDFC Bank',
            documentsFiled: 12,
            reraComplaintsCount: 2,
            completion: 68,
        };
        if (reg === 'P52100012345') return base;
        if (reg === 'P52100012354') {
            return {
                ...base,
                reraNumber: reg,
                projectName: 'Rustomjee Ultima',
                builderName: 'Rustomjee Group',
                address: 'Andheri West, Mumbai, Maharashtra 400053',
                reraComplaintsCount: 1,
                completion: 55,
            };
        }
        return { ...base, reraNumber: reg, projectName: `Project ${reg}`, reraComplaintsCount: 0 };
    }

    getMockBuilderInfo(builderName) {
        return {
            name: builderName,
            reraRegistration: 'RERA-MH-12345',
            totalProjects: 45,
            activeProjects: 5
        };
    }
}

module.exports = new RERAService();

