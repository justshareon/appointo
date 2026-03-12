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

class NewsApiService {
    async fetchNews(source, settings, limit = 50) {
        const apiKey = source?.apiKey || settings?.newsapi_api_key;
        if (!apiKey) {
            return { items: [], error: 'missing_newsapi_key' };
        }
        const query = source?.query || settings?.gdelt_query || 'market OR stock OR trading';
        const language = source?.language || settings?.newsapi_language || 'en';
        const pageSize = Math.min(Number(limit || 50), 100);
        const sortBy = source?.sortBy || 'publishedAt';

        try {
            const res = await axios.get('https://newsapi.org/v2/everything', {
                params: {
                    q: query,
                    language,
                    sortBy,
                    pageSize
                },
                headers: { 'X-Api-Key': apiKey },
                timeout: 15000
            });

            const articles = Array.isArray(res.data?.articles) ? res.data.articles : [];
            const items = articles.map((a, idx) => ({
                id: a.url || `${source?.id || 'newsapi'}-${idx}`,
                text: `${a.title || ''}${a.description ? ` - ${a.description}` : ''}`.trim(),
                date: a.publishedAt || new Date().toISOString(),
                link: a.url || '',
                image: a.urlToImage || '',
                source: source?.name || a.source?.name || 'newsapi',
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

            return { items: filtered.slice(0, pageSize) };
        } catch (err) {
            LOG.error('[NewsAPI] Fetch failed', err.message);
            return { items: [], error: err.message };
        }
    }
}

module.exports = new NewsApiService();

