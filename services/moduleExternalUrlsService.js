/**
 * Module-wise external URL configuration for super-admin.
 * List modules without URLs; load/save URLs only after a module is selected.
 */
const settingsService = require('./settingsService');
const offerSourcesService = require('./offerSourcesService');
const apiConfigService = require('./trustScore/apiConfigService');

const MODULES = [
  { id: 'trust_score', label: 'Trust Score', description: 'RERA & authority API endpoints', icon: 'star-check' },
  { id: 'cyber', label: 'Cyber / Suraksha', description: 'Threat intelligence RSS feeds', icon: 'shield-check' },
  { id: 'offer', label: 'Offers', description: 'Deal & coupon RSS feeds', icon: 'tag' },
  { id: 'news', label: 'News', description: 'News & category RSS feeds', icon: 'newspaper' },
  { id: 'trade', label: 'Trading', description: 'Market data source URLs', icon: 'chart-line' },
];

const DEFAULT_CYBER_SOURCES = [
  { id: 'cyber_cisa', name: 'CISA Alerts', url: 'https://www.cisa.gov/news-events/cybersecurity-advisories/rss.xml', type: 'rss', enabled: true },
  { id: 'cyber_us_cert', name: 'US-CERT', url: 'https://www.us-cert.gov/ncas/alerts.xml', type: 'rss', enabled: true },
  { id: 'cyber_krebs', name: 'Krebs on Security', url: 'https://krebsonsecurity.com/feed/', type: 'rss', enabled: true },
  { id: 'cyber_bleeping', name: 'Bleeping Computer', url: 'https://www.bleepingcomputer.com/feed/', type: 'rss', enabled: true },
  { id: 'cyber_hacker_news', name: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews', type: 'rss', enabled: true },
];

const DEFAULT_TRADE_SOURCES = [
  { id: 'trade_yahoo', name: 'Yahoo Finance API', url: 'https://query1.finance.yahoo.com/v8/finance/chart/', type: 'api', enabled: false, category: 'market_data' },
  { id: 'trade_excel', name: 'Excel sync file', url: './India_Stock_Market_Tracker_v1.0.xlsx', type: 'file', enabled: true, category: 'excel' },
];

function parseSources(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeEntry(row, idx, moduleId) {
  return {
    id: row.id || `${moduleId}_src_${idx}`,
    name: row.name || row.authority_name || row.id || 'External source',
    url: row.url || row.base_url || '',
    type: row.type || 'rss',
    enabled: row.enabled !== false && row.is_enabled !== false,
    category: row.category || row.authority_type || null,
    country: row.country || null,
    description: row.description || null,
  };
}

function isNewsSourceRow(row) {
  const cat = String(row?.category || '').toLowerCase();
  const name = String(row?.name || '').toLowerCase();
  if (offerSourcesService.OFFER_CATEGORY_KEYS.has(cat)) return false;
  if (/deal|coupon|offer|sale|discount|slick|flipkart|amazon|zomato|swiggy/i.test(name)) return false;
  return true;
}

function listModules() {
  return { modules: MODULES };
}

async function getCyberSources() {
  const settings = await settingsService.getSettings();
  const rows = parseSources(settings.cyber_threat_sources);
  const sources = (rows.length ? rows : DEFAULT_CYBER_SOURCES).map((row, idx) =>
    normalizeEntry(row, idx, 'cyber')
  );
  return { module: 'cyber', sources, settingsKey: 'cyber_threat_sources' };
}

async function getNewsSources() {
  const settings = await settingsService.getSettings();
  const all = parseSources(settings.trade_news_sources);
  const sources = all.filter(isNewsSourceRow).map((row, idx) => normalizeEntry(row, idx, 'news'));
  return { module: 'news', sources, settingsKey: 'trade_news_sources' };
}

async function getTradeSources() {
  const settings = await settingsService.getSettings();
  const rows = parseSources(settings.trading_external_urls);
  const sources = (rows.length ? rows : DEFAULT_TRADE_SOURCES).map((row, idx) =>
    normalizeEntry(row, idx, 'trade')
  );
  return { module: 'trade', sources, settingsKey: 'trading_external_urls' };
}

async function getTrustScoreSources() {
  await apiConfigService.initializeTable();
  const configs = await apiConfigService.getAllConfigs();
  const sources = (configs || []).map((row, idx) => ({
    id: row.id,
    name: row.authority_name || row.id,
    url: row.base_url || '',
    type: 'api',
    enabled: row.is_enabled !== false && row.is_enabled !== 0,
    category: row.authority_type || 'OTHER',
    description: row.description || '',
    authType: row.auth_type || 'Bearer',
    useApi: row.use_api !== false,
  }));
  return { module: 'trust_score', sources, storage: 'trust_score_api_configs' };
}

async function getModuleUrls(moduleId) {
  const id = String(moduleId || '').toLowerCase();
  switch (id) {
    case 'trust_score':
      return getTrustScoreSources();
    case 'cyber':
      return getCyberSources();
    case 'offer': {
      const data = await offerSourcesService.getOfferSources();
      return { module: 'offer', sources: data.sources || [], settingsKey: data.settingsKey };
    }
    case 'news':
      return getNewsSources();
    case 'trade':
      return getTradeSources();
    default:
      throw new Error(`Unknown module: ${moduleId}`);
  }
}

async function mergeSettingsSources(settingsKey, filterFn, sources = [], defaultCategory = 'global_news') {
  const settings = await settingsService.getSettings();
  const all = parseSources(settings[settingsKey]);
  const kept = all.filter((row) => !filterFn(row));
  const byId = new Map(kept.map((row) => [String(row.id), row]));

  (sources || []).forEach((patch) => {
    if (patch?._delete) {
      byId.delete(String(patch.id || ''));
      return;
    }
    let id = String(patch.id || '').trim();
    if (!id || id.startsWith('new_')) {
      id = `${settingsKey}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    }
    const prev = byId.get(id) || { id };
    byId.set(id, {
      ...prev,
      ...patch,
      id,
      enabled: patch.enabled !== false,
      url: String(patch.url || prev.url || '').trim(),
      name: String(patch.name || prev.name || id).trim(),
      type: patch.type || prev.type || 'rss',
      category: patch.category || prev.category || defaultCategory,
      country: patch.country || prev.country || 'IN',
    });
  });

  await settingsService.updateSettings({ [settingsKey]: [...byId.values()] });
}

async function updateTrustScoreSources(sources = []) {
  await apiConfigService.initializeTable();
  for (const patch of sources || []) {
    if (patch?._delete) {
      if (patch.id) await apiConfigService.deleteConfig(patch.id);
      continue;
    }
    let id = String(patch.id || '').trim();
    const isNew = !id || id.startsWith('new_');
    if (isNew) {
      id = `api_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await apiConfigService.createConfig({
        id,
        authority_name: patch.name || 'Authority API',
        authority_type: patch.category || 'OTHER',
        base_url: patch.url || '',
        auth_type: patch.authType || 'Bearer',
        is_enabled: patch.enabled !== false,
        use_api: patch.useApi !== false,
        description: patch.description || '',
      });
      continue;
    }
    const prev = await apiConfigService.getConfigById(id);
    if (!prev) continue;
    await apiConfigService.updateConfig(id, {
      authority_name: patch.name || prev.authority_name,
      authority_type: patch.category || prev.authority_type,
      base_url: patch.url != null ? patch.url : prev.base_url,
      is_enabled: patch.enabled !== undefined ? patch.enabled : prev.is_enabled,
      use_api: patch.useApi !== undefined ? patch.useApi : prev.use_api,
      description: patch.description != null ? patch.description : prev.description,
    });
  }
  return getTrustScoreSources();
}

async function updateCyberSources(sources = []) {
  const settings = await settingsService.getSettings();
  const current = parseSources(settings.cyber_threat_sources);
  const base = current.length ? current : DEFAULT_CYBER_SOURCES;
  const byId = new Map(base.map((row) => [String(row.id), row]));

  (sources || []).forEach((patch) => {
    if (patch?._delete) {
      byId.delete(String(patch.id || ''));
      return;
    }
    let id = String(patch.id || '').trim();
    if (!id || id.startsWith('new_')) {
      id = `cyber_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    }
    const prev = byId.get(id) || { id };
    byId.set(id, {
      ...prev,
      ...patch,
      id,
      enabled: patch.enabled !== false,
      url: String(patch.url || prev.url || '').trim(),
      name: String(patch.name || prev.name || id).trim(),
      type: patch.type || prev.type || 'rss',
    });
  });

  await settingsService.updateSettings({ cyber_threat_sources: [...byId.values()] });
  return getCyberSources();
}

async function updateNewsSources(sources = []) {
  await mergeSettingsSources(
    'trade_news_sources',
    isNewsSourceRow,
    sources,
    'global_news'
  );
  return getNewsSources();
}

async function updateTradeSources(sources = []) {
  const settings = await settingsService.getSettings();
  const current = parseSources(settings.trading_external_urls);
  const base = current.length ? current : DEFAULT_TRADE_SOURCES;
  const byId = new Map(base.map((row) => [String(row.id), row]));

  (sources || []).forEach((patch) => {
    if (patch?._delete) {
      byId.delete(String(patch.id || ''));
      return;
    }
    let id = String(patch.id || '').trim();
    if (!id || id.startsWith('new_')) {
      id = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    }
    const prev = byId.get(id) || { id };
    byId.set(id, {
      ...prev,
      ...patch,
      id,
      enabled: patch.enabled !== false,
      url: String(patch.url || prev.url || '').trim(),
      name: String(patch.name || prev.name || id).trim(),
      type: patch.type || prev.type || 'api',
      category: patch.category || prev.category || 'market_data',
    });
  });

  await settingsService.updateSettings({ trading_external_urls: [...byId.values()] });
  return getTradeSources();
}

async function updateModuleUrls(moduleId, sources = []) {
  const id = String(moduleId || '').toLowerCase();
  switch (id) {
    case 'trust_score':
      return updateTrustScoreSources(sources);
    case 'cyber':
      return updateCyberSources(sources);
    case 'offer':
      await offerSourcesService.updateOfferSources(sources);
      return getModuleUrls('offer');
    case 'news':
      return updateNewsSources(sources);
    case 'trade':
      return updateTradeSources(sources);
    default:
      throw new Error(`Unknown module: ${moduleId}`);
  }
}

async function getCyberThreatSourcesForScan() {
  const { sources } = await getCyberSources();
  return (sources || [])
    .filter((row) => row.enabled !== false)
    .map((row) => ({
      name: row.name,
      url: row.url,
      type: row.type || 'rss',
      enabled: true,
    }));
}

module.exports = {
  MODULES,
  listModules,
  getModuleUrls,
  updateModuleUrls,
  getCyberThreatSourcesForScan,
  DEFAULT_CYBER_SOURCES,
};
