/**
 * Offer feed URLs — RSS/API sources super-admin can view and edit.
 */
const settingsService = require('./settingsService');

const OFFER_CATEGORY_KEYS = new Set([
  'food_coupons',
  'trending_deals',
  'trending_offer',
  'new_offer',
  'coupons',
  'deals',
  'local_offers',
  'travel',
]);

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

function isOfferSource(row) {
  const cat = String(row?.category || '').toLowerCase();
  const name = String(row?.name || '').toLowerCase();
  if (OFFER_CATEGORY_KEYS.has(cat)) return true;
  return /deal|coupon|offer|sale|discount|slick|flipkart|amazon|zomato|swiggy/i.test(name);
}

async function getOfferSources() {
  const settings = await settingsService.getSettings();
  const all = parseSources(settings.trade_news_sources);
  const offerSources = all.filter(isOfferSource).map((row, idx) => ({
    id: row.id || `offer_src_${idx}`,
    name: row.name || row.id || 'Offer feed',
    url: row.url || '',
    type: row.type || 'rss',
    enabled: row.enabled !== false,
    category: row.category || 'trending_deals',
    country: row.country || 'IN',
  }));
  return {
    sources: offerSources,
    totalAllSources: all.length,
    settingsKey: 'trade_news_sources',
  };
}

async function updateOfferSources(sources = []) {
  const settings = await settingsService.getSettings();
  const all = parseSources(settings.trade_news_sources);
  const byId = new Map(all.map((row) => [String(row.id), row]));

  (sources || []).forEach((patch) => {
    if (patch?._delete) {
      byId.delete(String(patch.id || ''));
      return;
    }
    let id = String(patch.id || '').trim();
    if (!id || id.startsWith('new_')) {
      id = `offer_src_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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
      category: patch.category || prev.category || 'trending_deals',
      country: patch.country || prev.country || 'IN',
    });
  });

  const merged = [...byId.values()];
  await settingsService.updateSettings({ trade_news_sources: merged });
  return getOfferSources();
}

module.exports = {
  getOfferSources,
  updateOfferSources,
  OFFER_CATEGORY_KEYS,
};
