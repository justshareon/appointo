/**
 * AUTO-SYNC SERVICE
 * Keeps syncing until sync_module_state shows all modules SUCCESS.
 * Empty or incomplete table → auto sync + retry until complete.
 */
const cron = require('node-cron');
const LOG = require('../utils/logger');
const { syncAllToMysql } = require('../syncAllToMysql');
const syncStatus = require('./syncStatusService');
const { isMysqlConfigured } = require('../utils/resolveDbType');
const { hydrateOnStartup } = require('./dbHydrateService');
const { runDriftSync } = require('./driftSyncService');

let syncSchedule = null;
let driftSchedule = null;
let isSyncRunning = false;
let completionLoopRunning = false;

const RETRY_DELAY_MS = parseInt(process.env.SYNC_RETRY_DELAY_MS, 10) || 60000;
const MAX_SYNC_ATTEMPTS = parseInt(process.env.SYNC_MAX_ATTEMPTS, 10) || 0;
const AUTO_DRIFT_SYNC = process.env.AUTO_DRIFT_SYNC !== 'false';
const DRIFT_INTERVAL_MINUTES = parseInt(process.env.SYNC_DRIFT_INTERVAL_MINUTES, 10)
  || parseInt(process.env.SYNC_INTERVAL_MINUTES, 10)
  || 15;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runSyncAttempt(triggerSource, { forceFull = false } = {}) {
    if (isSyncRunning) {
        LOG.warning('[AutoSync] Sync already in progress');
        return { ok: false, skipped: true, reason: 'in_progress' };
    }
    isSyncRunning = true;
    try {
        const result = await syncAllToMysql({ triggerSource, forceFull });
        return { ok: true, result };
    } catch (err) {
        LOG.error('[AutoSync] Sync attempt failed:', err.message);
        return { ok: false, error: err.message };
    } finally {
        isSyncRunning = false;
    }
}

/**
 * Run sync repeatedly (resume mode) until all modules SUCCESS or max attempts.
 * Does not block — safe to call without await from server startup.
 */
async function syncUntilComplete(triggerSource = 'startup') {
    if (!isMysqlConfigured()) return;
    if (completionLoopRunning) {
        LOG.info('[AutoSync] Completion loop already running');
        return;
    }

    completionLoopRunning = true;
    try {
        await syncStatus.init();

        if (!(await syncStatus.needsSync())) {
            LOG.info('[AutoSync] All modules already synced — hydrating from MySQL');
            await hydrateOnStartup().catch((err) => {
                LOG.warning('[AutoSync] Post-sync hydrate skipped:', err.message);
            });
            if (AUTO_DRIFT_SYNC) {
                runDriftSync('startup-complete').catch((err) => {
                    LOG.warning('[AutoSync] Startup drift sync skipped:', err.message);
                });
            }
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
                await hydrateOnStartup().catch((err) => {
                    LOG.warning('[AutoSync] Post-sync hydrate skipped:', err.message);
                });
                if (AUTO_DRIFT_SYNC) {
                    await runDriftSync('bulk-complete').catch((err) => {
                        LOG.warning('[AutoSync] Post-bulk drift sync skipped:', err.message);
                    });
                }
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
    LOG.info(`[AutoSync] Bulk-resume schedule every ${intervalMinutes} min (while sync incomplete)`);

    syncSchedule = cron.schedule(cronExpression, async () => {
        if (!isMysqlConfigured()) return;
        try {
            await syncStatus.init();
            if (await syncStatus.isSyncComplete()) {
                LOG.info('[AutoSync] Cron: bulk sync complete — skip resume loop');
                return;
            }
            LOG.info('[AutoSync] Cron: sync still incomplete — resuming');
            await syncUntilComplete('cron');
        } catch (err) {
            LOG.error('[AutoSync] Cron sync error:', err.message);
        }
    });

    if (AUTO_DRIFT_SYNC) {
        startDriftSync(DRIFT_INTERVAL_MINUTES);
    }
};

const startDriftSync = (intervalMinutes = DRIFT_INTERVAL_MINUTES) => {
    if (driftSchedule) return;
    const mins = Math.max(5, intervalMinutes || DRIFT_INTERVAL_MINUTES);
    const cronExpression = `*/${mins} * * * *`;
    LOG.info(`[AutoSync] Drift sync every ${mins} min (memory ↔ MySQL)`);
    driftSchedule = cron.schedule(cronExpression, async () => {
        if (!isMysqlConfigured()) return;
        try {
            await syncStatus.init();
            if (!(await syncStatus.isSyncComplete())) {
                LOG.info('[AutoSync] Drift cron: bulk sync incomplete — deferring');
                return;
            }
            await runDriftSync('cron');
        } catch (err) {
            LOG.error('[AutoSync] Drift cron error:', err.message);
        }
    });
};

const stopAutoSync = () => {
    if (syncSchedule) {
        syncSchedule.stop();
        syncSchedule = null;
        LOG.info('[AutoSync] Auto-sync schedule stopped');
    }
    if (driftSchedule) {
        driftSchedule.stop();
        driftSchedule = null;
        LOG.info('[AutoSync] Drift sync schedule stopped');
    }
};

const syncOnStartup = (enabled = true) => {
    if (!enabled || !isMysqlConfigured()) return;

    LOG.info('[AutoSync] Checking sync_module_state on startup...');
    hydrateOnStartup().catch((err) => {
        LOG.warning('[AutoSync] Initial hydrate skipped:', err.message);
    });
    syncUntilComplete('startup').catch((err) => {
        LOG.error('[AutoSync] Startup sync loop error:', err.message);
    });
};

module.exports = {
    startAutoSync,
    startDriftSync,
    stopAutoSync,
    syncOnStartup,
    syncUntilComplete,
    runSyncAttempt,
    isSyncRunning: () => isSyncRunning || completionLoopRunning,
};
