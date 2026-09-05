const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const LOG = require('../utils/logger');

/** Seed JSON → MySQL before any trust-score read */
router.use(async (req, res, next) => {
    try {
        const { ensureTrustScoreSync } = require('../services/trustScore/trustScoreHydrateService');
        await ensureTrustScoreSync();
    } catch (err) {
        LOG.warning(`[Trust Score Routes] Sync skipped: ${err.message}`);
    }
    next();
});

function mapTrustProjectRow(p) {
    return {
        id: p.id,
        name: p.name,
        reraNumber: p.reraNumber || p.rera_number,
        builderName: p.builderName || p.builder_name,
        builderId: p.builderId || p.builder_id,
        address: p.address,
        location: p.location,
        latitude: p.latitude != null ? Number(p.latitude) : null,
        longitude: p.longitude != null ? Number(p.longitude) : null,
        projectStatus: p.projectStatus || p.status || p.project_status,
        status: p.projectStatus || p.status || p.project_status,
        trustScore: p.trustScore || p.projectScore || p.score || p.trust_score || 0,
        score: p.trustScore || p.projectScore || p.score || p.trust_score || 0,
        projectScore: p.trustScore || p.projectScore || p.score || p.trust_score || 0,
        builderScore: p.builderScore || p.builder_score || 0,
        totalArea: p.totalArea || p.total_area,
        numberOfUnits: p.numberOfUnits || p.number_of_units,
        numberOfFloors: p.numberOfFloors || p.number_of_floors,
        launchDate: p.launchDate || p.launch_date,
        expectedCompletionDate: p.expectedCompletionDate || p.expected_completion_date,
        actualCompletionDate: p.actualCompletionDate || p.actual_completion_date,
        reraExtensionDetails: p.reraExtensionDetails || p.rera_extension_details,
        landOwnershipTitle: p.landOwnershipTitle || p.land_ownership_title,
        landOwnerName: p.landOwnerName || p.land_owner_name,
        landArea: p.landArea || p.land_area,
        approvalAuthorities: typeof p.approvalAuthorities === 'string'
            ? JSON.parse(p.approvalAuthorities || '[]')
            : (p.approvalAuthorities || []),
        approvedBuildingPlans: p.approvedBuildingPlans || p.approved_building_plans,
        bankName: p.bankName || p.bank_name,
        loanAmountSanctioned: p.loanAmountSanctioned || p.loan_amount_sanctioned,
        totalAmountCollected: p.totalAmountCollected || p.total_amount_collected,
        fundingSources: p.fundingSources || p.funding_sources,
        litigationHistory: typeof p.litigationHistory === 'string'
            ? JSON.parse(p.litigationHistory || '[]')
            : (p.litigationHistory || []),
        reraComplaintsCount: p.reraComplaintsCount || p.rera_complaints_count || 0,
        reraComplaintsStatus: p.reraComplaintsStatus || p.rera_complaints_status,
        completion: p.completion || 0,
        priceRise: p.priceRise || p.price_rise,
        estimatedProjectCost: p.estimatedProjectCost || p.estimated_project_cost,
        escrowReserveDeposited: p.escrowReserveDeposited || p.escrow_reserve_deposited,
        escrowReservePercentRequired: p.escrowReservePercentRequired ?? p.escrow_reserve_percent_required ?? 70,
        escrowCompliant: p.escrowCompliant ?? (p.escrow_compliant !== 0 && p.escrow_compliant !== false),
        documentsFiled: p.documentsFiled ?? p.documents_filed ?? 0,
        registeredAgents: p.registeredAgents ?? p.registered_agents ?? 0,
        dataSource: p.dataSource || p.data_source,
        filingAsOf: p.filingAsOf || p.filing_as_of,
        dataSourceLabel: p.dataSourceLabel || (p.data_source === 'public_rera_filing_march_2026'
            ? 'Data sourced from public RERA filings as of March 2026'
            : undefined),
    };
}

function extractAreaToken(project) {
    const addr = String(project?.address || '').trim();
    if (addr) {
        const first = addr.split(',')[0]?.trim();
        if (first) return first;
    }
    return String(project?.location || '').trim();
}

async function findTrustProjectById(projectId) {
    const db = require('../database');
    if (db.getType() === 'mysql') {
        const pool = db.getPool();
        if (pool) {
            const [rows] = await pool.query(
                'SELECT * FROM trust_score_projects WHERE id = ? OR rera_number = ? LIMIT 1',
                [projectId, projectId]
            );
            if (rows?.[0]) return mapTrustProjectRow(rows[0]);
        }
    }
    const data = require('../database/data');
    const sources = [
        ...(data.trustScoreProjects || []),
        ...(db.trustScoreProjects || []),
    ];
    const found = sources.find(
        (p) => p.id === projectId || String(p.reraNumber) === String(projectId)
    );
    return found ? mapTrustProjectRow(found) : null;
}

/**
 * GET /api/trust-score/projects
 * Get projects with search, filters, pagination
 */
