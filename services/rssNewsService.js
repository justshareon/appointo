const axios = require('axios');
const xml2js = require('xml2js');
const LOG = require('../utils/logger');

const normalizeText = (msg) => (msg || '').toLowerCase();
const matchesKeywords = (text, keywords = []) => {
    const t = normalizeText(text);
    return keywords.some(k => t.includes(String(k).toLowerCase()));
};

class RssNewsService {
    async fetchNews(source, settings, limit = 50) {
        if (!source?.url) {
            return { items: [], error: 'missing_rss_url' };
        }
        try {
            const res = await axios.get(source.url, { timeout: 15000 });
            const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
            const parsed = await parser.parseStringPromise(res.data);
            const channel = parsed?.rss?.channel || parsed?.feed || {};
            const rawItems = channel.item || channel.entry || [];
            const items = Array.isArray(rawItems) ? rawItems : [rawItems];
            const out = items.slice(0, limit).map((item, idx) => {
                const title = item.title?.['#text'] || item.title || '';
                const desc = item.description || item.summary || '';
                const text = `${title}${desc ? ` - ${desc}` : ''}`.trim();
                const link = item.link?.href || item.link || '';
                const image =
                    item['media:content']?.url ||
                    item['media:thumbnail']?.url ||
                    item.enclosure?.url ||
                    (Array.isArray(item.enclosure) ? item.enclosure[0]?.url : '') ||
                    '';
                const pubDate = item.pubDate || item.published || item.updated || new Date().toISOString();
                return {
                    id: link || `${source.id || source.name || 'rss'}-${idx}`,
                    text,
                    date: new Date(pubDate).toISOString(),
                    link,
                    image,
                    source: source.name || 'rss',
                    category: source.category || '',
                    country: source.country || '',
                    city: source.city || '',
                    locality: source.locality || ''
                };
            });

            // Apply global keyword filter if configured
            const globalFilters = settings?.telegram_news_global_filters
                ? String(settings.telegram_news_global_filters).split(',').map(v => v.trim()).filter(Boolean)
                : [];
            const globalMode = (settings?.telegram_news_filter_mode || 'include').toLowerCase();
            const filtered = globalFilters.length
                ? out.filter(i => {
                    const matched = matchesKeywords(i.text, globalFilters);
                    return globalMode === 'include' ? matched : !matched;
                })
                : out;

            return { items: filtered.slice(0, limit) };
        } catch (err) {
            LOG.error('[RSS News] Fetch failed', err.message);
            return { items: [], error: err.message };
        }
    }
}

module.exports = new RssNewsService();

