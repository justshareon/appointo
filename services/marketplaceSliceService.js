/**
 * Lazy offer slices — MySQL + in-memory cache per scope/category/type.
 * Only fetches requested sources (deals | vendors | products).
 */
const dealsService = require('../dealsService');
const db = require('../database');
const productService = require('./productService');
const LOG = require('../utils/logger');

const { clampLimit, sortTodayRecentFirst, withinRecentDays } = require('../utils/recentSlice');

const sliceMem = new Map();
const SLICE_TTL_MS = 5 * 60 * 1000;
const MAX_SLICE_ATTEMPTS = parseInt(process.env.MARKETPLACE_SLICE_ATTEMPTS, 10)
  || parseInt(process.env.NEWS_SLICE_ATTEMPTS, 10)
  || 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const norm = (v) => String(v || '').trim().toLowerCase();

function sliceKey({ scope, category, type, sources, city, town, locality, state, language }) {
  return `${scope}|${category}|${type}|${sources}|${city}|${town}|${locality}|${state}|${language || 'hi'}`;
}

function inferCategory(raw) {
  const s = norm(raw);
  const map = [
    ['food', ['food', 'restaurant', 'cafe', 'pizza']],
    ['grocery', ['grocery', 'supermarket', 'mart']],
    ['fashion', ['fashion', 'apparel', 'clothing']],
    ['electronics', ['electronic', 'mobile', 'laptop']],
    ['travel', ['travel', 'flight', 'holiday']],
    ['health', ['health', 'hospital', 'clinic']],
    ['salon', ['salon', 'spa', 'hair']],
    ['home', ['home', 'furniture', 'decor']],
    ['beauty', ['beauty', 'cosmetic', 'makeup']],
    ['kids', ['kid', 'toy', 'baby']],
    ['sports', ['sport', 'fitness', 'gym']],
    ['hotel', ['hotel', 'stay', 'resort']],
    ['pharmacy', ['pharma', 'medicine', 'chemist']],
    ['auto', ['auto', 'car', 'bike']],
  ];
  for (const [key, needles] of map) {
    if (needles.some((n) => s.includes(n))) return key;
  }
  return 'food';
}

function inferType(text) {
  const blob = String(text || '');
  if (/flash|lightning/i.test(blob)) return 'flash';
  if (/bogo|buy\s*1/i.test(blob)) return 'bogo';
  if (/cashback/i.test(blob)) return 'cashback';
  if (/festival|diwali|holi/i.test(blob)) return 'festival';
  if (/daily deal|deal of the day/i.test(blob)) return 'daily';
  if (/bank|upi|card offer/i.test(blob)) return 'bank';
  if (/combo|bundle/i.test(blob)) return 'combo';
  if (/new user|first order/i.test(blob)) return 'new_user';
  if (/flat\s+\d|₹\s*\d+/i.test(blob)) return 'flat';
  if (/\d+\s*%/.test(blob)) return 'percent';
  return 'percent';
}

function rowBlob(row) {
  return norm(`${row?.location_name || ''} ${row?.city || ''} ${row?.location || ''} ${row?.state || ''} ${row?.shop_name || ''} ${row?.name || ''}`);
}

function matchesScope(row, scope, ctx) {
  if (!scope || scope === 'All') return true;
  const city = norm(ctx.city);
  const town = norm(ctx.town || ctx.locality);
  const locality = norm(ctx.locality || ctx.town);
  const state = norm(ctx.state);
  const blob = rowBlob(row);
  const itemScope = norm(row.scope);

  if (scope === 'international') {
    return norm(row.country || 'in') !== 'in' || itemScope === 'international';
  }
  if (scope === 'national') {
    return norm(row.country || 'in') === 'in' || !row.country || itemScope === 'national';
  }
  if (scope === 'state') {
    return itemScope === 'state' || (state && blob.includes(state));
  }
  if (scope === 'city') {
    return itemScope === 'city' || (city && blob.includes(city));
  }
  if (scope === 'town') {
    if (itemScope === 'town' || itemScope === 'local') return true;
    if (town && blob.includes(town)) return true;
    return false;
  }
  if (scope === 'local') {
    if (row.is_local || itemScope === 'local') return true;
    if (locality && blob.includes(locality)) return true;
    if (town && blob.includes(town)) return true;
    return !city || blob.includes(city);
  }
  return true;
}