router.get('/projects',
    authenticateToken,
    async (req, res) => {
        try {
            LOG.info('[Trust Score Routes] Fetching projects');
            
            const { search, location, limit = 10, offset = 0 } = req.query;
            const db = require('../database');
            const dbType = db.getType();
            
            let projects = [];
            
            if (dbType === 'mysql') {
                const pool = db.getPool();
                if (pool) {
                    let query = 'SELECT * FROM trust_score_projects WHERE 1=1';
                    const params = [];
                    
                    if (search) {
                        query += ` AND (name LIKE ? OR builder_name LIKE ? OR address LIKE ? OR rera_number LIKE ? OR location LIKE ?)`;
                        const searchTerm = `%${search}%`;
                        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
                    }
                    
                    if (location) {
                        query += ` AND (location LIKE ? OR address LIKE ?)`;
                        const locationTerm = `%${location}%`;
                        params.push(locationTerm, locationTerm);
                    }
                    
                    query += ` ORDER BY trust_score DESC, name ASC LIMIT ? OFFSET ?`;
                    params.push(parseInt(limit), parseInt(offset));
                    
                    const [rows] = await pool.query(query, params);
                    projects = rows.map(row => ({
                        id: row.id,
                        name: row.name,
                        reraNumber: row.rera_number,
                        builder: row.builder_name,
                        builderName: row.builder_name,
                        address: row.address,
                        location: row.location,
                        latitude: row.latitude,
                        longitude: row.longitude,
                        projectStatus: row.project_status,
                        status: row.project_status,
                        trustScore: row.trust_score,
                        score: row.trust_score,
                        projectScore: row.trust_score,
                        builderScore: row.builder_score,
                        reraComplaintsCount: row.rera_complaints_count || 0,
                        launchDate: row.launch_date,
                        expectedCompletionDate: row.expected_completion_date,
                        actualCompletionDate: row.actual_completion_date,
                        totalArea: row.total_area,
                        numberOfUnits: row.number_of_units,
                        numberOfFloors: row.number_of_floors,
                        loanAmountSanctioned: row.loan_amount_sanctioned,
                        totalAmountCollected: row.total_amount_collected,
                        fundingSources: row.funding_sources,
                        bankName: row.bank_name,
                        reraComplaintsStatus: row.rera_complaints_status,
                        litigationHistory: row.litigation_history
                    }));
                }
            } else {
                // In-memory database
                const data = require('../database/data');
                if (data.trustScoreProjects && Array.isArray(data.trustScoreProjects)) {
                    let filtered = [...data.trustScoreProjects];
                    
                    if (search) {
                        const searchLower = search.toLowerCase();
                        filtered = filtered.filter(p => 
                            (p.name && p.name.toLowerCase().includes(searchLower)) ||
                            (p.builderName && p.builderName.toLowerCase().includes(searchLower)) ||
                            (p.address && p.address.toLowerCase().includes(searchLower)) ||
                            (p.reraNumber && p.reraNumber.toLowerCase().includes(searchLower)) ||
                            (p.location && p.location.toLowerCase().includes(searchLower))
                        );
                    }
                    
                    if (location) {
                        const locationLower = location.toLowerCase();
                        filtered = filtered.filter(p => 
                            (p.location && p.location.toLowerCase().includes(locationLower)) ||
                            (p.address && p.address.toLowerCase().includes(locationLower))
                        );
                    }
                    
                    // Sort by trust score
                    filtered.sort((a, b) => {
                        const scoreA = a.trustScore || a.projectScore || a.score || 0;
                        const scoreB = b.trustScore || b.projectScore || b.score || 0;
                        if (scoreB !== scoreA) return scoreB - scoreA;
                        return (a.name || '').localeCompare(b.name || '');
                    });
                    
                    // Apply pagination
                    const start = parseInt(offset);
                    const end = start + parseInt(limit);
                    const paginated = filtered.slice(start, end);
                    
                    // Map to consistent format with all fields
                    projects = paginated.map(p => ({
                        id: p.id,
                        name: p.name,
                        reraNumber: p.reraNumber,
                        builder: p.builderName,
                        builderName: p.builderName,
                        address: p.address,
                        location: p.location,
                        latitude: p.latitude,
                        longitude: p.longitude,
                        projectStatus: p.projectStatus || p.status,
                        status: p.projectStatus || p.status,
                        trustScore: p.trustScore || p.projectScore || p.score || 0,
                        score: p.trustScore || p.projectScore || p.score || 0,
                        projectScore: p.trustScore || p.projectScore || p.score || 0,
                        builderScore: p.builderScore || 0,
                        reraComplaintsCount: p.reraComplaintsCount || 0,
                        launchDate: p.launchDate,
                        expectedCompletionDate: p.expectedCompletionDate,
                        actualCompletionDate: p.actualCompletionDate,
                        totalArea: p.totalArea,
                        numberOfUnits: p.numberOfUnits,
                        numberOfFloors: p.numberOfFloors,
                        loanAmountSanctioned: p.loanAmountSanctioned,
                        totalAmountCollected: p.totalAmountCollected,
                        fundingSources: p.fundingSources,
                        bankName: p.bankName,
                        reraComplaintsStatus: p.reraComplaintsStatus,
                        litigationHistory: p.litigationHistory
                    }));
                }
            }
            
            res.json(projects);
        } catch (error) {
            LOG.error('[Trust Score Routes] Error fetching projects:', error);
            res.status(500).json({ 
                success: false, 
                error: error.message 
            });
        }
    }
);

/**
 * GET /api/trust-score/projects/high-trust
 * Get high trust score projects (sorted by trust score, filtered by min_score if provided)
 */
router.get('/projects/high-trust',
    authenticateToken,
    async (req, res) => {
        try {
            LOG.info('[Trust Score Routes] Fetching high trust projects');
            
            const { location, limit = 10, min_score = 80 } = req.query;
            const db = require('../database');
            const dbType = db.getType();
            
            let projects = [];
            
            if (dbType === 'mysql') {
                const pool = db.getPool();
                if (pool) {
                    let query = `SELECT * FROM trust_score_projects WHERE trust_score >= ?`;
                    const params = [parseInt(min_score)];
                    
                    if (location) {
                        query += ` AND (location LIKE ? OR address LIKE ?)`;
                        const locationTerm = `%${location}%`;
                        params.push(locationTerm, locationTerm);
                    }
                    
                    query += ` ORDER BY trust_score DESC, name ASC LIMIT ?`;
                    params.push(parseInt(limit));
                    
                    const [rows] = await pool.query(query, params);
                    projects = rows.map(row => ({
                        id: row.id,
                        name: row.name,
                        reraNumber: row.rera_number,
                        builder: row.builder_name,
                        builderName: row.builder_name,
                        address: row.address,
                        location: row.location,
                        latitude: row.latitude,
                        longitude: row.longitude,
                        projectStatus: row.project_status,
                        status: row.project_status,
                        trustScore: row.trust_score,
                        score: row.trust_score,
                        projectScore: row.trust_score,
                        builderScore: row.builder_score,
                        reraComplaintsCount: row.rera_complaints_count || 0,
                        launchDate: row.launch_date,
                        expectedCompletionDate: row.expected_completion_date,
                        actualCompletionDate: row.actual_completion_date,
                        totalArea: row.total_area,
                        numberOfUnits: row.number_of_units,
                        numberOfFloors: row.number_of_floors,
                        loanAmountSanctioned: row.loan_amount_sanctioned,
                        totalAmountCollected: row.total_amount_collected,
                        fundingSources: row.funding_sources,
                        bankName: row.bank_name,
                        reraComplaintsStatus: row.rera_complaints_status,
                        litigationHistory: row.litigation_history
                    }));
                }
            } else {
                // In-memory database
                const data = require('../database/data');
                if (data.trustScoreProjects && Array.isArray(data.trustScoreProjects)) {
                    let filtered = [...data.trustScoreProjects];
                    
                    // Filter by minimum score
                    const minScore = parseInt(min_score);
                    filtered = filtered.filter(p => {
                        const score = p.trustScore || p.projectScore || p.score || 0;
                        return score >= minScore;
                    });
                    
                    if (location) {
                        const locationLower = location.toLowerCase();
                        filtered = filtered.filter(p => 
                            (p.location && p.location.toLowerCase().includes(locationLower)) ||
                            (p.address && p.address.toLowerCase().includes(locationLower))
                        );
                    }
                    
                    // Sort by trust score (highest first)
                    filtered.sort((a, b) => {
                        const scoreA = a.trustScore || a.projectScore || a.score || 0;
                        const scoreB = b.trustScore || b.projectScore || b.score || 0;
                        if (scoreB !== scoreA) return scoreB - scoreA;
                        return (a.name || '').localeCompare(b.name || '');
                    });
                    
                    // Apply limit
                    const limited = filtered.slice(0, parseInt(limit));
                    
                    // Map to consistent format with all fields
                    projects = limited.map(p => ({
                        id: p.id,
                        name: p.name,
                        reraNumber: p.reraNumber,
                        builder: p.builderName,
                        builderName: p.builderName,
                        address: p.address,
                        location: p.location,
                        latitude: p.latitude,
                        longitude: p.longitude,
                        projectStatus: p.projectStatus || p.status,
                        status: p.projectStatus || p.status,
                        trustScore: p.trustScore || p.projectScore || p.score || 0,
                        score: p.trustScore || p.projectScore || p.score || 0,
                        projectScore: p.trustScore || p.projectScore || p.score || 0,
                        builderScore: p.builderScore || 0,
                        reraComplaintsCount: p.reraComplaintsCount || 0,
                        launchDate: p.launchDate,
                        expectedCompletionDate: p.expectedCompletionDate,
                        actualCompletionDate: p.actualCompletionDate,
                        totalArea: p.totalArea,
                        numberOfUnits: p.numberOfUnits,
                        numberOfFloors: p.numberOfFloors,
                        loanAmountSanctioned: p.loanAmountSanctioned,
                        totalAmountCollected: p.totalAmountCollected,
                        fundingSources: p.fundingSources,
                        bankName: p.bankName,
                        reraComplaintsStatus: p.reraComplaintsStatus,
                        litigationHistory: p.litigationHistory
                    }));
                }
            }
            
            res.json(projects);
        } catch (error) {
            LOG.error('[Trust Score Routes] Error fetching high trust projects:', error);
            res.status(500).json({ 
                success: false, 
                error: error.message 
            });
        }
    }
);

