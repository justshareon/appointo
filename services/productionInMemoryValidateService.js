/**
 * In-memory release checks (news, offer, trade, SMART, R-Detector) — used by CLI and super-admin API.
 */
const {
  setRuntimeDbType,
  getRuntimeDbType,
  getRuntimeOverride,
  clearRuntimeDbTypeOverride,
} = require('../utils/runtimeDbType');

async function runProductionInMemoryValidation() {
  const checks = [];
  let failed = 0;

  const record = (ok, name, detail) => {
    checks.push({ ok, name, detail: detail || null });
    if (!ok) failed += 1;
  };

  const prev = getRuntimeOverride();
  setRuntimeDbType('inmemory');

  try {
    if (getRuntimeDbType() !== 'inmemory') {
      record(false, 'runtime DB', `expected inmemory, got ${getRuntimeDbType()}`);
    } else {
      record(true, 'runtime DB', 'inmemory');
    }

    const db = require('../database');
    if (db.getType?.() !== 'inmemory') {
      record(false, 'database.getType', String(db.getType?.()));
    } else {
      record(true, 'database.getType', 'inmemory');
    }

    const settings = await db.getSettings();
    const flags = [
      ['enable_news', 'news'],
      ['enable_offer', 'offers'],
      ['enable_trade', 'trading'],
      ['enable_smart', 'SMART'],
      ['enable_r_detector', 'R-Detector'],
    ];
    for (const [key, label] of flags) {
      const on = settings[key] !== false && String(settings[key] || 'true').toLowerCase() !== 'false';
      record(on, `${label} flag`, on ? key : `${key} off`);
    }

    try {
      const newsLogService = require('./newsLogService');
      const snap = await newsLogService.buildNewsSnapshot();
      record(true, 'news snapshot', `enable=${!!snap?.enableNews} cache=${snap?.cacheCount ?? '?'}`);
    } catch (e) {
      record(false, 'news snapshot', e.message);
    }

    try {
      const offerLogService = require('./offerLogService');
      const snap = await offerLogService.buildOfferSnapshot();
      record(true, 'offer snapshot', `deals=${snap?.dealsCount ?? '?'}`);
    } catch (e) {
      record(false, 'offer snapshot', e.message);
    }

    try {
      const stockDataService = require('./stockDataService');
      record(!!stockDataService, 'trading stockDataService', stockDataService ? 'loaded' : 'missing');
    } catch (e) {
      record(false, 'trading stockDataService', e.message);
    }

    try {
      const smartService = require('./smartService');
      const ok =
        typeof smartService.listNearbyDevices === 'function'
        || typeof smartService.getStatus === 'function'
        || !!smartService;
      record(ok, 'smart service', ok ? 'loaded' : 'missing');
    } catch (e) {
      record(false, 'smart service', e.message);
    }

    try {
      const rDetectorService = require('./rDetectorService');
      const ok =
        typeof rDetectorService.getRecentScans === 'function'
        || typeof rDetectorService.listIncidents === 'function'
        || !!rDetectorService;
      record(ok, 'r-detector service', ok ? 'loaded' : 'missing');
    } catch (e) {
      record(false, 'r-detector service', e.message);
    }

    try {
      const { clearAllApsLogs } = require('./apsLogClearService');
      record(typeof clearAllApsLogs === 'function', 'apsLogClearService', 'ready');
    } catch (e) {
      record(false, 'apsLogClearService', e.message);
    }

    try {
      const { getSystemHealth, HEALTH_SCOPES } = require('./systemHealthService');
      const health = await getSystemHealth({ scopes: ['modules'] });
      for (const k of ['newsLogs', 'offerLogs', 'featureScanLogs', 'tradingExcelLogs', 'moduleReports']) {
        if (health[k] !== undefined) {
          record(true, `health.modules.${k}`, Array.isArray(health[k]) ? `${health[k].length} rows` : 'ok');
        } else {
          record(false, `health.modules.${k}`, 'missing');
        }
      }
      record(HEALTH_SCOPES?.includes('trading'), 'HEALTH_SCOPES', HEALTH_SCOPES?.includes('trading') ? 'includes trading' : 'missing trading');
    } catch (e) {
      record(false, 'getSystemHealth(modules)', e.message);
    }
  } finally {
    if (prev === 'mysql' || prev === 'inmemory') setRuntimeDbType(prev);
    else clearRuntimeDbTypeOverride();
  }

  const passed = checks.filter((c) => c.ok).length;
  return {
    success: failed === 0,
    failed,
    passed,
    total: checks.length,
    checks,
    at: new Date().toISOString(),
  };
}

module.exports = { runProductionInMemoryValidation };
