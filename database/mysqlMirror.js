/**
 * Dual-write helper: keep MySQL populated while the app runs in-memory.
 * Reads stay in-memory until DB_TYPE=mysql. Writes are mirrored when DB_HOST is set.
 */
const fcm = require('./featureConnectionManager');
const LOG = {
    warning: (msg, d = '') => console.warn(`[MySQL Mirror] ${msg}`, d),
};

let mirrorPoolPromise = null;

async function getMirrorPool() {
    if (!fcm.isMysqlConfigured()) return null;
    const cached = fcm.getCachedPool('core') || fcm.getPool();
    if (cached) return cached;
    if (!mirrorPoolPromise) {
        mirrorPoolPromise = fcm.acquireForSync('core').catch((err) => {
            mirrorPoolPromise = null;
            LOG.warning('Could not open mirror pool', err.message);
            return null;
        });
    }
    return mirrorPoolPromise;
}

async function mirrorQuery(sql, params) {
    try {
        const pool = await getMirrorPool();
        if (!pool) return;
        await pool.query(sql, params);
    } catch (err) {
        LOG.warning(err.message);
    }
}

module.exports = { getMirrorPool, mirrorQuery };