// Add a new route to show available data statistics
/**
 * GET /api/trust-score/projects/stats
 * Get statistics about available projects in database
 */
router.get('/projects/stats',
    authenticateToken,
    async (req, res) => {
        try {
            LOG.info('[Trust Score Routes] Fetching project statistics');
            
            const db = require('../database');
            const dbType = db.getType();
            let stats = {
                total: 0,
                byStatus: {
                    completed: 0,
                    ongoing: 0,
                    delayed: 0,
                    disputed: 0,
                    prelaunch: 0
                },
                byLocation: {},
                byBuilder: {},
                mumbaiProjects: []
            };
            
            if (dbType === 'mysql') {
                const pool = db.getPool();
                if (pool) {
                    // Get total count
                    const [totalRows] = await pool.query('SELECT COUNT(*) as count FROM trust_score_projects');
                    stats.total = totalRows[0]?.count || 0;
                    
                    // Get by status
                    const [statusRows] = await pool.query(`
                        SELECT project_status, COUNT(*) as count 
                        FROM trust_score_projects 
                        GROUP BY project_status
                    `);
                    statusRows.forEach(row => {
                        const status = (row.project_status || '').toLowerCase();
                        if (status.includes('completed') || status.includes('near completion')) {
                            stats.byStatus.completed += row.count;
                        } else if (status.includes('ongoing')) {
                            stats.byStatus.ongoing += row.count;
                        } else if (status.includes('delay')) {
                            stats.byStatus.delayed += row.count;
                        } else if (status.includes('pre-launch') || status.includes('prelaunch')) {
                            stats.byStatus.prelaunch += row.count;
                        }
                    });
                    
                    // Get by location
                    const [locationRows] = await pool.query(`
                        SELECT location, COUNT(*) as count 
                        FROM trust_score_projects 
                        WHERE location IS NOT NULL
                        GROUP BY location
                        ORDER BY count DESC
                    `);
                    locationRows.forEach(row => {
                        stats.byLocation[row.location] = row.count;
                    });
                    
                    // Get Mumbai projects
                    const [mumbaiRows] = await pool.query(`
                        SELECT id, name, rera_number, builder_name, location, project_status
                        FROM trust_score_projects 
                        WHERE location LIKE '%Mumbai%' OR address LIKE '%Mumbai%'
                        LIMIT 20
                    `);
                    stats.mumbaiProjects = mumbaiRows.map(row => ({
                        id: row.id,
                        name: row.name,
                        reraNumber: row.rera_number,
                        builder: row.builder_name,
                        location: row.location,
                        status: row.project_status
                    }));
                }
            } else {
                // In-memory database
                const data = require('../database/data');
                if (data.trustScoreProjects && Array.isArray(data.trustScoreProjects)) {
                    stats.total = data.trustScoreProjects.length;
                    
                    data.trustScoreProjects.forEach(project => {
                        // Count by status
                        const status = (project.projectStatus || project.status || '').toLowerCase();
                        if (status.includes('completed') || status.includes('near completion')) {
                            stats.byStatus.completed++;
                        } else if (status.includes('ongoing')) {
                            stats.byStatus.ongoing++;
                        } else if (status.includes('delay')) {
                            stats.byStatus.delayed++;
                        } else if (status.includes('pre-launch') || status.includes('prelaunch')) {
                            stats.byStatus.prelaunch++;
                        }
                        
                        // Count by location
                        const location = project.location || 'Unknown';
                        stats.byLocation[location] = (stats.byLocation[location] || 0) + 1;
                        
                        // Count by builder
                        const builder = project.builderName || 'Unknown';
                        stats.byBuilder[builder] = (stats.byBuilder[builder] || 0) + 1;
                    });
                    
                    // Get Mumbai projects
                    stats.mumbaiProjects = data.trustScoreProjects
                        .filter(p => 
                            (p.location && p.location.toLowerCase().includes('mumbai')) ||
                            (p.address && p.address.toLowerCase().includes('mumbai'))
                        )
                        .slice(0, 20)
                        .map(p => ({
                            id: p.id,
                            name: p.name,
                            reraNumber: p.reraNumber,
                            builder: p.builderName,
                            location: p.location,
                            status: p.projectStatus
                        }));
                }
            }
            
            res.json({ 
                success: true, 
                data: stats 
            });
        } catch (error) {
            LOG.error('[Trust Score Routes] Error fetching project stats:', error);
            res.status(500).json({ 
                success: false, 
                error: error.message 
            });
        }
    }
);

/**
 * GET /api/trust-score/builders
 * Get top builders with trust scores calculated as average of all project scores
 */
