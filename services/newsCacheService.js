const crypto = require('crypto');
const db = require('../database');
const newsAggregatorService = require('./newsAggregatorService');
const settingsService = require('./settingsService');

const buildUniqueKey = (item) => {
    const rawKey = item.link || item.id || `${item.source || ''}|${item.date || ''}|${item.text || ''}`;
    return rawKey.length > 200
        ? crypto.createHash('sha1').update(rawKey).digest('hex')
        : rawKey;
};

class NewsCacheService {
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
}

module.exports = new NewsCacheService();

