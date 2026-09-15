/**
 * Cross-module health diagnostics for super-admin APS dashboard.
 */
const LOG = require('../utils/logger');
const syncStatus = require('./syncStatusService');
const { isMysqlConfigured } = require('../utils/resolveDbType');
const { purgeErrorLogOlderThan } = require('../utils/errorLogRetention');
const { readAllAppLogTails, APP_LOG_PATHS } = require('../utils/appLogFiles');

const MODULE_CHECKS = [
  { key: 'trust_score', label: 'Trust Score', tables: ['trust_score_projects', 'trust_score_builders'] },
  { key: 'suraksha', label: 'Suraksha', tables: ['suraksha_reports', 'suraksha_validations'] },
  { key: 'cyber', label: 'Cyber Threats', tables: ['cyber_threats'] },
  { key: 'r_detector', label: 'R-Detector', tables: ['r_detector_scan_results', 'fleet_bad_road_probes'] },
  { key: 'fleet', label: 'Fleet', tables: ['fleet_driver_stats', 'fleet_trips'] },
  { key: 'trading', label: 'Trading', tables: ['live_stock_data'] },
  { key: 'shopping', label: 'Shopping', tables: ['products', 'orders'] },
  { key: 'news', label: 'News cache', tables: ['news_cache'] },
  { key: 'offers', label: 'Offers / deals', tables: ['deals'] },
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

function issueTime(issue) {
  const raw = issue?.at || issue?.reportedAt || issue?.checkedAt;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

function sortIssues(issues = []) {
  const levelRank = { L1: 0, L2: 1, L3: 2 };
  const severityRank = { critical: 0, warning: 1, info: 2 };
  return [...issues].sort((a, b) => {
    const aLevel = levelRank[a.level] ?? 9;
    const bLevel = levelRank[b.level] ?? 9;
    if (aLevel !== bLevel) return aLevel - bLevel;
    const sevDiff = (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9);
    if (sevDiff !== 0) return sevDiff;
    return issueTime(b) - issueTime(a);
  });
}

function purgeDiagnosticLogs() {
  const errorResult = purgeErrorLogOlderThan();
  purgeErrorLogOlderThan(undefined, APP_LOG_PATHS.info);
  purgeErrorLogOlderThan(undefined, APP_LOG_PATHS.debug);
  purgeErrorLogOlderThan(undefined, APP_LOG_PATHS.ui);
  let newsKept = 0;
  let clientKept = 0;
  try {
    newsKept = require('./newsLogService').purgeNewsLogs();
  } catch (_) {
    /* ignore */
  }
  let offerKept = 0;
  try {
    offerKept = require('./offerLogService').purgeOfferLogs();
  } catch (_) {
    /* ignore */
  }
  let featureScanKept = 0;
  try {
    featureScanKept = require('./featureScanLogService').purgeFeatureScanLogs();
  } catch (_) {
    /* ignore */
  }
  let moduleDiagKept = 0;
  try {
    moduleDiagKept = require('./moduleDiagnosticLogService').purgeModuleDiagnostics();
  } catch (_) {
    /* ignore */
  }
  try {
    clientKept = require('./clientErrorService').purgeClientErrors();
  } catch (_) {
    /* ignore */
  }
  return { errorLog: errorResult, newsKept, offerKept, featureScanKept, moduleDiagKept, clientKept };
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

const HEALTH_SCOPES = ['core', 'sync', 'tables', 'news', 'offer', 'scan', 'modules', 'client', 'backend'];

function resolveHealthScopes(scopes) {
  if (!scopes || scopes.length === 0) return new Set(HEALTH_SCOPES);
  const s = new Set(scopes);
  if (s.has('all')) return new Set(HEALTH_SCOPES);
  if (s.has('modules')) {
    ['sync', 'tables', 'client'].forEach((x) => s.add(x));
  }
  return s;
}

/**
 * System health for super-admin APS — full snapshot or one scope (event refresh).
 */
async function getSystemHealth(options = {}) {
  const active = resolveHealthScopes(options.scopes);
  const on = (name) => active.has(name);
  const singleScope =
    options.scopes?.length === 1 ? options.scopes[0] : active.size < HEALTH_SCOPES.length ? [...active][0] : null;
  const partial = active.size < HEALTH_SCOPES.length;

  const checkedAt = new Date().toISOString();
  const issues = [];
  let clientErrors = [];
  let clientErrorService = null;

  if (on('client') || on('modules')) {
    try {
      clientErrorService = require('./clientErrorService');
      clientErrors = clientErrorService.getClientErrors(50);
      issues.push(...clientErrorService.clientErrorsToIssues(clientErrors));
    } catch (err) {
      issues.push({ severity: 'warning', module: 'ui', message: `Client error log unavailable: ${err.message}` });
    }
  }

  let pool = null;
  let dbType = 'inmemory';
  if (on('core') || on('tables') || on('modules')) {
    const mysqlProbe = await probeMysqlPool();
    pool = mysqlProbe.pool;
    dbType = mysqlProbe.dbType;
    issues.push(...mysqlProbe.issues);
  }

  let featurePools = [];
  let poolConfig = null;
  let poolStats = [];
  let poolSummary = null;
  if (on('core') || on('modules')) {
    const { pools, issues: featureIssues } = await probeFeaturePools();
    featurePools = pools;
    issues.push(...featureIssues);

    const poolProbe = await probePoolConfig();
    poolConfig = poolProbe.config;
    poolStats = poolProbe.stats;
    poolSummary = poolProbe.summary;
    issues.push(...poolProbe.issues);
  }

  let sync = { available: false, modules: [], summary: {}, latestRun: null };
  if (on('sync') || on('modules')) {
  try {
    const state = await syncStatus.getModuleState();
    sync.modules = state.modules || [];
    sync.summary = state.summary || {};
    sync.available = state.available;
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
        at: sync.latestRun.completed_at || sync.latestRun.started_at || checkedAt,
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
  }

  let tableModules = [];
  if (on('tables') || on('modules')) {
    const tableProbe = await getTableHealth(pool);
    tableModules = tableProbe.modules;
    issues.push(...tableProbe.issues);
  }

  let trustScore = null;
  if (on('core') || on('modules')) {
    trustScore = await getTrustScoreHealth(pool, issues);
  }

  let errorLog = { lines: [] };
  let infoLog = { lines: [] };
  let debugLog = { lines: [] };
  let uiLog = { lines: [] };
  if (on('backend')) {
    const tails = readAllAppLogTails(80);
    errorLog = tails.errorLog;
    infoLog = tails.infoLog;
    debugLog = tails.debugLog;
    uiLog = tails.uiLog;
    for (const line of errorLog.lines.slice(0, 10)) {
      if (/error|fail|exception|crash/i.test(line)) {
        issues.push({
          severity: 'warning',
          module: 'backend',
          message: line.slice(0, 2000),
          source: 'error.log',
        });
      }
    }
  }

  let newsDiagnostics = null;
  let newsLogs = [];
  let newsLevelSummary = { L1: 0, L2: 0, L3: 0 };
  let offerDiagnostics = null;
  let offerLogs = [];
  let offerLevelSummary = { L1: 0, L2: 0, L3: 0 };
  if (on('news')) {
  try {
    const newsLogService = require('./newsLogService');
    newsDiagnostics = await newsLogService.buildNewsSnapshot();
    newsLogs = newsLogService.getNewsLogs(50);
    newsLevelSummary = newsLogService.getLevelSummary(newsLogs);
    issues.push(...newsLogService.newsLogsToIssues(newsLogs));
    if (newsDiagnostics?.issues?.length) {
      for (const ni of newsDiagnostics.issues) {
        issues.push({
          severity: ni.level === 'L1' ? 'critical' : 'warning',
          level: ni.level,
          module: 'news',
          message: ni.message,
          source: 'news_snapshot',
        });
      }
    }
  } catch (err) {
    issues.push({
      severity: 'warning',
      level: 'L2',
      module: 'news',
      message: `News diagnostics unavailable: ${err.message}`,
    });
  }
  }

  if (on('offer')) {
  try {
    const offerLogService = require('./offerLogService');
    offerDiagnostics = await offerLogService.buildOfferSnapshot();
    offerLogs = offerLogService.getOfferLogs(50);
    offerLevelSummary = offerLogService.getLevelSummary(offerLogs);
    issues.push(...offerLogService.offerLogsToIssues(offerLogs));
    if (offerDiagnostics?.issues?.length) {
      for (const oi of offerDiagnostics.issues) {
        issues.push({
          severity: oi.level === 'L1' ? 'critical' : 'warning',
          level: oi.level,
          module: 'offers',
          message: oi.message,
          source: 'offer_snapshot',
        });
      }
    }
    if ((offerDiagnostics?.dealsCount || 0) > 0) {
      for (let i = issues.length - 1; i >= 0; i -= 1) {
        const msg = String(issues[i].message || '');
        if (issues[i].module === 'offers' && /deals is empty|Table deals has 0 rows/i.test(msg)) {
          issues.splice(i, 1);
        }
      }
    }
  } catch (err) {
    issues.push({
      severity: 'warning',
      level: 'L2',
      module: 'offers',
      message: `Offer diagnostics unavailable: ${err.message}`,
    });
  }
  }

  let featureScanLogs = [];
  let featureScanLevelSummary = { L1: 0, L2: 0, L3: 0 };
  if (on('scan')) {
  try {
    const featureScanLogService = require('./featureScanLogService');
    featureScanLogs = featureScanLogService.getFeatureScanLogs(120);
    featureScanLevelSummary = featureScanLogService.getLevelSummary(featureScanLogs);
    issues.push(...featureScanLogService.featureScanLogsToIssues(featureScanLogs));
  } catch (err) {
    issues.push({
      severity: 'warning',
      level: 'L2',
      module: 'r_detector',
      message: `Scan diagnostics unavailable: ${err.message}`,
      source: 'feature_scan_log',
    });
  }
  }

  let moduleDiagnostics = [];
  let moduleDiagnosticLevelSummary = { L1: 0, L2: 0, L3: 0 };
  let moduleReports = [];
  if (on('modules')) {
  try {
    const moduleDiagnosticLogService = require('./moduleDiagnosticLogService');
    const moduleDiagnosticsService = require('./moduleDiagnosticsService');
    moduleDiagnostics = moduleDiagnosticLogService.getModuleDiagnostics(80);
    moduleDiagnosticLevelSummary = moduleDiagnosticLogService.getLevelSummary(moduleDiagnostics);
    issues.push(...moduleDiagnosticLogService.moduleDiagnosticsToIssues(moduleDiagnostics));

    let settings = {};
    try {
      settings = await require('./settingsService').getSettings();
    } catch (_) {
      /* ignore */
    }

    moduleReports = await moduleDiagnosticsService.buildModuleReports({
      settings,
      dbType,
      poolReady: !!pool,
      syncModules: sync.modules || [],
      tableModules,
      clientErrors,
      featureScanLogs,
      moduleDiagnostics,
      trustScore,
      newsDiagnostics,
      offerDiagnostics,
      newsLogs,
      offerLogs,
      issues,
    });
    issues.push(...moduleDiagnosticsService.moduleReportsToIssues(moduleReports));
  } catch (err) {
    issues.push({
      severity: 'warning',
      level: 'L2',
      module: 'core',
      message: `Module diagnostics unavailable: ${err.message}`,
      source: 'module_report',
    });
  }
  }

  const normalizedIssues = withIssueLevels(issues);
  const levelSummary = summarizeIssueLevels(normalizedIssues);
  const clientLevelSummary = clientErrorService?.getLevelSummary(clientErrors) || { L1: 0, L2: 0, L3: 0 };

  const summary = {
    critical: normalizedIssues.filter((i) => i.severity === 'critical').length,
    warning: normalizedIssues.filter((i) => i.severity === 'warning').length,
    info: normalizedIssues.filter((i) => i.severity === 'info').length,
    total: normalizedIssues.length,
  };

  let runtimeDb = null;
  try {
    const runtimeDbModeService = require('./runtimeDbModeService');
    runtimeDb = runtimeDbModeService.getStatus();
  } catch (_) {
    /* optional */
  }

  const payload = {
    success: true,
    checkedAt,
    partial,
    scope: options.scopes?.length === 1 ? options.scopes[0] : singleScope,
    scopesApplied: [...active],
    dbType,
    runtimeDb,
    mysqlConfigured: isMysqlConfigured(),
    poolReady: !!pool,
    buildVersion: syncStatus.getBuildVersion?.() || process.env.BUILD_VERSION || 'local',
    levelSummary,
    issues: sortIssues(normalizedIssues),
    summary,
  };

  if (on('core') || on('modules')) {
    Object.assign(payload, {
      featurePools,
      poolConfig,
      poolStats,
      poolSummary,
      trustScore,
    });
  }
  if (on('sync') || on('modules')) payload.sync = sync;
  if (on('tables') || on('modules')) payload.tableModules = tableModules;
  if (on('backend')) {
    Object.assign(payload, { errorLog, infoLog, debugLog, uiLog });
  }
  if (on('client') || on('modules')) {
    payload.clientErrors = clientErrors;
    payload.clientLevelSummary = clientLevelSummary;
  }
  if (on('news')) {
    Object.assign(payload, { newsDiagnostics, newsLogs, newsLevelSummary });
  }
  if (on('offer')) {
    Object.assign(payload, { offerDiagnostics, offerLogs, offerLevelSummary });
  }
  if (on('scan')) {
    const featureScanLogService = require('./featureScanLogService');
    Object.assign(payload, {
      featureScanLogs,
      featureScanLevelSummary,
      featureScanInsights: featureScanLogService.splitFeatureScanInsights(featureScanLogs, 50),
    });
  }
  if (on('modules')) {
    Object.assign(payload, { moduleDiagnostics, moduleDiagnosticLevelSummary, moduleReports });
  }

  return payload;
}

module.exports = { getSystemHealth, MODULE_CHECKS, purgeDiagnosticLogs };
