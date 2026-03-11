const db = require('../database');
const LOG = require('../utils/logger');

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
    
    // Log request details
    LOG.info(`[HTTP REQ] ========================================`);
    LOG.info(`[HTTP REQ] Request ID: ${requestId}`);
    LOG.info(`[HTTP REQ] Method: ${req.method}`);
    LOG.info(`[HTTP REQ] URL: ${req.originalUrl || req.url}`);
    LOG.info(`[HTTP REQ] Path: ${req.path}`);
    
    // Log query parameters
    if (Object.keys(req.query).length > 0) {
        LOG.info(`[HTTP REQ] Query Params: ${JSON.stringify(req.query)}`);
    }
    
    // Log request body (truncated if large)
    if (req.body && Object.keys(req.body).length > 0 && req.method !== 'GET') {
        const bodyStr = JSON.stringify(req.body);
        if (bodyStr.length > 1000) {
            LOG.info(`[HTTP REQ] Body: ${bodyStr.substring(0, 1000)}... (${bodyStr.length} chars total)`);
        } else {
            LOG.info(`[HTTP REQ] Body: ${JSON.stringify(req.body)}`);
        }
    }
    
    // Log headers (only important ones)
    if (req.headers.authorization) {
        LOG.info(`[HTTP REQ] Authorization: ${req.headers.authorization.substring(0, 20)}...`);
    }
    if (req.headers['user-agent']) {
        LOG.info(`[HTTP REQ] User-Agent: ${req.headers['user-agent'].substring(0, 50)}...`);
    }
    
    // Intercept response
    const originalSend = res.send;
    const originalJson = res.json;
    
    res.send = function(data) {
        const duration = Date.now() - start;
        const responseSize = typeof data === 'string' ? data.length : JSON.stringify(data).length;
        
        LOG.info(`[HTTP RES] ========================================`);
        LOG.info(`[HTTP RES] Request ID: ${requestId}`);
        LOG.info(`[HTTP RES] Method: ${req.method}`);
        LOG.info(`[HTTP RES] URL: ${req.originalUrl || req.url}`);
        LOG.info(`[HTTP RES] Status: ${res.statusCode} ${res.statusMessage || ''}`);
        LOG.info(`[HTTP RES] Duration: ${duration}ms`);
        LOG.info(`[HTTP RES] Response Size: ${responseSize} bytes`);
        
        // Log response data for trading routes
        if (req.originalUrl && req.originalUrl.includes('/trading/')) {
            try {
                const responseData = typeof data === 'string' ? JSON.parse(data) : data;
                if (responseData) {
                    if (responseData.success !== undefined) {
                        LOG.info(`[HTTP RES] Success: ${responseData.success}`);
                    }
                    if (responseData.data) {
                        const dataLength = Array.isArray(responseData.data) ? responseData.data.length : 'object';
                        LOG.info(`[HTTP RES] Data Type: ${Array.isArray(responseData.data) ? `Array[${responseData.data.length}]` : typeof responseData.data}`);
                        if (Array.isArray(responseData.data) && responseData.data.length > 0) {
                            LOG.info(`[HTTP RES] First Item: ${JSON.stringify(responseData.data[0]).substring(0, 300)}`);
                        } else if (responseData.data && typeof responseData.data === 'object') {
                            LOG.info(`[HTTP RES] Data Keys: ${Object.keys(responseData.data).join(', ')}`);
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
        originalSend.call(this, data);
    };
    
    res.json = function(data) {
        const duration = Date.now() - start;
        const responseSize = JSON.stringify(data).length;
        
        LOG.info(`[HTTP RES] ========================================`);
        LOG.info(`[HTTP RES] Request ID: ${requestId}`);
        LOG.info(`[HTTP RES] Method: ${req.method}`);
        LOG.info(`[HTTP RES] URL: ${req.originalUrl || req.url}`);
        LOG.info(`[HTTP RES] Status: ${res.statusCode} ${res.statusMessage || ''}`);
        LOG.info(`[HTTP RES] Duration: ${duration}ms`);
        LOG.info(`[HTTP RES] Response Size: ${responseSize} bytes`);
        
        // Log response data for trading routes
        if (req.originalUrl && req.originalUrl.includes('/trading/')) {
            if (data) {
                if (data.success !== undefined) {
                    LOG.info(`[HTTP RES] Success: ${data.success}`);
                }
                if (data.data) {
                    const dataLength = Array.isArray(data.data) ? data.data.length : 'object';
                    LOG.info(`[HTTP RES] Data Type: ${Array.isArray(data.data) ? `Array[${data.data.length}]` : typeof data.data}`);
                    if (Array.isArray(data.data) && data.data.length > 0) {
                        LOG.info(`[HTTP RES] First Item: ${JSON.stringify(data.data[0]).substring(0, 300)}`);
                    } else if (data.data && typeof data.data === 'object') {
                        LOG.info(`[HTTP RES] Data Keys: ${Object.keys(data.data).join(', ')}`);
                        LOG.info(`[HTTP RES] Data Sample: ${JSON.stringify(data.data).substring(0, 300)}`);
                    }
                }
                if (data.error) {
                    LOG.error(`[HTTP RES] Error: ${data.error}`);
                }
            }
        }
        
        LOG.info(`[HTTP RES] ========================================`);
        originalJson.call(this, data);
    };
    
    res.on('finish', () => {
        // Fallback logging if send/json weren't called
        if (!res.headersSent) {
            const duration = Date.now() - start;
            const color = res.statusCode >= 400 ? "\x1b[31m" : "\x1b[32m";
            console.log(`${color}[REQ] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)\x1b[0m`);
        }
    });
    
    next();
};

module.exports = requestLogger;

