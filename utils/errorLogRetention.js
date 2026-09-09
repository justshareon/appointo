/**
 * Backend error.log retention — keep last hour only, return newest-first tail.
 */
const fs = require('fs');
const path = require('path');

const ERROR_LOG_PATH = path.join(__dirname, '..', 'error.log');
const TS_RE = /^\[([^\]]+)\]/;
const DEFAULT_TTL_MS = 60 * 60 * 1000;

function parseLineTimestamp(line) {
  const match = String(line || '').match(TS_RE);
  if (!match) return null;
  const t = new Date(match[1]).getTime();
  return Number.isFinite(t) ? t : null;
}

function purgeErrorLogOlderThan(ttlMs = DEFAULT_TTL_MS, logPath = ERROR_LOG_PATH) {
  try {
    if (!fs.existsSync(logPath)) return { purged: 0, kept: 0, path: logPath };
    const lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean);
    const cutoff = Date.now() - ttlMs;
    const kept = lines.filter((line) => {
      const t = parseLineTimestamp(line);
      return t == null || t >= cutoff;
    });
    if (kept.length !== lines.length) {
      fs.writeFileSync(logPath, kept.length ? `${kept.join('\n')}\n` : '');
    }
    return { purged: lines.length - kept.length, kept: kept.length, path: logPath };
  } catch (err) {
    return { purged: 0, kept: 0, path: logPath, error: err.message };
  }
}

function readErrorLogTail(maxLines = 40, ttlMs = DEFAULT_TTL_MS, logPath = ERROR_LOG_PATH) {
  purgeErrorLogOlderThan(ttlMs, logPath);
  try {
    if (!fs.existsSync(logPath)) {
      return { path: logPath, lines: [], exists: false, recentFirst: true };
    }
    const raw = fs.readFileSync(logPath, 'utf8');
    const lines = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .sort((a, b) => (parseLineTimestamp(b) || 0) - (parseLineTimestamp(a) || 0))
      .slice(0, maxLines);
    return { path: logPath, lines, exists: true, recentFirst: true };
  } catch (err) {
    return { path: logPath, lines: [], exists: false, error: err.message, recentFirst: true };
  }
}

module.exports = {
  ERROR_LOG_PATH,
  DEFAULT_TTL_MS,
  parseLineTimestamp,
  purgeErrorLogOlderThan,
  readErrorLogTail,
};
