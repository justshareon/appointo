/**
 * After bulk MySQL sync — run release maintenance in one pass (super-admin “Sync now”).
 * Includes R-Detector ensure scripts + drift sync (last SYNC_RECENT_HOURS, default 2h).
 */
const LOG = require('../utils/logger');
const { isMysqlConfigured } = require('../utils/resolveDbType');
const { getRecentSyncHours } = require('../syncLast3Hours');

let lastMaintenance = null;

function getDriftSyncEnv() {
  const driftIntervalMinutes = parseInt(process.env.SYNC_DRIFT_INTERVAL_MINUTES, 10)
    || parseInt(process.env.SYNC_INTERVAL_MINUTES, 10)
    || 15;
  return {
    autoDriftSync: process.env.AUTO_DRIFT_SYNC !== 'false',
    driftIntervalMinutes: Math.max(5, driftIntervalMinutes),
    recentHours: getRecentSyncHours(),
    driftDebounceMs: parseInt(process.env.SYNC_DRIFT_DEBOUNCE_MS, 10) || 2 * 60 * 1000,
    envKeys: {
      AUTO_DRIFT_SYNC: 'true',
      SYNC_DRIFT_INTERVAL_MINUTES: String(Math.max(5, driftIntervalMinutes)),
      SYNC_RECENT_HOURS: String(getRecentSyncHours()),
    },
  };
}

function getLastMaintenanceResult() {
  return lastMaintenance;
}

/**
 * @param {string} triggerSource
 * @param {{ skipDrift?: boolean }} opts
 */
async function runReleaseMaintenanceSteps(triggerSource = 'auto', { skipDrift = false } = {}) {
  const env = getDriftSyncEnv();
  const startedAt = new Date().toISOString();
  const steps = [];

  const push = (name, ok, detail, extra = null) => {
    steps.push({ name, ok, detail: detail || null, at: new Date().toISOString(), ...extra });
  };

  if (!isMysqlConfigured()) {
    const result = {
      ok: true,
      skipped: true,
      reason: 'mysql_not_configured',
      triggerSource,
      startedAt,
      completedAt: new Date().toISOString(),
      env,
      steps,
    };
    lastMaintenance = result;
    return result;
  }

  try {
    const { ensureRDetectorCommute } = require('../ensureRDetectorCommute');
    const r = await ensureRDetectorCommute();
    push('ensure_r_detector_commute', true, JSON.stringify(r));
  } catch (err) {
    push('ensure_r_detector_commute', false, err.message);
  }

  try {
    const { ensureRDetectorScanResults } = require('../ensureRDetectorScanResults');
    const r = await ensureRDetectorScanResults();
    push('ensure_r_detector_scans', true, JSON.stringify(r));
  } catch (err) {
    push('ensure_r_detector_scans', false, err.message);
  }

  const runDrift = !skipDrift && env.autoDriftSync;
  if (runDrift) {
    try {
      const { runDriftSync } = require('./driftSyncService');
      const drift = await runDriftSync(`maintenance:${triggerSource}`);
      const ok = drift?.ok !== false && !drift?.error;
      push(
        'drift_recent_mysql',
        ok,
        drift?.skipped
          ? `skipped:${drift.reason || 'unknown'}`
          : `last ${env.recentHours}h · vendors/mappings/recent activity`,
        { drift, recentHours: env.recentHours }
      );
    } catch (err) {
      push('drift_recent_mysql', false, err.message, { recentHours: env.recentHours });
    }
  } else {
    push(
      'drift_recent_mysql',
      true,
      skipDrift ? 'skipped:skipDrift' : 'skipped:AUTO_DRIFT_SYNC=false',
      { skipped: true }
    );
  }

  try {
    const { syncSmartSettingsFromEnvAndValidate } = require('./smartSgateAdminService');
    const validation = await syncSmartSettingsFromEnvAndValidate();
    push(
      'validate_smart_sgate',
      validation.success,
      validation.message || `${validation.passed}/${validation.total}`,
      { validation }
    );
  } catch (err) {
    push('validate_smart_sgate', false, err.message);
  }

  const failed = steps.filter((s) => !s.ok).length;
  const result = {
    ok: failed === 0,
    skipped: false,
    triggerSource,
    startedAt,
    completedAt: new Date().toISOString(),
    env,
    steps,
    failed,
  };
  lastMaintenance = result;
  if (failed) {
    LOG.warning(`[SyncMaintenance] ${triggerSource} — ${failed} step(s) failed`);
  } else {
    LOG.success(
      `[SyncMaintenance] ${triggerSource} — release scripts + ${env.recentHours}h drift done`
    );
  }
  return result;
}

module.exports = {
  getDriftSyncEnv,
  getLastMaintenanceResult,
  runReleaseMaintenanceSteps,
};
