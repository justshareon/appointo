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
            
            // Fix 1: Replace unencoded < characters in CDATA sections
            // Pattern matches: <![CDATA[ ... < ... ]]>
            xmlData = xmlData.replace(/<!\[CDATA\[([^\]]*)<([^\]]*)\]\]>/g, (match, p1, p2) => {
                return `<![CDATA[${p1}&lt;${p2}]]>`;
            });
            
            // Fix 2: Handle CDATA sections with multiple < characters
            xmlData = xmlData.replace(/<!\[CDATA\[(.*?)\]\]>/gs, (match, content) => {
                // Replace any remaining < that aren't part of tags with &lt;
                const fixedContent = content.replace(/<(?!\/?[a-zA-Z][^>]*>)/g, '&lt;');
                return `<![CDATA[${fixedContent}]]>`;
            });
            
            // Fix 3: Handle unescaped & characters
            xmlData = xmlData.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;');
            
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
                // Handle different XML structure variations
                const title = item.title?.['#text'] || item.title || '';
                const desc = item.description?.['#text'] || item.description || item.summary?.['#text'] || item.summary || '';
                const text = `${title}${desc ? ` - ${desc}` : ''}`.trim();
                
                // Handle link variations
                let link = '';
                if (item.link) {
                    if (typeof item.link === 'object') {
                        link = item.link?.href || item.link?.url || '';
                    } else if (typeof item.link === 'string') {
                        link = item.link;
                    }
                }
                
                // Handle image variations
                let image = '';
                if (item['media:content']) {
                    image = typeof item['media:content'] === 'object' 
                        ? item['media:content']?.url || item['media:content']?.$?.url || ''
                        : item['media:content'];
                } else if (item['media:thumbnail']) {
                    image = typeof item['media:thumbnail'] === 'object'
                        ? item['media:thumbnail']?.url || item['media:thumbnail']?.$?.url || ''
                        : item['media:thumbnail'];
                } else if (item.enclosure) {
                    if (Array.isArray(item.enclosure)) {
                        image = item.enclosure[0]?.url || item.enclosure[0]?.$?.url || '';
                    } else {
                        image = item.enclosure?.url || item.enclosure?.$?.url || '';
                    }
                }
                
                // Handle date variations
                let pubDate = item.pubDate || item.published || item.updated || item.pubdate || '';
                if (pubDate) {
                    try {
                        pubDate = new Date(pubDate).toISOString();
                    } catch (e) {
                        pubDate = new Date().toISOString();
                    }
                } else {
                    pubDate = new Date().toISOString();
                }
                
                return {
                    id: link || `${source.id || source.name || 'rss'}-${idx}`,
                    text: text.substring(0, 5000), // Limit text length
                    date: pubDate,
                    link: link || '',
                    image: image || '',
                    source: source.name || 'rss',
                    category: source.category || '',
                    country: source.country || '',
                    city: source.city || '',
                    locality: source.locality || ''
                };
            }).filter(item => item.text && item.text.length > 0); // Remove empty items

            // Apply global keyword filter if configured
            const globalFilters = settings?.telegram_news_global_filters
                ? String(settings.telegram_news_global_filters).split(',').map(v => v.trim()).filter(Boolean)
                : [];
            const globalMode = (settings?.telegram_news_filter_mode || 'include').toLowerCase();
            
            let filtered = out;
            if (globalFilters.length) {
                filtered = out.filter(i => {
                    const matched = matchesKeywords(i.text, globalFilters);
                    return globalMode === 'include' ? matched : !matched;
                });
            }

            return { items: filtered.slice(0, limit) };
        } catch (err) {
            // Detailed error logging for RSS parsing failures
            const errorMsg = err.message || String(err);
            const errorStack = err.stack || '';
            
            if (errorMsg.includes('Unencoded') || errorMsg.includes('syntax') || errorMsg.includes('parser')) {
                LOG.warning('[RSS News] XML parsing error (malformed feed):', errorMsg.substring(0, 200));
                LOG.warning('[RSS News] Feed URL:', source.url);
                LOG.warning('[RSS News] Returning empty results for malformed feed');
                
                // Attempt to fix common XML issues and retry
                try {
                    LOG.info('[RSS News] Attempting to fix malformed XML...');
                    let fixedXml = res.data || '';
                    
                    // Remove invalid characters
                    fixedXml = fixedXml.replace(/[^\x09\x0A\x0D\x20-\xFF\x85\xA0-\uD7FF\uE000-\uFDCF\uFDE0-\uFFFD]/g, '');
                    
                    // Fix unclosed tags
                    fixedXml = fixedXml.replace(/<([^>]+)([^>]*)$/g, '<$1$2/>');
                    
                    // Retry parsing with fixed XML
                    const retryParser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true, strict: false });
                    const retryParsed = await retryParser.parseStringPromise(fixedXml);
                    const retryChannel = retryParsed?.rss?.channel || retryParsed?.feed || {};
                    const retryRawItems = retryChannel.item || retryChannel.entry || [];
                    const retryItems = Array.isArray(retryRawItems) ? retryRawItems : [retryRawItems];
                    
                    if (retryItems.length > 0) {
                        LOG.success(`[RSS News] Successfully recovered ${retryItems.length} items from malformed feed`);
                        const recoveredOut = retryItems.slice(0, limit).map((item, idx) => {
                            const title = item.title?.['#text'] || item.title || '';
                            const desc = item.description?.['#text'] || item.description || item.summary?.['#text'] || item.summary || '';
                            const text = `${title}${desc ? ` - ${desc}` : ''}`.trim();
                            const link = item.link?.href || item.link || '';
                            const image = item['media:content']?.url || item['media:thumbnail']?.url || '';
                            const pubDate = item.pubDate || item.published || item.updated || new Date().toISOString();
                            
                            return {
                                id: link || `${source.id || source.name || 'rss'}-${idx}`,
                                text: text.substring(0, 5000),
                                date: new Date(pubDate).toISOString(),
                                link: link || '',
                                image: image || '',
                                source: source.name || 'rss',
                                category: source.category || '',
                                country: source.country || '',
                                city: source.city || '',
                                locality: source.locality || ''
                            };
                        }).filter(item => item.text && item.text.length > 0);
                        
                        return { items: recoveredOut.slice(0, limit) };
                    }
                } catch (retryErr) {
                    LOG.warning('[RSS News] Recovery attempt failed:', retryErr.message);
                }
            } else {
                LOG.error('[RSS News] Fetch failed:', errorMsg);
                if (errorStack) {
                    LOG.error('[RSS News] Error stack:', errorStack.substring(0, 500));
                }
            }
            
            return { items: [], error: errorMsg };
        }
    }
    
    /**
     * Fetch multiple RSS feeds
     * @param {Array} sources - Array of feed sources
     * @param {Object} settings - Global settings
     * @param {number} limit - Max items per feed
     * @returns {Promise<Array>} Combined items from all feeds
     */
    async fetchMultipleFeeds(sources, settings, limit = 50) {
        if (!sources || sources.length === 0) {
            return [];
        }
        
        const results = await Promise.allSettled(
            sources.map(async (source) => {
                const result = await this.fetchNews(source, settings, limit);
                return result.items || [];
            })
        );
        
        // Combine all successful results
        const allItems = results
            .filter(result => result.status === 'fulfilled')
            .flatMap(result => result.value);
        
        // Sort by date (newest first)
        allItems.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        // Remove duplicates by link
        const uniqueItems = [];
        const seenLinks = new Set();
        for (const item of allItems) {
            if (item.link && !seenLinks.has(item.link)) {
                seenLinks.add(item.link);
                uniqueItems.push(item);
            } else if (!item.link) {
                // Items without links, keep them but with caution
                const id = `${item.source}-${item.text.substring(0, 100)}`;
                if (!seenLinks.has(id)) {
                    seenLinks.add(id);
                    uniqueItems.push(item);
                }
            }
        }
        
        return uniqueItems.slice(0, limit * 2); // Return up to 2x limit for combined feeds
    }
    
    /**
     * Validate RSS feed URL
     * @param {string} url - RSS feed URL
     * @returns {Promise<boolean>} Whether the feed is valid
     */
    async validateFeed(url) {
        if (!url) return false;
        
        try {
            const res = await axios.get(url, { timeout: 10000 });
            const xmlData = res.data || '';
            
            // Quick validation: check if it contains RSS or feed tags
            const hasRssTag = /<rss/i.test(xmlData);
            const hasFeedTag = /<feed/i.test(xmlData);
            const hasChannelTag = /<channel/i.test(xmlData);
            
            if (!hasRssTag && !hasFeedTag && !hasChannelTag) {
                return false;
            }
            
            // Try to parse
            const parser = new xml2js.Parser({ explicitArray: false, strict: false });
            await parser.parseStringPromise(xmlData);
            
            return true;
        } catch (err) {
            LOG.warning('[RSS News] Feed validation failed for', url, ':', err.message);
            return false;
        }
    }
}

module.exports = new RssNewsService();