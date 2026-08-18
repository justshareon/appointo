const jwt = require('jsonwebtoken');
const LOG = require('../utils/logger');

const OPTIONAL_AUTH_PATHS = ['/me', '/user', '/mapped-vendors'];

function isOptionalAuthPath(req) {
    const path = `${req.originalUrl || ''} ${req.path || ''}`;
    return OPTIONAL_AUTH_PATHS.some((p) => path.includes(p));
}

/**
 * Authentication middleware
 * Verifies JWT token from Authorization header
 */
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        if (!isOptionalAuthPath(req)) {
            LOG.error("Access Denied", "No Authorization token provided");
        }
        return res.status(401).json({ error: 'Unauthorized' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'secret', (err, user) => {
        if (err) {
            if (!isOptionalAuthPath(req)) {
                LOG.error("Token Verification Failed", `${err.message} (Secret: ${process.env.JWT_SECRET ? 'Env Set' : 'Default/Fallback'})`);
            }
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

module.exports = { authenticateToken };
