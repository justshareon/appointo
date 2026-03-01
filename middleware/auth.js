const jwt = require('jsonwebtoken');
const LOG = require('../utils/logger');

/**
 * Authentication middleware
 * Verifies JWT token from Authorization header
 */
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        // Suppress error logging for /vendors/me endpoint when token is missing (expected behavior)
        const isVendorMeEndpoint = req.path === '/api/vendors/me';
        if (!isVendorMeEndpoint) {
            LOG.error("Access Denied", "No Authorization token provided");
        }
        return res.sendStatus(401);
    }

    jwt.verify(token, process.env.JWT_SECRET || 'secret', (err, user) => {
        if (err) {
            LOG.error("Token Verification Failed", `${err.message} (Secret: ${process.env.JWT_SECRET ? 'Env Set' : 'Default/Fallback'})`);
            return res.sendStatus(403);
        }
        req.user = user;
        next();
    });
};

module.exports = { authenticateToken };