router.get('/builders',
    authenticateToken,
    async (req, res) => {
        try {
            LOG.info('[Trust Score Routes] Fetching top builders');
            
            const { location, limit = 10, sort = 'activity' } = req.query;
            const db = require('../database');
            const dbType = db.getType();
            
            let builders = [];
            
            if (dbType === 'mysql') {
                const pool = db.getPool();
                if (pool) {
                    // Get all projects grouped by builder
                    let query = `
                        SELECT 
                            builder_name,
                            COUNT(*) as total_projects,
                            AVG(trust_score) as avg_trust_score,
                            SUM(CASE WHEN project_status LIKE '%Completed%' OR project_status LIKE '%Near Completion%' THEN 1 ELSE 0 END) as delivered_projects,
                            SUM(CASE WHEN project_status LIKE '%Ongoing%' THEN 1 ELSE 0 END) as ongoing_projects,
                            SUM(CASE WHEN project_status LIKE '%Delay%' THEN 1 ELSE 0 END) as delayed_projects,
                            SUM(rera_complaints_count) as total_complaints
                        FROM trust_score_projects
                        WHERE builder_name IS NOT NULL
                    `;
                    const params = [];
                    
                    if (location) {
                        query += ` AND (location LIKE ? OR address LIKE ?)`;
                        const locationTerm = `%${location}%`;
                        params.push(locationTerm, locationTerm);
                    }
                    
                    query += ` GROUP BY builder_name ORDER BY (SUM(CASE WHEN project_status LIKE '%Ongoing%' THEN 3 ELSE 0 END) + COUNT(*)) DESC, avg_trust_score DESC LIMIT ?`;
                    params.push(parseInt(limit));
                    
                    const [rows] = await pool.query(query, params);
                    builders = rows.map((row, index) => ({
                        id: `builder_${index + 1}`,
                        name: row.builder_name,
                        trustScore: Math.round(row.avg_trust_score || 0),
                        score: Math.round(row.avg_trust_score || 0),
                        totalProjects: row.total_projects,
                        deliveredProjects: row.delivered_projects,
                        ongoingProjects: row.ongoing_projects,
                        delayedProjects: row.delayed_projects,
                        complaints: row.total_complaints || 0,
                        reraComplaints: row.total_complaints || 0,
                        onTimePercentage: row.total_projects > 0 
                            ? Math.round((row.delivered_projects / row.total_projects) * 100) 
                            : 0
                    }));
                }
            } else {
                // In-memory database
                const data = require('../database/data');
                if (data.trustScoreProjects && Array.isArray(data.trustScoreProjects)) {
                    let projects = [...data.trustScoreProjects];
                    
                    if (location) {
                        const locationLower = location.toLowerCase();
                        projects = projects.filter(p => 
                            (p.location && p.location.toLowerCase().includes(locationLower)) ||
                            (p.address && p.address.toLowerCase().includes(locationLower))
                        );
                    }
                    
                    // Group by builder and calculate averages
                    const builderMap = {};
                    projects.forEach(project => {
                        const builderName = project.builderName || 'Unknown Builder';
                        if (!builderMap[builderName]) {
                            builderMap[builderName] = {
                                name: builderName,
                                projects: [],
                                totalScore: 0,
                                totalComplaints: 0
                            };
                        }
                        const score = project.trustScore || project.projectScore || project.score || 0;
                        builderMap[builderName].projects.push(project);
                        builderMap[builderName].totalScore += score;
                        builderMap[builderName].totalComplaints += (project.reraComplaintsCount || 0);
                    });
                    
                    // Convert to array and calculate averages
                    builders = Object.values(builderMap).map((builder, index) => {
                        const avgScore = builder.projects.length > 0 
                            ? Math.round(builder.totalScore / builder.projects.length) 
                            : 0;
                        const delivered = builder.projects.filter(p => 
                            (p.status === 'Completed' || p.status === 'Near Completion' || 
                             p.projectStatus === 'Completed' || p.projectStatus === 'Near Completion')
                        ).length;
                        const ongoing = builder.projects.filter(p => 
                            (p.status === 'Ongoing' || p.projectStatus === 'Ongoing')
                        ).length;
                        const delayed = builder.projects.filter(p => 
                            (p.status && p.status.toLowerCase().includes('delay')) ||
                            (p.projectStatus && p.projectStatus.toLowerCase().includes('delay'))
                        ).length;
                        const sample = builder.projects[0] || {};
                        
                        return {
                            id: sample.builderId || `builder_${index + 1}`,
                            name: builder.name,
                            trustScore: avgScore,
                            score: avgScore,
                            totalProjects: builder.projects.length,
                            projects: builder.projects.length,
                            deliveredProjects: delivered,
                            ongoingProjects: ongoing,
                            delayedProjects: delayed,
                            complaints: builder.totalComplaints,
                            reraComplaints: builder.totalComplaints,
                            location: sample.location || sample.address || 'N/A',
                            address: sample.address || sample.location || 'N/A',
                            activityScore: ongoing * 3 + builder.projects.length + delivered,
                            onTimePercentage: builder.projects.length > 0 
                                ? Math.round((delivered / builder.projects.length) * 100) 
                                : 0
                        };
                    });
                    
                    const sortMode = String(req.query.sort || 'activity').toLowerCase();
                    if (sortMode === 'activity' || location) {
                        builders.sort((a, b) => {
                            if (location) {
                                const locLower = location.toLowerCase();
                                const aLocal = (a.location || a.address || '').toLowerCase().includes(locLower) ? 1 : 0;
                                const bLocal = (b.location || b.address || '').toLowerCase().includes(locLower) ? 1 : 0;
                                if (bLocal !== aLocal) return bLocal - aLocal;
                            }
                            const act = (b.activityScore || 0) - (a.activityScore || 0);
                            if (act !== 0) return act;
                            return (b.trustScore || 0) - (a.trustScore || 0);
                        });
                    } else {
                        builders.sort((a, b) => b.trustScore - a.trustScore);
                    }
                    builders = builders.slice(0, parseInt(limit));
                }
            }
            
            res.json(builders);
        } catch (error) {
            LOG.error('[Trust Score Routes] Error fetching builders:', error);
            res.status(500).json({ 
                success: false, 
                error: error.message 
            });
        }
    }
);

/**
 * GET /api/trust-score/builders/:builderIdOrName
 * Get builder details with trust score calculated as average of all project scores
 */
