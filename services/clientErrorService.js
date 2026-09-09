/**
 * In-memory + file-backed client UI error log for super-admin APS dashboard.
 */
const path = require('path');
const { sortLatestFirst } = require('../utils/sortLatest');
const { createDiagnosticLogStore } = require('../utils/diagnosticLogStore');

const MAX_ENTRIES = 200;
const LOG_FILE = path.join(__dirname, '..', 'client-errors.log');
const store = createDiagnosticLogStore({
  logFile: LOG_FILE,
  maxEntries: MAX_ENTRIES,
  dateFields: ['reportedAt'],
});

function normalizeLevel(level) {
  const l = String(level || 'L1').toUpperCase();
  if (l === 'L1' || l === 'L2' || l === 'L3') return l;
  return 'L1';
}

function recordClientError(payload = {}) {
  const level = normalizeLevel(payload.level);
  const entry = {
    id: `ce_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    level,
    kind: String(payload.kind || (level === 'L1' ? 'crash' : 'feature')).slice(0, 32),
    screen: String(payload.screen || 'unknown').slice(0, 120),
    message: String(payload.message || 'Unknown error').slice(0, 500),
    stack: payload.stack ? String(payload.stack).slice(0, 2000) : null,
    componentStack: payload.componentStack ? String(payload.componentStack).slice(0, 3000) : null,
    platform: payload.platform ? String(payload.platform).slice(0, 32) : null,
    route: payload.route ? String(payload.route).slice(0, 120) : null,
    userId: payload.userId ? String(payload.userId).slice(0, 64) : null,
    userRole: payload.userRole ? String(payload.userRole).slice(0, 32) : null,
    reportedAt: new Date().toISOString(),
  };

  return store.append(entry);
}

function getClientErrors(limit = 50) {
  return store.getEntries(limit);
}

function purgeClientErrors() {
  return store.purgeExpired();
}

function levelToSeverity(level) {
  if (level === 'L1') return 'critical';
  if (level === 'L2') return 'warning';
  return 'info';
}

function clientErrorsToIssues(errors = []) {
  return [...errors]
    .sort((a, b) => new Date(b.reportedAt || 0) - new Date(a.reportedAt || 0))
    .slice(0, 40)
    .map((err) => {
    const level = normalizeLevel(err.level);
    return {
      severity: levelToSeverity(level),
      level,
      kind: err.kind || (level === 'L1' ? 'crash' : 'feature'),
      module: level === 'L1' ? 'ui' : err.kind === 'empty_data'
        ? (/offer/i.test(String(err.screen || '')) ? 'offers' : 'news')
        : 'ui',
      message: `[${level}] ${err.screen}: ${err.message}`,
      source: 'client',
      screen: err.screen,
      platform: err.platform,
      reportedAt: err.reportedAt,
      userId: err.userId,
    };
  });
}

function getLevelSummary(errors = []) {
  const counts = { L1: 0, L2: 0, L3: 0 };
  errors.forEach((e) => {
    const level = normalizeLevel(e.level);
    counts[level] = (counts[level] || 0) + 1;
  });
  return counts;
}

module.exports = {
  recordClientError,
  getClientErrors,
  purgeClientErrors,
  clientErrorsToIssues,
  getLevelSummary,
  normalizeLevel,
};
