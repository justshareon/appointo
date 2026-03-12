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

const buildTelegramLink = (channel, messageId) => {
    if (!channel || !messageId) return '';
    if (String(channel).startsWith('@')) {
        return `https://t.me/${String(channel).replace('@', '')}/${messageId}`;
    }
    return '';
};

class TelegramNewsService {
    async fetchNews(settings, limit = 50) {
        const token = settings.telegram_bot_token;
        if (!token) {
            return { categories: [], error: 'missing_bot_token' };
        }
        const channel = settings.telegram_channel || '';
        const filters = parseFilters(settings.telegram_news_filters);
        const categories = parseCategories(settings.telegram_news_categories, filters);
        const globalFilters = parseList(settings.telegram_news_global_filters);
        const globalMode = (settings.telegram_news_filter_mode || 'include').toLowerCase();
        const maxItems = Number(limit || settings.telegram_news_limit || 50);
        const perCategoryLimit = Number(settings.telegram_news_per_category_limit || 20);
        const sinceHours = Number(settings.telegram_news_since_hours || 0);

        try {
            const url = `https://api.telegram.org/bot${token}/getUpdates`;
            const res = await axios.get(url, {
                params: { limit: Math.min(maxItems, 100), allowed_updates: 'channel_post' },
                timeout: 8000
            });

            const updates = Array.isArray(res.data?.result) ? res.data.result : [];
            const messages = updates
                .map(u => u.channel_post || u.message)
                .filter(Boolean)
                .filter(m => {
                    if (!channel) return true;
                    const chat = m.chat || {};
                    const chatId = String(chat.id || '');
                    const username = chat.username ? `@${chat.username}` : '';
                    return String(channel) === chatId || String(channel) === username;
                })
                .filter(m => {
                    if (!sinceHours) return true;
                    const msgTime = m.date ? new Date(m.date * 1000).getTime() : 0;
                    const cutoff = Date.now() - sinceHours * 60 * 60 * 1000;
                    return msgTime >= cutoff;
                })
                .slice(-maxItems)
                .reverse();

            const categorized = {};
            categories.forEach(c => { categorized[c] = []; });
            const otherKey = categories.includes('other') ? 'other' : 'other';

            messages.forEach((m) => {
                const text = m.text || m.caption || '';
                if (!text) return;
                if (globalFilters.length) {
                    const matchedGlobal = matchesKeywords(text, globalFilters);
                    if (globalMode === 'include' && !matchedGlobal) return;
                    if (globalMode === 'exclude' && matchedGlobal) return;
                }
                const item = {
                    id: m.message_id,
                    text,
                    date: m.date ? new Date(m.date * 1000).toISOString() : new Date().toISOString(),
                    link: buildTelegramLink(channel, m.message_id),
                    source: 'telegram'
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
            LOG.error('[Telegram News] Fetch failed', err.message);
            return { categories: [], error: err.message };
        }
    }
}

module.exports = new TelegramNewsService();

