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
            
            // Fix CDATA sections with nested brackets - CORRECTED REGEX
            // This regex properly handles CDATA with any nested content including < and >
            xmlData = xmlData.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (match, content) => {
                // Escape any unencoded < and > characters within CDATA content
                let escapedContent = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                return `<![CDATA[${escapedContent}]]>`;
            });
            
            // Also fix any remaining unencoded ampersands
            xmlData = xmlData.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#x?[0-9A-Fa-f]+;)/g, '&amp;');
            
            const parser = new xml2js.Parser({ 
                explicitArray: false, 
                mergeAttrs: true, 
                strict: false,
                trim: true,
                normalizeTags: false
            });
            
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