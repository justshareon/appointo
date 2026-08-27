/**
 * If MySQL sync is incomplete, kick off background sync-until-complete on API traffic.
 * Debounced so it does not fire on every request.
 */
const LOG = require('../utils/logger');

const { isMysqlConfigured } = require('../utils/resolveDbType');

const DEBOUNCE_MS = parseInt(process.env.SYNC_ENSURE_DEBOUNCE_MS, 10) || 30000;
let lastTriggeredAt = 0;

function ensureSyncOnLoadMiddleware(req, res, next) {
    if (!isMysqlConfigured()) return next();
    if (req.path.startsWith('/api/sync')) return next();

    const now = Date.now();
    if (now - lastTriggeredAt < DEBOUNCE_MS) return next();

    lastTriggeredAt = now;

    Promise.resolve()
        .then(async () => {
            const syncStatus = require('../services/syncStatusService');
            const { syncUntilComplete, isSyncRunning } = require('../services/autoSyncService');
            await syncStatus.init();
            if (!(await syncStatus.needsSync())) return;
            if (isSyncRunning()) return;
            LOG.info('[EnsureSync] API request — sync incomplete, resuming until complete');
            await syncUntilComplete('api-request');
        })
        .catch((err) => {
            LOG.warning(`[EnsureSync] middleware: ${err.message}`);
        });

    next();
}

module.exports = ensureSyncOnLoadMiddleware;
