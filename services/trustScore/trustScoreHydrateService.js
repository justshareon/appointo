/**
 * Trust Score MySQL ↔ in-memory sync.
 * Runs on first trust_score module access (via featureMemoryManager).
 */
const LOG = require('../../utils/logger');
const { isMysqlConfigured } = require('../../utils/resolveDbType');

let syncPromise = null;

function getDb() {
  return require('../../database');
}

function getPool() {
  const db = getDb();
  try {
    const fcm = require('../../database/featureConnectionManager');
    return fcm.getCachedPool('trust_score')
      || fcm.getCachedPool('core')
      || (db.getPool ? db.getPool() : null);
  } catch (_) {
    return db.getPool ? db.getPool() : null;
  }
}

function parseJsonField(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function mapProjectRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    reraNumber: row.rera_number,
    builderName: row.builder_name,
    builderId: row.builder_id,
    address: row.address,
    location: row.location,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    projectStatus: row.project_status,
    status: row.project_status,
    totalArea: row.total_area,
    numberOfFloors: row.number_of_floors,
    numberOfUnits: row.number_of_units,
    launchDate: row.launch_date,
    expectedCompletionDate: row.expected_completion_date,
    actualCompletionDate: row.actual_completion_date,
    reraExtensionDetails: row.rera_extension_details,
    landOwnershipTitle: row.land_ownership_title,
    landOwnerName: row.land_owner_name,
    landArea: row.land_area,
    landId: row.land_id,
    approvalAuthorities: parseJsonField(row.approval_authorities, []),
    approvedBuildingPlans: row.approved_building_plans,
    bankName: row.bank_name,
    loanAmountSanctioned: row.loan_amount_sanctioned,
    totalAmountCollected: row.total_amount_collected,
    fundingSources: row.funding_sources,
    litigationHistory: parseJsonField(row.litigation_history, []),
    reraComplaintsCount: row.rera_complaints_count ?? 0,
    reraComplaintsStatus: row.rera_complaints_status,
    trustScore: row.trust_score ?? 0,
    builderScore: row.builder_score ?? 0,
    projectScore: row.project_score ?? row.trust_score ?? 0,
    completion: row.completion ?? 0,
    priceRise: row.price_rise,
    estimatedProjectCost: row.estimated_project_cost,
    escrowReserveDeposited: row.escrow_reserve_deposited,
    escrowReservePercentRequired: row.escrow_reserve_percent_required ?? 70,
    escrowCompliant: row.escrow_compliant !== 0 && row.escrow_compliant !== false,
    documentsFiled: row.documents_filed ?? 0,
    registeredAgents: row.registered_agents ?? 0,
    dataSource: row.data_source,
    filingAsOf: row.filing_as_of,
    dataSourceLabel: row.data_source === 'public_rera_filing_march_2026'
      ? 'Data sourced from public RERA filings as of March 2026'
      : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFraudAlertRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    landId: row.land_id,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    projectId: row.project_id,
    projectName: row.project_name,
    fraudType: row.fraud_type,
    severity: row.severity,
    status: row.status,
    details: parseJsonField(row.details, {}),
    createdAt: row.created_at,
  };
}

function mapBuilderRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    reraRegistration: row.rera_registration,
    address: row.address,
    totalProjects: row.total_projects ?? 0,
    deliveredProjects: row.delivered_projects ?? 0,
    ongoingProjects: row.ongoing_projects ?? 0,
    delayedProjects: row.delayed_projects ?? 0,
    deliveredOnTime: row.delivered_on_time ?? 0,
    reraComplaints: row.rera_complaints ?? 0,
    cidcoComplaints: row.cidco_complaints ?? 0,
    landTitleDisputes: row.land_title_disputes ?? 0,
    averageUserRating: row.average_user_rating != null ? Number(row.average_user_rating) : 0,
    totalReviews: row.total_reviews ?? 0,
    yearsInBusiness: row.years_in_business ?? 0,
    trustScore: row.trust_score ?? 0,
    createdAt: row.created_at,
  };
}

