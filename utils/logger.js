/**
 * Centralized logging — console + dedicated files (error / info / debug).
 */
const { appendAppLog, formatLine } = require('./appLogFiles');

function writeFile(kind, level, msg, detail = '') {
  appendAppLog(kind, formatLine(level, msg, detail));
}

const LOG = {
  error: (msg, detail = '') => {
    const errorMsg = `[ERROR] ${new Date().toLocaleTimeString()} | ${msg} | ${detail}`;
    console.error('\x1b[31m%s\x1b[0m', errorMsg);
    writeFile('error', 'ERROR', msg, detail);
  },
  info: (msg, detail = '') => {
    const infoMsg = `[INFO] ${new Date().toLocaleTimeString()} | ${msg}${detail ? ` | ${detail}` : ''}`;
    console.log('\x1b[36m%s\x1b[0m', infoMsg);
    writeFile('info', 'INFO', msg, detail);
  },
  success: (msg) => {
    const successMsg = `[SUCCESS] ${new Date().toLocaleTimeString()} | ${msg}`;
    console.log('\x1b[32m%s\x1b[0m', successMsg);
    writeFile('info', 'SUCCESS', msg);
  },
  warning: (msg, detail = '') => {
    const warnMsg = `[WARN] ${new Date().toLocaleTimeString()} | ${msg}${detail ? ` | ${detail}` : ''}`;
    console.log('\x1b[33m%s\x1b[0m', warnMsg);
    writeFile('error', 'WARN', msg, detail);
  },
  debug: (msg, detail = '') => {
    const debugMsg = `[DEBUG] ${new Date().toLocaleTimeString()} | ${msg}${detail ? ` | ${detail}` : ''}`;
    console.log('\x1b[90m%s\x1b[0m', debugMsg);
    writeFile('debug', 'DEBUG', msg, detail);
  },
  /** Access / auth failures */
  access: (msg, detail = '') => {
    LOG.error(`[access] ${msg}`, detail);
  },
  /** Sync pipeline failures */
  sync: (msg, detail = '') => {
    LOG.error(`[sync] ${msg}`, detail);
  },
  /** UI events recorded server-side */
  ui: (msg, detail = '') => {
    appendAppLog('ui', formatLine('UI', msg, detail));
  },
};

module.exports = LOG;
