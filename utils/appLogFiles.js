/**
 * Separate backend log files: error, info, debug, ui (human-readable lines).
 */
const fs = require('fs');
const path = require('path');
const { purgeErrorLogOlderThan, parseLineTimestamp, sortLogLinesNewestFirst } = require('./errorLogRetention');

const LOG_DIR = path.join(__dirname, '..');

const APP_LOG_PATHS = {
  error: path.join(LOG_DIR, 'error.log'),
  info: path.join(LOG_DIR, 'info.log'),
  debug: path.join(LOG_DIR, 'debug.log'),
  ui: path.join(LOG_DIR, 'ui.log'),
};

const DEFAULT_TTL_MS = 60 * 60 * 1000;

function formatLine(level, msg, detail = '') {
  const ts = new Date().toISOString();
  const body = detail ? `${msg} | ${detail}` : msg;
  return `[${ts}] [${level}] ${body}`;
}

function appendAppLog(kind, line) {
  const logPath = APP_LOG_PATHS[kind] || APP_LOG_PATHS.error;
  try {
    fs.appendFileSync(logPath, `${line.replace(/\r?\n/g, ' ')}\n`, 'utf8');
  } catch (_) {
    /* ignore disk failures */
  }
}

function readAppLogTail(kind, maxLines = 40, ttlMs = DEFAULT_TTL_MS) {
  const logPath = APP_LOG_PATHS[kind] || APP_LOG_PATHS.error;
  purgeErrorLogOlderThan(ttlMs, logPath);
  const fetchedAt = new Date().toISOString();
  try {
    if (!fs.existsSync(logPath)) {
      return { path: logPath, kind, lines: [], exists: false, recentFirst: true, fetchedAt };
    }
    const raw = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean);
    const lines = sortLogLinesNewestFirst(raw).slice(0, maxLines);
    let mtime = null;
    try {
      mtime = fs.statSync(logPath).mtime?.toISOString?.() || null;
    } catch (_) {
      /* ignore */
    }
    return { path: logPath, kind, lines, exists: true, recentFirst: true, fetchedAt, fileMtime: mtime };
  } catch (err) {
    return { path: logPath, kind, lines: [], exists: false, error: err.message, recentFirst: true, fetchedAt };
  }
}

function readAllAppLogTails(maxLines = 40) {
  return {
    errorLog: readAppLogTail('error', maxLines),
    infoLog: readAppLogTail('info', maxLines),
    debugLog: readAppLogTail('debug', maxLines),
    uiLog: readAppLogTail('ui', maxLines),
  };
}

module.exports = {
  APP_LOG_PATHS,
  DEFAULT_TTL_MS,
  formatLine,
  appendAppLog,
  readAppLogTail,
  readAllAppLogTails,
};
