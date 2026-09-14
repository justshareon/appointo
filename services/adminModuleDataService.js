/**
 * Super-admin module DATA — MySQL table samples + in-memory arrays only (no file logs).
 */
const { MODULE_REGISTRY } = require('./moduleDiagnosticsService');
const { FEATURES } = require('../database/featureRegistry');

const HEALTH_TABLES = {
  trust_score: ['trust_score_projects', 'trust_score_builders', 'trust_score_reviews', 'trust_score_complaints'],
  suraksha: ['suraksha_reports', 'suraksha_validations'],
  cyber: ['cyber_threats'],
  r_detector: ['r_detector_scan_results', 'fleet_bad_road_probes'],
  fleet: ['fleet_driver_stats', 'fleet_trips'],
  trading: ['live_stock_data'],
  shopping: ['products', 'orders'],
  news: ['news_cache'],
  offers: ['deals'],
};

const EXTRA_MYSQL = {
  queue: ['queues'],
  appointments: ['appointments'],
  offers: ['deals', 'products', 'companies', 'categories'],
  shopping: ['products', 'orders', 'queues'],
  realestate: ['real_estate_properties', 'real_estate_enquiries', 'real_estate_favorites'],
  cyber: ['cyber_threats', 'suraksha_reports', 'suraksha_validations'],
  trust_score: [
    'trust_score_projects',
    'trust_score_builders',
    'trust_score_reviews',
    'trust_score_fraud_alerts',
  ],
  trading: ['live_stock_data', 'companies'],
  news: ['news_cache'],
  fleet: ['fleet_driver_stats', 'fleet_trips'],
  r_detector: ['r_detector_scan_results', 'fleet_bad_road_probes'],
};

const FEATURE_ID = { offers: 'offer', trading: 'trade' };

/** MySQL table name → inMemoryDb key when pool unavailable */
const TABLE_TO_MEM = {
  products: 'products',
  orders: 'orders',
  queues: 'queues',
  appointments: 'appointments',
  deals: 'deals',
  news_cache: 'news_cache',
  cyber_threats: 'cyberThreats',
  suraksha_reports: 'surakshaReports',
  suraksha_validations: 'surakshaValidations',
  trust_score_projects: 'trustScoreProjects',
  trust_score_builders: 'trustScoreBuilders',
  trust_score_reviews: 'trustScoreReviews',
  trust_score_fraud_alerts: 'trustScoreFraudAlerts',
  r_detector_scan_results: 'r_detector_scan_results',
  live_stock_data: 'live_stock_data',
  real_estate_properties: 'real_estate_properties',
  real_estate_enquiries: 'real_estate_enquiries',
};

const EXTRA_MEMORY_BY_MODULE = {
  queue: ['queues'],
  shopping: ['products', 'orders', 'vendors'],
  appointments: ['appointments'],
  offers: ['products', 'vendors'],
  matchmaking: ['matchmaking_templates', 'matchmaking_submissions'],
  realestate: ['real_estate_properties', 'real_estate_enquiries'],
  fleet: ['fleet_hazards'],
  cyber: [
    'surakshaValidations',
    'surakshaReports',
    'cyberThreats',
    'mobileSecurityScans',
  ],
  trust_score: ['trustScoreProjects', 'trustScoreFraudAlerts', 'trustScoreBuilders'],
  smart: [
    'smartNearbyVendors',
    'smartNearbyScanSessions',
    'smartNearbyDeviceControls',
  ],
  r_detector: ['r_detector_scan_results', 'r_detector_commute_trips'],
};

const SENSITIVE = /password|passwd|token|secret|otp|api_key|authorization/i;
const MAX_CELL = 280;

function featureIdFor(moduleKey) {
  return FEATURE_ID[moduleKey] || moduleKey;
}

function mysqlTablesForModule(moduleKey, tableModuleKey) {
  const set = new Set();
  if (tableModuleKey && HEALTH_TABLES[tableModuleKey]) {
    HEALTH_TABLES[tableModuleKey].forEach((t) => set.add(t));
  }
  (EXTRA_MYSQL[moduleKey] || []).forEach((t) => set.add(t));
  return [...set];
}

function getPool() {
  try {
    const db = require('../database');
    return db.getPool?.() || null;
  } catch (_) {
    return null;
  }
}

function getMem() {
  try {
    const db = require('../database');
    return db.inMemoryDb || null;
  } catch (_) {
    return null;
  }
}