function projectToMysqlParams(p) {
  const now = new Date();
  return [
    p.id,
    p.name,
    p.reraNumber,
    p.builderName,
    p.builderId || null,
    p.address,
    p.latitude ?? null,
    p.longitude ?? null,
    p.totalArea || null,
    p.numberOfFloors ?? null,
    p.numberOfUnits ?? null,
    p.projectStatus || p.status || null,
    p.launchDate || null,
    p.expectedCompletionDate || null,
    p.actualCompletionDate || null,
    p.reraExtensionDetails || null,
    p.landOwnershipTitle || null,
    p.landOwnerName || null,
    p.landArea || null,
    p.landId || null,
    typeof p.approvalAuthorities === 'string'
      ? p.approvalAuthorities
      : JSON.stringify(p.approvalAuthorities || []),
    p.approvedBuildingPlans || null,
    p.bankName || null,
    p.loanAmountSanctioned || null,
    p.totalAmountCollected || null,
    p.fundingSources || null,
    typeof p.litigationHistory === 'string'
      ? p.litigationHistory
      : JSON.stringify(p.litigationHistory || []),
    p.reraComplaintsCount ?? 0,
    p.reraComplaintsStatus || null,
    p.trustScore ?? p.projectScore ?? 0,
    p.builderScore ?? 0,
    p.projectScore ?? p.trustScore ?? 0,
    p.completion ?? 0,
    p.priceRise || null,
    p.location || null,
    p.estimatedProjectCost || null,
    p.escrowReserveDeposited || null,
    p.escrowReservePercentRequired ?? 70,
    p.escrowCompliant === false ? 0 : 1,
    p.documentsFiled ?? 0,
    p.registeredAgents ?? 0,
    p.dataSource || null,
    p.filingAsOf || null,
    p.createdAt || now,
    p.updatedAt || now,
  ];
}

const PROJECT_UPSERT_SQL = `
  INSERT INTO trust_score_projects (
    id, name, rera_number, builder_name, builder_id, address, latitude, longitude,
    total_area, number_of_floors, number_of_units, project_status, launch_date,
    expected_completion_date, actual_completion_date, rera_extension_details,
    land_ownership_title, land_owner_name, land_area, land_id, approval_authorities,
    approved_building_plans, bank_name, loan_amount_sanctioned, total_amount_collected,
    funding_sources, litigation_history, rera_complaints_count, rera_complaints_status,
    trust_score, builder_score, project_score, completion, price_rise, location,
    estimated_project_cost, escrow_reserve_deposited, escrow_reserve_percent_required,
    escrow_compliant, documents_filed, registered_agents, data_source, filing_as_of,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE
    name=VALUES(name), rera_number=VALUES(rera_number), builder_name=VALUES(builder_name),
    builder_id=VALUES(builder_id), address=VALUES(address), latitude=VALUES(latitude),
    longitude=VALUES(longitude), total_area=VALUES(total_area), number_of_floors=VALUES(number_of_floors),
    number_of_units=VALUES(number_of_units), project_status=VALUES(project_status),
    launch_date=VALUES(launch_date), expected_completion_date=VALUES(expected_completion_date),
    actual_completion_date=VALUES(actual_completion_date), rera_extension_details=VALUES(rera_extension_details),
    land_ownership_title=VALUES(land_ownership_title), land_owner_name=VALUES(land_owner_name),
    land_area=VALUES(land_area), land_id=VALUES(land_id), approval_authorities=VALUES(approval_authorities),
    approved_building_plans=VALUES(approved_building_plans), bank_name=VALUES(bank_name),
    loan_amount_sanctioned=VALUES(loan_amount_sanctioned), total_amount_collected=VALUES(total_amount_collected),
    funding_sources=VALUES(funding_sources), litigation_history=VALUES(litigation_history),
    rera_complaints_count=VALUES(rera_complaints_count), rera_complaints_status=VALUES(rera_complaints_status),
    trust_score=VALUES(trust_score), builder_score=VALUES(builder_score), project_score=VALUES(project_score),
    completion=VALUES(completion), price_rise=VALUES(price_rise), location=VALUES(location),
    estimated_project_cost=VALUES(estimated_project_cost), escrow_reserve_deposited=VALUES(escrow_reserve_deposited),
    escrow_reserve_percent_required=VALUES(escrow_reserve_percent_required), escrow_compliant=VALUES(escrow_compliant),
    documents_filed=VALUES(documents_filed), registered_agents=VALUES(registered_agents),
    data_source=VALUES(data_source), filing_as_of=VALUES(filing_as_of), updated_at=VALUES(updated_at)
`;

async function upsertProject(pool, project) {
  await pool.query(PROJECT_UPSERT_SQL, projectToMysqlParams(project));
}

