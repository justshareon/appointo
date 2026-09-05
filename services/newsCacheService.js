const crypto = require('crypto');
const db = require('../database');
const newsAggregatorService = require('./newsAggregatorService');
const settingsService = require('./settingsService');
const locationNewsService = require('./locationNewsService');
const { curatedFallback } = locationNewsService;
const LOG = require('../utils/logger');
const { clampLimit, sortTodayRecentFirst, withinRecentDays } = require('../utils/recentSlice');

const norm = (v) => String(v || '').trim().toLowerCase();
const sliceMem = new Map();
const SLICE_TTL_MS = 5 * 60 * 1000;

const buildUniqueKey = (item) => {
    const rawKey = item.link || item.id || `${item.source || ''}|${item.date || ''}|${item.text || ''}`;
    return rawKey.length > 200
        ? crypto.createHash('sha1').update(rawKey).digest('hex')
        : rawKey;
};

class NewsCacheService {
    /**
     * Fetch from external APIs (RSS/Telegram/etc.) → save to in-memory + MySQL.
     */
    async refreshNews(limit = 50, settingsOverride = null) {
        const settings = settingsOverride || await settingsService.getSettings();
        const result = await newsAggregatorService.fetchNews(settings, limit);
        const flattened = (result.categories || []).flatMap(c => (c.items || []).map(item => ({
            ...item,
            category: item.category || c.name
        })));
        const withKeys = flattened.map(item => ({ ...item, unique_key: buildUniqueKey(item) }));
        await db.saveNewsItems(withKeys);
        await db.updateSettings({ news_cache_last_updated: new Date().toISOString() });
        return result;
    }

    async getCachedGrouped(limit = 200, settingsOverride = null) {
        const settings = settingsOverride || await settingsService.getSettings();
        const cachedItems = await db.getNewsItems(limit);
        const localOffers = await newsAggregatorService.fetchLocalVendorOffers(settings, 40);
        const merged = [...localOffers, ...(cachedItems || [])];
        const seen = new Set();
        const deduped = merged.filter((item) => {
            const key = item.unique_key || item.id || item.link || item.text;
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        const { sortNewsItems } = require('./newsLocalPriority');
        return newsAggregatorService.groupItems(sortNewsItems(deduped, settings), settings);
    }

    /** Category counts — read layered store (MySQL when populated, else in-memory). */
    async getMeta(settingsOverride = null) {
        const settings = settingsOverride || await settingsService.getSettings();
        const items = await db.getNewsItems(120);
        const counts = {};
        (items || []).forEach((item) => {
            const cat = item.category || 'general';
            counts[cat] = (counts[cat] || 0) + 1;
        });
        const categories = Object.entries(counts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);
        return { categories, total: (items || []).length, settings };
    }

    _filterScope(items, scope, locationCtx = {}) {
        if (!scope || scope === 'All') return items;
        const city = norm(locationCtx.city);
        const locality = norm(locationCtx.locality || locationCtx.town);
        const intlCats = new Set(['global_news', 'world', 'international']);
        return (items || []).filter((item) => {
            const cat = norm(item.category);
            const blob = norm(`${item.text || ''} ${item.city || ''} ${item.locality || ''}`);
            if (scope === 'international') {
                return intlCats.has(cat) || blob.includes('global') || blob.includes('world');
            }
            if (scope === 'national') {
                return norm(item.country || 'in') === 'in' || !item.country;
            }
            if (scope === 'local' || scope === 'town') {
                if (item.is_local || item.source_type === 'local_vendor' || item.source_type === 'r_detector') return true;
                if (locality && blob.includes(locality)) return true;
                if (city && blob.includes(city)) return true;
                if (item.is_local === true) return true;
                return scope === 'town';
            }
            if (scope === 'city' && city) return blob.includes(city);
            if (scope === 'state' && locationCtx.state) return blob.includes(norm(locationCtx.state));
            return true;
        });
    }

    /**
     * Layered news slice:
     * 1. Read in-memory / MySQL (MySQL wins when it has rows)
     * 2. If empty or refresh: fetch APIs → saveNewsItems (memory + MySQL)
     * 3. Re-read from layered store (MySQL when synced)
     */
    async getSlice({
        category = 'All',
        scope = 'All',
        limit = 15,
        locationCtx = {},
        settingsOverride = null,
        refresh = false,
    } = {}) {
        const settings = settingsOverride || await settingsService.getSettings();
        const safeLimit = clampLimit(limit, { def: 15, max: 20 });
        const memKey = `${scope}|${category}|${safeLimit}|${locationCtx.city || ''}|${locationCtx.locality || ''}|${locationCtx.language || 'hi'}`;
        if (!refresh) {
            const hit = sliceMem.get(memKey);
            if (hit && Date.now() - hit.ts < SLICE_TTL_MS) return hit.data;
        }

        const fetchLimit = Math.min(Math.max(safeLimit * 2, 24), 40);
        let items = await db.getNewsItems(fetchLimit);

        if (refresh || !(items || []).length) {
            try {
                await this.refreshNews(Math.min(Math.max(safeLimit * 2, 30), 50), settings);
                items = await db.getNewsItems(fetchLimit);
            } catch (e) {
                LOG.warning('[NewsCache] API refresh failed, using in-memory:', e?.message || e);
            }
        }

        const hasLocation = !!(locationCtx.city || locationCtx.locality || locationCtx.placeLabel);
        const localScope = ['local', 'town', 'city', 'All'].includes(scope);

        if (localScope && (hasLocation || !(items || []).length)) {
            try {
                const localItems = await locationNewsService.fetchLocationNews(
                    settings,
                    locationCtx,
                    Math.min(safeLimit, 20)
                );
                items = [...(localItems || []), ...(items || [])];
            } catch (_) {}
        }

        const seen = new Set();
        items = (items || []).filter((item) => {
            const key = item.unique_key || item.id || item.link || item.text;
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        if (category && category !== 'All') {
            items = items.filter(
                (item) => norm(item.category) === norm(category) || norm(item._cat) === norm(category)
            );
        }

        items = this._filterScope(items, scope, locationCtx);
        if (!items.length && scope !== 'All') {
            items = this._filterScope(
                await db.getNewsItems(fetchLimit).catch(() => []),
                'All',
                locationCtx
            );
        }

        if (!items.length) {
            try {
                const localItems = await locationNewsService.fetchLocationNews(
                    settings,
                    locationCtx,
                    Math.min(safeLimit, 20)
                );
                items = localItems || [];
            } catch (_) {}
        }

        if (!items.length) {
            items = curatedFallback(locationCtx);
        }

        items = withinRecentDays(items, 14, ['date', 'published_at']);
        const { sortNewsItems } = require('./newsLocalPriority');
        items = sortTodayRecentFirst(sortNewsItems(items, settings), safeLimit, ['date', 'published_at']);
        const grouped = newsAggregatorService.groupItems(items, settings);
        const payload = {
            categories: grouped.categories?.length
                ? grouped.categories
                : [{ name: category === 'All' ? 'News' : category, items }],
            slice: true,
            scope,
            category,
        };
        sliceMem.set(memKey, { data: payload, ts: Date.now() });
        return payload;
    }
}

module.exports = new NewsCacheService();
