/**
 * AUTO-SYNC SERVICE
 * Keeps syncing until sync_module_state shows all modules SUCCESS.
 * Empty or incomplete table → auto sync + retry until complete.
 */
const cron = require('node-cron');
const LOG = require('../utils/logger');
const { syncAllToMysql } = require('../syncAllToMysql');
const syncStatus = require('./syncStatusService');

let syncSchedule = null;
let isSyncRunning = false;
let completionLoopRunning = false;

const RETRY_DELAY_MS = parseInt(process.env.SYNC_RETRY_DELAY_MS, 10) || 60000;
const MAX_SYNC_ATTEMPTS = parseInt(process.env.SYNC_MAX_ATTEMPTS, 10) || 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const mysqlConfigured = () => !!(process.env.DB_HOST || process.env.DB_NAME);

async function runSyncAttempt(triggerSource, { forceFull = false } = {}) {
    if (isSyncRunning) {
        LOG.warning('[AutoSync] Sync already in progress');
        return false;
    }
    isSyncRunning = true;
    try {
        await syncAllToMysql({ triggerSource, forceFull });
        return true;
    } catch (err) {
        LOG.error('[AutoSync] Sync attempt failed:', err.message);
        return false;
    } finally {
        isSyncRunning = false;
    }
}

/**
 * Run sync repeatedly (resume mode) until all modules SUCCESS or max attempts.
 * Does not block — safe to call without await from server startup.
 */
async function syncUntilComplete(triggerSource = 'startup') {
    if (!mysqlConfigured()) return;
    if (completionLoopRunning) {
        LOG.info('[AutoSync] Completion loop already running');
        return;
    }

    completionLoopRunning = true;
    try {
        await syncStatus.init();

        if (!(await syncStatus.needsSync())) {
            LOG.info('[AutoSync] All modules already synced — nothing to do');
            return;
        }

        LOG.info('[AutoSync] Sync incomplete — auto-retry until all modules complete');
        let attempt = 0;

        while (await syncStatus.needsSync()) {
            attempt += 1;
            if (MAX_SYNC_ATTEMPTS > 0 && attempt > MAX_SYNC_ATTEMPTS) {
                LOG.warning(`[AutoSync] Stopped after ${MAX_SYNC_ATTEMPTS} attempts (still incomplete)`);
                break;
            }

            const src = attempt === 1 ? triggerSource : 'auto-retry';
            LOG.info(`[AutoSync] Attempt ${attempt} (${src})...`);
            await runSyncAttempt(src, { forceFull: false });

            if (await syncStatus.isSyncComplete()) {
                const state = await syncStatus.getModuleState();
                syncStatus.printSummary(state.modules, state.summary);
                LOG.success('[AutoSync] All modules synced successfully');
                return;
            }

            const state = await syncStatus.getModuleState();
            LOG.warning(
                `[AutoSync] Progress: ${state.summary.done}/${state.summary.total} done, `
                + `${state.summary.pending} pending, ${state.summary.failed} failed — `
                + `retry in ${Math.round(RETRY_DELAY_MS / 1000)}s`
            );
            await sleep(RETRY_DELAY_MS);
        }
    } finally {
        completionLoopRunning = false;
    }
}

const startAutoSync = (intervalMinutes = 30) => {
    if (syncSchedule) {
        LOG.warning('[AutoSync] Sync schedule already running');
        return;
    }

    const cronExpression = `*/${intervalMinutes} * * * *`;
    LOG.info(`[AutoSync] Schedule every ${intervalMinutes} min (runs only while sync incomplete)`);

    syncSchedule = cron.schedule(cronExpression, async () => {
        if (!mysqlConfigured()) return;
        try {
            await syncStatus.init();
            if (await syncStatus.isSyncComplete()) {
                LOG.info('[AutoSync] Cron: all modules complete — skip');
                return;
            }
            LOG.info('[AutoSync] Cron: sync still incomplete — resuming');
            await syncUntilComplete('cron');
        } catch (err) {
            LOG.error('[AutoSync] Cron sync error:', err.message);
        }
    });
};

const stopAutoSync = () => {
    if (syncSchedule) {
        syncSchedule.stop();
        syncSchedule = null;
        LOG.info('[AutoSync] Auto-sync schedule stopped');
    }
};

/** Non-blocking: starts background sync-until-complete after server is up. */
const syncOnStartup = (enabled = true) => {
    if (!enabled || !mysqlConfigured()) return;

    LOG.info('[AutoSync] Checking sync_module_state on startup...');
    syncUntilComplete('startup').catch((err) => {
        LOG.error('[AutoSync] Startup sync loop error:', err.message);
    });
};

module.exports = {
    startAutoSync,
    stopAutoSync,
    syncOnStartup,
    syncUntilComplete,
    runSyncAttempt,
    isSyncRunning: () => isSyncRunning || completionLoopRunning,
};
