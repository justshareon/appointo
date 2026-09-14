/**
 * Per-module “no data / error” log for APS — UI empty states, API failures, admin notes.
 */
const path = require('path');
const { createDiagnosticLogStore } = require('../utils/diagnosticLogStore');

const MAX_ENTRIES = 500;
const LOG_FILE = path.join(__dirname, '..', 'module-diagnostics.log');

const store = createDiagnosticLogStore({
  logFile: LOG_FILE,
  maxEntries: MAX_ENTRIES,
  dateFields: ['at'],
});

function normalizeLevel(level) {
  const l = String(level || 'L2').toUpperCase();
  if (l === 'L1' || l === 'L2' || l === 'L3') return l;
  return 'L2';
}

function recordModuleDiagnostic(payload = {}) {
  const entry = {
    id: `md_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    module: String(payload.module || 'unknown').slice(0, 48),
    level: normalizeLevel(payload.level),
    kind: String(payload.kind || 'empty_data').slice(0, 32),
    source: String(payload.source || 'client').slice(0, 24),
    screen: payload.screen ? String(payload.screen).slice(0, 120) : null,
    message: String(payload.message || 'No data').slice(0, 500),
    platform: payload.platform ? String(payload.platform).slice(0, 24) : null,
    userId: payload.userId ? String(payload.userId).slice(0, 64) : null,
    meta: payload.meta && typeof payload.meta === 'object' ? payload.meta : null,
    at: new Date().toISOString(),
  };
  return store.append(entry);
}

function getModuleDiagnostics(limit = 80, module = null) {
  const rows = store.getEntries(limit * 3);
  const filtered = module
    ? rows.filter((r) => r.module === module)
    : rows;
  return filtered.slice(0, limit);
}

function purgeModuleDiagnostics() {
  return store.purgeExpired();
}

function moduleDiagnosticsToIssues(logs = []) {
  return [...logs]
    .filter((l) => l.level === 'L1' || l.level === 'L2')
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
    .slice(0, 40)
    .map((l) => ({
      severity: l.level === 'L1' ? 'critical' : 'warning',
      level: l.level,
      module: l.module,
      message: `[${l.module}/${l.kind}] ${l.message}`,
      source: 'module_diagnostic',
      at: l.at,
      screen: l.screen,
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
  recordModuleDiagnostic,
  getModuleDiagnostics,
  purgeModuleDiagnostics,
  moduleDiagnosticsToIssues,
  getLevelSummary,
};
