const telegramNewsService = require('./telegramNewsService');
const gdeltNewsService = require('./gdeltNewsService');
const rssNewsService = require('./rssNewsService');
const newsApiService = require('./newsApiService');
const gnewsService = require('./gnewsService');
const { sortNewsItems, sortSources, sortCategories, productsToLocalNewsItems } = require('./newsLocalPriority');

const parseFilters = (raw) => {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed ? parsed : {};
    } catch (e) {
        return {};
    }
};

const parseCategories = (raw, filterMap) => {
    if (raw) {
        return String(raw)
            .split(',')
            .map(v => v.trim())
            .filter(Boolean);
    }
    const keys = Object.keys(filterMap || {});
    return keys.length ? keys : ['general'];
};

const normalizeText = (msg) => (msg || '').toLowerCase();
const matchesKeywords = (text, keywords = []) => {
    const t = normalizeText(text);
    return keywords.some(k => t.includes(String(k).toLowerCase()));
};

const parseSources = (raw) => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
};

const dedupeItems = (items) => {
    const seen = new Set();
    const out = [];
    items.forEach((i) => {
        const key = i.link || i.id || i.text;
        if (!key || seen.has(key)) return;
        seen.add(key);
        out.push(i);
    });
    return out;
};

const categorizeItems = (items, settings) => {
    const filters = parseFilters(settings.telegram_news_filters);
    const categories = parseCategories(settings.telegram_news_categories, filters);
    const out = {};
    categories.forEach(c => { out[c] = []; });
    const otherKey = categories.includes('other') ? 'other' : 'other';

    items.forEach((item) => {
        const text = item.text || '';
        if (!text) return;
        let matched = false;
        for (const [category, keywords] of Object.entries(filters)) {
            if (matchesKeywords(text, keywords)) {
                if (!out[category]) out[category] = [];
                out[category].push(item);
                matched = true;
            }
        }
        if (!matched) {
            if (!out[otherKey]) out[otherKey] = [];
            out[otherKey].push(item);
        }
    });
    return out;
};

const groupByLocation = (items, key) => {
    const out = {};
    items.forEach((item) => {
        const val = (item?.[key] || '').trim();
        const name = val ? `${key}:${val}` : `${key}:unknown`;
        if (!out[name]) out[name] = [];
        out[name].push(item);
    });
    return out;
};

const applyDefaultLocation = (items, settings) => {
    const defCountry = settings.news_default_country || '';
    const defCity = settings.news_default_city || '';
    const defLocality = settings.news_default_locality || '';
    return items.map(item => ({
        ...item,
        country: item.country || defCountry,
        city: item.city || defCity,
        locality: item.locality || defLocality
    }));
};

class NewsAggregatorService {
    groupItems(items, settings) {
        const perCategoryLimit = Number(settings.telegram_news_per_category_limit || 20);
        const groupingMode = (settings.news_grouping_mode || 'category').toLowerCase();
        let grouped;
        if (groupingMode === 'country') {
            grouped = groupByLocation(items, 'country');
        } else if (groupingMode === 'city') {
            grouped = groupByLocation(items, 'city');
        } else if (groupingMode === 'locality') {
            grouped = groupByLocation(items, 'locality');
        } else {
            grouped = categorizeItems(items, settings);
        }
        const categoriesOut = Object.entries(grouped)
            .map(([name, list]) => ({
                name,
                items: perCategoryLimit > 0 ? list.slice(0, perCategoryLimit) : list
            }))
            .filter(c => c.items.length > 0);
        return { categories: sortCategories(categoriesOut, settings) };
    }

    async fetchLocalVendorOffers(settings, limit = 30) {
        try {
            const db = require('../database');
            let products = [];
            if (typeof db.getAllProductsWithVendors === 'function') {
                products = await db.getAllProductsWithVendors();
            } else {
                const inMemoryDb = db.inMemoryDb || {};
                const vendors = inMemoryDb.vendors || [];
                const vendorMap = new Map(vendors.map((v) => [String(v.id), v]));
                products = (inMemoryDb.products || []).map((p) => {
                    const v = vendorMap.get(String(p.vendor_id));
                    return {
                        ...p,
                        shop_name: p.shop_name || v?.shop_name,
                        city: p.city || v?.city,
                        locality: p.locality || v?.location_name || v?.locality,
                    };
                });
            }
            return productsToLocalNewsItems(products, settings).slice(0, limit);
        } catch (_) {
            return [];
        }
    }

    async fetchNews(settings, limit = 50) {
        const sources = sortSources(parseSources(settings.trade_news_sources));

        let items = [];

        // Local vendor offers from app database — highest priority
        const localOffers = await this.fetchLocalVendorOffers(settings, Math.min(limit, 40));
        items = items.concat(localOffers);

        if (sources.length) {
            for (const source of sources) {
                if (!source || source.enabled === false) continue;
                const type = (source.type || '').toLowerCase();
                if (type === 'telegram') {
                    const res = await telegramNewsService.fetchNews(settings, limit);
                    const flattened = (res.categories || []).flatMap(c => (c.items || []).map(i => ({
                        ...i,
                        category: c.name,
                        country: source.country || i.country || '',
                        city: source.city || i.city || '',
                        locality: source.locality || i.locality || ''
                    })));
                    items = items.concat(flattened);
                } else if (type === 'gdelt') {
                    const res = await gdeltNewsService.fetchNews({ ...settings, ...source }, limit);
                    const flattened = (res.categories || []).flatMap(c => (c.items || []).map(i => ({
                        ...i,
                        category: c.name,
                        country: source.country || i.country || '',
                        city: source.city || i.city || '',
                        locality: source.locality || i.locality || ''
                    })));
                    items = items.concat(flattened);
                } else if (type === 'rss') {
                    const res = await rssNewsService.fetchNews(source, settings, limit);
                    items = items.concat(res.items || []);
                } else if (type === 'newsapi') {
                    const res = await newsApiService.fetchNews(source, settings, limit);
                    items = items.concat(res.items || []);
                } else if (type === 'gnews') {
                    const res = await gnewsService.fetchNews(source, settings, limit);
                    items = items.concat(res.items || []);
                } else if (type === 'api') {
                    // Basic JSON API: expects { items: [...] } or { articles: [...] }
                    const apiRes = await rssNewsService.fetchNews({ ...source, url: source.url }, settings, limit);
                    items = items.concat(apiRes.items || []);
                }
            }
        } else {
            const source = (settings.trade_news_source || 'telegram').toLowerCase();
            if (source === 'gdelt') {
                const res = await gdeltNewsService.fetchNews(settings, limit);
                items = (res.categories || []).flatMap(c => (c.items || []).map(i => ({ ...i, category: c.name })));
            } else {
                const res = await telegramNewsService.fetchNews(settings, limit);
                items = (res.categories || []).flatMap(c => (c.items || []).map(i => ({ ...i, category: c.name })));
            }
        }

        const withDefaults = applyDefaultLocation(items, settings);
        const deduped = dedupeItems(withDefaults);
        const prioritized = sortNewsItems(deduped, settings);
        return this.groupItems(prioritized, settings);
    }
}

module.exports = new NewsAggregatorService();

