const axios = require('axios');
const LOG = require('../utils/logger');

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

const parseList = (raw) => {
    if (!raw) return [];
    return String(raw)
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
};

const normalizeText = (msg) => (msg || '').toLowerCase();

const matchesKeywords = (text, keywords = []) => {
    const t = normalizeText(text);
    return keywords.some(k => t.includes(String(k).toLowerCase()));
};

const parseSeenDate = (raw) => {
    if (!raw) return new Date().toISOString();
    const str = String(raw);
    if (str.length !== 14) return new Date(raw).toISOString();
    const yyyy = str.slice(0, 4);
    const mm = str.slice(4, 6);
    const dd = str.slice(6, 8);
    const hh = str.slice(8, 10);
    const mi = str.slice(10, 12);
    const ss = str.slice(12, 14);
    return new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}Z`).toISOString();
};

class GdeltNewsService {
    async fetchNews(settings, limit = 50) {
        const query = settings.gdelt_query || 'stock market OR nifty OR sensex OR trading';
        const filters = parseFilters(settings.telegram_news_filters);
        const categories = parseCategories(settings.telegram_news_categories, filters);
        const globalFilters = parseList(settings.telegram_news_global_filters);
        const globalMode = (settings.telegram_news_filter_mode || 'include').toLowerCase();
        const maxItems = Number(limit || settings.telegram_news_limit || 50);
        const perCategoryLimit = Number(settings.telegram_news_per_category_limit || 20);
        const timespan = settings.gdelt_timespan || '';
        const languages = parseList(settings.gdelt_languages);

        try {
            const params = {
                query,
                mode: 'ArtList',
                format: 'json',
                maxrecords: Math.min(maxItems, 100),
                sort: 'HybridRel'
            };
            if (timespan) params.timespan = timespan;
            if (languages.length) params.sourcelang = languages.join(',');

            const res = await axios.get('https://api.gdeltproject.org/api/v2/doc/doc', {
                params,
                timeout: 15000
            });

            const articles = Array.isArray(res.data?.articles) ? res.data.articles : [];
            const categorized = {};
            categories.forEach(c => { categorized[c] = []; });
            const otherKey = categories.includes('other') ? 'other' : 'other';

            articles.forEach((a, idx) => {
                const title = a.title || '';
                const description = a.seendate ? ` (${a.seendate})` : '';
                const text = `${title}${description}`.trim();
                if (!text) return;

                if (globalFilters.length) {
                    const matchedGlobal = matchesKeywords(text, globalFilters);
                    if (globalMode === 'include' && !matchedGlobal) return;
                    if (globalMode === 'exclude' && matchedGlobal) return;
                }

                const item = {
                    id: a.url || `${a.seendate || 'gdelt'}-${idx}`,
                    text,
                    date: parseSeenDate(a.seendate),
                    link: a.url || '',
                    source: 'gdelt'
                };

                let matched = false;
                for (const [category, keywords] of Object.entries(filters)) {
                    if (matchesKeywords(text, keywords)) {
                        if (!categorized[category]) categorized[category] = [];
                        categorized[category].push(item);
                        matched = true;
                    }
                }
                if (!matched) {
                    if (!categorized[otherKey]) categorized[otherKey] = [];
                    categorized[otherKey].push(item);
                }
            });

            const categoriesOut = Object.entries(categorized)
                .map(([name, items]) => ({
                    name,
                    items: perCategoryLimit > 0 ? items.slice(0, perCategoryLimit) : items
                }))
                .filter(c => c.items.length > 0);

            return { categories: categoriesOut };
        } catch (err) {
            LOG.error('[GDELT News] Fetch failed', err.message);
            return { categories: [], error: err.message };
        }
    }
}

module.exports = new GdeltNewsService();

