/**
 * SGATE live stream retention — super_admin setting smart_live_retention_days (default 1).
 */
const LOG = require('../utils/logger');

const CACHE_MS = 30 * 1000;
let cachedRetentionDays = 1;
let cachedAt = 0;

function parseRetentionDays(raw) {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 365);
}

function getSmartLiveRetentionDaysSync() {
  if (Date.now() - cachedAt > CACHE_MS) {
    refreshSmartLiveSettings().catch((err) => {
      LOG.warning('[SmartLiveSettings] background refresh failed:', err.message);
    });
  }
  return cachedRetentionDays;
}

async function refreshSmartLiveSettings() {
  try {
    const settingsService = require('./settingsService');
    const s = await settingsService.getSettings();
    cachedRetentionDays = parseRetentionDays(
      s.smart_live_retention_days ?? process.env.SMART_LIVE_RETENTION_DAYS
    );
  } catch (err) {
    const env = parseInt(process.env.SMART_LIVE_RETENTION_DAYS || '1', 10);
    cachedRetentionDays = parseRetentionDays(env);
  }
  cachedAt = Date.now();
  return { retentionDays: cachedRetentionDays };
}

function applySmartLiveSettingsPatch(patch = {}) {
  if (patch.smart_live_retention_days !== undefined && patch.smart_live_retention_days !== null) {
    cachedRetentionDays = parseRetentionDays(patch.smart_live_retention_days);
    cachedAt = Date.now();
  }
}

module.exports = {
  getSmartLiveRetentionDaysSync,
  refreshSmartLiveSettings,
  applySmartLiveSettingsPatch,
  parseRetentionDays,
};
