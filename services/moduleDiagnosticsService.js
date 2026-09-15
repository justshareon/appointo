/**
 * Super-admin “why is this module empty?” — merges settings, MySQL, sync, client & scan logs.
 */
const { isMysqlConfigured } = require('../utils/resolveDbType');
const { getScriptsForModule, summarizeSyncPipeline } = require('./moduleScriptCatalog');

/** App feature flag → APS module card */
const MODULE_REGISTRY = [
  {
    key: 'news',
    label: 'News',
    featureFlag: 'enable_news',
    syncKeys: ['news_cache'],
    tableModuleKey: 'news',
  },
  {
    key: 'offers',
    label: 'Offers / Marketplace',
    featureFlag: 'enable_offer',
    syncKeys: ['products', 'vendors'],
    tableModuleKey: 'shopping',
  },
  {
    key: 'trading',
    label: 'Trading',
    featureFlag: 'enable_trade',
    syncKeys: ['trading_data'],
    tableModuleKey: 'trading',
  },
  {
    key: 'shopping',
    label: 'Shopping / Queue buy',
    featureFlag: 'enable_shopping',
    syncKeys: ['products', 'orders', 'queues'],
    tableModuleKey: 'shopping',
  },
  {
    key: 'queue',
    label: 'Queue',
    featureFlag: 'enable_queue',
    syncKeys: ['queues'],
    tableModuleKey: null,
  },
  {
    key: 'appointments',
    label: 'Appointments',
    featureFlag: 'enable_appointments',
    syncKeys: ['appointments'],
    tableModuleKey: null,
  },
  {
    key: 'qless',
    label: 'QLess',
    featureFlag: 'enable_qless',
    syncKeys: ['feature_seed'],
    tableModuleKey: null,
  },
  {
    key: 'fleet',
    label: 'Fleet',
    featureFlag: 'enable_fleet',
    syncKeys: ['fleet_data'],
    tableModuleKey: 'fleet',
  },
  {
    key: 'r_detector',
    label: 'R-Detector / Road Scan',
    featureFlag: 'enable_r_detector',
    syncKeys: ['r_detector_data'],
    tableModuleKey: 'r_detector',
  },
  {
    key: 'smart',
    label: 'SMART Scan',
    featureFlag: 'enable_smart',
    syncKeys: ['smart_data'],
    tableModuleKey: null,
  },
  {
    key: 'cyber',
    label: 'Cyber / Suraksha',
    featureFlag: 'enable_cyber',
    syncKeys: ['cyber_threats', 'suraksha_data'],
    tableModuleKey: 'cyber',
  },
  {
    key: 'trust_score',
    label: 'Trust Score / RERA',
    featureFlag: 'enable_trust_score',
    syncKeys: ['trust_score_data'],
    tableModuleKey: 'trust_score',
  },
  {
    key: 'realestate',
    label: 'Real Estate',
    featureFlag: 'enable_realestate',
    syncKeys: ['vendors'],
    tableModuleKey: null,
  },
  {
    key: 'matchmaking',
    label: 'Matchmaking',
    featureFlag: 'enable_matchmaking',
    syncKeys: ['vendors', 'user_vendor_mappings'],
    tableModuleKey: null,
  },
];

const SCREEN_TO_MODULE = [
  { pattern: /news/i, module: 'news' },
  { pattern: /offer|marketplace|deal/i, module: 'offers' },
  { pattern: /trad|watchlist|stock|portfolio|discover/i, module: 'trading' },
  { pattern: /cart|product|order|queue.?buy|shop/i, module: 'shopping' },
  { pattern: /appointment/i, module: 'appointments' },
  { pattern: /qless|qlless/i, module: 'qless' },
  { pattern: /fleet|driver|hazard/i, module: 'fleet' },
  { pattern: /rdetector|r.?detector|road.?scan/i, module: 'r_detector' },
  { pattern: /smart/i, module: 'smart' },
  { pattern: /cyber|suraksha|caller|mobile.?security/i, module: 'cyber' },
  { pattern: /trust|rera|builder|project/i, module: 'trust_score' },
  { pattern: /realestate|realtor/i, module: 'realestate' },
  { pattern: /matchmaking/i, module: 'matchmaking' },
  { pattern: /queue(?!\.)/i, module: 'queue' },
];

