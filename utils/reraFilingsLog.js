/**
 * Ring buffer for RERA public filings load/save diagnostics.
 */
const LOG = require('./logger');

const MAX_ENTRIES = 100;
const entries = [];

function push(level, step, message, meta = {}) {
  const row = {
    at: new Date().toISOString(),
    level,
    step,
    message: String(message || ''),
    ...(meta && typeof meta === 'object' ? meta : {}),
  };
  entries.unshift(row);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;

  const line = `[ReraFilings][${step}] ${message}`;
  if (level === 'error') LOG.error(line, meta?.err || meta?.stack || '');
  else if (level === 'warn') LOG.warning(line);
  else LOG.info(line);
  return row;
}

function getRecent(limit = 30) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 30, 1), MAX_ENTRIES);
  return entries.slice(0, n);
}

function attachError(error, step, diagnostics = {}) {
  if (!error || typeof error !== 'object') return error;
  error.reraFilingsStep = step;
  error.diagnostics = { ...(error.diagnostics || {}), ...diagnostics };
  push('error', step, error.message, { err: error.message, ...diagnostics });
  return error;
}

module.exports = {
  push,
  getRecent,
  attachError,
};
