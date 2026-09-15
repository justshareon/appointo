/**
 * Super-admin: wipe APS / module diagnostic logs (not live business data).
 */
const { truncateAllAppLogs } = require('../utils/appLogFiles');
const { purgeErrorLogOlderThan } = require('../utils/errorLogRetention');
const LOG = require('../utils/logger');

function clearStore(name, fn) {
  try {
    const kept = fn?.();
    return { ok: true, kept: typeof kept === 'number' ? kept : 0 };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function clearAllApsLogs() {
  const result = {
    at: new Date().toISOString(),
    appLogFiles: truncateAllAppLogs(),
    errorLogPurge: purgeErrorLogOlderThan(0),
    news: clearStore('news', () => {
      const svc = require('./newsLogService');
      return svc.clearNewsLogs?.() ?? svc.purgeNewsLogs?.();
    }),
    offers: clearStore('offers', () => {
      const svc = require('./offerLogService');
      return svc.clearOfferLogs?.() ?? svc.purgeOfferLogs?.();
    }),
    featureScan: clearStore('featureScan', () => {
      const svc = require('./featureScanLogService');
      return svc.clearFeatureScanLogs?.() ?? svc.purgeFeatureScanLogs?.();
    }),
    moduleDiagnostics: clearStore('moduleDiagnostics', () => {
      const svc = require('./moduleDiagnosticLogService');
      return svc.clearModuleDiagnostics?.() ?? svc.purgeModuleDiagnostics?.();
    }),
    clientErrors: clearStore('clientErrors', () => {
      const svc = require('./clientErrorService');
      return svc.clearClientErrors?.() ?? svc.purgeClientErrors?.();
    }),
    tradingExcel: clearStore('tradingExcel', () => {
      const log = require('../utils/tradingExcelLog');
      log.clear();
      return 0;
    }),
    vendorAuto: clearStore('vendorAuto', () => {
      const { clearVendorAutoLogs } = require('../utils/vendorAutoLog');
      return clearVendorAutoLogs?.() ?? 0;
    }),
  };

  LOG.info('[APS] Cleared diagnostic logs (super-admin)');
  return result;
}

module.exports = { clearAllApsLogs };