function flagEnabled(settings, key) {
  if (!key) return true;
  const v = settings?.[key];
  return !(v === false || v === 0 || v === '0' || v === 'false');
}

function resolveModuleFromScreen(screen = '') {
  const s = String(screen || '');
  for (const row of SCREEN_TO_MODULE) {
    if (row.pattern.test(s)) return row.module;
  }
  return null;
}

function pickSyncRows(syncModules = [], syncKeys = []) {
  return syncModules.filter((m) => syncKeys.includes(m.key));
}

function tableBlockFor(tableModules = [], tableModuleKey) {
  if (!tableModuleKey) return null;
  return tableModules.find((m) => m.key === tableModuleKey) || null;
}

function sumTableRows(tables = []) {
  let total = 0;
  let hasError = false;
  for (const t of tables) {
    if (t.error) hasError = true;
    else if (Number.isFinite(t.count)) total += t.count;
  }
  return { total, hasError };
}

function collectLogsForModule(moduleKey, ctx = {}) {
  const {
    clientErrors = [],
    featureScanLogs = [],
    moduleDiagnostics = [],
    newsLogs = [],
    offerLogs = [],
    tradingExcelLogs = [],
    issues = [],
  } = ctx;

  const moduleDiagnostic = moduleDiagnostics.filter((e) => e.module === moduleKey).slice(0, 20);
  const client = clientErrors
    .filter((e) => resolveModuleFromScreen(e.screen || e.route) === moduleKey)
    .slice(0, 15);
  const scanForModule = (e) => {
    if (moduleKey === 'smart') return e.feature === 'smart_scan';
    if (moduleKey === 'r_detector') return e.feature === 'r_detector';
    return false;
  };
  const scanUi = featureScanLogs
    .filter((e) => scanForModule(e) && String(e.logSource || 'ui') === 'ui')
    .slice(0, 15);
  const scanBackend = featureScanLogs
    .filter((e) => scanForModule(e) && String(e.logSource) === 'backend')
    .slice(0, 15);
  const scan = [...scanUi, ...scanBackend].slice(0, 20);
  let pipeline =
    moduleKey === 'news'
      ? newsLogs.slice(0, 20)
      : moduleKey === 'offers'
        ? offerLogs.slice(0, 20)
        : [];
  if (moduleKey === 'trading' && tradingExcelLogs?.length) {
    pipeline = tradingExcelLogs.slice(0, 20).map((row, idx) => ({
      id: `trading-excel-${idx}-${row.at}`,
      level: row.level === 'error' ? 'L1' : row.level === 'warn' ? 'L2' : 'L3',
      stage: row.step || 'excel',
      message: row.message,
      at: row.at,
      meta: row,
    }));
  }

  const relatedIssues = issues.filter(
    (i) => i.module === moduleKey || (i.message || '').toLowerCase().includes(moduleKey.replace('_', ' '))
  ).slice(0, 12);

  return { moduleDiagnostic, client, scan, scanUi, scanBackend, pipeline, relatedIssues };
}

function collectSignals(moduleKey, { clientErrors = [], featureScanLogs = [], moduleDiagnostics = [] }) {
  const signals = [];
  const push = (row, source) => {
    signals.push({
      at: row.at || row.reportedAt,
      level: row.level || 'L3',
      message: row.message,
      source,
      screen: row.screen,
      kind: row.kind || row.stage,
    });
  };

  clientErrors.forEach((e) => {
    const mod = resolveModuleFromScreen(e.screen) || resolveModuleFromScreen(e.route);
    if (mod === moduleKey) push({ ...e, level: e.level || 'L2' }, 'client_error');
  });

  featureScanLogs.forEach((e) => {
    const mod = e.feature === 'smart_scan' ? 'smart' : e.feature === 'r_detector' ? 'r_detector' : null;
    if (mod === moduleKey) push({ ...e, level: e.level || 'L3', kind: e.stage }, 'feature_scan');
  });

  moduleDiagnostics.forEach((e) => {
    if (e.module === moduleKey) push(e, 'module_diagnostic');
  });

  return signals
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
    .slice(0, 8);
}

