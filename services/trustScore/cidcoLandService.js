/**
 * CIDCO / Land Records Integration Service
 * Fetches land ownership, title details, and encumbrances
 * 
 * API Endpoints Used:
 * - GET https://api.cidco.gov.in/api/projects/{cidcoNumber}
 *   Headers: X-API-Key: {CIDCO_API_KEY}
 * 
 * - GET https://landrecords.maharashtra.gov.in/api/land-ownership?land_id={landId}&latitude={lat}&longitude={lng}
 *   Headers: Authorization: Bearer {LAND_RECORDS_API_KEY}
 * 
 * - GET https://landrecords.maharashtra.gov.in/api/land-title/{landId}
 *   Headers: Authorization: Bearer {LAND_RECORDS_API_KEY}
 * 
 * Environment Variables Required:
 * - CIDCO_API_URL: Base URL for CIDCO API
 * - CIDCO_API_KEY: API key for CIDCO authentication
 * - LAND_RECORDS_URL: Base URL for Land Records API
 * - LAND_RECORDS_API_KEY: API key for Land Records authentication
 * - CIDCO_USE_API: Set to 'true' to use API, otherwise uses mock data
 */
const axios = require('axios');
const LOG = require('../../utils/logger');
const { API_CONFIG } = require('./apiConfig');
const apiConfigService = require('./apiConfigService');

class CIDCOLandService {
    constructor() {
        // Default config from env (fallback)
        const cidcoConfig = API_CONFIG.CIDCO;
        const landConfig = API_CONFIG.LAND_RECORDS;
        
        this.cidcoUrl = cidcoConfig.baseUrl;
        this.cidcoApiKey = cidcoConfig.apiKey;
        this.landRecordsUrl = landConfig.baseUrl;
        this.landRecordsApiKey = landConfig.apiKey;
        this.useAPI = cidcoConfig.useAPI;
        this.endpoints = {
            cidco: cidcoConfig.endpoints,
            landRecords: landConfig.endpoints
        };
        
        // Load from database on initialization
        this.loadConfigFromDB();
    }

    /**
     * Load configuration from database
     */
    async loadConfigFromDB() {
        try {
            // Load CIDCO config
            const cidcoConfig = await apiConfigService.getConfigByType('CIDCO');
            if (cidcoConfig && cidcoConfig.is_enabled) {
                this.cidcoUrl = cidcoConfig.base_url || this.cidcoUrl;
                this.cidcoApiKey = cidcoConfig.api_key || this.cidcoApiKey;
                this.cidcoAuthType = cidcoConfig.auth_type || 'API_Key';
                this.cidcoAuthHeader = cidcoConfig.auth_header || 'X-API-Key';
                LOG.info(`[CIDCO Service] Loaded config from DB: ${cidcoConfig.authority_name}`);
            }
            
            // Load Land Records config
            const landConfig = await apiConfigService.getConfigByType('LAND_RECORDS');
            if (landConfig && landConfig.is_enabled) {
                this.landRecordsUrl = landConfig.base_url || this.landRecordsUrl;
                this.landRecordsApiKey = landConfig.api_key || this.landRecordsApiKey;
                this.landAuthType = landConfig.auth_type || 'Bearer';
                this.landAuthHeader = landConfig.auth_header || 'Authorization';
                LOG.info(`[Land Records Service] Loaded config from DB: ${landConfig.authority_name}`);
            }
            
            LOG.info(`[CIDCO/Land Service] Initialized`);
            LOG.info(`[CIDCO] Base URL: ${this.cidcoUrl}, API Key: ${this.cidcoApiKey ? '***' + this.cidcoApiKey.slice(-4) : 'Not Set'}`);
            LOG.info(`[Land Records] Base URL: ${this.landRecordsUrl}, API Key: ${this.landRecordsApiKey ? '***' + this.landRecordsApiKey.slice(-4) : 'Not Set'}`);
        } catch (error) {
            LOG.warning(`[CIDCO/Land Service] Failed to load config from DB, using defaults: ${error.message}`);
        }
    }

