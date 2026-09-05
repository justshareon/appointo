/**
 * MySQL pool limits — env, admin settings, per-feature overrides.
 * Floor: 3 connections · recommended default: 5 · max: 20
 */
const { MYSQL_FEATURES, FEATURES } = require('../database/featureRegistry');

const ABS_MIN = 3;
const ABS_MAX = 20;
const RECOMMENDED = 5;

let cachedSettings = null;
let cachedAt = 0;
const CACHE_MS = 15000;

function clampLimit(n) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v)) return RECOMMENDED;
  return Math.max(ABS_MIN, Math.min(ABS_MAX, v));
}

function parseFeatureLimits(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    return JSON.parse(String(raw));
  } catch (_) {
    return {};
  }
}

function settingsSnapshot(settings = {}) {
  const minLimit = clampLimit(settings.db_pool_min_limit || process.env.DB_POOL_MIN_LIMIT || ABS_MIN);
  const defaultLimit = clampLimit(
    settings.db_pool_default_limit || process.env.DB_CONN_LIMIT || RECOMMENDED
  );
  const featureLimits = parseFeatureLimits(settings.db_pool_feature_limits);
  return { minLimit, defaultLimit, featureLimits };
}

async function loadSettings(force = false) {
  if (!force && cachedSettings && Date.now() - cachedAt < CACHE_MS) {
    return cachedSettings;
  }
  try {
    const settingsService = require('../services/settingsService');
    cachedSettings = await settingsService.getSettings();
    cachedAt = Date.now();
  } catch (_) {
    cachedSettings = cachedSettings || {};
  }
  return cachedSettings;
}

function clearCache() {
  cachedSettings = null;
  cachedAt = 0;
}

function resolveLimitSync(feature = 'core', settings = null) {
  const snap = settingsSnapshot(settings || cachedSettings || {});
  const envKey = `DB_CONN_LIMIT_${String(feature).toUpperCase()}`;
  const envLimit = process.env[envKey];
  const fromMap = snap.featureLimits?.[feature];
  const raw = fromMap ?? envLimit ?? snap.defaultLimit;
  return clampLimit(Math.max(snap.minLimit, raw));
}

async function resolveLimit(feature = 'core') {
  const settings = await loadSettings();
  return resolveLimitSync(feature, settings);
}

function resolveMaxIdle(connectionLimit) {
  const limit = clampLimit(connectionLimit);
  return Math.min(limit, Math.max(ABS_MIN, Math.floor(limit * 0.6)));
}

async function getPoolConfig() {
  const settings = await loadSettings(true);
  const snap = settingsSnapshot(settings);
  const features = MYSQL_FEATURES.map((id) => ({
    id,
    label: FEATURES[id]?.label || id,
    limit: resolveLimitSync(id, settings),
    configured: snap.featureLimits[id] ?? null,
  }));
  return {
    minLimit: snap.minLimit,
    defaultLimit: snap.defaultLimit,
    recommendedLimit: RECOMMENDED,
    absoluteMin: ABS_MIN,
    absoluteMax: ABS_MAX,
    featureLimits: snap.featureLimits,
    features,
    idleCloseMinutes: parseInt(
      settings.db_pool_idle_close_minutes || process.env.FEATURE_IDLE_MINUTES || '10',
      10
    ),
  };
}

async function updatePoolConfig(patch = {}) {
  const settings = await loadSettings(true);
  const snap = settingsSnapshot(settings);
  const next = {};

  if (patch.defaultLimit != null) {
    next.db_pool_default_limit = clampLimit(patch.defaultLimit);
  }
  if (patch.minLimit != null) {
    next.db_pool_min_limit = clampLimit(patch.minLimit);
  }
  if (patch.idleCloseMinutes != null) {
    next.db_pool_idle_close_minutes = Math.max(1, parseInt(patch.idleCloseMinutes, 10) || 10);
  }
  if (patch.featureLimits && typeof patch.featureLimits === 'object') {
    const merged = { ...snap.featureLimits };
    Object.entries(patch.featureLimits).forEach(([key, val]) => {
      if (val == null || val === '') {
        delete merged[key];
      } else {
        merged[key] = clampLimit(val);
      }
    });
    next.db_pool_feature_limits = merged;
  }

  const settingsService = require('../services/settingsService');
  await settingsService.updateSettings(next);
  clearCache();
  return getPoolConfig();
}

function validatePoolHealthRows(rows = []) {
  const issues = [];
  rows.forEach((row) => {
    const limit = row.connectionLimit ?? row.actualLimit ?? 0;
    if (limit < ABS_MIN) {
      issues.push({
        severity: 'critical',
        level: 'L1',
        kind: 'pool_limit',
        module: 'mysql',
        feature: row.feature,
        message: `${row.label} pool limit ${limit} is below minimum ${ABS_MIN} — raise in APS pool settings`,
        source: 'pool_config',
      });
    } else if (limit < RECOMMENDED) {
      issues.push({
        severity: 'warning',
        level: 'L2',
        kind: 'pool_limit',
        module: row.feature,
        feature: row.feature,
        message: `${row.label} pool limit ${limit} — recommended ${RECOMMENDED} for stable concurrent queries`,
        source: 'pool_config',
      });
    }
    if (row.open && (row.queued || 0) > 0) {
      issues.push({
        severity: 'critical',
        level: 'L1',
        kind: 'pool_exhausted',
        module: 'mysql',
        feature: row.feature,
        message: `${row.label} pool saturated — ${row.queued} queued (limit ${limit}, active ${row.activeConnections ?? '?'})`,
        source: 'pool_runtime',
      });
    }
    if (row.open && limit >= ABS_MIN && (row.activeConnections || 0) >= limit) {
      issues.push({
        severity: 'warning',
        level: 'L2',
        kind: 'pool_full',
        module: row.feature,
        feature: row.feature,
        message: `${row.label} pool at capacity (${row.activeConnections}/${limit} connections in use)`,
        source: 'pool_runtime',
      });
    }
  });
  return issues;
}

function summarizePoolRows(rows = []) {
  const open = rows.filter((r) => r.open).length;
  const belowMin = rows.filter((r) => (r.connectionLimit || 0) < ABS_MIN).length;
  const belowRecommended = rows.filter((r) => (r.connectionLimit || 0) < RECOMMENDED).length;
  const queued = rows.reduce((n, r) => n + (r.queued || 0), 0);
  return {
    totalFeatures: rows.length,
    openPools: open,
    closedPools: rows.length - open,
    belowMin,
    belowRecommended,
    queuedTotal: queued,
    healthy: belowMin === 0 && queued === 0,
  };
}

module.exports = {
  ABS_MIN,
  ABS_MAX,
  RECOMMENDED,
  loadSettings,
  clearCache,
  resolveLimit,
  resolveLimitSync,
  resolveMaxIdle,
  getPoolConfig,
  updatePoolConfig,
  validatePoolHealthRows,
  summarizePoolRows,
};
