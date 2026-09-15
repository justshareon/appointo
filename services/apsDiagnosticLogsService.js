/**
 * Super-admin — read, clear, and regenerate module / APS diagnostic logs.
 */
const { readAllAppLogTails } = require('../utils/appLogFiles');

async function getLatestDiagnosticLogs({ limit = 25 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 25, 5), 80);
  const newsLogService = require('./newsLogService');
  const offerLogService = require('./offerLogService');
  const featureScanLogService = require('./featureScanLogService');
  const moduleDiagnosticLogService = require('./moduleDiagnosticLogService');
  const clientErrorService = require('./clientErrorService');
  const tradingExcelLog = require('../utils/tradingExcelLog');
  const { getVendorAutoLogs } = require('../utils/vendorAutoLog');

  const newsLogs = newsLogService.getNewsLogs(n);
  const offerLogs = offerLogService.getOfferLogs(n);
  const featureScanLogs = featureScanLogService.getFeatureScanLogs(n);
  const moduleDiagnostics = moduleDiagnosticLogService.getModuleDiagnostics(n);
  const clientErrors = clientErrorService.getClientErrors(Math.min(n, 20));
  const tradingExcelLogs = tradingExcelLog.getRecent(n);
  const vendorAutoLogs = getVendorAutoLogs({ limit: n });
  const tails = readAllAppLogTails(Math.min(n, 30));

  return {
    at: new Date().toISOString(),
    counts: {
      news: newsLogs.length,
      offers: offerLogs.length,
      featureScan: featureScanLogs.length,
      moduleDiagnostics: moduleDiagnostics.length,
      clientErrors: clientErrors.length,
      tradingExcel: tradingExcelLogs.length,
      vendorAuto: vendorAutoLogs.length,
      backendInfo: tails.infoLog?.lines?.length || 0,
      backendError: tails.errorLog?.lines?.length || 0,
    },
    newsLogs,
    offerLogs,
    featureScanLogs,
    moduleDiagnostics,
    clientErrors,
    tradingExcelLogs,
    vendorAutoLogs,
    backend: {
      errorLog: tails.errorLog,
      infoLog: tails.infoLog,
      debugLog: tails.debugLog,
      uiLog: tails.uiLog,
    },
  };
}

async function regenerateDiagnosticLogs() {
  const steps = [];
  const pushStep = (name, ok, detail) => {
    steps.push({ name, ok, detail: detail || null, at: new Date().toISOString() });
  };

  try {
    const { probeNewsPipeline } = require('./newsLogService');
    await probeNewsPipeline();
    pushStep('news_probe', true, 'News pipeline probe completed');
  } catch (err) {
    pushStep('news_probe', false, err.message);
  }

  try {
    const { probeOfferPipeline } = require('./offerLogService');
    await probeOfferPipeline();
    pushStep('offer_probe', true, 'Offer pipeline probe completed');
  } catch (err) {
    pushStep('offer_probe', false, err.message);
  }

  try {
    const { pushVendorAutoLog } = require('../utils/vendorAutoLog');
    pushVendorAutoLog('info', 'Log regenerate requested (super-admin)', { source: 'aps_regenerate' });
    pushStep('vendor_auto', true, 'Vendor Auto log entry added');
  } catch (err) {
    pushStep('vendor_auto', false, err.message);
  }

  try {
    const tradingExcelLog = require('../utils/tradingExcelLog');
    tradingExcelLog.push('info', 'regenerate', 'Diagnostic regenerate ping (no Excel file touched)');
    pushStep('trading_excel', true, 'Trading Excel log entry added');
  } catch (err) {
    pushStep('trading_excel', false, err.message);
  }

  try {
    const { recordModuleDiagnostic } = require('./moduleDiagnosticLogService');
    recordModuleDiagnostic({
      module: 'core',
      kind: 'aps_regenerate',
      level: 'L3',
      message: 'Super-admin regenerated module diagnostic logs',
      screen: 'SuperAdminModules',
    });
    pushStep('module_diagnostic', true, 'Module diagnostic row recorded');
  } catch (err) {
    pushStep('module_diagnostic', false, err.message);
  }

  try {
    const { runProductionInMemoryValidation } = require('./productionInMemoryValidateService');
    const validation = await runProductionInMemoryValidation();
    pushStep(
      'validate_production',
      validation.success,
      `${validation.passed}/${validation.total} checks`
    );
  } catch (err) {
    pushStep('validate_production', false, err.message);
  }

  const logs = await getLatestDiagnosticLogs({ limit: 30 });
  return {
    at: new Date().toISOString(),
    steps,
    logs,
  };
}

module.exports = { getLatestDiagnosticLogs, regenerateDiagnosticLogs };
