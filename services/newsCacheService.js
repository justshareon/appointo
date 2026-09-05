const crypto = require('crypto');
const db = require('../database');
const newsAggregatorService = require('./newsAggregatorService');
const settingsService = require('./settingsService');
const locationNewsService = require('./locationNewsService');
const { curatedFallback, orderItemsByGeoScope } = locationNewsService;
const LOG = require('../utils/logger');
const { clampLimit, sortTodayRecentFirst, withinRecentDays } = require('../utils/recentSlice');

const norm = (v) => String(v || '').trim().toLowerCase();
const sliceMem = new Map();
const SLICE_TTL_MS = 5 * 60 * 1000;
const MAX_SLICE_ATTEMPTS = parseInt(process.env.NEWS_SLICE_ATTEMPTS, 10) || 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
        const town = norm(locationCtx.town || locationCtx.locality);
        const locality = norm(locationCtx.locality || locationCtx.town);
        const state = norm(locationCtx.state);
        const intlCats = new Set(['global_news', 'world', 'international']);
        return (items || []).filter((item) => {
            const cat = norm(item.category);
            const blob = norm(`${item.text || ''} ${item.city || ''} ${item.locality || ''} ${item.state || ''}`);
            const itemScope = norm(item.scope);
            if (scope === 'international') {
                return intlCats.has(cat) || blob.includes('global') || blob.includes('world') || itemScope === 'international';
            }
            if (scope === 'national') {
                return norm(item.country || 'in') === 'in' || !item.country || itemScope === 'national';
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
                if (item.is_local || item.source_type === 'local_vendor' || item.source_type === 'r_detector') return true;
                if (itemScope === 'local') return true;
                if (locality && blob.includes(locality)) return true;
                if (town && blob.includes(town)) return true;
                return false;
            }
            return true;
        });
    }

    /**
     * Layered news slice:
     * 1. Read in-memory / MySQL (MySQL wins when it has rows)
     * 2. Tiered local → town → city → state fetch (town/city hit twice)
     * 3. Up to 3 attempts before empty / curated fallback
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
        let items = [];
        let attempt = 0;

        while (attempt < MAX_SLICE_ATTEMPTS) {
            attempt += 1;
            const forceRefresh = refresh || attempt > 1;

            items = await db.getNewsItems(fetchLimit).catch(() => []);

            if (forceRefresh || !(items || []).length) {
                try {
                    await this.refreshNews(Math.min(Math.max(safeLimit * 2, 30), 50), settings);
                    items = await db.getNewsItems(fetchLimit);
                } catch (e) {
                    LOG.warning(`[NewsCache] API refresh attempt ${attempt} failed:`, e?.message || e);
                }
            }

            const hasLocation = !!(locationCtx.city || locationCtx.locality || locationCtx.town || locationCtx.placeLabel);
            const localScope = ['local', 'town', 'city', 'state', 'All'].includes(scope);

            if (localScope && (hasLocation || !(items || []).length)) {
                try {
                    const localItems = await locationNewsService.fetchLocationNews(
                        settings,
                        locationCtx,
                        Math.min(Math.max(safeLimit, 20), 36)
                    );
                    items = orderItemsByGeoScope(
                        this._dedupeItems([...(localItems || []), ...(items || [])]),
                        locationCtx
                    );
                } catch (e) {
                    LOG.warning(`[NewsCache] Location fetch attempt ${attempt} failed:`, e?.message || e);
                }
            } else {
                items = this._dedupeItems(items || []);
            }

            items = await this._applyFilters(items, category, scope, locationCtx, fetchLimit);

            if (items.length > 0) break;

            if (attempt < MAX_SLICE_ATTEMPTS) {
                LOG.info(`[NewsCache] Slice empty (attempt ${attempt}/${MAX_SLICE_ATTEMPTS}) — retry tiered fetch`);
                sliceMem.delete(memKey);
                await sleep(700 * attempt);
            }
        }

        if (!items.length) {
            items = orderItemsByGeoScope(curatedFallback(locationCtx), locationCtx);
            items = await this._applyFilters(items, category, scope, locationCtx, fetchLimit);
        }

        items = withinRecentDays(items, 14, ['date', 'published_at']);
        const { sortNewsItems } = require('./newsLocalPriority');
        items = orderItemsByGeoScope(
            sortTodayRecentFirst(sortNewsItems(items, settings), safeLimit, ['date', 'published_at']),
            locationCtx
        );
        const grouped = newsAggregatorService.groupItems(items, settings);
        const payload = {
            categories: grouped.categories?.length
                ? grouped.categories
                : [{ name: category === 'All' ? 'News' : category, items }],
            slice: true,
            scope,
            category,
            fetchAttempts: attempt,
        };
        sliceMem.set(memKey, { data: payload, ts: Date.now() });
        return payload;
    }

    _dedupeItems(items) {
        const seen = new Set();
        return (items || []).filter((item) => {
            const key = item.unique_key || item.id || item.link || item.text;
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    async _applyFilters(items, category, scope, locationCtx, fetchLimit) {
        let filtered = this._dedupeItems(items);

        if (category && category !== 'All') {
            filtered = filtered.filter(
                (item) => norm(item.category) === norm(category) || norm(item._cat) === norm(category)
            );
        }

        filtered = this._filterScope(filtered, scope, locationCtx);

        if (!filtered.length && scope !== 'All') {
            filtered = this._filterScope(
                this._dedupeItems(items),
                'All',
                locationCtx
            );
        }

        if (!filtered.length) {
            try {
                const settings = await settingsService.getSettings();
                const localItems = await locationNewsService.fetchLocationNews(
                    settings,
                    locationCtx,
                    Math.min(20, fetchLimit)
                );
                filtered = orderItemsByGeoScope(localItems || [], locationCtx);
            } catch (_) {
                /* ignore */
            }
        }

        return filtered;
    }
}

module.exports = new NewsCacheService();
