const db = require('../database');
const LOG = require('../utils/logger');

/**
 * Request logging middleware
 * Logs all incoming requests with duration
 */
const requestLogger = (req, res, next) => {
    // Basic health check endpoint - skip logging to reduce noise
    if (req.url === '/' && req.method === 'GET') {
        return next();
    }
    
    // Performance log check
    if (db.LOG_CONFIG && !db.LOG_CONFIG.ENABLED) return next();

    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        const color = res.statusCode >= 400 ? "\x1b[31m" : "\x1b[32m"; // Red for error, Green for success
        console.log(`${color}[REQ] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)\x1b[0m`);
    });
    next();
};

module.exports = requestLogger;

