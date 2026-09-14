/**
 * Backend error.log retention — keep last hour only, return newest-first tail.
 */
const fs = require('fs');
const path = require('path');

const ERROR_LOG_PATH = path.join(__dirname, '..', 'error.log');
const TS_RE = /^\[([^\]]+)\]/;
const TIME_ONLY_RE = /^\[(ERROR|INFO|WARN|DEBUG|SUCCESS|UI)\]\s+([^|]+)\s*\|/i;
const DEFAULT_TTL_MS = 60 * 60 * 1000;

function parseLineTimestamp(line) {
  const text = String(line || '');
  const iso = text.match(TS_RE);
  if (iso) {
    const t = new Date(iso[1]).getTime();
    if (Number.isFinite(t)) return t;
  }
  const legacy = text.match(TIME_ONLY_RE);
  if (legacy) {
    const t = new Date(legacy[2].trim()).getTime();
    if (Number.isFinite(t)) return t;
  }
  return null;
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

function sortLogLinesNewestFirst(rawLines) {
  const indexed = (rawLines || []).map((line, i) => ({ line, i }));
  indexed.sort((a, b) => {
    const ta = parseLineTimestamp(a.line);
    const tb = parseLineTimestamp(b.line);
    if (ta != null && tb != null) return tb - ta;
    if (ta != null) return -1;
    if (tb != null) return 1;
    return b.i - a.i;
  });
  return indexed.map((row) => row.line);
}

function readErrorLogTail(maxLines = 40, ttlMs = DEFAULT_TTL_MS, logPath = ERROR_LOG_PATH) {
  purgeErrorLogOlderThan(ttlMs, logPath);
  try {
    if (!fs.existsSync(logPath)) {
      return { path: logPath, lines: [], exists: false, recentFirst: true };
    }
    const raw = fs.readFileSync(logPath, 'utf8');
    const lines = sortLogLinesNewestFirst(raw.split(/\r?\n/).filter(Boolean)).slice(0, maxLines);
    return { path: logPath, lines, exists: true, recentFirst: true, fetchedAt: new Date().toISOString() };
  } catch (err) {
    return { path: logPath, lines: [], exists: false, error: err.message, recentFirst: true };
  }
}

module.exports = {
  ERROR_LOG_PATH,
  DEFAULT_TTL_MS,
  parseLineTimestamp,
  sortLogLinesNewestFirst,
  purgeErrorLogOlderThan,
  readErrorLogTail,
};