function buildReasonsAndHints({
  mod,
  featureEnabled,
  mysqlConfigured,
  poolReady,
  dbType,
  runtimeDb,
  syncRows,
  tableBlock,
  tableSum,
  extraIssues = [],
}) {
  const reasons = [];
  const fixHints = [];

  if (!featureEnabled) {
    reasons.push(`Feature flag ${mod.featureFlag} is OFF — UI hides or blocks this module.`);
    fixHints.push(`Super Admin → Features & Subscriptions → enable “${mod.label}” (${mod.featureFlag}).`);
  }

  const apsInMemoryByChoice = runtimeDb?.override === 'inmemory';

  if (mysqlConfigured && !poolReady && !apsInMemoryByChoice) {
    reasons.push('MySQL is configured but pool is not ready — API may return empty or memory fallback.');
    fixHints.push('Check APS MySQL pools section and .env DB credentials; restart backend.');
  }
  if (dbType === 'inmemory' && mysqlConfigured && !apsInMemoryByChoice) {
    reasons.push('Server reports in-memory DB while MySQL is configured — data may not persist.');
    fixHints.push('APS → toggle MySQL, or run Revalidate / Sync now.');
  } else if (apsInMemoryByChoice) {
    fixHints.push('APS in-memory mode is ON — toggle MySQL on APS when you want persisted reads.');
  }

  for (const s of syncRows) {
    if (s.status === 'FAILED') {
      reasons.push(`Sync failed: ${s.label} — ${s.lastError || 'unknown error'}`);
      fixHints.push(`APS → Sync → retry module “${s.key}”.`);
    } else if (s.status === 'PENDING') {
      reasons.push(`Sync pending: ${s.label} — data not loaded into MySQL yet.`);
      fixHints.push('Tap Sync now on APS dashboard.');
    }
  }

  if (tableBlock) {
    for (const t of tableBlock.tables || []) {
      if (t.error) {
        reasons.push(`MySQL table ${t.table}: ${t.error}`);
        fixHints.push(`Run core schema sync or create table ${t.table}.`);
      } else if (t.count === 0) {
        reasons.push(`Table ${t.table} has 0 rows — UI lists will be empty.`);
        fixHints.push(`Run matching sync (${mod.syncKeys.join(', ')}) or seed data for ${mod.label}.`);
      }
    }
  } else if (mod.tableModuleKey && mysqlConfigured && poolReady) {
    reasons.push('No table health probe for this module — check feature-specific API logs.');
  }

  if (tableSum.total === 0 && !tableSum.hasError && tableBlock && featureEnabled) {
    reasons.push('All probed tables are empty while feature is enabled.');
  }

  extraIssues.forEach((msg) => reasons.push(msg));

  if (reasons.length === 0 && featureEnabled) {
    reasons.push('Backend flags look OK — if UI still empty, check client logs below or user role access.');
  }

  return { reasons: [...new Set(reasons)], fixHints: [...new Set(fixHints)] };
}

function deriveUiStatus({ featureEnabled, reasons, tableSum, syncRows }) {
  if (!featureEnabled) return 'disabled';
  if (syncRows.some((s) => s.status === 'FAILED')) return 'sync_error';
  if (tableSum.hasError) return 'db_error';
  if (tableSum.total === 0 && reasons.some((r) => /0 rows|empty/i.test(r))) return 'empty';
  if (syncRows.some((s) => s.status === 'PENDING')) return 'sync_pending';
  return 'ok';
}

