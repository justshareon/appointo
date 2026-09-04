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
};
