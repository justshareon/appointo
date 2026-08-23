const db = require('../database');
const LOG = require('../utils/logger');
const { logApiStart, logApiDone } = require('../utils/dbtiming');

/**
 * Compact request logging: always emit API START/DONE timing.
 * Dump headers/body only for slow or failed responses.
 */
const requestLogger = (req, res, next) => {
    if (req.url === '/' && req.method === 'GET') {
        return next();
    }

    if (db.LOG_CONFIG && !db.LOG_CONFIG.ENABLED) return next();

    const start = Date.now();
    const url = req.originalUrl || req.url;
    const dbMode = (db.getType && db.getType()) || process.env.DB_TYPE || 'inmemory';
    req.dbTiming = { mysqlCount: 0, mysqlMs: 0 };

    logApiStart(req.method, url, dbMode);

    const originalSend = res.send;
    const originalJson = res.json;
    let loggedDone = false;
    const logDone = (data) => {
        if (loggedDone) return;
        loggedDone = true;
        const duration = Date.now() - start;
        const timing = req.dbTiming || { mysqlCount: 0, mysqlMs: 0 };
        logApiDone(req.method, url, duration, dbMode, timing.mysqlCount, timing.mysqlMs);
        const failed = res.statusCode >= 400;
        const slow = duration >= 500;
        if (!failed && !slow) return;
        const responseSize = data == null
            ? 0
            : (typeof data === 'string' ? data.length : JSON.stringify(data).length);
        LOG.info(`[HTTP ${failed ? 'ERR' : 'SLOW'}] ${req.method} ${url} ${res.statusCode} ${duration}ms ${responseSize}b mysql=${timing.mysqlCount}`);
    };

    res.send = function(data) {
        logDone(data);
        return originalSend.call(this, data);
    };

    res.json = function(data) {
        logDone(data);
        return originalJson.call(this, data);
    };

    res.on('finish', () => logDone());

    next();
};

module.exports = requestLogger;