async function buildModuleReports(ctx = {}) {
  let settings = ctx.settings || {};
  if (!ctx.settings) {
    try {
      settings = await require('./settingsService').getSettings();
    } catch (_) {
      settings = {};
    }
  }

  const {
    dbType = 'inmemory',
    runtimeDb = null,
    poolReady = false,
    syncModules = [],
    tableModules = [],
    clientErrors = [],
    featureScanLogs = [],
    moduleDiagnostics = [],
    trustScore = null,
    newsDiagnostics = null,
    offerDiagnostics = null,
    newsLogs = [],
    offerLogs = [],
    tradingExcelLogs = [],
    issues = [],
  } = ctx;

  const mysqlConfigured = isMysqlConfigured();
  const reports = [];

  for (const mod of MODULE_REGISTRY) {
    const featureEnabled = flagEnabled(settings, mod.featureFlag);
    const syncRows = pickSyncRows(syncModules, mod.syncKeys);
    const tableBlock = tableBlockFor(tableModules, mod.tableModuleKey);
    const tableSum = sumTableRows(tableBlock?.tables || []);

    const extraIssues = [];
    if (mod.key === 'trust_score' && trustScore?.mysqlProjects === 0 && trustScore?.memoryProjects > 0) {
      extraIssues.push(`${trustScore.memoryProjects} projects in memory, 0 in MySQL.`);
    }
    if (mod.key === 'news' && newsDiagnostics && !newsDiagnostics.enableNews) {
      extraIssues.push('News pipeline reports enable_news off or slice disabled.');
    }
    if (mod.key === 'offers' && offerDiagnostics?.issues?.length) {
      offerDiagnostics.issues.slice(0, 3).forEach((i) => extraIssues.push(i.message));
    }

    let effectiveTableSum = tableSum;
    if (mod.key === 'offers' && (offerDiagnostics?.dealsCount || 0) > 0 && tableSum.total === 0) {
      effectiveTableSum = {
        total: (offerDiagnostics.dealsCount || 0) + (offerDiagnostics.vendorsCount || 0),
        hasError: tableSum.hasError,
      };
    }

    const { reasons, fixHints } = buildReasonsAndHints({
      mod,
      featureEnabled,
      mysqlConfigured,
      poolReady: ctx.poolReady,
      dbType,
      runtimeDb,
      syncRows,
      tableBlock:
        mod.key === 'offers' && (offerDiagnostics?.dealsCount || 0) > 0
          ? {
              ...tableBlock,
              tables: (tableBlock?.tables || []).map((t) =>
                t.table === 'deals' && t.count === 0
                  ? { ...t, count: offerDiagnostics.dealsCount, note: 'from offer snapshot' }
                  : t
              ),
            }
          : tableBlock,
      tableSum: effectiveTableSum,
      extraIssues,
    });

    const uiStatus = deriveUiStatus({ featureEnabled, reasons, tableSum: effectiveTableSum, syncRows });
    const recentSignals = collectSignals(mod.key, {
      clientErrors,
      featureScanLogs,
      moduleDiagnostics,
    });

    const logs = collectLogsForModule(mod.key, {
      clientErrors,
      featureScanLogs,
      moduleDiagnostics,
      newsLogs,
      offerLogs,
      tradingExcelLogs,
      issues,
    });

    const syncPipeline = summarizeSyncPipeline(mod.syncKeys, syncModules);
    const scripts = getScriptsForModule(mod.key);

    if (syncPipeline.failed > 0) {
      fixHints.push(`Re-run sync for failed step(s): ${syncPipeline.steps.filter((s) => s.status === 'FAILED').map((s) => s.key).join(', ')}`);
    }
    if (syncPipeline.assignedSteps > 0 && syncPipeline.success < syncPipeline.assignedSteps && featureEnabled) {
      reasons.push(`Sync pipeline: ${syncPipeline.executedLabel} (queries=${syncPipeline.queriesSynced}, items=${syncPipeline.itemsSynced}).`);
    }

    reports.push({
      key: mod.key,
      label: mod.label,
      featureFlag: mod.featureFlag,
      featureEnabled,
      uiStatus,
      syncPipeline,
      scripts,
      syncRows: syncPipeline.steps,
      tables: tableBlock?.tables || [],
      totalRows: tableSum.total,
      reasons,
      fixHints,
      recentSignals,
      logs,
    });
  }

  const statusRank = { disabled: 0, sync_error: 1, db_error: 2, empty: 3, sync_pending: 4, ok: 5 };
  reports.sort((a, b) => (statusRank[a.uiStatus] ?? 9) - (statusRank[b.uiStatus] ?? 9));

  return reports;
}

function moduleReportsToIssues(reports = []) {
  const out = [];
  for (const r of reports) {
    if (r.uiStatus === 'ok') continue;
    const level = r.uiStatus === 'disabled' || r.uiStatus === 'sync_error' || r.uiStatus === 'db_error'
      ? 'L1'
      : 'L2';
    const top = r.reasons[0] || `${r.label} may show no data`;
    out.push({
      severity: level === 'L1' ? 'critical' : 'warning',
      level,
      module: r.key,
      message: `[${r.uiStatus}] ${r.label}: ${top}`,
      source: 'module_report',
      at: new Date().toISOString(),
    });
  }
  return out;
}

module.exports = {
  MODULE_REGISTRY,
  resolveModuleFromScreen,
  buildModuleReports,
  moduleReportsToIssues,
};
