/**
 * Transient MySQL / DNS errors — safe to retry after a delay.
 */
const TRANSIENT_CODES = new Set([
    'ENOTFOUND',
    'EAI_AGAIN',
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'EPIPE',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'PROTOCOL_CONNECTION_LOST',
    'PROTOCOL_ENQUEUE_AFTER_QUIT',
    'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
]);

function isTransientConnectionError(err) {
    if (!err) return false;
    if (TRANSIENT_CODES.has(err.code) || TRANSIENT_CODES.has(String(err.errno))) return true;
    const msg = String(err.message || err);
    return /getaddrinfo|Pool is closed|pool is closed|Cannot enqueue|Connection lost|server closed the connection|socket has been ended|closed state/i.test(msg);
}

module.exports = {
    TRANSIENT_CODES,
    isTransientConnectionError,
};
