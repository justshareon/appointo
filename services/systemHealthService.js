/**
 * Cross-module health diagnostics for super-admin APS dashboard.
 */
const fs = require('fs');
const path = require('path');
const LOG = require('../utils/logger');
const syncStatus = require('./syncStatusService');
const { isMysqlConfigured } = require('../utils/resolveDbType');

const MODULE_CHECKS = [
  { key: 'trust_score', label: 'Trust Score', tables: ['trust_score_projects', 'trust_score_builders'] },
  { key: 'suraksha', label: 'Suraksha', tables: ['suraksha_reports', 'suraksha_validations'] },
  { key: 'cyber', label: 'Cyber Threats', tables: ['cyber_threats'] },
  { key: 'r_detector', label: 'R-Detector', tables: ['r_detector_incidents', 'fleet_bad_road_probes'] },
  { key: 'fleet', label: 'Fleet', tables: ['fleet_drivers', 'fleet_vehicles'] },
  { key: 'trading', label: 'Trading', tables: ['live_stock_data'] },
  { key: 'shopping', label: 'Shopping', tables: ['products', 'orders'] },
  { key: 'news', label: 'News cache', tables: ['news_cache_entries'] },
];

async function safeCount(pool, table) {
  if (!pool) return { table, count: null, error: 'No pool' };
  try {
    const [rows] = await pool.query(`SELECT COUNT(*) AS cnt FROM \`${table}\``);
    return { table, count: Number(rows?.[0]?.cnt) || 0, error: null };
  } catch (err) {
    return { table, count: null, error: err.message };
  }
}

async function probeMysqlPool() {
  const issues = [];
  let pool = null;
  let dbType = 'inmemory';
  try {
    const db = require('../database');
    dbType = db.getType?.() || 'inmemory';
    pool = db.getPool?.() || null;
  } catch (err) {
    issues.push({ severity: 'critical', module: 'core', message: `Database boot failed: ${err.message}` });
  }

  if (isMysqlConfigured() && !pool) {
    issues.push({
      severity: 'critical',
      level: 'L1',
      module: 'mysql',
      message: 'MySQL configured in .env but pool is null — queries will fail or use memory fallback',
    });
  }

  if (pool) {
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      issues.push({ severity: 'critical', level: 'L1', module: 'mysql', message: `MySQL ping failed: ${err.message}` });
      pool = null;
    }
  }

  return { pool, dbType, issues };
}

async function probeFeaturePools() {
  const issues = [];
  const pools = [];
  try {
    const fcm = require('../database/featureConnectionManager');
    const { MYSQL_FEATURES } = require('../database/featureRegistry');
    for (const mod of MYSQL_FEATURES) {
      let pool = null;
      try {
        pool = fcm.getCachedPool?.(mod) || null;
      } catch (_) {
        /* ignore */
      }
      pools.push({ module: mod, ready: !!pool });
    }
  } catch (err) {
    issues.push({
      severity: 'warning',
      level: 'L2',
      module: 'features',
      message: err.message,
      source: 'pool_probe',
    });
  }
  return { pools, issues };
}

async function probePoolConfig() {
  const issues = [];
  let config = null;
  let stats = [];
  let summary = null;
  try {
    const poolConfig = require('../utils/poolConfig');
    const fcm = require('../database/featureConnectionManager');
    await poolConfig.loadSettings(true);
    config = await poolConfig.getPoolConfig();
    stats = fcm.getPoolStats?.() || [];
    summary = poolConfig.summarizePoolRows(stats);
    issues.push(...poolConfig.validatePoolHealthRows(stats));

    if (isMysqlConfigured() && summary.belowMin > 0) {
      issues.push({
        severity: 'critical',
        level: 'L1',
        kind: 'pool_limit',
        module: 'mysql',
        message: `${summary.belowMin} feature pool(s) below minimum ${poolConfig.ABS_MIN} connections — fix in APS pool settings`,
        source: 'pool_config',
      });
    }
  } catch (err) {
    issues.push({
      severity: 'critical',
      level: 'L1',
      kind: 'pool_config',
      module: 'mysql',
      message: `Pool diagnostics failed: ${err.message}`,
      source: 'pool_config',
    });
  }
  return { config, stats, summary, issues };
}

function summarizeIssueLevels(issues = []) {
  const counts = { L1: 0, L2: 0, L3: 0 };
  issues.forEach((issue) => {
    const level = issue.level
      || (issue.severity === 'critical' ? 'L1' : issue.severity === 'warning' ? 'L2' : 'L3');
    if (counts[level] != null) counts[level] += 1;
  });
  return counts;
}

function withIssueLevels(issues = []) {
  return issues.map((issue) => ({
    ...issue,
    level: issue.level
      || (issue.severity === 'critical' ? 'L1' : issue.severity === 'warning' ? 'L2' : 'L3'),
  }));
}

function readErrorLogTail(maxLines = 40) {
  const logPath = path.join(__dirname, '..', 'error.log');
  try {
    if (!fs.existsSync(logPath)) return { path: logPath, lines: [], exists: false };
    const raw = fs.readFileSync(logPath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean).slice(-maxLines);
    return { path: logPath, lines, exists: true };
  } catch (err) {
    return { path: logPath, lines: [], exists: false, error: err.message };
  }
}

