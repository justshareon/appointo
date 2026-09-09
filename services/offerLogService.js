/**
 * Offer / marketplace diagnostic log for super-admin APS dashboard.
 */
const path = require('path');
const { createDiagnosticLogStore } = require('../utils/diagnosticLogStore');

const MAX_ENTRIES = 300;
const LOG_FILE = path.join(__dirname, '..', 'offer-diagnostics.log');
const GEO_PROBE_SCOPES = ['local', 'town', 'city', 'state', 'All'];

const store = createDiagnosticLogStore({
  logFile: LOG_FILE,
  maxEntries: MAX_ENTRIES,
  dateFields: ['at'],
});

function normalizeLevel(level) {
  const l = String(level || 'L3').toUpperCase();
  if (l === 'L1' || l === 'L2' || l === 'L3') return l;
  return 'L3';
}

function recordOfferLog(payload = {}) {
  const level = normalizeLevel(payload.level);
  const entry = {
    id: `ol_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    level,
    stage: String(payload.stage || 'general').slice(0, 32),
    message: String(payload.message || 'Offer event').slice(0, 500),
    meta: payload.meta && typeof payload.meta === 'object' ? payload.meta : null,
    at: new Date().toISOString(),
  };
  return store.append(entry);
}

function getOfferLogs(limit = 50) {
  return store.getEntries(limit);
}

function purgeOfferLogs() {
  return store.purgeExpired();
}

function countSliceItems(slice = {}) {
  return (slice.deals?.length || 0) + (slice.vendors?.length || 0) + (slice.products?.length || 0);
}

async function buildOfferSnapshot() {
  const settingsService = require('./settingsService');
  const offerSourcesService = require('./offerSourcesService');
  const settings = await settingsService.getSettings();
  const { sources, totalAllSources } = await offerSourcesService.getOfferSources();
  const enabledSources = sources.filter((s) => s && s.enabled !== false);

  let dealsCount = 0;
  let vendorsCount = 0;
  let dealsError = null;
  try {
    const dealsService = require('../dealsService');
    const db = require('../database');
    const deals = await dealsService.getDealsFromDB({ limit: 100 });
    dealsCount = (deals || []).length;
    const vendors = await db.getVendors(true, 1, 40, 'newest', '', true, 'offer');
    vendorsCount = (vendors || []).filter(
      (v) => v.features_offer === true || v.features_offer === 1 || v.features_offer === '1'
    ).length;
  } catch (err) {
    dealsError = err.message;
  }

  const issues = [];
  if (dealsCount === 0 && vendorsCount === 0) {
    issues.push({ level: 'L1', message: 'No deals or offer vendors in DB — run deals sync or seed vendors' });
  } else if (dealsCount === 0) {
    issues.push({ level: 'L2', message: 'deals table empty — marketplace slice may show vendors only' });
  }
  if (enabledSources.length === 0) {
    issues.push({ level: 'L2', message: 'No enabled offer RSS sources in trade_news_sources' });
  }
  if (dealsError) {
    issues.push({ level: 'L1', message: `Offer DB read failed: ${dealsError}` });
  }

  const recentL1 = getOfferLogs(80).filter((l) => l.level === 'L1').length;

  return {
    dealsCount,
    vendorsCount,
    sourcesTotal: sources.length,
    sourcesEnabled: enabledSources.length,
    allSourcesTotal: totalAllSources,
    defaultCity: settings.news_default_city || '',
    defaultLocality: settings.news_default_locality || '',
    recentL1Logs: recentL1,
    issues,
    checkedAt: new Date().toISOString(),
  };
}

async function probeOfferPipeline() {
  const settingsService = require('./settingsService');
  const marketplaceSliceService = require('./marketplaceSliceService');
  const settings = await settingsService.getSettings();

  recordOfferLog({ level: 'L3', stage: 'probe', message: 'Offer probe started by super-admin' });

  const snapshot = await buildOfferSnapshot();
  recordOfferLog({
    level: snapshot.dealsCount || snapshot.vendorsCount ? 'L3' : 'L1',
    stage: 'config',
    message: `DB: ${snapshot.dealsCount} deal(s) · ${snapshot.vendorsCount} offer vendor(s) · ${snapshot.sourcesEnabled} RSS source(s)`,
    meta: {
      dealsCount: snapshot.dealsCount,
      vendorsCount: snapshot.vendorsCount,
      sourcesEnabled: snapshot.sourcesEnabled,
    },
  });

  const locationCtx = {
    city: settings.news_default_city || 'Delhi',
    town: settings.news_default_locality || '',
    locality: settings.news_default_locality || '',
    state: settings.news_default_state || '',
    language: settings.gnews_language || 'hi',
  };

  for (const probeScope of GEO_PROBE_SCOPES) {
    try {
      const slice = await marketplaceSliceService.getSlice({
        scope: probeScope,
        category: 'all',
        type: 'all',
        sources: 'deals,vendors',
        limit: 20,
        city: locationCtx.city,
        town: locationCtx.town,
        locality: locationCtx.locality,
        state: locationCtx.state,
        language: locationCtx.language,
        refresh: true,
      });
      const count = countSliceItems(slice);
      recordOfferLog({
        level: count ? 'L3' : 'L2',
        stage: 'probe_scope',
        message: `Probe ${probeScope}: ${count} item(s) · resolved=${slice.resolvedScope || probeScope} · attempts=${slice.fetchAttempts || 1}`,
        meta: {
          scope: probeScope,
          resolvedScope: slice.resolvedScope || probeScope,
          itemCount: count,
          deals: slice.deals?.length || 0,
          vendors: slice.vendors?.length || 0,
          city: locationCtx.city,
          locality: locationCtx.locality,
        },
      });
    } catch (err) {
      recordOfferLog({
        level: 'L1',
        stage: 'probe_scope',
        message: `Probe ${probeScope} failed: ${err.message}`,
        meta: { scope: probeScope, city: locationCtx.city },
      });
    }
  }

  recordOfferLog({ level: 'L3', stage: 'probe', message: 'Offer probe finished' });
  return {
    snapshot: await buildOfferSnapshot(),
    logs: getOfferLogs(50),
  };
}

function offerLogsToIssues(logs = []) {
  return [...logs]
    .filter((l) => l.level === 'L1' || l.level === 'L2')
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
    .slice(0, 20)
    .map((l) => ({
      severity: l.level === 'L1' ? 'critical' : 'warning',
      level: l.level,
      module: 'offers',
      message: `[${l.stage}] ${l.message}`,
      source: 'offer_log',
      at: l.at,
    }));
}

function getLevelSummary(logs = []) {
  const counts = { L1: 0, L2: 0, L3: 0 };
  logs.forEach((l) => {
    if (counts[l.level] != null) counts[l.level] += 1;
  });
  return counts;
}

module.exports = {
  recordOfferLog,
  getOfferLogs,
  purgeOfferLogs,
  buildOfferSnapshot,
  probeOfferPipeline,
  offerLogsToIssues,
  getLevelSummary,
  GEO_PROBE_SCOPES,
};
