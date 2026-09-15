/**
 * Super-admin APS: switch active reads between MySQL and in-memory.
 * On toggle, syncs recent activity both ways before applying mode.
 */
const settingsService = require('./settingsService');
const LOG = require('../utils/logger');
const { resolveDbType, isMysqlConfigured } = require('../utils/resolveDbType');
const {
    SETTINGS_KEY,
    getRuntimeDbType,
    setRuntimeDbType,
    getRuntimeOverride,
} = require('../utils/runtimeDbType');

const { APS_ACTIVITY_SYNC_HOURS } = require('../syncLast3Hours');
const DEFAULT_SYNC_HOURS = APS_ACTIVITY_SYNC_HOURS;

async function loadPersistedMode() {
    try {
        const settings = await settingsService.getSettings();
        const persisted = String(settings?.[SETTINGS_KEY] || '').trim().toLowerCase();
        if (persisted === 'mysql' || persisted === 'inmemory') {
            if (persisted === 'mysql' && !isMysqlConfigured()) {
                LOG.warning('[RuntimeDB] Persisted mysql mode but MySQL not configured — using inmemory');
                setRuntimeDbType('inmemory');
                return { mode: 'inmemory', source: 'persisted_fallback' };
            }
            setRuntimeDbType(persisted);
            LOG.info(`[RuntimeDB] Restored APS mode: ${persisted}`);
            return { mode: persisted, source: 'persisted' };
        }
    } catch (err) {
        LOG.warning(`[RuntimeDB] loadPersistedMode: ${err.message}`);
    }
    return { mode: getRuntimeDbType(), source: 'env' };
}

function getStatus() {
    return {
        mode: getRuntimeDbType(),
        override: getRuntimeOverride(),
        envDefault: resolveDbType(),
        mysqlConfigured: isMysqlConfigured(),
        syncHoursDefault: DEFAULT_SYNC_HOURS,
    };
}

/**
 * @param {'mysql'|'inmemory'} mode
 * @param {{ syncHours?: number }} opts
 */
async function applyRuntimeDbMode(mode, { syncHours = DEFAULT_SYNC_HOURS } = {}) {
    const next = String(mode || '').trim().toLowerCase();
    if (next !== 'mysql' && next !== 'inmemory') {
        throw new Error('mode must be mysql or inmemory');
    }
    if (next === 'mysql' && !isMysqlConfigured()) {
        throw new Error('MySQL is not configured (DB_HOST / DB_NAME in .env)');
    }

    const hours = Math.min(Math.max(parseInt(syncHours, 10) || DEFAULT_SYNC_HOURS, 1), 168);
    let sync = null;

    if (isMysqlConfigured()) {
        LOG.info(`[RuntimeDB] Syncing last ${hours}h memory ↔ MySQL before mode=${next}`);
        const { runSyncLast3Hours } = require('../syncLast3Hours');
        sync = await runSyncLast3Hours({ hours });
    } else {
        sync = { skipped: true, reason: 'mysql_not_configured' };
    }

    await settingsService.updateSettings({ [SETTINGS_KEY]: next });
    setRuntimeDbType(next);

    LOG.success(`[RuntimeDB] Active storage mode → ${next} (sync ${hours}h done)`);

    return {
        ...getStatus(),
        sync,
        syncHours: hours,
    };
}

async function revalidateRecentActivity({ hours = DEFAULT_SYNC_HOURS } = {}) {
    if (!isMysqlConfigured()) {
        return { skipped: true, reason: 'mysql_not_configured', hours: 0 };
    }
    const { revalidateRecentActivity: runRecent } = require('../syncLast3Hours');
    const sync = await runRecent({ hours });
    LOG.info(`[RuntimeDB] Revalidated last ${hours}h activity: ${JSON.stringify(sync)}`);
    return sync;
}

module.exports = {
    loadPersistedMode,
    getStatus,
    applyRuntimeDbMode,
    revalidateRecentActivity,
    DEFAULT_SYNC_HOURS,
};
