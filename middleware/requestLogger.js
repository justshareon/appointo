const db = require('../database');
const LOG = require('../utils/logger');
const { logApiStart, logApiDone } = require('../utils/dbTiming');

/**
 * Request logging middleware
 * Logs all incoming requests with duration, query params, body, and response
 */
const requestLogger = (req, res, next) => {
    // Basic health check endpoint - skip detailed logging to reduce noise
    if (req.url === '/' && req.method === 'GET') {
        return next();
    }

    // Performance log check
    if (db.LOG_CONFIG && !db.LOG_CONFIG.ENABLED) return next();

    const start = Date.now();
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const url = req.originalUrl || req.url;
    const dbMode = (db.getType && db.getType()) || process.env.DB_TYPE || 'inmemory';
    req.dbTiming = { mysqlCount: 0, mysqlMs: 0 };

    logApiStart(req.method, url, dbMode);

    LOG.info(`[HTTP REQ] ========================================`);
    LOG.info(`[HTTP REQ] Request ID: ${requestId}`);
    LOG.info(`[HTTP REQ] Method: ${req.method}`);
    LOG.info(`[HTTP REQ] URL: ${url}`);
    LOG.info(`[HTTP REQ] Path: ${req.path}`);
    LOG.info(`[HTTP REQ] DB: ${dbMode}`);

    if (Object.keys(req.query).length > 0) {
        LOG.info(`[HTTP REQ] Query Params: ${JSON.stringify(req.query)}`);
    }

    if (req.body && Object.keys(req.body).length > 0 && req.method !== 'GET') {
        const bodyStr = JSON.stringify(req.body);
        if (bodyStr.length > 1000) {
            LOG.info(`[HTTP REQ] Body: ${bodyStr.substring(0, 1000)}... (${bodyStr.length} chars total)`);
        } else {
            LOG.info(`[HTTP REQ] Body: ${JSON.stringify(req.body)}`);
        }
    }

    if (req.headers.authorization) {
        LOG.info(`[HTTP REQ] Authorization: ${req.headers.authorization.substring(0, 20)}...`);
    }
    if (req.headers['user-agent']) {
        LOG.info(`[HTTP REQ] User-Agent: ${req.headers['user-agent'].substring(0, 50)}...`);
    }

    const originalSend = res.send;
    const originalJson = res.json;
    let loggedDone = false;
    let loggedRes = false;
    const logDone = () => {
        if (loggedDone) return;
        loggedDone = true;
        const duration = Date.now() - start;
        const timing = req.dbTiming || { mysqlCount: 0, mysqlMs: 0 };
        logApiDone(req.method, url, duration, dbMode, timing.mysqlCount, timing.mysqlMs);
    };

    const logResponse = (data) => {
        if (loggedRes) return;
        loggedRes = true;
        const duration = Date.now() - start;
        const responseSize = typeof data === 'string' ? data.length : JSON.stringify(data || '').length;

        LOG.info(`[HTTP RES] ========================================`);
        LOG.info(`[HTTP RES] Request ID: ${requestId}`);
        LOG.info(`[HTTP RES] Method: ${req.method}`);
        LOG.info(`[HTTP RES] URL: ${url}`);
        LOG.info(`[HTTP RES] Status: ${res.statusCode} ${res.statusMessage || ''}`);
        LOG.info(`[HTTP RES] Duration: ${duration}ms`);
        LOG.info(`[HTTP RES] DB: ${dbMode}`);
        LOG.info(`[HTTP RES] Response Size: ${responseSize} bytes`);

        if (url.includes('/trading/')) {
            try {
                const responseData = typeof data === 'string' ? JSON.parse(data) : data;
                if (responseData) {
                    if (responseData.success !== undefined) {
                        LOG.info(`[HTTP RES] Success: ${responseData.success}`);
                    }
                    if (responseData.data) {
                        LOG.info(`[HTTP RES] Data Type: ${Array.isArray(responseData.data) ? `Array[${responseData.data.length}]` : typeof responseData.data}`);
                        if (Array.isArray(responseData.data) && responseData.data.length > 0) {
                            LOG.info(`[HTTP RES] First Item: ${JSON.stringify(responseData.data[0]).substring(0, 300)}`);
                        } else if (responseData.data && typeof responseData.data === 'object') {
                            LOG.info(`[HTTP RES] Data Keys: ${Object.keys(responseData.data).join(', ')}`);
                            LOG.info(`[HTTP RES] Data Sample: ${JSON.stringify(responseData.data).substring(0, 300)}`);
                        }
                    }
                    if (responseData.error) {
                        LOG.error(`[HTTP RES] Error: ${responseData.error}`);
                    }
                }
            } catch (e) {
                // Not JSON, skip
            }
        }

        LOG.info(`[HTTP RES] ========================================`);
        logDone();
    };

    res.send = function(data) {
        logResponse(data);
        return originalSend.call(this, data);
    };

    res.json = function(data) {
        logResponse(data);
        return originalJson.call(this, data);
    };

    res.on('finish', logDone);

    next();
};

module.exports = requestLogger;
