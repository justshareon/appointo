/**
 * Court Cases / Disputes Integration Service
 * Integrates with legal databases (Indian Kanoon) to flag ongoing litigation
 */
const axios = require('axios');
const LOG = require('../../utils/logger');

class CourtCasesService {
    constructor() {
        this.indianKanoonUrl = process.env.INDIAN_KANOON_URL || 'https://indiankanoon.org';
        this.useAPI = process.env.COURT_CASES_USE_API === 'true';
    }

    /**
     * Search court cases by builder/project name
     */
    async searchCourtCases(entityName, entityType = 'builder') {
        try {
            if (this.useAPI) {
                const response = await axios.get(`${this.indianKanoonUrl}/api/search`, {
                    params: {
                        query: entityName,
                        type: entityType
                    },
                    headers: {
                        'Authorization': `Bearer ${process.env.INDIAN_KANOON_API_KEY}`
                    }
                });
                
                return this.parseCourtCases(response.data);
            } else {
                return this.getMockCourtCases(entityName);
            }
        } catch (error) {
            LOG.error('[Court Cases Service] Error searching cases:', error);
            return [];
        }
    }

    /**
     * Get litigation history for a project
     */
    async getProjectLitigation(projectName, builderName) {
        try {
            const [projectCases, builderCases] = await Promise.all([
                this.searchCourtCases(projectName, 'project'),
                this.searchCourtCases(builderName, 'builder')
            ]);
            
            // Combine and deduplicate
            const allCases = [...projectCases, ...builderCases];
            const uniqueCases = this.deduplicateCases(allCases);
            
            return {
                projectCases: projectCases,
                builderCases: builderCases,
                totalCases: uniqueCases.length,
                activeCases: uniqueCases.filter(c => c.status === 'Pending').length,
                resolvedCases: uniqueCases.filter(c => c.status === 'Resolved').length,
                cases: uniqueCases
            };
        } catch (error) {
            LOG.error('[Court Cases Service] Error getting litigation:', error);
            return { totalCases: 0, activeCases: 0, cases: [] };
        }
    }

    /**
     * Parse court cases from API response
     */
    parseCourtCases(data) {
        return (data.cases || []).map(case_ => ({
            caseNumber: case_.case_number,
            title: case_.title,
            court: case_.court,
            status: case_.status, // 'Pending', 'Resolved', 'Appeal'
            filedDate: case_.filed_date,
            lastHearing: case_.last_hearing,
            parties: case_.parties,
            category: case_.category
        }));
    }

    /**
     * Deduplicate cases
     */
    deduplicateCases(cases) {
        const seen = new Set();
        return cases.filter(case_ => {
            const key = `${case_.caseNumber}_${case_.court}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    /**
     * Mock data for development
     */
    getMockCourtCases(entityName) {
        return [
            {
                caseNumber: 'WP/1234/2023',
                title: `${entityName} vs. Homebuyers Association`,
                court: 'Bombay High Court',
                status: 'Pending',
                filedDate: '2023-05-15',
                lastHearing: '2024-01-10',
                parties: [entityName, 'Homebuyers Association'],
                category: 'Consumer Dispute'
            }
        ];
    }
}

module.exports = new CourtCasesService();