router.get('/builders/:builderIdOrName',
    authenticateToken,
    async (req, res) => {
        try {
            const { builderIdOrName } = req.params;
            LOG.info(`[Trust Score Routes] Fetching builder details: ${builderIdOrName}`);
            
            const db = require('../database');
            const dbType = db.getType();
            
            let builder = null;
            
            if (dbType === 'mysql') {
                const pool = db.getPool();
                if (pool) {
                    // Use builderName from query if available, otherwise use builderIdOrName
                    const searchTerm = req.query.builderName || builderIdOrName;
                    // Get builder projects
                    const [rows] = await pool.query(
                        `SELECT * FROM trust_score_projects WHERE builder_name LIKE ?`,
                        [`%${searchTerm}%`]
                    );
                    
                    if (rows.length > 0) {
                        const builderName = rows[0].builder_name;
                        const totalScore = rows.reduce((sum, p) => sum + (p.trust_score || 0), 0);
                        const avgScore = Math.round(totalScore / rows.length);
                        const totalComplaints = rows.reduce((sum, p) => sum + (p.rera_complaints_count || 0), 0);
                        const delivered = rows.filter(p => 
                            (p.project_status && (p.project_status.includes('Completed') || p.project_status.includes('Near Completion')))
                        ).length;
                        const ongoing = rows.filter(p => 
                            (p.project_status && p.project_status.includes('Ongoing'))
                        ).length;
                        const delayed = rows.filter(p => 
                            (p.project_status && p.project_status.toLowerCase().includes('delay'))
                        ).length;
                        
                        builder = {
                            id: builderIdOrName,
                            name: builderName,
                            trustScore: avgScore,
                            score: avgScore,
                            totalProjects: rows.length,
                            deliveredProjects: delivered,
                            ongoingProjects: ongoing,
                            delayedProjects: delayed,
                            complaints: totalComplaints,
                            reraComplaints: totalComplaints,
                            onTimePercentage: rows.length > 0 ? Math.round((delivered / rows.length) * 100) : 0,
                            address: rows[0].address || 'N/A',
                            registrationNumber: rows[0].rera_number || rows[0].registration_number || '',
                            reraNumber: rows[0].rera_number || ''
                        };
                    }
                }
            } else {
                // In-memory database
                const data = require('../database/data');
                if (data.trustScoreProjects && Array.isArray(data.trustScoreProjects)) {
                    // Find projects by builder name (case-insensitive partial match)
                    // Also check if builderIdOrName is a builder name from query params
                    const searchTerm = (req.query.builderName || builderIdOrName).toLowerCase();
                    const builderProjects = data.trustScoreProjects.filter(p => {
                        const builderName = (p.builderName || '').toLowerCase();
                        return builderName.includes(searchTerm) || searchTerm.includes(builderName);
                    });
                    
                    if (builderProjects.length > 0) {
                        const builderName = builderProjects[0].builderName;
                        const totalScore = builderProjects.reduce((sum, p) => 
                            sum + (p.trustScore || p.projectScore || p.score || 0), 0
                        );
                        const avgScore = Math.round(totalScore / builderProjects.length);
                        const totalComplaints = builderProjects.reduce((sum, p) => 
                            sum + (p.reraComplaintsCount || 0), 0
                        );
                        const delivered = builderProjects.filter(p => 
                            (p.status === 'Completed' || p.status === 'Near Completion' || 
                             p.projectStatus === 'Completed' || p.projectStatus === 'Near Completion')
                        ).length;
                        const ongoing = builderProjects.filter(p => 
                            (p.status === 'Ongoing' || p.projectStatus === 'Ongoing')
                        ).length;
                        const delayed = builderProjects.filter(p => 
                            (p.status && p.status.toLowerCase().includes('delay')) ||
                            (p.projectStatus && p.projectStatus.toLowerCase().includes('delay'))
                        ).length;
                        
                        builder = {
                            id: builderIdOrName,
                            name: builderName,
                            trustScore: avgScore,
                            score: avgScore,
                            totalProjects: builderProjects.length,
                            deliveredProjects: delivered,
                            ongoingProjects: ongoing,
                            delayedProjects: delayed,
                            complaints: totalComplaints,
                            reraComplaints: totalComplaints,
                            onTimePercentage: builderProjects.length > 0 
                                ? Math.round((delivered / builderProjects.length) * 100) 
                                : 0,
                            address: builderProjects[0].address || 'N/A',
                            registrationNumber: builderProjects[0].reraNumber || builderProjects[0].registrationNumber || '',
                            reraNumber: builderProjects[0].reraNumber || ''
                        };
                    }
                }
            }
            
            if (!builder) {
                return res.status(404).json({ 
                    success: false, 
                    error: 'Builder not found' 
                });
            }
            
            res.json(builder);
        } catch (error) {
            LOG.error('[Trust Score Routes] Error fetching builder details:', error);
            res.status(500).json({ 
                success: false, 
                error: error.message 
            });
        }
    }
);

/**
 * GET /api/trust-score/builders/:builderIdOrName/projects
 * Get all projects for a specific builder
 */
router.get('/builders/:builderIdOrName/projects',
    authenticateToken,
    async (req, res) => {
        try {
            const { builderIdOrName } = req.params;
            LOG.info(`[Trust Score Routes] Fetching projects for builder: ${builderIdOrName}`);
            
            const db = require('../database');
            const dbType = db.getType();
            
            let projects = [];
            
            if (dbType === 'mysql') {
                const pool = db.getPool();
                if (pool) {
                    // Use builderName from query if available, otherwise use builderIdOrName
                    const searchTerm = req.query.builderName || builderIdOrName;
                    const [rows] = await pool.query(
                        `SELECT * FROM trust_score_projects WHERE builder_name LIKE ? ORDER BY trust_score DESC, name ASC`,
                        [`%${searchTerm}%`]
                    );
                    
                    projects = rows.map(row => ({
                        id: row.id,
                        name: row.name,
                        reraNumber: row.rera_number,
                        builder: row.builder_name,
                        builderName: row.builder_name,
                        address: row.address,
                        location: row.location,
                        projectStatus: row.project_status,
                        status: row.project_status,
                        trustScore: row.trust_score,
                        projectScore: row.trust_score,
                        score: row.trust_score,
                        reraComplaintsCount: row.rera_complaints_count || 0
                    }));
                }
            } else {
                // In-memory database
                const data = require('../database/data');
                if (data.trustScoreProjects && Array.isArray(data.trustScoreProjects)) {
                    // Use builderName from query if available, otherwise use builderIdOrName
                    const searchTerm = (req.query.builderName || builderIdOrName).toLowerCase();
                    const builderProjects = data.trustScoreProjects.filter(p => {
                        const builderName = (p.builderName || '').toLowerCase();
                        return builderName.includes(searchTerm) || searchTerm.includes(builderName);
                    });
                    
                    projects = builderProjects.map(p => ({
                        id: p.id,
                        name: p.name,
                        reraNumber: p.reraNumber,
                        builder: p.builderName,
                        builderName: p.builderName,
                        address: p.address,
                        location: p.location,
                        latitude: p.latitude,
                        longitude: p.longitude,
                        projectStatus: p.projectStatus || p.status,
                        status: p.projectStatus || p.status,
                        trustScore: p.trustScore || p.projectScore || p.score || 0,
                        projectScore: p.trustScore || p.projectScore || p.score || 0,
                        score: p.trustScore || p.projectScore || p.score || 0,
                        builderScore: p.builderScore || 0,
                        reraComplaintsCount: p.reraComplaintsCount || 0,
                        launchDate: p.launchDate,
                        expectedCompletionDate: p.expectedCompletionDate,
                        actualCompletionDate: p.actualCompletionDate,
                        totalArea: p.totalArea,
                        numberOfUnits: p.numberOfUnits,
                        numberOfFloors: p.numberOfFloors,
                        loanAmountSanctioned: p.loanAmountSanctioned,
                        totalAmountCollected: p.totalAmountCollected,
                        fundingSources: p.fundingSources,
                        bankName: p.bankName,
                        reraComplaintsStatus: p.reraComplaintsStatus,
                        litigationHistory: p.litigationHistory
                    }));
                }
            }
            
            res.json(projects);
        } catch (error) {
            LOG.error('[Trust Score Routes] Error fetching builder projects:', error);
            res.status(500).json({ 
                success: false, 
                error: error.message 
            });
        }
    }
);

/**
 * GET /api/trust-score/fraud-alerts
 * Get fraud alerts with optional radius/location filters
 */
