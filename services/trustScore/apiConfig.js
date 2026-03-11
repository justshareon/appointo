/**
 * Trust Score API Configuration
 * Documents all API endpoints, keys, and authentication methods
 */

const LOG = require('../../utils/logger');

const API_CONFIG = {
    // RERA Maharashtra APIs
    RERA: {
        baseUrl: process.env.RERA_MAHARASHTRA_URL || 'https://maharera.mahaonline.gov.in',
        apiKey: process.env.RERA_API_KEY || null,
        apiSecret: process.env.RERA_API_SECRET || null,
        useAPI: process.env.RERA_USE_API === 'true',
        
        endpoints: {
            // Official RERA API endpoints (if available)
            getProject: '/api/projects/{reraNumber}',
            getComplaints: '/api/complaints?rera={reraNumber}',
            getBuilder: '/api/builders?name={builderName}',
            validateSalesperson: '/api/salespersons/{reraNumber}'
        },
        
        authentication: {
            type: 'Bearer Token',
            header: 'Authorization',
            format: 'Bearer {RERA_API_KEY}'
        }
    },
    
    // CIDCO APIs
    CIDCO: {
        baseUrl: process.env.CIDCO_API_URL || 'https://api.cidco.gov.in',
        apiKey: process.env.CIDCO_API_KEY || null,
        apiSecret: process.env.CIDCO_API_SECRET || null,
        useAPI: process.env.CIDCO_USE_API === 'true',
        
        endpoints: {
            getProject: '/api/projects/{cidcoNumber}',
            getLandRecords: '/api/land-records/{landId}',
            searchProjects: '/api/projects/search?location={location}'
        },
        
        authentication: {
            type: 'API Key',
            header: 'X-API-Key',
            format: '{CIDCO_API_KEY}'
        }
    },
    
    // Maharashtra Land Records APIs
    LAND_RECORDS: {
        baseUrl: process.env.LAND_RECORDS_URL || 'https://landrecords.maharashtra.gov.in',
        apiKey: process.env.LAND_RECORDS_API_KEY || null,
        apiSecret: process.env.LAND_RECORDS_API_SECRET || null,
        useAPI: process.env.LAND_RECORDS_USE_API === 'true',
        
        endpoints: {
            getLandOwnership: '/api/land-ownership?land_id={landId}&latitude={lat}&longitude={lng}',
            getLandTitle: '/api/land-title/{landId}',
            getEncumbrances: '/api/encumbrances/{landId}',
            searchByCoordinates: '/api/search?lat={lat}&lng={lng}&radius={radius}'
        },
        
        authentication: {
            type: 'Bearer Token',
            header: 'Authorization',
            format: 'Bearer {LAND_RECORDS_API_KEY}'
        }
    },
    
    // Indian Kanoon (Court Cases)
    INDIAN_KANOON: {
        baseUrl: process.env.INDIAN_KANOON_URL || 'https://api.indiankanoon.org',
        apiKey: process.env.INDIAN_KANOON_API_KEY || null,
        useAPI: process.env.INDIAN_KANOON_USE_API === 'true',
        
        endpoints: {
            searchCases: '/search?q={query}&type={type}',
            getCaseDetails: '/doc/{caseId}',
            searchByParty: '/search?party={partyName}'
        },
        
        authentication: {
            type: 'Bearer Token',
            header: 'Authorization',
            format: 'Bearer {INDIAN_KANOON_API_KEY}'
        }
    },
    
    // Open Source Project Databases
    OPEN_SOURCE: {
        // GitHub repositories with project data
        githubRepos: [
            'https://raw.githubusercontent.com/maharera/projects-database/main/projects.json',
            'https://raw.githubusercontent.com/mumbai-realestate/projects-data/main/data.json'
        ],
        
        // Government open data portals
        dataPortals: [
            'https://data.gov.in/api/projects',
            'https://maharera.mahaonline.gov.in/open-data/projects'
        ],
        
        // CSV/JSON download URLs
        downloadUrls: {
            mumbaiProjects: 'https://maharera.mahaonline.gov.in/downloads/mumbai-projects.csv',
            allProjects: 'https://maharera.mahaonline.gov.in/downloads/all-projects.json'
        }
    }
};

/**
 * Log all API configurations (without exposing secrets)
 */
function logAPIConfig() {
    LOG.info('=== Trust Score API Configuration ===');
    
    Object.keys(API_CONFIG).forEach(service => {
        const config = API_CONFIG[service];
        LOG.info(`\n[${service}]`);
        LOG.info(`  Base URL: ${config.baseUrl || 'N/A'}`);
        LOG.info(`  API Key: ${config.apiKey ? '***' + config.apiKey.slice(-4) : 'Not Set'}`);
        LOG.info(`  Use API: ${config.useAPI || false}`);
        
        if (config.endpoints) {
            LOG.info(`  Endpoints:`);
            Object.entries(config.endpoints).forEach(([name, endpoint]) => {
                LOG.info(`    - ${name}: ${endpoint}`);
            });
        }
        
        if (config.authentication) {
            LOG.info(`  Authentication: ${config.authentication.type}`);
        }
    });
}

module.exports = {
    API_CONFIG,
    logAPIConfig
};