async function upsertFraudAlert(pool, alert) {
  await pool.query(`
    INSERT INTO trust_score_fraud_alerts
    (id, land_id, latitude, longitude, project_id, project_name, fraud_type, severity, status, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      land_id=VALUES(land_id), latitude=VALUES(latitude), longitude=VALUES(longitude),
      project_id=VALUES(project_id), project_name=VALUES(project_name), fraud_type=VALUES(fraud_type),
      severity=VALUES(severity), status=VALUES(status), details=VALUES(details)
  `, [
    alert.id,
    alert.landId || null,
    alert.latitude ?? null,
    alert.longitude ?? null,
    alert.projectId || null,
    alert.projectName || null,
    alert.fraudType || null,
    alert.severity || null,
    alert.status || 'active',
    typeof alert.details === 'string' ? alert.details : JSON.stringify(alert.details || {}),
    alert.createdAt || new Date(),
  ]);
}

async function upsertBuilder(pool, builder) {
  await pool.query(`
    INSERT INTO trust_score_builders
    (id, name, rera_registration, address, total_projects, delivered_projects, ongoing_projects,
     delayed_projects, delivered_on_time, rera_complaints, cidco_complaints, land_title_disputes,
     average_user_rating, total_reviews, years_in_business, trust_score, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      name=VALUES(name), rera_registration=VALUES(rera_registration), address=VALUES(address),
      total_projects=VALUES(total_projects), delivered_projects=VALUES(delivered_projects),
      ongoing_projects=VALUES(ongoing_projects), delayed_projects=VALUES(delayed_projects),
      delivered_on_time=VALUES(delivered_on_time), rera_complaints=VALUES(rera_complaints),
      cidco_complaints=VALUES(cidco_complaints), land_title_disputes=VALUES(land_title_disputes),
      average_user_rating=VALUES(average_user_rating), total_reviews=VALUES(total_reviews),
      years_in_business=VALUES(years_in_business), trust_score=VALUES(trust_score)
  `, [
    builder.id,
    builder.name,
    builder.reraRegistration || null,
    builder.address || null,
    builder.totalProjects ?? 0,
    builder.deliveredProjects ?? 0,
    builder.ongoingProjects ?? 0,
    builder.delayedProjects ?? 0,
    builder.deliveredOnTime ?? 0,
    builder.reraComplaints ?? 0,
    builder.cidcoComplaints ?? 0,
    builder.landTitleDisputes ?? 0,
    builder.averageUserRating ?? 0,
    builder.totalReviews ?? 0,
    builder.yearsInBusiness ?? 0,
    builder.trustScore ?? 0,
    builder.createdAt || new Date(),
  ]);
}

const TABLE_SPECS = [
  {
    table: 'trust_score_projects',
    memKey: 'trustScoreProjects',
    mapRow: mapProjectRow,
    upsert: upsertProject,
  },
  {
    table: 'trust_score_fraud_alerts',
    memKey: 'trustScoreFraudAlerts',
    mapRow: mapFraudAlertRow,
    upsert: upsertFraudAlert,
  },
  {
    table: 'trust_score_builders',
    memKey: 'trustScoreBuilders',
    mapRow: mapBuilderRow,
    upsert: upsertBuilder,
  },
];

async function hydrateTableFromMysql(pool, spec) {
  const db = getDb();
  const mem = db.inMemoryDb || db;
  if (!mem[spec.memKey]) mem[spec.memKey] = [];

  let mysqlCount = 0;
  try {
    const [countRows] = await pool.query(`SELECT COUNT(*) AS count FROM ${spec.table}`);
    mysqlCount = countRows?.[0]?.count || 0;
  } catch (err) {
    LOG.warning(`[TrustHydrate] Count skip ${spec.table}: ${err.message}`);
    return { mysqlCount: 0, hydrated: 0 };
  }

  if (mysqlCount === 0) return { mysqlCount: 0, hydrated: 0 };

  try {
    const [rows] = await pool.query(`SELECT * FROM ${spec.table}`);
    const mapped = (rows || []).map(spec.mapRow).filter(Boolean);
    mem[spec.memKey].length = 0;
    mem[spec.memKey].push(...mapped);
    if (db[spec.memKey] !== mem[spec.memKey]) {
      db[spec.memKey] = mem[spec.memKey];
    }
    return { mysqlCount, hydrated: mapped.length };
  } catch (err) {
    LOG.warning(`[TrustHydrate] Pull failed ${spec.table}: ${err.message}`);
    return { mysqlCount, hydrated: 0, error: err.message };
  }
}