router.get('/fraud-alerts',
    authenticateToken,
    async (req, res) => {
        try {
            LOG.info('[Trust Score Routes] Fetching fraud alerts');
            
            const { radius = 10, latitude, longitude } = req.query;
            const db = require('../database');
            const dbType = db.getType();
            
            let alerts = [];
            
            if (dbType === 'mysql') {
                const pool = db.getPool();
                if (pool) {
                    let query = 'SELECT * FROM trust_score_fraud_alerts WHERE status = ?';
                    const params = ['active'];
                    
                    // If location provided, filter by radius
                    if (latitude && longitude && radius) {
                        // Simple distance calculation (Haversine formula approximation)
                        // For production, use proper spatial queries
                        query += ` AND (
                            (ABS(latitude - ?) + ABS(longitude - ?)) * 111 <= ?
                        )`;
                        params.push(parseFloat(latitude), parseFloat(longitude), parseFloat(radius));
                    }
                    
                    query += ' ORDER BY created_at DESC LIMIT 50';
                    
                    const [rows] = await pool.query(query, params);
                    alerts = rows.map(row => ({
                        id: row.id,
                        landId: row.land_id,
                        latitude: row.latitude,
                        longitude: row.longitude,
                        projectId: row.project_id,
                        projectName: row.project_name,
                        fraudType: row.fraud_type,
                        severity: row.severity,
                        status: row.status,
                        details: row.details ? (typeof row.details === 'string' ? JSON.parse(row.details) : row.details) : {},
                        createdAt: row.created_at
                    }));
                }
            } else {
                // In-memory database
                const data = require('../database/data');
                if (data.trustScoreFraudAlerts && Array.isArray(data.trustScoreFraudAlerts)) {
                    let filtered = [...data.trustScoreFraudAlerts].filter(a => a.status === 'active');
                    
                    // If location provided, filter by radius
                    if (latitude && longitude && radius) {
                        const lat = parseFloat(latitude);
                        const lng = parseFloat(longitude);
                        const radiusKm = parseFloat(radius);
                        
                        filtered = filtered.filter(alert => {
                            if (!alert.latitude || !alert.longitude) return false;
                            
                            // Simple distance calculation (approximation)
                            const latDiff = Math.abs(alert.latitude - lat);
                            const lngDiff = Math.abs(alert.longitude - lng);
                            const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111; // km
                            
                            return distance <= radiusKm;
                        });
                    }
                    
                    // Sort by date and limit
                    alerts = filtered
                        .sort((a, b) => new Date(b.createdAt || b.created_at) - new Date(a.createdAt || a.created_at))
                        .slice(0, 50)
                        .map(alert => ({
                            id: alert.id,
                            landId: alert.landId || alert.land_id,
                            latitude: alert.latitude,
                            longitude: alert.longitude,
                            projectId: alert.projectId || alert.project_id,
                            projectName: alert.projectName || alert.project_name,
                            fraudType: alert.fraudType || alert.fraud_type,
                            severity: alert.severity,
                            status: alert.status,
                            details: alert.details || {},
                            createdAt: alert.createdAt || alert.created_at
                        }));
                }
            }
            
            res.json(alerts);
        } catch (error) {
            LOG.error('[Trust Score Routes] Error fetching fraud alerts:', error);
            res.status(500).json({ 
                success: false, 
                error: error.message 
            });
        }
    }
);

/**
 * GET /api/trust-score/projects/:projectId
 * Full project details (all fields)
 */