async function getTableHealth(pool) {
  const modules = [];
  const issues = [];

  for (const mod of MODULE_CHECKS) {
    const tables = [];
    for (const table of mod.tables) {
      const row = await safeCount(pool, table);
      tables.push(row);
      if (row.error) {
        issues.push({
          severity: 'warning',
          module: mod.key,
          message: `Table ${table}: ${row.error}`,
        });
      } else if (row.count === 0) {
        issues.push({
          severity: 'info',
          module: mod.key,
          message: `${table} is empty — seed/sync may be needed`,
        });
      }
    }
    modules.push({ ...mod, tables });
  }
  return { modules, issues };
}

async function getTrustScoreHealth(pool, issues) {
  try {
    const { getProjectMysqlCount, getProjectMemoryCount } = require('./trustScore/trustScoreHydrateService');
    const mysqlCount = await getProjectMysqlCount();
    const memoryCount = getProjectMemoryCount();
    if (isMysqlConfigured() && mysqlCount === 0 && memoryCount > 0) {
      issues.push({
        severity: 'warning',
        module: 'trust_score',
        message: `${memoryCount} projects in memory but 0 in MySQL — run trust score sync`,
      });
    }
    return { mysqlProjects: mysqlCount, memoryProjects: memoryCount };
  } catch (err) {
    issues.push({ severity: 'warning', module: 'trust_score', message: err.message });
    return { mysqlProjects: null, memoryProjects: null };
  }
}

/**
 * Full system health snapshot for super-admin APS page.
 */
async function getSystemHealth() {
  const checkedAt = new Date().toISOString();
  const issues = [];
  let clientErrors = [];
  let clientErrorService = null;
  try {
    clientErrorService = require('./clientErrorService');
    clientErrors = clientErrorService.getClientErrors(50);
    issues.push(...clientErrorService.clientErrorsToIssues(clientErrors));
  } catch (err) {
    issues.push({ severity: 'warning', module: 'ui', message: `Client error log unavailable: ${err.message}` });
  }
  const { pool, dbType, issues: mysqlProbeIssues } = await probeMysqlPool();
  issues.push(...mysqlProbeIssues);

  const { pools: featurePools, issues: featureIssues } = await probeFeaturePools();
  issues.push(...featureIssues);

  const { config: poolConfig, stats: poolStats, summary: poolSummary, issues: poolConfigIssues } = await probePoolConfig();
  issues.push(...poolConfigIssues);

  let sync = { available: false, modules: [], summary: {}, latestRun: null };
  try {
    sync.modules = (await syncStatus.getModuleState()).modules || [];
    sync.summary = (await syncStatus.getModuleState()).summary || {};
    sync.available = (await syncStatus.getModuleState()).available;
    sync.latestRun = await syncStatus.getLatestRun();
    for (const m of sync.modules) {
      if (m.status === 'FAILED') {
        issues.push({
          severity: 'critical',
          level: 'L1',
          kind: 'sync',
          module: 'sync',
          source: m.key,
          message: `Sync failed: ${m.label} — ${m.lastError || 'unknown error'}`,
        });
      } else if (m.status === 'PENDING' && isMysqlConfigured()) {
        issues.push({
          severity: 'critical',
          level: 'L1',
          kind: 'sync',
          module: 'sync',
          source: m.key,
          message: `Sync pending: ${m.label} — tap Sync now on APS dashboard`,
        });
      }
    }
    if (sync.latestRun?.status === 'FAILED') {
      issues.push({
        severity: 'critical',
        level: 'L1',
        kind: 'sync',
        module: 'sync',
        message: `Last sync run failed: ${sync.latestRun.error_message || 'unknown error'}`,
      });
    }
  } catch (err) {
    issues.push({
      severity: 'critical',
      level: 'L1',
      kind: 'sync',
      module: 'sync',
      message: err.message,
    });
  }

  const { modules: tableModules, issues: tableIssues } = await getTableHealth(pool);
  issues.push(...tableIssues);

  const trustScore = await getTrustScoreHealth(pool, issues);
  const errorLog = readErrorLogTail(50);
  const normalizedIssues = withIssueLevels(issues);
  const levelSummary = summarizeIssueLevels(normalizedIssues);
  const clientLevelSummary = clientErrorService?.getLevelSummary(clientErrors) || { L1: 0, L2: 0, L3: 0 };

  for (const line of errorLog.lines.slice(-10)) {
    if (/error|fail|exception|crash/i.test(line)) {
      issues.push({
        severity: 'warning',
        module: 'backend',
        message: line.slice(0, 240),
        source: 'error.log',
      });
    }
  }

  const summary = {
    critical: normalizedIssues.filter((i) => i.severity === 'critical').length,
    warning: normalizedIssues.filter((i) => i.severity === 'warning').length,
    info: normalizedIssues.filter((i) => i.severity === 'info').length,
    total: normalizedIssues.length,
  };

  return {
    success: true,
    checkedAt,
    dbType,
    mysqlConfigured: isMysqlConfigured(),
    poolReady: !!pool,
    buildVersion: syncStatus.getBuildVersion?.() || process.env.BUILD_VERSION || 'local',
    sync,
    featurePools,
    poolConfig,
    poolStats,
    poolSummary,
    tableModules,
    trustScore,
    errorLog,
    clientErrors,
    clientLevelSummary,
    levelSummary,
    issues: normalizedIssues.sort((a, b) => {
      const levelRank = { L1: 0, L2: 1, L3: 2 };
      const aLevel = levelRank[a.level] ?? 9;
      const bLevel = levelRank[b.level] ?? 9;
      if (aLevel !== bLevel) return aLevel - bLevel;
      const rank = { critical: 0, warning: 1, info: 2 };
      return (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9);
    }),
    summary,
  };
}

module.exports = { getSystemHealth, MODULE_CHECKS };
