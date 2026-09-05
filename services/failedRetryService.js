/**
 * Retry failed MySQL sync modules and background jobs every 5 minutes (configurable).
 * Only re-runs entries that previously failed — successful modules are untouched.
 */
const cron = require('node-cron');
const LOG = require('../utils/logger');
const { isMysqlConfigured } = require('../utils/resolveDbType');

const RETRY_INTERVAL_MS = parseInt(process.env.MYSQL_RETRY_DELAY_MS, 10)
    || parseInt(process.env.SYNC_RETRY_DELAY_MS, 10)
    || 300000;

/** @type {Map<string, { label: string, fn: Function, retryAfter: number, attempts: number }>} */
const jobQueue = new Map();
let cronTask = null;
let running = false;

function scheduleJobRetry(id, label, fn) {
    const prev = jobQueue.get(id);
    const attempts = (prev?.attempts || 0) + 1;
    jobQueue.set(id, {
        label,
        fn,
        retryAfter: Date.now() + RETRY_INTERVAL_MS,
        attempts,
    });
    LOG.info(
        `[FailedRetry] Queued "${label}" — retry #${attempts} in ${Math.round(RETRY_INTERVAL_MS / 60000)} min`
    );
}

async function tryReconnectMysql() {
    if (!isMysqlConfigured()) return false;
    try {
        const fcm = require('../database/featureConnectionManager');
        await fcm.acquireForSync('core');
        return true;
    } catch (err) {
        LOG.warning(`[FailedRetry] MySQL reconnect failed: ${err.message}`);
        return false;
    }
}

async function retryFailedSyncModules() {
    const syncStatus = require('./syncStatusService');
    try {
        await syncStatus.init();
    } catch (err) {
        LOG.warning(`[FailedRetry] sync status init skipped: ${err.message}`);
        return { retried: 0 };
    }

    const keys = await syncStatus.getFailedModuleKeys();
    if (!keys.length) return { retried: 0 };

    const { syncAllToMysql } = require('../syncAllToMysql');
    LOG.info(`[FailedRetry] Retrying ${keys.length} failed sync module(s): ${keys.join(', ')}`);
    await syncAllToMysql({ triggerSource: 'auto-failed-retry', failedOnly: true });
    return { retried: keys.length };
}

async function processFailedRetries() {
    if (!isMysqlConfigured()) return;
    if (running) {
        LOG.info('[FailedRetry] Retry pass already running — skip');
        return;
    }

    running = true;
    try {
        await tryReconnectMysql();
        await retryFailedSyncModules();

        const now = Date.now();
        for (const [id, job] of [...jobQueue.entries()]) {
            if (now < job.retryAfter) continue;
            try {
                await job.fn();
                jobQueue.delete(id);
                LOG.success(`[FailedRetry] "${job.label}" succeeded on retry #${job.attempts}`);
            } catch (err) {
                job.retryAfter = now + RETRY_INTERVAL_MS;
                LOG.warning(
                    `[FailedRetry] "${job.label}" still failing: ${err.message} — `
                    + `next try in ${Math.round(RETRY_INTERVAL_MS / 60000)} min`
                );
            }
        }
    } catch (err) {
        LOG.error('[FailedRetry] Process error:', err.message);
    } finally {
        running = false;
    }
}

function startFailedRetryCron() {
    if (cronTask || !isMysqlConfigured()) return;
    const mins = Math.max(1, Math.round(RETRY_INTERVAL_MS / 60000));
    const cronExpr = mins >= 60 ? `0 */${Math.max(1, Math.floor(mins / 60))} * * *` : `*/${mins} * * * *`;
    LOG.info(`[FailedRetry] Auto-retry failed entries every ${mins} min`);
    cronTask = cron.schedule(cronExpr, () => {
        processFailedRetries().catch((err) => LOG.error('[FailedRetry] Cron error:', err.message));
    });
}

function stopFailedRetryCron() {
    if (cronTask) {
        cronTask.stop();
        cronTask = null;
    }
}

module.exports = {
    RETRY_INTERVAL_MS,
    scheduleJobRetry,
    processFailedRetries,
    startFailedRetryCron,
    stopFailedRetryCron,
};
