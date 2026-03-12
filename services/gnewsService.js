const axios = require('axios');
const LOG = require('../utils/logger');

const normalizeText = (msg) => (msg || '').toLowerCase();
const matchesKeywords = (text, keywords = []) => {
    const t = normalizeText(text);
    return keywords.some(k => t.includes(String(k).toLowerCase()));
};

const parseList = (raw) => {
    if (!raw) return [];
    return String(raw)
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
};

class GnewsService {
    async fetchNews(source, settings, limit = 50) {
        const apiKey = source?.apiKey || settings?.gnews_api_key;
        if (!apiKey) {
            return { items: [], error: 'missing_gnews_key' };
        }
        const query = source?.query || settings?.gdelt_query || 'market OR stock OR trading';
        const language = source?.language || settings?.gnews_language || 'en';
        const max = Math.min(Number(limit || 50), 100);
        const country = source?.countryCode || settings?.gnews_country || '';

        try {
            const res = await axios.get('https://gnews.io/api/v4/search', {
                params: {
                    q: query,
                    lang: language,
                    max,
                    country: country || undefined,
                    token: apiKey
                },
                timeout: 15000
            });

            const articles = Array.isArray(res.data?.articles) ? res.data.articles : [];
            const items = articles.map((a, idx) => ({
                id: a.url || `${source?.id || 'gnews'}-${idx}`,
                text: `${a.title || ''}${a.description ? ` - ${a.description}` : ''}`.trim(),
                date: a.publishedAt || new Date().toISOString(),
                link: a.url || '',
                image: a.image || '',
                source: source?.name || 'gnews',
                category: source?.category || '',
                country: source?.country || '',
                city: source?.city || '',
                locality: source?.locality || ''
            }));

            const globalFilters = parseList(settings?.telegram_news_global_filters);
            const globalMode = (settings?.telegram_news_filter_mode || 'include').toLowerCase();
            const filtered = globalFilters.length
                ? items.filter(i => {
                    const matched = matchesKeywords(i.text, globalFilters);
                    return globalMode === 'include' ? matched : !matched;
                })
                : items;

            return { items: filtered.slice(0, max) };
        } catch (err) {
            LOG.error('[GNews] Fetch failed', err.message);
            return { items: [], error: err.message };
        }
    }
}

module.exports = new GnewsService();

