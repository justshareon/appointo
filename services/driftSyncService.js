/**
 * Ongoing in-memory ↔ MySQL drift sync (users, vendors, mappings, recent activity).
 * Runs automatically on a schedule and on API traffic when bulk sync is already complete.
 */
const LOG = require('../utils/logger');
const { isMysqlConfigured } = require('../utils/resolveDbType');

let driftRunning = false;
let lastDriftAt = 0;
const DRIFT_DEBOUNCE_MS = parseInt(process.env.SYNC_DRIFT_DEBOUNCE_MS, 10) || 2 * 60 * 1000;

async function runDriftSync(triggerSource = 'auto') {
  if (!isMysqlConfigured()) {
    return { ok: true, skipped: true, reason: 'mysql_not_configured' };
  }

  const now = Date.now();
  if (driftRunning) {
    return { ok: true, skipped: true, reason: 'in_progress' };
  }
  if (now - lastDriftAt < DRIFT_DEBOUNCE_MS) {
    return { ok: true, skipped: true, reason: 'debounced' };
  }

  driftRunning = true;
  lastDriftAt = now;

  try {
    LOG.info(`[DriftSync] Starting memory ↔ MySQL alignment (${triggerSource})`);

    const db = require('../database');
    if (typeof db.ensureAllUsersAndVendors === 'function') {
      await db.ensureAllUsersAndVendors();
    }

    const { syncVendors, syncUserVendorMappings } = require('../syncAllToMysql');
    const vendorResult = await syncVendors();
    const mappingResult = await syncUserVendorMappings();

    const { syncLast3Hours } = require('../syncLast3Hours');
    const recent = await syncLast3Hours({ exit: false });

    const { hydrateOnStartup } = require('./dbHydrateService');
    const hydrate = await hydrateOnStartup();

    LOG.success(
      `[DriftSync] Done (${triggerSource}) — vendors:${vendorResult?.itemsSynced ?? 0} `
      + `mappings:${mappingResult?.itemsSynced ?? 0} recent:${JSON.stringify(recent || {})}`
    );

    return {
      ok: true,
      vendors: vendorResult?.itemsSynced ?? 0,
      mappings: mappingResult?.itemsSynced ?? 0,
      recent,
      hydrate,
    };
  } catch (err) {
    LOG.error(`[DriftSync] Failed (${triggerSource}):`, err.message);
    return { ok: false, error: err.message };
  } finally {
    driftRunning = false;
  }
}

function isDriftRunning() {
  return driftRunning;
}

module.exports = { runDriftSync, isDriftRunning };
