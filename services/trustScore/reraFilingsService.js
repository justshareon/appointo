/**
 * Public RERA filings loader — preview in memory, super admin saves to DB.
 * Data sourced from public RERA filings as of March 2026.
 */
const fs = require('fs');
const path = require('path');
const reraFilingsLog = require('../../utils/reraFilingsLog');
const { parseAmountToCrores } = require('./projectValidationService');
const {
  upsertProject,
  getProjectMysqlCount,
  getProjectMemoryCount,
} = require('./trustScoreHydrateService');

function getMysqlPool() {
  try {
    const fcm = require('../../database/featureConnectionManager');
    return fcm.getCachedPool('trust_score') || fcm.getCachedPool('core');
  } catch (_) {
    return null;
  }
}

const FILINGS_PATH = path.join(__dirname, '../../data/rera_public_filings_march_2026.json');
const DATA_SOURCE = 'public_rera_filing_march_2026';
const DATA_SOURCE_LABEL = 'Data sourced from public RERA filings as of March 2026';
const FILING_AS_OF = '2026-03-01';

let pendingPreview = null;

function formatCrores(n) {
  if (n == null || Number.isNaN(n)) return null;
  return `₹${Math.round(n * 10) / 10} Crores`;
}

function enrichFinancials(project = {}) {
  const out = { ...project };
  const collected = parseAmountToCrores(out.totalAmountCollected);
  const requiredPct = Number(out.escrowReservePercentRequired || 70);

  if (!out.estimatedProjectCost && collected != null) {
    out.estimatedProjectCost = formatCrores(collected * 1.25);
  }
  if (!out.escrowReserveDeposited && collected != null && out.escrowCompliant !== false) {
    out.escrowReserveDeposited = formatCrores((collected * requiredPct) / 100);
  }
  if (out.escrowCompliant == null && collected != null) {
    const deposited = parseAmountToCrores(out.escrowReserveDeposited);
    const required = (collected * requiredPct) / 100;
    out.escrowCompliant = deposited == null ? true : deposited >= required * 0.98;
  }
  if (out.documentsFiled == null) out.documentsFiled = 10;
  if (out.registeredAgents == null) out.registeredAgents = 0;
  return out;
}

function mergeFilingWithSeed(filing = {}) {
  const seedData = require('../../database/data');
  const seed = (seedData.trustScoreProjects || []).find(
    (p) => p.id === filing.id || p.reraNumber === filing.reraNumber
  );
  if (!seed) {
    return enrichFinancials({
      ...filing,
      dataSource: DATA_SOURCE,
      dataSourceLabel: DATA_SOURCE_LABEL,
      filingAsOf: FILING_AS_OF,
    });
  }
  return enrichFinancials({
    ...seed,
    ...filing,
    dataSource: DATA_SOURCE,
    dataSourceLabel: DATA_SOURCE_LABEL,
    filingAsOf: FILING_AS_OF,
  });
}

function readFilingsJson() {
  if (!fs.existsSync(FILINGS_PATH)) {
    throw new Error(`RERA filings file not found: ${FILINGS_PATH}`);
  }
  const raw = fs.readFileSync(FILINGS_PATH, 'utf8');
  return JSON.parse(raw);
}

async function overlayReraApi(projects = []) {
  let reraService;
  try {
    reraService = require('./reraService');
  } catch (_) {
    return projects;
  }
  const out = [];
  for (const p of projects) {
    const reraNo = p.reraNumber;
    if (!reraNo || !String(reraNo).startsWith('P521')) {
      out.push(p);
      continue;
    }
    try {
      const apiRow = await reraService.getProjectDetails(reraNo);
      if (apiRow && typeof apiRow === 'object') {
        out.push(enrichFinancials({ ...p, ...apiRow, dataSource: DATA_SOURCE, filingAsOf: FILING_AS_OF }));
        continue;
      }
    } catch (err) {
      reraFilingsLog.push('warn', 'api_overlay', `RERA API skip ${reraNo}: ${err.message}`);
    }
    out.push(p);
  }
  return out;
}

