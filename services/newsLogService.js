/**
 * News pipeline diagnostic log for super-admin APS dashboard.
 * Records slice/refresh/RSS/location/config events in a ring buffer + disk tail.
 */
const path = require('path');
const { createDiagnosticLogStore } = require('../utils/diagnosticLogStore');

const MAX_ENTRIES = 300;
const LOG_FILE = path.join(__dirname, '..', 'news-diagnostics.log');
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

function recordNewsLog(payload = {}) {
  const level = normalizeLevel(payload.level);
  const entry = {
    id: `nl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    level,
    stage: String(payload.stage || 'general').slice(0, 32),
    message: String(payload.message || 'News event').slice(0, 500),
    meta: payload.meta && typeof payload.meta === 'object' ? payload.meta : null,
    at: new Date().toISOString(),
  };

  return store.append(entry);
}

function getNewsLogs(limit = 50) {
  return store.getEntries(limit);
}

function purgeNewsLogs() {
  return store.purgeExpired();
}

function parseSources(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function countSliceItems(slice = {}) {
  const cats = slice.categories || [];
  return cats.reduce((n, c) => n + (c.items || []).length, 0);
}

function maskKey(val) {
  const s = String(val || '').trim();
  if (!s) return null;
  if (s.length <= 6) return '***';
  return `${s.slice(0, 3)}…${s.slice(-3)}`;
}

async function buildNewsSnapshot() {
  const settingsService = require('./settingsService');
  const settings = await settingsService.getSettings();
  const sources = parseSources(settings.trade_news_sources);
  const enabledSources = sources.filter((s) => s && s.enabled !== false);

  let cacheCount = 0;
  let cacheError = null;
  try {
    const db = require('../database');
    const items = await db.getNewsItems(500);
    cacheCount = (items || []).length;
  } catch (err) {
    cacheError = err.message;
  }

  const issues = [];
  if (!settings.enable_news) {
    issues.push({ level: 'L1', message: 'enable_news is OFF — news disabled system-wide' });
  }
  if (enabledSources.length === 0) {
    issues.push({ level: 'L1', message: 'No enabled trade_news_sources — RSS feeds not configured' });
  }
  if (cacheCount === 0) {
    issues.push({ level: 'L2', message: 'news_cache is empty — run probe or share refresh=1 slice' });
  }
  if (cacheError) {
    issues.push({ level: 'L1', message: `News cache read failed: ${cacheError}` });
  }

  const recentL1 = getNewsLogs(80).filter((l) => l.level === 'L1').length;

  return {
    enableNews: !!settings.enable_news,
    cacheCount,
    cacheLastUpdated: settings.news_cache_last_updated || null,
    sourcesTotal: sources.length,
    sourcesEnabled: enabledSources.length,
    sourceTypes: [...new Set(enabledSources.map((s) => (s.type || 'rss').toLowerCase()))],
    tradeNewsSource: settings.trade_news_source || 'rss',
    hasTelegram: !!(settings.telegram_bot_token && settings.telegram_channel),
    hasGnewsKey: !!settings.gnews_api_key,
    hasNewsApiKey: !!settings.newsapi_api_key,
    gnewsKeyPreview: maskKey(settings.gnews_api_key),
    newsApiKeyPreview: maskKey(settings.newsapi_api_key),
    defaultCity: settings.news_default_city || '',
    defaultLocality: settings.news_default_locality || '',
    recentL1Logs: recentL1,
    issues,
    checkedAt: new Date().toISOString(),
  };
}

async function probeNewsPipeline() {
  const settingsService = require('./settingsService');
  const newsCacheService = require('./newsCacheService');
  const rssNewsService = require('./rssNewsService');
  const settings = await settingsService.getSettings();

  recordNewsLog({ level: 'L3', stage: 'probe', message: 'News probe started by super-admin' });

  const snapshot = await buildNewsSnapshot();

  if (!settings.enable_news) {
    recordNewsLog({
      level: 'L1',
      stage: 'config',
      message: 'enable_news is OFF — all news API routes return empty/disabled',
    });
  } else {
    recordNewsLog({
      level: 'L3',
      stage: 'config',
      message: `enable_news ON · ${snapshot.sourcesEnabled} source(s) · cache ${snapshot.cacheCount} item(s)`,
      meta: { cacheCount: snapshot.cacheCount, sourcesEnabled: snapshot.sourcesEnabled },
    });
  }

  const sources = parseSources(settings.trade_news_sources).filter((s) => s && s.enabled !== false);
  for (const src of sources.slice(0, 8)) {
    const type = (src.type || 'rss').toLowerCase();
    if (type !== 'rss' && type !== 'api') {
      recordNewsLog({
        level: 'L3',
        stage: 'source',
        message: `Skipping live probe for ${type} source "${src.name || src.id}" (RSS-only probe)`,
        meta: { sourceId: src.id, type },
      });
      continue;
    }
    try {
      const res = await rssNewsService.fetchNews(src, settings, 8);
      const count = (res.items || []).length;
      recordNewsLog({
        level: count ? 'L3' : 'L2',
        stage: 'rss',
        message: `${src.name || src.id}: ${count} item(s)${res.error ? ` — ${res.error}` : ''}`,
        meta: { sourceId: src.id, url: src.url, count, error: res.error || null },
      });
    } catch (err) {
      recordNewsLog({
        level: 'L1',
        stage: 'rss',
        message: `${src.name || src.id}: fetch failed — ${err.message}`,
        meta: { sourceId: src.id, url: src.url },
      });
    }
  }

  if (settings.enable_news) {
    const locationCtx = {
      city: settings.news_default_city || 'Delhi',
      town: settings.news_default_locality || '',
      locality: settings.news_default_locality || '',
      state: settings.news_default_state || '',
      language: settings.gnews_language || 'hi',
    };
    const GEO_PROBE_SCOPES = ['local', 'town', 'city', 'state', 'All'];
    for (const probeScope of GEO_PROBE_SCOPES) {
      try {
        const slice = await newsCacheService.getSlice({
          scope: probeScope,
          category: 'All',
          limit: 15,
          locationCtx,
          settingsOverride: settings,
          refresh: true,
        });
        const count = countSliceItems(slice);
        recordNewsLog({
          level: count ? 'L3' : 'L2',
          stage: 'probe_scope',
          message: `Probe ${probeScope}: ${count} item(s) · attempts=${slice.fetchAttempts || 1}`,
          meta: {
            count,
            attempts: slice.fetchAttempts || 1,
            scope: probeScope,
            category: 'All',
            city: locationCtx.city,
            locality: locationCtx.locality,
          },
        });
      } catch (err) {
        recordNewsLog({
          level: 'L1',
          stage: 'probe_scope',
          message: `Probe ${probeScope} failed: ${err.message}`,
          meta: { scope: probeScope },
        });
      }
    }
  }

  recordNewsLog({ level: 'L3', stage: 'probe', message: 'News probe finished' });
  return {
    snapshot: await buildNewsSnapshot(),
    logs: getNewsLogs(40),
  };
}

function newsLogsToIssues(logs = []) {
  return [...logs]
    .filter((l) => l.level === 'L1' || l.level === 'L2')
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
    .slice(0, 20)
    .map((l) => ({
      severity: l.level === 'L1' ? 'critical' : 'warning',
      level: l.level,
      module: 'news',
      message: `[${l.stage}] ${l.message}`,
      source: 'news_log',
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
  recordNewsLog,
  getNewsLogs,
  purgeNewsLogs,
  buildNewsSnapshot,
  probeNewsPipeline,
  newsLogsToIssues,
  getLevelSummary,
};