function hasDevanagari(text) {
  return /[\u0900-\u097F]/.test(String(text || ''));
}

function inferRowLanguage(row) {
  const explicit = norm(row?.language || row?.lang);
  if (explicit) return explicit;
  const blob = `${row?.title || ''} ${row?.offer || ''} ${row?.current_offer || ''} ${row?.name || ''} ${row?.description || ''}`;
  if (hasDevanagari(blob)) return 'hi';
  return '';
}

function filterByLanguage(rows, language) {
  const lang = norm(language || 'hi');
  const list = Array.isArray(rows) ? rows : [];
  if (lang === 'all') return list;

  const primary = list.filter((row) => {
    const itemLang = inferRowLanguage(row);
    if (!itemLang) return true;
    if (lang === itemLang) return true;
    if (lang === 'hi' && itemLang === 'hi') return true;
    return false;
  });

  if (lang === 'hi') {
    if (primary.length >= 1) return primary;
    const english = list.filter((row) => {
      const itemLang = inferRowLanguage(row);
      return itemLang === 'en' || itemLang === '';
    });
    const seen = new Set();
    return [...primary, ...english].filter((row) => {
      const key = row.id || row.shop_name || row.title;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return primary.length ? primary : list;
}

const SCOPE_RANK = { local: 0, town: 1, city: 2, district: 3, state: 4, national: 5, international: 6 };

function classifyRowScope(row, ctx) {
  const blob = rowBlob(row);
  const city = norm(ctx.city);
  const town = norm(ctx.town || ctx.locality);
  const locality = norm(ctx.locality || ctx.town);
  const state = norm(ctx.state);
  if (row.is_local) return 'local';
  if (locality && blob.includes(locality)) return 'local';
  if (town && blob.includes(town)) return 'town';
  if (city && blob.includes(city)) return 'city';
  if (state && blob.includes(state)) return 'state';
  if (norm(row.country || 'in') !== 'in') return 'international';
  return 'national';
}

function orderRowsByGeoScope(rows, ctx) {
  return [...(rows || [])].sort((a, b) => {
    const ra = SCOPE_RANK[classifyRowScope(a, ctx)] ?? 5;
    const rb = SCOPE_RANK[classifyRowScope(b, ctx)] ?? 5;
    return ra - rb;
  });
}

function filterRows(rows, { category, type, scope, ctx, language }) {
  let list = Array.isArray(rows) ? rows : [];
  if (category && category !== 'all') {
    list = list.filter((r) => inferCategory(r.category || r.shop_name || r.name || r.title) === category);
  }
  if (type && type !== 'all') {
    list = list.filter((r) => {
      const blob = `${r.offer || ''} ${r.current_offer || ''} ${r.discount_text_raw || ''} ${r.title || ''}`;
      return inferType(blob) === type;
    });
  }
  list = filterByLanguage(list, language);
  if (scope && scope !== 'All') {
    list = list.filter((r) => matchesScope(r, scope, ctx));
    if (!list.length) {
      list = filterByLanguage(Array.isArray(rows) ? rows : [], language);
    }
  }
  return orderRowsByGeoScope(list, ctx);
}

function countSlice(result) {
  if (!result || typeof result !== 'object') return 0;
  return (result.deals?.length || 0) + (result.vendors?.length || 0) + (result.products?.length || 0);
}

async function fetchDeals(limit) {
  try {
    const rows = await dealsService.getDealsFromDB({ limit: Math.min(Math.max(limit, 20), 40) });
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

async function fetchVendors() {
  try {
    const rows = await db.getVendors(true, 1, 40, 'newest', '', true, 'offer');
    return (rows || []).filter(
      (v) => v.features_offer === true || v.features_offer === 1 || v.features_offer === '1'
    );
  } catch (_) {
    return [];
  }
}

async function fetchProducts(limit) {
  try {
    const rows = await productService.getAllProducts();
    const list = Array.isArray(rows) ? rows : [];
    return list.filter((p) => p.offer && !/^no offer$/i.test(String(p.offer))).slice(0, Math.min(Math.max(limit, 20), 40));
  } catch (_) {
    return [];
  }
}

async function buildSliceBody(opts) {
  const safeLimit = clampLimit(opts.limit, { def: 20, max: 30 });
  const {
    scope = 'All',
    category = 'all',
    type = 'all',
    sources = 'deals',
    city = '',
    town = '',
    locality = '',
    state = '',
    language = 'hi',
  } = opts;
  const ctx = { city, town, locality, state, language };
  const srcList = String(sources || 'deals')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const result = { vendors: [], products: [], deals: [], scope, category, type, sources: srcList };

  if (srcList.includes('deals')) {
    const deals = await fetchDeals(safeLimit * 2);
    result.deals = sortTodayRecentFirst(
      filterRows(deals, { category, type, scope, ctx, language }),
      safeLimit,
      ['updated_at', 'created_at', 'date']
    );
  }
  if (srcList.includes('vendors')) {
    result.vendors = filterRows(await fetchVendors(), { category, type, scope, ctx, language }).slice(0, safeLimit);
  }
  if (srcList.includes('products')) {
    result.products = filterRows(await fetchProducts(safeLimit * 2), { category, type, scope, ctx, language }).slice(0, safeLimit);
  }

  result.deals = withinRecentDays(result.deals, 21, ['updated_at', 'created_at', 'date', 'validity_to']);
  return result;
}

async function getSlice(opts = {}) {
  const safeLimit = clampLimit(opts.limit, { def: 20, max: 30 });
  const {
    scope = 'All',
    category = 'all',
    type = 'all',
    sources = 'deals',
    city = '',
    town = '',
    locality = '',
    state = '',
    language = 'hi',
    refresh = false,
  } = opts;

  const key = sliceKey({ scope, category, type, sources, city, town, locality, state, language });
  if (!refresh) {
    const hit = sliceMem.get(key);
    if (hit && Date.now() - hit.ts < SLICE_TTL_MS) {
      return { ...hit.data, cached: true };
    }
  }

  let attempt = 0;
  let lastResult = { vendors: [], products: [], deals: [], scope, category, type, sources: [] };
  let tryScope = scope;

  while (attempt < MAX_SLICE_ATTEMPTS) {
    attempt += 1;
    const forceRefresh = refresh || attempt > 1;
    if (attempt >= 2 && tryScope !== 'All') tryScope = 'All';

    if (forceRefresh) {
      sliceMem.delete(key);
      if (attempt >= 2) {
        try {
          await dealsService.autoSyncAllCompanies();
        } catch (e) {
          LOG.warning(`[Marketplace] deals sync attempt ${attempt} failed:`, e?.message || e);
        }
      }
    }

    lastResult = await buildSliceBody({
      scope: tryScope,
      category,
      type,
      sources,
      city,
      town,
      locality,
      state,
      language,
      limit: safeLimit,
    });
    lastResult.fetchAttempts = attempt;
    lastResult.resolvedScope = tryScope;

    if (countSlice(lastResult) > 0) {
      sliceMem.set(key, { data: lastResult, ts: Date.now() });
      return { ...lastResult, cached: false };
    }

    if (attempt < MAX_SLICE_ATTEMPTS) {
      LOG.info(`[Marketplace] Slice empty (attempt ${attempt}/${MAX_SLICE_ATTEMPTS}) — retry`);
      await sleep(700 * attempt);
    }
  }

  sliceMem.set(key, { data: lastResult, ts: Date.now() });
  return { ...lastResult, cached: false };
}

module.exports = { getSlice, sliceKey };