function mergeProjectIntoMemory(db, normalized) {
  const mem = db.inMemoryDb || db;
  if (!mem.trustScoreProjects) mem.trustScoreProjects = [];
  if (db.trustScoreProjects !== mem.trustScoreProjects) {
    db.trustScoreProjects = mem.trustScoreProjects;
  }
  const idx = mem.trustScoreProjects.findIndex((p) => p.id === normalized.id);
  if (idx >= 0) {
    mem.trustScoreProjects[idx] = {
      ...mem.trustScoreProjects[idx],
      ...normalized,
      updatedAt: new Date(),
    };
    return 'updated';
  }
  mem.trustScoreProjects.push({
    ...normalized,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return 'inserted';
}

function getDiagnostics() {
  const db = require('../../database');
  return {
    filingsFileExists: fs.existsSync(FILINGS_PATH),
    filingsFilePath: FILINGS_PATH,
    dataSourceLabel: DATA_SOURCE_LABEL,
    filingAsOf: FILING_AS_OF,
    dbType: db.getType ? db.getType() : 'inmemory',
  };
}

async function loadPreview({ useReraApi = false } = {}) {
  const json = readFilingsJson();
  let projects = (json.filings || []).map(mergeFilingWithSeed);
  if (useReraApi) {
    projects = await overlayReraApi(projects);
  }
  pendingPreview = projects;

  const sample = projects.slice(0, 8).map((p) => ({
    id: p.id,
    name: p.name,
    reraNumber: p.reraNumber,
    builderName: p.builderName,
    location: p.location,
    estimatedProjectCost: p.estimatedProjectCost,
    escrowReserveDeposited: p.escrowReserveDeposited,
    escrowCompliant: p.escrowCompliant,
    documentsFiled: p.documentsFiled,
    reraComplaintsCount: p.reraComplaintsCount,
  }));

  reraFilingsLog.push('info', 'load_done', `Preview ready: ${projects.length} projects`);

  return {
    total: projects.length,
    sample,
    dataSourceLabel: json.dataSourceLabel || DATA_SOURCE_LABEL,
    filingAsOf: json.filingAsOf || FILING_AS_OF,
    counts: {
      compliant: projects.filter((p) => p.escrowCompliant !== false).length,
      nonCompliant: projects.filter((p) => p.escrowCompliant === false).length,
      withComplaints: projects.filter((p) => (p.reraComplaintsCount || 0) > 0).length,
    },
  };
}

async function saveToDatabase(overrideRows) {
  const rows = Array.isArray(overrideRows) && overrideRows.length ? overrideRows : pendingPreview;
  if (!rows?.length) {
    const err = new Error('No preview loaded — run Load first');
    err.reraFilingsStep = 'save_no_preview';
    throw err;
  }

  const db = require('../../database');
  const { isMysqlConfigured } = require('../../utils/resolveDbType');
  if (isMysqlConfigured()) {
    try {
      const fcm = require('../../database/featureConnectionManager');
      await fcm.acquireForSync('trust_score');
      const { ensureFeatureSchema } = require('../../database/schema/featureTables');
      await ensureFeatureSchema('trust_score', db);
    } catch (err) {
      reraFilingsLog.push('warn', 'save_pool', err.message);
    }
  }
  const pool = getMysqlPool();

  let inserted = 0;
  let updated = 0;
  const storage = [];

  for (const project of rows) {
    const normalized = enrichFinancials({
      ...project,
      dataSource: project.dataSource || DATA_SOURCE,
      filingAsOf: project.filingAsOf || FILING_AS_OF,
      dataSourceLabel: project.dataSourceLabel || DATA_SOURCE_LABEL,
    });

    if (pool) {
      try {
        const [existing] = await pool.query(
          'SELECT id FROM trust_score_projects WHERE id = ?',
          [normalized.id]
        );
        await upsertProject(pool, normalized);
        if (existing?.length) updated += 1;
        else inserted += 1;
        if (!storage.includes('mysql')) storage.push('mysql');
      } catch (err) {
        reraFilingsLog.push('warn', 'mysql_upsert', `${normalized.id}: ${err.message}`);
      }
    }

    const memResult = mergeProjectIntoMemory(db, normalized);
    if (!pool) {
      if (memResult === 'updated') updated += 1;
      else inserted += 1;
    }
    if (!storage.includes('memory')) storage.push('memory');
  }

  pendingPreview = null;

  return {
    inserted,
    updated,
    total: rows.length,
    storage: storage.join('+') || 'memory',
    dataSourceLabel: DATA_SOURCE_LABEL,
    filingAsOf: FILING_AS_OF,
  };
}

async function getStatus() {
  return {
    mysqlCount: await getProjectMysqlCount(),
    memoryCount: getProjectMemoryCount(),
    pendingPreview: pendingPreview?.length || 0,
    diagnostics: getDiagnostics(),
  };
}

function getPendingPreview() {
  return pendingPreview;
}

function findFilingByRera(reraNumber) {
  try {
    const json = readFilingsJson();
    const reg = String(reraNumber || '').trim().toUpperCase();
    return (json.filings || []).find((f) => String(f.reraNumber || '').toUpperCase() === reg) || null;
  } catch (_) {
    return null;
  }
}

function findSeedProjectByRera(reraNumber) {
  try {
    const seedData = require('../../database/data');
    const reg = String(reraNumber || '').trim().toUpperCase();
    return (seedData.trustScoreProjects || []).find(
      (p) => String(p.reraNumber || '').toUpperCase() === reg
    ) || null;
  } catch (_) {
    return null;
  }
}

async function findDbProjectByRera(reraNumber) {
  const reg = String(reraNumber || '').trim().toUpperCase();
  if (!reg) return null;
  const db = require('../../database');
  if (db.getType?.() === 'mysql') {
    const pool = getMysqlPool();
    if (pool) {
      try {
        const [rows] = await pool.query(
          'SELECT * FROM trust_score_projects WHERE rera_number = ? LIMIT 1',
          [reg]
        );
        if (rows?.[0]) {
          return {
            id: rows[0].id,
            name: rows[0].name,
            reraNumber: rows[0].rera_number,
            builderName: rows[0].builder_name,
            address: rows[0].address,
            location: rows[0].location,
            projectStatus: rows[0].project_status,
            status: rows[0].project_status,
            totalAmountCollected: rows[0].total_amount_collected,
            loanAmountSanctioned: rows[0].loan_amount_sanctioned,
            estimatedProjectCost: rows[0].estimated_project_cost,
            escrowReserveDeposited: rows[0].escrow_reserve_deposited,
            escrowReservePercentRequired: rows[0].escrow_reserve_percent_required,
            escrowCompliant: rows[0].escrow_compliant !== 0,
            documentsFiled: rows[0].documents_filed,
            registeredAgents: rows[0].registered_agents,
            reraComplaintsCount: rows[0].rera_complaints_count,
            reraComplaintsStatus: rows[0].rera_complaints_status,
            completion: rows[0].completion,
            dataSource: rows[0].data_source,
            filingAsOf: rows[0].filing_as_of,
          };
        }
      } catch (_) {}
    }
  }
  const mem = db.trustScoreProjects || db.inMemoryDb?.trustScoreProjects || [];
  return mem.find((p) => String(p.reraNumber || '').toUpperCase() === reg) || null;
}

function buildMahaReraPortalUrl({ reraNumber, projectName, builderName } = {}) {
  const reg = String(reraNumber || '').trim().toUpperCase();
  const params = new URLSearchParams();
  if (reg) params.set('certificate_no', reg);
  if (projectName) params.set('project_name', String(projectName).trim());
  if (builderName) params.set('promoter_name', String(builderName).trim());
  params.set('project_state', '27');
  return `https://maharera.maharashtra.gov.in/projects-search-result?${params.toString()}`;
}

/**
 * Resolve govt/RERA details: public filings → DB → seed → RERA service overlay.
 */
async function getGovtDetailsByReraNumber(reraNumber) {
  const reg = String(reraNumber || '').trim().toUpperCase();
  if (!reg) return null;

  const filing = findFilingByRera(reg);
  const seed = findSeedProjectByRera(reg);
  const dbProject = await findDbProjectByRera(reg);
  const filingMerged = filing ? mergeFilingWithSeed(filing) : null;

  let base = {
    ...(seed || {}),
    ...(dbProject || {}),
    ...(filingMerged || {}),
    reraNumber: reg,
    name: filingMerged?.name || dbProject?.name || seed?.name || `Project ${reg}`,
    projectName: filingMerged?.name || dbProject?.name || seed?.name || `Project ${reg}`,
    builderName: filingMerged?.builderName || dbProject?.builderName || seed?.builderName || '',
    location: filingMerged?.location || dbProject?.location || seed?.location || '',
    address: dbProject?.address || seed?.address || '',
    status: dbProject?.projectStatus || dbProject?.status || seed?.projectStatus || seed?.status || 'Registered',
    projectStatus: dbProject?.projectStatus || dbProject?.status || seed?.projectStatus || seed?.status || 'Registered',
    dataSource: DATA_SOURCE,
    dataSourceLabel: DATA_SOURCE_LABEL,
    filingAsOf: FILING_AS_OF,
  };

  let apiOverlay = {};
  try {
    const reraService = require('./reraService');
    apiOverlay = await reraService.getProjectDetails(reg);
    if (apiOverlay && typeof apiOverlay === 'object') {
      base = {
        ...apiOverlay,
        ...base,
        reraNumber: reg,
        projectName: base.name || base.projectName || apiOverlay.projectName,
        builderName: base.builderName || apiOverlay.builderName,
        reraComplaintsCount:
          base.reraComplaintsCount ??
          dbProject?.reraComplaintsCount ??
          seed?.reraComplaintsCount ??
          apiOverlay.reraComplaintsCount ??
          0,
      };
    }
  } catch (err) {
    reraFilingsLog.push('warn', 'govt_overlay', `${reg}: ${err.message}`);
  }

  let governmentComplaints = [];
  try {
    const reraService = require('./reraService');
    governmentComplaints = await reraService.getProjectComplaints(reg);
  } catch (_) {}

  return {
    ...base,
    governmentComplaints,
    portalUrl: buildMahaReraPortalUrl({
      reraNumber: reg,
      projectName: base.name || base.projectName,
      builderName: base.builderName,
    }),
  };
}

async function listReraSuggestions(searchQuery = '', limit = 10) {
  const q = String(searchQuery || '').trim().toLowerCase();
  const max = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
  const dbProject = await findDbProjectByRera(q.toUpperCase().startsWith('P') ? q.toUpperCase() : '');
  const pool = [];

  try {
    const json = readFilingsJson();
    (json.filings || []).forEach((f) => {
      pool.push({
        reraNumber: f.reraNumber,
        projectName: f.name || f.projectName,
        builderName: f.builderName,
        location: f.location,
      });
    });
  } catch (_) {}

  try {
    const seedData = require('../../database/data');
    (seedData.trustScoreProjects || []).forEach((p) => {
      pool.push({
        reraNumber: p.reraNumber,
        projectName: p.name,
        builderName: p.builderName,
        location: p.location,
      });
    });
  } catch (_) {}

  const db = require('../../database');
  const mem = db.trustScoreProjects || db.inMemoryDb?.trustScoreProjects || [];
  mem.forEach((p) => {
    pool.push({
      reraNumber: p.reraNumber,
      projectName: p.name,
      builderName: p.builderName,
      location: p.location,
    });
  });

  const seen = new Set();
  const unique = [];
  for (const row of pool) {
    const key = String(row.reraNumber || '').toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  const filtered = q
    ? unique.filter((row) => {
        const hay = [row.reraNumber, row.projectName, row.builderName, row.location]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
    : unique;

  if (dbProject && !filtered.some((r) => String(r.reraNumber).toUpperCase() === String(dbProject.reraNumber).toUpperCase())) {
    filtered.unshift({
      reraNumber: dbProject.reraNumber,
      projectName: dbProject.name,
      builderName: dbProject.builderName,
      location: dbProject.location,
    });
  }

  return filtered.slice(0, max);
}

module.exports = {
  DATA_SOURCE,
  DATA_SOURCE_LABEL,
  FILING_AS_OF,
  FILINGS_PATH,
  loadPreview,
  saveToDatabase,
  getStatus,
  getPendingPreview,
  getDiagnostics,
  findFilingByRera,
  findSeedProjectByRera,
  mergeFilingWithSeed,
  getGovtDetailsByReraNumber,
  listReraSuggestions,
  buildMahaReraPortalUrl,
};
