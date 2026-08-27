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
            const res = await axios.get(source.url, {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; QRQueueNewsBot/1.0; +https://qrqueue.app)',
                    Accept: 'application/rss+xml, application/xml, text/xml, */*',
                },
                maxRedirects: 5,
            });
            let xmlData = typeof res.data === 'string' ? res.data : String(res.data || '');

            const tryParse = async (xml) => {
                const parser = new xml2js.Parser({
                    explicitArray: false,
                    mergeAttrs: true,
                    strict: false,
                    trim: true,
                    normalizeTags: true,
                });
                return parser.parseStringPromise(xml);
            };

            const parsed = await tryParse(xmlData);
            const rssRoot = parsed?.rss || parsed?.feed || {};
            const channel = rssRoot?.channel || parsed?.feed || {};
            const rawItems = channel.item || channel.entry || [];
            const items = Array.isArray(rawItems) ? rawItems : [rawItems];
            
            const extractImgFromHtml = (html) => {
                if (!html || typeof html !== 'string') return '';
                const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
                return match?.[1] && /^https?:\/\//i.test(match[1]) ? match[1] : '';
            };

            const pickMediaUrl = (value) => {
                if (!value) return '';
                if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
                if (typeof value === 'object') {
                    const url = value.url || value.href || value.$?.url;
                    if (url && /^https?:\/\//i.test(url)) return url;
                }
                if (Array.isArray(value)) {
                    for (const entry of value) {
                        const picked = pickMediaUrl(entry);
                        if (picked) return picked;
                    }
                }
                return '';
            };

            const out = items.slice(0, limit).map((item, idx) => {
                const title = item.title?.['#text'] || item.title || '';
                const desc = item.description || item.summary || item['content:encoded'] || '';
                const descText = typeof desc === 'object' ? (desc['#text'] || desc._ || '') : desc;
                const text = `${title}${descText ? ` - ${descText}` : ''}`.trim();
                const link = item.link?.href || item.link || '';
                const image =
                    pickMediaUrl(item['media:content']) ||
                    pickMediaUrl(item['media:thumbnail']) ||
                    pickMediaUrl(item.enclosure) ||
                    extractImgFromHtml(descText) ||
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