async function pushTableToMysql(pool, spec) {
  const db = getDb();
  const mem = db.inMemoryDb || db;
  const rows = mem[spec.memKey] || db[spec.memKey] || [];
  if (!rows.length) return 0;

  let pushed = 0;
  for (const row of rows) {
    try {
      await spec.upsert(pool, row);
      pushed += 1;
    } catch (err) {
      LOG.warning(`[TrustHydrate] Push skip ${spec.table}/${row.id}: ${err.message}`);
    }
  }
  return pushed;
}

async function hydrateMemoryFromMysql() {
  if (!isMysqlConfigured()) return { skipped: true, hydrated: 0 };

  const pool = getPool();
  if (!pool) return { skipped: true, hydrated: 0 };

  let totalHydrated = 0;
  const byTable = {};

  for (const spec of TABLE_SPECS) {
    const result = await hydrateTableFromMysql(pool, spec);
    byTable[spec.memKey] = result;
    totalHydrated += result.hydrated || 0;
  }

  if (totalHydrated > 0) {
    LOG.info(`[TrustHydrate] Loaded ${totalHydrated} rows from MySQL into memory`);
  }

  return { ok: true, hydrated: totalHydrated, byTable };
}

async function syncMemoryToMysql() {
  if (!isMysqlConfigured()) return { skipped: true, pushed: 0 };

  const pool = getPool();
  if (!pool) return { skipped: true, pushed: 0 };

  let totalPushed = 0;
  const byTable = {};

  for (const spec of TABLE_SPECS) {
    let mysqlCount = 0;
    try {
      const [countRows] = await pool.query(`SELECT COUNT(*) AS count FROM ${spec.table}`);
      mysqlCount = countRows?.[0]?.count || 0;
    } catch (_) {
      mysqlCount = 0;
    }
    if (mysqlCount > 0) {
      byTable[spec.memKey] = { skipped: true, mysqlCount };
      continue;
    }
    const pushed = await pushTableToMysql(pool, spec);
    byTable[spec.memKey] = { pushed };
    totalPushed += pushed;
  }

  if (totalPushed > 0) {
    LOG.info(`[TrustHydrate] Pushed ${totalPushed} seed rows from memory to MySQL`);
  }

  return { ok: true, pushed: totalPushed, byTable };
}

/**
 * First open: pull MySQL → memory when DB has data; else push seed → MySQL for future restarts.
 */
async function ensureTrustScoreSync() {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    if (isMysqlConfigured()) {
      try {
        const fcm = require('../../database/featureConnectionManager');
        await fcm.acquireForSync('trust_score');
        const db = getDb();
        const { ensureFeatureSchema } = require('../../database/schema/featureTables');
        await ensureFeatureSchema('trust_score', db);
      } catch (err) {
        LOG.warning(`[TrustHydrate] Pool/schema skipped: ${err.message}`);
      }
    }
    const hydrated = await hydrateMemoryFromMysql();
    if ((hydrated.hydrated || 0) > 0) {
      return { ...hydrated, pushed: 0, mode: 'mysql_to_memory' };
    }
    const pushed = await syncMemoryToMysql();
    return { ...hydrated, ...pushed, mode: 'memory_to_mysql' };
  })().catch((err) => {
    syncPromise = null;
    LOG.error('[TrustHydrate] ensureTrustScoreSync failed:', err.message);
    return { ok: false, error: err.message };
  });

  return syncPromise;
}

async function getProjectMysqlCount() {
  const pool = getPool();
  if (!pool) return 0;
  try {
    const [rows] = await pool.query('SELECT COUNT(*) AS count FROM trust_score_projects');
    return rows?.[0]?.count || 0;
  } catch (_) {
    return 0;
  }
}

function getProjectMemoryCount() {
  const db = getDb();
  const mem = db.inMemoryDb || db;
  return (mem.trustScoreProjects || db.trustScoreProjects || []).length;
}

module.exports = {
  mapProjectRow,
  mapFraudAlertRow,
  upsertProject,
  upsertFraudAlert,
  upsertBuilder,
  projectToMysqlParams,
  hydrateMemoryFromMysql,
  syncMemoryToMysql,
  ensureTrustScoreSync,
  getProjectMysqlCount,
  getProjectMemoryCount,
};