    /**
     * Get land ownership details by land ID
     * API Call: GET https://landrecords.maharashtra.gov.in/api/land-ownership?land_id={landId}&latitude={lat}&longitude={lng}
     * Headers: Authorization: Bearer {LAND_RECORDS_API_KEY}
     */
    async getLandOwnership(landId, coordinates = null) {
        try {
            if (this.useAPI) {
                let url = this.endpoints.landRecords.getLandOwnership.replace('{landId}', landId);
                if (coordinates) {
                    url = url.replace('{lat}', coordinates.latitude)
                            .replace('{lng}', coordinates.longitude);
                } else {
                    url = url.replace('&latitude={lat}&longitude={lng}', '');
                }
                
                const fullUrl = `${this.landRecordsUrl}${url}`;
                LOG.info(`[Land Records API] Calling: ${fullUrl}`);
                LOG.info(`[Land Records API] Using API Key: ${this.landRecordsApiKey ? '***' + this.landRecordsApiKey.slice(-4) : 'Not Set'}`);
                
                // Reload config from DB before each API call
                await this.loadConfigFromDB();
                
                const headers = {};
                if (this.landRecordsApiKey) {
                    if (this.landAuthType === 'Bearer') {
                        headers[this.landAuthHeader] = `Bearer ${this.landRecordsApiKey}`;
                    } else if (this.landAuthType === 'API_Key') {
                        headers[this.landAuthHeader] = this.landRecordsApiKey;
                    }
                }
                
                const response = await axios.get(fullUrl, {
                    headers,
                    timeout: 30000
                });
                
                LOG.info(`[Land Records API] Response status: ${response.status}`);
                
                return {
                    landId: landId,
                    ownerName: response.data.owner_name,
                    ownershipType: response.data.ownership_type,
                    titleStatus: response.data.title_status,
                    area: response.data.area,
                    coordinates: response.data.coordinates || coordinates,
                    encumbrances: response.data.encumbrances || [],
                    saleHistory: response.data.sale_history || []
                };
            } else {
                LOG.info(`[CIDCO/Land Service] Using mock land ownership for ${landId}`);
                return this.getMockLandOwnership(landId, coordinates);
            }
        } catch (error) {
            LOG.error('[CIDCO/Land Service] Error fetching land ownership:', error.message);
            LOG.error('[CIDCO/Land Service] Error details:', {
                url: error.config?.url,
                status: error.response?.status
            });
            return this.getMockLandOwnership(landId, coordinates);
        }
    }

    /**
     * Get land title details
     */
    async getLandTitle(landId) {
        try {
            if (this.useAPI) {
                const response = await axios.get(`${this.landRecordsUrl}/api/land-title/${landId}`);
                return response.data;
            } else {
                return {
                    landId: landId,
                    titleNumber: 'TITLE-12345',
                    titleStatus: 'Clear',
                    registeredDate: '2015-03-20',
                    lastUpdated: '2023-01-15'
                };
            }
        } catch (error) {
            LOG.error('[CIDCO/Land Service] Error fetching land title:', error);
            return null;
        }
    }

    /**
     * Get encumbrances (mortgages, liens, etc.)
     */
    async getEncumbrances(landId) {
        try {
            if (this.useAPI) {
                const response = await axios.get(`${this.landRecordsUrl}/api/encumbrances/${landId}`);
                return response.data.encumbrances || [];
            } else {
                return [];
            }
        } catch (error) {
            LOG.error('[CIDCO/Land Service] Error fetching encumbrances:', error);
            return [];
        }
    }

    /**
     * Check if land has been sold multiple times (fraud detection)
     */
    async checkMultipleSales(landId, coordinates) {
        try {
            const ownership = await this.getLandOwnership(landId, coordinates);
            const saleHistory = ownership.saleHistory || [];
            
            // Check for multiple sales to different parties
            const uniqueBuyers = new Set(saleHistory.map(sale => sale.buyerId));
            
            if (uniqueBuyers.size > 1) {
                return {
                    isFraud: true,
                    landId: landId,
                    coordinates: coordinates,
                    saleCount: saleHistory.length,
                    uniqueBuyers: Array.from(uniqueBuyers),
                    sales: saleHistory,
                    severity: saleHistory.length > 2 ? 'high' : 'medium'
                };
            }
            
            return { isFraud: false };
        } catch (error) {
            LOG.error('[CIDCO/Land Service] Error checking multiple sales:', error);
            return { isFraud: false, error: error.message };
        }
    }

    /**
     * Get CIDCO project details
     * API Call: GET https://api.cidco.gov.in/api/projects/{cidcoNumber}
     * Headers: X-API-Key: {CIDCO_API_KEY}
     */
    async getCIDCOProject(cidcoNumber) {
        try {
            if (this.useAPI) {
                const url = `${this.cidcoUrl}${this.endpoints.cidco.getProject.replace('{cidcoNumber}', cidcoNumber)}`;
                LOG.info(`[CIDCO API] Calling: ${url}`);
                LOG.info(`[CIDCO API] Using API Key: ${this.cidcoApiKey ? '***' + this.cidcoApiKey.slice(-4) : 'Not Set'}`);
                
                // Reload config from DB before each API call
                await this.loadConfigFromDB();
                
                const headers = {};
                if (this.cidcoApiKey) {
                    if (this.cidcoAuthType === 'API_Key') {
                        headers[this.cidcoAuthHeader] = this.cidcoApiKey;
                    } else if (this.cidcoAuthType === 'Bearer') {
                        headers[this.cidcoAuthHeader] = `Bearer ${this.cidcoApiKey}`;
                    }
                }
                
                const response = await axios.get(url, {
                    headers,
                    timeout: 30000
                });
                
                LOG.info(`[CIDCO API] Response status: ${response.status}`);
                return response.data;
            } else {
                LOG.info(`[CIDCO/Land Service] Using mock CIDCO project for ${cidcoNumber}`);
                return {
                    cidcoNumber: cidcoNumber,
                    projectName: 'CIDCO Project',
                    location: 'Navi Mumbai',
                    status: 'Approved'
                };
            }
        } catch (error) {
            LOG.error('[CIDCO/Land Service] Error fetching CIDCO project:', error.message);
            LOG.error('[CIDCO/Land Service] Error details:', {
                url: error.config?.url,
                status: error.response?.status
            });
            return null;
        }
    }

