/**
 * Vendor Auto discover/save — ring buffer for super-admin diagnostics.
 */
const LOG = require('./logger');

const MAX = 200;
const entries = [];

function push(level, message, meta = {}) {
  const row = {
    id: `val_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    level: level || 'info',
    message: String(message || '').slice(0, 2000),
    meta: meta && typeof meta === 'object' ? meta : {},
    at: new Date().toISOString(),
  };
  entries.unshift(row);
  if (entries.length > MAX) entries.length = MAX;
  const line = `[VendorAuto] ${row.level.toUpperCase()} ${row.message}`;
  if (row.level === 'error') LOG.error(line);
  else if (row.level === 'warn') LOG.warning(line);
  else LOG.info(line);
  return row;
}

function getLogs({ limit = 80, since = null } = {}) {
  let rows = [...entries];
  if (since) {
    const t = new Date(since).getTime();
    rows = rows.filter((r) => new Date(r.at).getTime() > t);
  }
  return rows.slice(0, limit);
}

module.exports = {
  pushVendorAutoLog: push,
  getVendorAutoLogs: getLogs,
};
