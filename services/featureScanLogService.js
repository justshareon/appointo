/**
 * R-Detector & SMART scan diagnostic log for super-admin APS (reason codes, cache, prerequisites).
 */
const path = require('path');
const { createDiagnosticLogStore } = require('../utils/diagnosticLogStore');

const MAX_ENTRIES = 400;
const LOG_FILE = path.join(__dirname, '..', 'feature-scan-diagnostics.log');

const L1_STAGES = new Set([
  'prerequisite_fail',
  'monitor_denied',
  'scan_error',
  'history_error',
  'module_load_error',
  'bump_prerequisite_fail',
]);

const L2_STAGES = new Set(['history_sync', 'scan_timeout', 'permission_denied']);

const store = createDiagnosticLogStore({
  logFile: LOG_FILE,
  maxEntries: MAX_ENTRIES,
  dateFields: ['at'],
});

function normalizeLevel(payload = {}) {
  if (payload.level) {
    const l = String(payload.level).toUpperCase();
    if (l === 'L1' || l === 'L2' || l === 'L3') return l;
  }
  const stage = String(payload.stage || '').toLowerCase();
  if (L1_STAGES.has(stage)) return 'L1';
  if (L2_STAGES.has(stage)) return 'L2';
  return 'L3';
}

function normalizeFeature(feature) {
  const f = String(feature || '').toLowerCase();
  if (f === 'smart_scan' || f === 'r_detector') return f;
  return 'r_detector';
}

function normalizeLogSource(src) {
  const s = String(src || 'ui').toLowerCase();
  return s === 'backend' ? 'backend' : 'ui';
}

function recordFeatureScanLog(payload = {}) {
  const feature = normalizeFeature(payload.feature);
  const stage = String(payload.stage || 'info').slice(0, 48);
  const level = normalizeLevel({ ...payload, stage });
  const logSource = normalizeLogSource(payload.logSource);
  const entry = {
    id: `fs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    feature,
    logSource,
    level,
    stage,
    message: String(payload.message || 'Scan event').slice(0, 500),
    platform: payload.platform ? String(payload.platform).slice(0, 24) : null,
    userId: payload.userId ? String(payload.userId).slice(0, 64) : null,
    meta: payload.meta && typeof payload.meta === 'object' ? payload.meta : null,
    at: new Date().toISOString(),
  };
  return store.append(entry);
}

function recordBackendFeatureScan(feature, stage, message, meta = null) {
  return recordFeatureScanLog({
    feature,
    stage,
    message,
    meta,
    logSource: 'backend',
  });
}

function getFeatureScanLogs(limit = 60, options = null) {
  const featureFilter =
    typeof options === 'string' ? options : options?.feature || null;
  const logSource = typeof options === 'object' ? options?.logSource : null;
  const rows = store.getEntries(limit * 3);
  let filtered = rows;
  if (featureFilter) {
    filtered = filtered.filter((r) => r.feature === normalizeFeature(featureFilter));
  }
  if (logSource) {
    const want = normalizeLogSource(logSource);
    filtered = filtered.filter((r) => normalizeLogSource(r.logSource) === want);
  }
  return filtered.slice(0, limit);
}

function splitFeatureScanInsights(logs = [], limitPer = 40) {
  const split = (feature) => ({
    ui: logs
      .filter((r) => r.feature === feature && normalizeLogSource(r.logSource) === 'ui')
      .slice(0, limitPer),
    backend: logs
      .filter((r) => r.feature === feature && normalizeLogSource(r.logSource) === 'backend')
      .slice(0, limitPer),
  });
  return {
    r_detector: split('r_detector'),
    smart_scan: split('smart_scan'),
  };
}

function purgeFeatureScanLogs() {
  return store.purgeExpired();
}

function featureScanLogsToIssues(logs = []) {
  return [...logs]
    .filter((l) => l.level === 'L1' || l.level === 'L2')
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
    .slice(0, 30)
    .map((l) => ({
      severity: l.level === 'L1' ? 'critical' : 'warning',
      level: l.level,
      module: l.feature === 'smart_scan' ? 'smart' : 'r_detector',
      message: `[${l.feature}/${l.stage}] ${l.message}`,
      source: 'feature_scan_log',
      at: l.at,
      platform: l.platform,
    }));
}

function getLevelSummary(logs = []) {
  const counts = { L1: 0, L2: 0, L3: 0 };
  logs.forEach((l) => {
    if (counts[l.level] != null) counts[l.level] += 1;
  });
  return counts;
}

module.exports = {
  recordFeatureScanLog,
  recordBackendFeatureScan,
  getFeatureScanLogs,
  splitFeatureScanInsights,
  purgeFeatureScanLogs,
  featureScanLogsToIssues,
  getLevelSummary,
};