function sanitizeValue(key, val) {
  if (val == null) return val;
  if (SENSITIVE.test(String(key))) return '***';
  if (typeof val === 'string' && val.length > MAX_CELL) {
    return `${val.slice(0, MAX_CELL)}…`;
  }
  if (typeof val === 'object') {
    try {
      const s = JSON.stringify(val);
      if (s.length > MAX_CELL) return `${s.slice(0, MAX_CELL)}…`;
    } catch (_) {
      return '[object]';
    }
  }
  return val;
}

function sanitizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = sanitizeValue(k, v);
  }
  return out;
}

function memRowsForTable(table) {
  const mem = getMem();
  if (!mem) return null;
  const key = TABLE_TO_MEM[table] || table;
  const val = mem[key];
  if (Array.isArray(val)) return val;
  return null;
}

async function mysqlTableMeta(pool, table) {
  if (!pool) {
    const memRows = memRowsForTable(table);
    if (memRows) {
      return { table, count: memRows.length, error: null, source: 'memory' };
    }
    return { table, count: 0, error: null, source: 'memory', note: 'No MySQL pool' };
  }
  try {
    const [countRows] = await pool.query(`SELECT COUNT(*) AS cnt FROM \`${table}\``);
    const count = Number(countRows?.[0]?.cnt) || 0;
    return { table, count, error: null, source: 'mysql' };
  } catch (err) {
    const memRows = memRowsForTable(table);
    if (memRows) {
      return { table, count: memRows.length, error: null, source: 'memory_fallback' };
    }
    return { table, count: null, error: err.message, rows: [], source: 'error' };
  }
}

async function mysqlTableSample(pool, table, limit) {
  const meta = await mysqlTableMeta(pool, table);
  if (meta.source === 'memory' || meta.source === 'memory_fallback') {
    const memRows = memRowsForTable(table) || [];
    const slice = memRows.length > limit ? memRows.slice(-limit) : memRows;
    return {
      table,
      count: memRows.length,
      error: null,
      source: meta.source,
      limit,
      truncated: memRows.length > limit,
      rows: slice.map(sanitizeRow),
    };
  }
  if (meta.error && meta.count == null) {
    return { ...meta, rows: [], truncated: false, limit };
  }
  if (!pool) {
    return { table, count: 0, error: null, rows: [], truncated: false, limit, source: 'none' };
  }
  try {
    const [rows] = await pool.query(`SELECT * FROM \`${table}\` LIMIT ?`, [limit]);
    const truncated = meta.count > limit;
    return {
      table,
      count: meta.count,
      error: null,
      source: 'mysql',
      limit,
      truncated,
      rows: (rows || []).map(sanitizeRow),
    };
  } catch (err) {
    const memRows = memRowsForTable(table);
    if (memRows) {
      const slice = memRows.length > limit ? memRows.slice(-limit) : memRows;
      return {
        table,
        count: memRows.length,
        error: null,
        source: 'memory_fallback',
        limit,
        truncated: memRows.length > limit,
        rows: slice.map(sanitizeRow),
      };
    }
    return { table, count: meta.count, error: err.message, rows: [], truncated: false, limit };
  }
}

function memoryKeyMeta(mem, key) {
  if (!mem) return { key, count: 0, error: 'No in-memory DB' };
  const val = mem[key];
  if (val == null) return { key, count: 0, error: null };
  if (Array.isArray(val)) return { key, count: val.length, error: null };
  if (typeof val === 'object') {
    return { key, count: Object.keys(val).length, error: null, kind: 'object' };
  }
  return { key, count: 1, error: null, kind: typeof val };
}

function memoryKeySample(mem, key, limit) {
  const meta = memoryKeyMeta(mem, key);
  if (meta.error && meta.error !== null && meta.count === 0 && !mem?.[key]) {
    return { ...meta, rows: [], truncated: false, limit };
  }
  const val = mem?.[key];
  if (Array.isArray(val)) {
    const slice = val.length > limit ? val.slice(-limit) : val;
    return {
      key,
      count: val.length,
      error: null,
      limit,
      truncated: val.length > limit,
      rows: slice.map(sanitizeRow),
    };
  }
  if (val && typeof val === 'object') {
    return {
      key,
      count: Object.keys(val).length,
      error: null,
      kind: 'object',
      limit,
      truncated: false,
      rows: [sanitizeRow(val)],
    };
  }
  return { key, count: val != null ? 1 : 0, error: null, rows: val != null ? [sanitizeRow({ value: val })] : [], limit, truncated: false };
}