    /**
     * Download and sync CIDCO project database from open source
     */
    async downloadAndSyncCIDCODatabase() {
        try {
            LOG.info('[CIDCO Service] Starting CIDCO project database download and sync...');
            const { API_CONFIG } = require('./apiConfig');
            const openSource = API_CONFIG.OPEN_SOURCE;
            const db = require('../../database');
            const pool = db.getPool();
            
            let syncedCount = 0;
            let errorCount = 0;
            
            // Try downloading from data portals
            for (const portalUrl of openSource.dataPortals) {
                try {
                    LOG.info(`[CIDCO Service] Downloading from: ${portalUrl}`);
                    const response = await axios.get(portalUrl, {
                        timeout: 30000,
                        headers: {
                            'Accept': 'application/json'
                        }
                    });
                    
                    const projects = Array.isArray(response.data) ? response.data : 
                                   (response.data.projects || response.data.data || []);
                    
                    LOG.info(`[CIDCO Service] Downloaded ${projects.length} projects from ${portalUrl}`);
                    
                    // Sync projects to database
                    for (const project of projects) {
                        try {
                            if (pool) {
                                await pool.query(`
                                    INSERT INTO trust_score_projects 
                                    (id, name, builder_name, address, location, created_at, updated_at)
                                    VALUES (?, ?, ?, ?, ?, NOW(), NOW())
                                    ON DUPLICATE KEY UPDATE
                                    name=VALUES(name), builder_name=VALUES(builder_name), 
                                    address=VALUES(address), updated_at=NOW()
                                `, [
                                    project.id || `cidco_${project.cidco_number}`,
                                    project.name || project.project_name,
                                    project.builder_name || 'CIDCO',
                                    project.address || project.location,
                                    project.location || 'Navi Mumbai'
                                ]);
                            } else {
                                if (!db.trustScoreProjects) {
                                    db.trustScoreProjects = [];
                                }
                                const existingIndex = db.trustScoreProjects.findIndex(p => p.id === (project.id || `cidco_${project.cidco_number}`));
                                if (existingIndex >= 0) {
                                    db.trustScoreProjects[existingIndex] = { ...db.trustScoreProjects[existingIndex], ...project };
                                } else {
                                    db.trustScoreProjects.push({
                                        id: project.id || `cidco_${project.cidco_number}`,
                                        name: project.name || project.project_name,
                                        builderName: project.builder_name || 'CIDCO',
                                        location: project.location || 'Navi Mumbai',
                                        createdAt: new Date(),
                                        updatedAt: new Date()
                                    });
                                }
                            }
                            syncedCount++;
                        } catch (syncError) {
                            errorCount++;
                            LOG.warn(`[CIDCO Service] Failed to sync project:`, syncError.message);
                        }
                    }
                } catch (downloadError) {
                    LOG.warn(`[CIDCO Service] Failed to download from ${portalUrl}:`, downloadError.message);
                    errorCount++;
                }
            }
            
            LOG.info(`[CIDCO Service] Database sync complete: ${syncedCount} projects synced, ${errorCount} errors`);
            return { synced: syncedCount, errors: errorCount };
        } catch (error) {
            LOG.error('[CIDCO Service] Database sync failed:', error);
            throw error;
        }
    }

    /**
     * Mock data for development
     */
    getMockLandOwnership(landId, coordinates) {
        return {
            landId: landId,
            ownerName: 'Lodha Developers Pvt. Ltd.',
            ownershipType: 'Freehold',
            titleStatus: 'Clear',
            area: '15,000 sq. m.',
            coordinates: coordinates || { latitude: 19.1136, longitude: 72.8697 },
            encumbrances: [],
            saleHistory: [
                { buyerId: 'buyer1', buyerName: 'First Buyer', saleDate: '2015-03-20', amount: '₹50 Crores' }
            ]
        };
    }
}

module.exports = new CIDCOLandService();

