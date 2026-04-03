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
            // Sanitize XML before parsing - fix unencoded characters in CDATA sections
            let xmlData = res.data || '';
            // Replace unencoded < characters in text nodes with &lt;
            xmlData = xmlData.replace(/<!\\[CDATA\\[([^\]]*)<([^\]]*)]\\]>/g, (match, p1, p2) => {
                return `<![CDATA[${p1}&lt;${p2}]]>`;
            });
            const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true, strict: false });
            const parsed = await parser.parseStringPromise(xmlData);
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
            // Detailed error logging for RSS parsing failures
            const errorMsg = err.message || String(err);
            if (errorMsg.includes('Unencoded') || errorMsg.includes('syntax')) {
                LOG.warning('[RSS News] XML parsing error (malformed feed):', errorMsg.substring(0, 100));
                LOG.warning('[RSS News] Feed URL:', source.url);
                LOG.warning('[RSS News] Returning empty results for malformed feed');
            } else {
                LOG.error('[RSS News] Fetch failed', errorMsg);
            }
            return { items: [], error: errorMsg };
        }
    }
}

module.exports = new RssNewsService();

