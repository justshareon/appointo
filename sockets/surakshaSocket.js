/**
 * Suraksha Socket.IO Handler
 * Handles real-time fraud alerts and validation updates
 */
const jwt = require('jsonwebtoken');
const LOG = require('../utils/logger');

/**
 * Setup Suraksha Socket.IO handlers
 * @param {Server} io - Socket.IO server instance
 */
function setupSurakshaSocket(io) {
    // Authentication middleware for Socket.IO
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
        
        if (!token) {
            return next(new Error('Authentication error: No token provided'));
        }
        
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
            socket.userId = decoded.id;
            socket.userEmail = decoded.email;
            next();
        } catch (err) {
            LOG.error('[Suraksha Socket] JWT verification failed:', err.message);
            next(new Error('Authentication error: Invalid token'));
        }
    });
    
    io.on('connection', (socket) => {
        const userId = socket.userId;
        const userRoom = `user_${userId}`;
        
        LOG.info(`[Suraksha Socket] User connected: ${userId} (${socket.userEmail})`);
        
        // Join user's personal room
        socket.join(userRoom);
        LOG.info(`[Suraksha Socket] User ${userId} joined room: ${userRoom}`);
        
        // Handle validation request (optional - can also use HTTP)
        socket.on('request_validation', async (data) => {
            try {
                const { input, type } = data;
                
                if (!input || !type) {
                    socket.emit('error', { message: 'Input and type are required' });
                    return;
                }
                
                // Emit pending status immediately
                socket.emit('validation_update', {
                    requestId: `val_${Date.now()}`,
                    status: 'pending',
                    message: 'Validation in progress...'
                });
                
                // Note: Actual validation should be done via HTTP endpoint
                // This is just for WebSocket-based requests
                LOG.info(`[Suraksha Socket] Validation requested by ${userId}: ${type} - ${input}`);
            } catch (error) {
                LOG.error('[Suraksha Socket] Validation request error:', error);
                socket.emit('error', { message: error.message });
            }
        });
        
        // Handle periodic SIM check request
        socket.on('check_sims', async (data) => {
            try {
                const { aadhaar } = data;
                LOG.info(`[Suraksha Socket] SIM check requested by ${userId}`);
                
                // Note: Actual check should be done via HTTP endpoint
                // This is just for WebSocket-based requests
            } catch (error) {
                LOG.error('[Suraksha Socket] SIM check error:', error);
                socket.emit('error', { message: error.message });
            }
        });
        
        // Handle disconnect
        socket.on('disconnect', () => {
            LOG.info(`[Suraksha Socket] User disconnected: ${userId}`);
        });
        
        // Handle errors
        socket.on('error', (error) => {
            LOG.error(`[Suraksha Socket] Socket error for user ${userId}:`, error);
        });
    });
    
    LOG.success('[Suraksha Socket] Socket.IO handlers initialized');
}

module.exports = setupSurakshaSocket;