router.get('/projects/:projectId',
    authenticateToken,
    async (req, res) => {
        try {
            const { projectId } = req.params;
            if (projectId === 'high-trust' || projectId === 'stats') {
                return res.status(404).json({ success: false, error: 'Not found' });
            }

            LOG.info(`[Trust Score Routes] Fetching project ${projectId}`);

            const project = await findTrustProjectById(projectId);
            if (project) {
                return res.json(project);
            }

            res.status(404).json({ success: false, error: 'Project not found' });
        } catch (error) {
            LOG.error('[Trust Score Routes] Error fetching project:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
);

/**
 * GET /api/trust-score/projects/:projectId/validation
 * RERAScore-style breakdown + financial reserve + alerts
 */
router.get('/projects/:projectId/validation',
    authenticateToken,
    async (req, res) => {
        try {
            const { projectId } = req.params;
            const { buildProjectValidation } = require('../services/trustScore/projectValidationService');
            const reraService = require('../services/trustScore/reraService');

            let project = null;
            const db = require('../database');
            const data = require('../database/data');
            const sources = [
                ...(data.trustScoreProjects || []),
                ...(db.trustScoreProjects || []),
            ];
            project = sources.find(
                (p) => p.id === projectId || String(p.reraNumber) === String(projectId)
            );

            if (!project && db.getType() === 'mysql') {
                const pool = db.getPool();
                if (pool) {
                    const [rows] = await pool.query(
                        'SELECT * FROM trust_score_projects WHERE id = ? OR rera_number = ? LIMIT 1',
                        [projectId, projectId]
                    );
                    if (rows?.[0]) {
                        const row = rows[0];
                        project = {
                            id: row.id,
                            name: row.name,
                            reraNumber: row.rera_number,
                            builderName: row.builder_name,
                            totalAmountCollected: row.total_amount_collected,
                            loanAmountSanctioned: row.loan_amount_sanctioned,
                            bankName: row.bank_name,
                            fundingSources: row.funding_sources,
                            reraComplaintsCount: row.rera_complaints_count,
                            projectStatus: row.project_status,
                            completion: row.completion,
                            estimatedProjectCost: row.estimated_project_cost,
                            escrowReserveDeposited: row.escrow_reserve_deposited,
                            escrowReservePercentRequired: row.escrow_reserve_percent_required,
                            escrowCompliant: row.escrow_compliant !== 0,
                            documentsFiled: row.documents_filed,
                            registeredAgents: row.registered_agents,
                            dataSource: row.data_source,
                            filingAsOf: row.filing_as_of,
                        };
                    }
                }
            }

            if (!project) {
                return res.status(404).json({ success: false, error: 'Project not found' });
            }

            let reraGovt = {};
            if (project.reraNumber) {
                try {
                    const reraFilingsService = require('../services/trustScore/reraFilingsService');
                    reraGovt = await reraFilingsService.getGovtDetailsByReraNumber(project.reraNumber);
                } catch {
                    try {
                        reraGovt = await reraService.getProjectDetails(project.reraNumber);
                    } catch {
                        reraGovt = {};
                    }
                }
            }

            const validation = buildProjectValidation(project, reraGovt);
            res.json({ success: true, validation, projectId: project.id, reraNumber: project.reraNumber });
        } catch (error) {
            LOG.error('[Trust Score Routes] Validation error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
);

/**
 * GET /api/trust-score/projects/:projectId/nearby
 * Other projects in the same area (MySQL-first)
 */
router.get('/projects/:projectId/nearby',
    authenticateToken,
    async (req, res) => {
        try {
            const { projectId } = req.params;
            const limit = Math.min(parseInt(req.query.limit, 10) || 6, 20);
            const current = await findTrustProjectById(projectId);
            if (!current) {
                return res.status(404).json({ success: false, error: 'Project not found' });
            }

            const areaToken = extractAreaToken(current);
            const cityToken = String(current.location || '').trim();
            const db = require('../database');
            let nearby = [];

            if (db.getType() === 'mysql') {
                const pool = db.getPool();
                if (pool) {
                    const likeArea = areaToken ? `%${areaToken}%` : null;
                    const likeCity = cityToken ? `%${cityToken}%` : null;
                    let query = 'SELECT * FROM trust_score_projects WHERE id != ?';
                    const params = [current.id];
                    if (likeArea || likeCity) {
                        query += ' AND (';
                        const parts = [];
                        if (likeArea) {
                            parts.push('address LIKE ?');
                            params.push(likeArea);
                        }
                        if (likeCity) {
                            parts.push('location LIKE ?');
                            params.push(likeCity);
                        }
                        query += parts.join(' OR ') + ')';
                    }
                    query += ' ORDER BY trust_score DESC, name ASC LIMIT ?';
                    params.push(limit);
                    const [rows] = await pool.query(query, params);
                    nearby = (rows || []).map(mapTrustProjectRow);
                }
            }

            if (!nearby.length) {
                const data = require('../database/data');
                const sources = [
                    ...(data.trustScoreProjects || []),
                    ...(db.trustScoreProjects || []),
                ].map(mapTrustProjectRow);
                nearby = sources
                    .filter((p) => p.id !== current.id)
                    .filter((p) => {
                        if (!areaToken && !cityToken) return true;
                        const hay = `${p.address || ''} ${p.location || ''}`.toLowerCase();
                        const areaOk = areaToken && hay.includes(areaToken.toLowerCase());
                        const cityOk = cityToken && hay.includes(cityToken.toLowerCase());
                        return areaOk || cityOk;
                    })
                    .slice(0, limit);
            }

            res.json({ success: true, area: areaToken || cityToken, projects: nearby });
        } catch (error) {
            LOG.error('[Trust Score Routes] Nearby projects error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
);

/**
 * GET /api/trust-score/projects/:projectId/complaints
 * Local user complaints + MahaRERA government complaints
 */
router.get('/projects/:projectId/complaints',
    authenticateToken,
    async (req, res) => {
        try {
            const { projectId } = req.params;
            const { reraNumber: reraQuery } = req.query;
            const db = require('../database');
            const dbType = db.getType();
            const reraService = require('../services/trustScore/reraService');

            let localComplaints = [];
            let resolvedRera = String(reraQuery || '').trim();
            let projectName = '';

            if (dbType === 'mysql') {
                const pool = db.getPool();
                if (pool) {
                    const [rows] = await pool.query(
                        'SELECT * FROM trust_score_complaints WHERE project_id = ? ORDER BY created_at DESC',
                        [projectId]
                    );
                    localComplaints = (rows || []).map(row => ({
                        id: row.id,
                        userId: row.user_id,
                        projectId: row.project_id,
                        projectName: row.project_name,
                        issueType: row.issue_type,
                        description: row.description,
                        status: row.status,
                        createdAt: row.created_at,
                        source: 'local',
                    }));

                    if (!resolvedRera) {
                        const [projRows] = await pool.query(
                            'SELECT rera_number, name FROM trust_score_projects WHERE id = ? LIMIT 1',
                            [projectId]
                        );
                        if (projRows?.[0]) {
                            resolvedRera = projRows[0].rera_number || '';
                            projectName = projRows[0].name || '';
                        }
                    }
                }
            } else {
                const dbModule = require('../database');
                const complaints = dbModule.trustScoreComplaints || [];
                if (Array.isArray(complaints)) {
                    localComplaints = complaints
                        .filter(c => (c.projectId || c.project_id) === projectId)
                        .map(c => ({
                            id: c.id,
                            userId: c.userId || c.user_id,
                            projectId: c.projectId || c.project_id,
                            projectName: c.projectName || c.project_name,
                            issueType: c.issueType || c.issue_type,
                            description: c.description,
                            status: c.status || 'Pending',
                            createdAt: c.createdAt || c.created_at,
                            source: 'local',
                        }))
                        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                }

                const projects = dbModule.trustScoreProjects
                    || require('../database/data').trustScoreProjects
                    || [];
                if (!resolvedRera && projects.length) {
                    const proj = projects.find(p => p.id === projectId);
                    if (proj) {
                        resolvedRera = proj.reraNumber || '';
                        projectName = proj.name || '';
                    }
                }
            }

            let governmentComplaints = [];
            if (resolvedRera) {
                const govtRaw = await reraService.getProjectComplaints(resolvedRera);
                governmentComplaints = (govtRaw || []).map((c, idx) => ({
                    id: c.id || `govt_${idx}`,
                    type: c.type || c.complaintType || 'RERA Complaint',
                    status: c.status || 'Pending',
                    date: c.date || c.filedDate,
                    description: c.description || c.details || '',
                    source: 'government',
                }));
            }

            res.json({
                success: true,
                projectId,
                projectName,
                reraNumber: resolvedRera,
                local: localComplaints,
                government: governmentComplaints,
                total: localComplaints.length + governmentComplaints.length,
            });
        } catch (error) {
            LOG.error('[Trust Score Routes] Error fetching complaints:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
);

/**
 * POST /api/trust-score/complaints
 * Add a local RERA complaint for a project
 */
router.post('/complaints',
    authenticateToken,
    async (req, res) => {
        try {
            const {
                projectId,
                projectName,
                reraNumber,
                issueType,
                description,
            } = req.body || {};

            if (!projectId || !issueType || !description) {
                return res.status(400).json({
                    success: false,
                    error: 'projectId, issueType, and description are required',
                });
            }

            const db = require('../database');
            const dbType = db.getType();
            const complaint = {
                id: `comp_${Date.now()}`,
                userId: req.user?.id || req.user?.userId || null,
                projectId,
                projectName: projectName || '',
                reraNumber: reraNumber || '',
                issueType,
                description,
                status: 'Pending',
                documents: JSON.stringify([]),
                createdAt: new Date(),
            };

            if (dbType === 'mysql') {
                const pool = db.getPool();
                if (pool) {
                    await pool.query(`
                        INSERT INTO trust_score_complaints
                        (id, user_id, project_id, project_name, issue_type, description, status, documents, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        complaint.id,
                        complaint.userId,
                        complaint.projectId,
                        complaint.projectName,
                        complaint.issueType,
                        complaint.description,
                        complaint.status,
                        complaint.documents,
                        complaint.createdAt,
                    ]);

                    try {
                        await pool.query(
                            `UPDATE trust_score_projects
                             SET rera_complaints_count = COALESCE(rera_complaints_count, 0) + 1
                             WHERE id = ?`,
                            [projectId]
                        );
                    } catch (updateErr) {
                        LOG.warning('[Trust Score Routes] Could not bump complaint count:', updateErr.message);
                    }
                }
            }

            const dbModule = require('../database');
            if (!dbModule.trustScoreComplaints) dbModule.trustScoreComplaints = [];
            dbModule.trustScoreComplaints.push(complaint);

            const projects = dbModule.trustScoreProjects
                || require('../database/data').trustScoreProjects
                || [];
            const proj = projects.find(p => p.id === projectId);
            if (proj) {
                proj.reraComplaintsCount = (proj.reraComplaintsCount || 0) + 1;
                const pending = dbModule.trustScoreComplaints.filter(
                    c => (c.projectId || c.project_id) === projectId
                ).length;
                proj.reraComplaintsStatus = `${pending} Pending`;
            }

            res.json({ success: true, complaint: { ...complaint, source: 'local' } });
        } catch (error) {
            LOG.error('[Trust Score Routes] Error adding complaint:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
);

/**
 * GET /api/trust-score/rera/suggestions?search=&limit=
 */
router.get('/rera/suggestions', authenticateToken, async (req, res) => {
    try {
        const reraFilingsService = require('../services/trustScore/reraFilingsService');
        const rows = await reraFilingsService.listReraSuggestions(req.query.search, req.query.limit);
        res.json(rows);
    } catch (error) {
        LOG.error('[Trust Score Routes] RERA suggestions error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/trust-score/rera/validate
 * Body: { reraNumber }
 */
router.post('/rera/validate', authenticateToken, async (req, res) => {
    try {
        const reraNumber = String(req.body?.reraNumber || '').trim();
        if (!reraNumber) {
            return res.status(400).json({ success: false, error: 'reraNumber is required' });
        }
        const reraFilingsService = require('../services/trustScore/reraFilingsService');
        const project = await reraFilingsService.getGovtDetailsByReraNumber(reraNumber);
        if (!project) {
            return res.json({ success: false, error: 'RERA number not found in govt filings' });
        }
        res.json({
            success: true,
            project: {
                reraNumber: project.reraNumber,
                projectName: project.projectName || project.name,
                builderName: project.builderName,
                status: project.status || project.projectStatus,
                registrationDate: project.registrationDate || project.launchDate,
                validityDate: project.validityDate || project.expectedCompletionDate,
                address: project.address || project.location,
                totalAmountCollected: project.totalAmountCollected,
                loanAmountSanctioned: project.loanAmountSanctioned,
                estimatedProjectCost: project.estimatedProjectCost,
                escrowReserveDeposited: project.escrowReserveDeposited,
                escrowCompliant: project.escrowCompliant,
                documentsFiled: project.documentsFiled,
                reraComplaintsCount: project.reraComplaintsCount,
                reraComplaintsStatus: project.reraComplaintsStatus,
                completion: project.completion,
            },
            governmentComplaints: project.governmentComplaints || [],
            dataSource: project.dataSource,
            dataSourceLabel: project.dataSourceLabel,
            filingAsOf: project.filingAsOf,
            portalUrl: project.portalUrl,
        });
    } catch (error) {
        LOG.error('[Trust Score Routes] RERA validate error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/trust-score/rera/govt-details?reraNumber=
 */
router.get('/rera/govt-details', authenticateToken, async (req, res) => {
    try {
        const reraNumber = String(req.query.reraNumber || '').trim();
        if (!reraNumber) {
            return res.status(400).json({ success: false, error: 'reraNumber is required' });
        }
        const reraFilingsService = require('../services/trustScore/reraFilingsService');
        const project = await reraFilingsService.getGovtDetailsByReraNumber(reraNumber);
        if (!project) {
            return res.json({ success: false, error: 'Not found' });
        }
        res.json({ success: true, ...project });
    } catch (error) {
        LOG.error('[Trust Score Routes] RERA govt-details error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/trust-score/watchlist
 */
router.get('/watchlist', authenticateToken, async (req, res) => {
    try {
        const userId = req.query.user_id || req.user?.id || req.user?.userId;
        if (!userId) {
            return res.status(400).json({ success: false, error: 'user_id is required' });
        }

        const db = require('../database');
        const dbType = db.getType();
        let items = [];

        if (dbType === 'mysql') {
            const pool = db.getPool();
            if (pool) {
                const [rows] = await pool.query(
                    `SELECT w.*, p.trust_score, p.location, p.project_status
                     FROM trust_score_watchlist w
                     LEFT JOIN trust_score_projects p ON p.id = w.project_id
                     WHERE w.user_id = ?
                     ORDER BY w.created_at DESC`,
                    [String(userId)]
                );
                items = (rows || []).map((row) => ({
                    id: row.project_id,
                    watchlistId: row.id,
                    name: row.project_name,
                    projectName: row.project_name,
                    score: row.trust_score,
                    trustScore: row.trust_score,
                    location: row.location,
                    status: row.project_status,
                    savedAt: row.created_at,
                }));
            }
        }

        if (!items.length) {
            const mem = db.trustScoreWatchlist || [];
            items = mem
                .filter((w) => String(w.userId || w.user_id) === String(userId))
                .map((w) => ({
                    id: w.projectId || w.project_id,
                    watchlistId: w.id,
                    name: w.projectName || w.project_name,
                    projectName: w.projectName || w.project_name,
                    savedAt: w.createdAt || w.created_at,
                }));
        }

        res.json(items);
    } catch (error) {
        LOG.error('[Trust Score Routes] Error fetching watchlist:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/trust-score/watchlist
 * Body: { user_id?, project_ids: string[] }
 */
router.post('/watchlist', authenticateToken, async (req, res) => {
    try {
        const userId = req.body.user_id || req.user?.id || req.user?.userId;
        const projectIds = Array.isArray(req.body.project_ids) ? req.body.project_ids : [];
        if (!userId) {
            return res.status(400).json({ success: false, error: 'user_id is required' });
        }
        if (!projectIds.length) {
            return res.status(400).json({ success: false, error: 'project_ids is required' });
        }

        const db = require('../database');
        const dbType = db.getType();
        const data = require('../database/data');
        const allProjects = db.trustScoreProjects || data.trustScoreProjects || [];
        let added = 0;

        const resolveProject = (pid) =>
            allProjects.find((p) => String(p.id) === String(pid)) || null;

        if (!db.trustScoreWatchlist) db.trustScoreWatchlist = [];

        for (const projectId of projectIds) {
            const existsMem = db.trustScoreWatchlist.some(
                (w) =>
                    String(w.userId || w.user_id) === String(userId) &&
                    String(w.projectId || w.project_id) === String(projectId)
            );
            if (existsMem) continue;

            const proj = resolveProject(projectId);
            const watchId = `watch_${String(userId)}_${String(projectId)}`;

            if (dbType === 'mysql') {
                const pool = db.getPool();
                if (pool) {
                    const [existing] = await pool.query(
                        'SELECT id FROM trust_score_watchlist WHERE user_id = ? AND project_id = ? LIMIT 1',
                        [String(userId), String(projectId)]
                    );
                    if (existing?.length) continue;

                    await pool.query(
                        `INSERT INTO trust_score_watchlist (id, user_id, project_id, project_name, created_at)
                         VALUES (?, ?, ?, ?, NOW())`,
                        [
                            watchId,
                            String(userId),
                            String(projectId),
                            proj?.name || proj?.projectName || String(projectId),
                        ]
                    );
                }
            }

            db.trustScoreWatchlist.push({
                id: watchId,
                userId: String(userId),
                projectId: String(projectId),
                projectName: proj?.name || proj?.projectName || String(projectId),
                createdAt: new Date(),
            });
            added += 1;
        }

        res.json({ success: true, added, total: projectIds.length });
    } catch (error) {
        LOG.error('[Trust Score Routes] Error adding to watchlist:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
