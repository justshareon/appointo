/**
 * Rate Limiter Middleware
 * Prevents abuse of validation endpoints
 */
const LOG = require('../utils/logger');

// In-memory store for rate limiting (use Redis in production)
const rateLimitStore = new Map();

/**
 * Rate limiter middleware
 * @param {Object} options - Rate limit options
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.max - Maximum requests per window
 */
function rateLimiter(options = {}) {
    const windowMs = options.windowMs || 60000; // 1 minute default
    const max = options.max || 10; // 10 requests default
    
    return (req, res, next) => {
        const userId = req.user?.id || req.ip; // Use IP if no user
        const key = `rate_limit_${userId}`;
        
        const now = Date.now();
        const record = rateLimitStore.get(key);
        
        if (!record || now - record.resetTime > windowMs) {
            // New window
            rateLimitStore.set(key, {
                count: 1,
                resetTime: now
            });
            return next();
        }
        
        if (record.count >= max) {
            LOG.warning(`Rate limit exceeded for ${userId}`);
            return res.status(429).json({
                error: 'Too many requests',
                message: `Rate limit exceeded. Maximum ${max} requests per ${windowMs / 1000} seconds.`,
                retryAfter: Math.ceil((windowMs - (now - record.resetTime)) / 1000)
            });
        }
        
        // Increment count
        record.count++;
        rateLimitStore.set(key, record);
        
        // Set rate limit headers
        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', max - record.count);
        res.setHeader('X-RateLimit-Reset', new Date(record.resetTime + windowMs).toISOString());
        
        next();
    };
}

/**
 * Clean up old rate limit records periodically
 */
setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
        if (now - record.resetTime > 600000) { // 10 minutes
            rateLimitStore.delete(key);
        }
    }
}, 60000); // Clean every minute

module.exports = rateLimiter;