function memoryNestedSample(mem, parentKey, childKey, limit) {
  const path = `${parentKey}.${childKey}`;
  const parent = mem?.[parentKey];
  const arr = parent?.[childKey];
  if (!Array.isArray(arr)) {
    return { key: path, count: 0, error: null, rows: [], limit, truncated: false };
  }
  const slice = arr.length > limit ? arr.slice(-limit) : arr;
  return {
    key: path,
    count: arr.length,
    error: null,
    limit,
    truncated: arr.length > limit,
    rows: slice.map(sanitizeRow),
  };
}

function memorySpecForModule(moduleKey) {
  const fid = featureIdFor(moduleKey);
  const feat = FEATURES[fid];
  const fromFeat = feat?.memory?.arrays || [];
  const nested = feat?.memory?.nested || [];
  const extra = EXTRA_MEMORY_BY_MODULE[moduleKey] || [];
  const arrays = [...new Set([...fromFeat, ...extra])];
  const extras = [];
  if (moduleKey === 'trading') {
    extras.push({ type: 'object', key: 'tradingData' });
  }
  return { arrays, nested, extras };
}

function tradingDataSample(mem, limit) {
  const td = mem?.tradingData;
  if (!td || typeof td !== 'object') {
    return { key: 'tradingData', sections: [], error: null };
  }
  const sections = [];
  for (const [subKey, val] of Object.entries(td)) {
    if (Array.isArray(val)) {
      const slice = val.length > limit ? val.slice(-limit) : val;
      sections.push({
        key: `tradingData.${subKey}`,
        count: val.length,
        truncated: val.length > limit,
        limit,
        rows: slice.map(sanitizeRow),
      });
    } else if (val != null) {
      sections.push({
        key: `tradingData.${subKey}`,
        count: 1,
        truncated: false,
        limit,
        rows: [sanitizeRow(typeof val === 'object' ? val : { value: val })],
      });
    }
  }
  return { key: 'tradingData', sections, error: null };
}

function clampLimit(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 20;
  return Math.max(1, Math.min(100, n));
}

function registryEntry(moduleKey) {
  return MODULE_REGISTRY.find((m) => m.key === moduleKey) || null;
}

async function getModuleDataCatalog() {
  const pool = getPool();
  const mem = getMem();
  const modules = [];

  for (const entry of MODULE_REGISTRY) {
    const mysqlTables = mysqlTablesForModule(entry.key, entry.tableModuleKey);
    const spec = memorySpecForModule(entry.key);
    const mysql = [];
    for (const table of mysqlTables) {
      mysql.push(await mysqlTableMeta(pool, table));
    }
    const memory = (spec.arrays || []).map((k) => memoryKeyMeta(mem, k));
    for (const [parent, child] of spec.nested || []) {
      const parentVal = mem?.[parent];
      const arr = parentVal?.[child];
      const count = Array.isArray(arr) ? arr.length : 0;
      memory.push({ key: `${parent}.${child}`, count, error: null });
    }
    if (entry.key === 'trading' && mem?.tradingData) {
      memory.push({ key: 'tradingData', count: Object.keys(mem.tradingData).length, kind: 'object' });
    }

    modules.push({
      moduleId: entry.key,
      label: entry.label,
      mysql,
      memory,
    });
  }

  return {
    at: new Date().toISOString(),
    modules,
    note: 'Samples are capped per request. Sensitive fields redacted.',
  };
}

async function getModuleDataSample(moduleKey, limitRaw) {
  const limit = clampLimit(limitRaw);
  const entry = registryEntry(moduleKey);
  if (!entry) {
    return { ok: false, error: `Unknown module: ${moduleKey}` };
  }

  const pool = getPool();
  const mem = getMem();
  const mysqlTables = mysqlTablesForModule(entry.key, entry.tableModuleKey);
  const spec = memorySpecForModule(entry.key);

  const mysql = [];
  for (const table of mysqlTables) {
    mysql.push(await mysqlTableSample(pool, table, limit));
  }

  const memory = [];
  for (const key of spec.arrays || []) {
    memory.push(memoryKeySample(mem, key, limit));
  }
  for (const [parent, child] of spec.nested || []) {
    memory.push(memoryNestedSample(mem, parent, child, limit));
  }

  let tradingExtra = null;
  if (entry.key === 'trading') {
    tradingExtra = tradingDataSample(mem, limit);
  }

  return {
    ok: true,
    at: new Date().toISOString(),
    moduleId: entry.key,
    label: entry.label,
    limit,
    mysql,
    memory,
    tradingData: tradingExtra,
  };
}

module.exports = {
  getModuleDataCatalog,
  getModuleDataSample,
  clampLimit,
};
