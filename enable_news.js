/**
 * Enable News feature in MySQL + in-memory settings.
 * Preserves existing telegram/gnews/newsapi keys in system_settings.
 */
require('./loadEnv');
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const settingsService = require('./services/settingsService');
const newsCacheService = require('./services/newsCacheService');
const data = require('./database/data');

dotenv.config({ path: path.join(__dirname, '.env'), override: true });

const RSS_SOURCES = '[{"id":"google-global","type":"rss","enabled":true,"name":"Google News Global","url":"https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"global_news"},{"id":"google-tech","type":"rss","enabled":true,"name":"Google News Technology","url":"https://news.google.com/rss/search?q=technology&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"new_technology"},{"id":"google-sports","type":"rss","enabled":true,"name":"Google News Sports","url":"https://news.google.com/rss/search?q=sports&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"sports"},{"id":"google-travel","type":"rss","enabled":true,"name":"Google News Travel","url":"https://news.google.com/rss/search?q=travel%20deals&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"travel"},{"id":"google-coupons","type":"rss","enabled":true,"name":"Google News Coupons","url":"https://news.google.com/rss/search?q=local%20coupons%20OR%20food%20coupons&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"food_coupons"},{"id":"google-deals","type":"rss","enabled":true,"name":"Google News Deals","url":"https://news.google.com/rss/search?q=deal%20of%20the%20day%20OR%20flash%20sale&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"trending_deals"},{"id":"google-flash-sale","type":"rss","enabled":true,"name":"Google News Flash Sale","url":"https://news.google.com/rss/search?q=flash%20sale%20OR%20limited%20time%20offer%20OR%20mega%20sale&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"trending_offer"},{"id":"slickdeals","type":"rss","enabled":true,"name":"Slickdeals Frontpage","url":"https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1","category":"trending_deals"},{"id":"dealnews","type":"rss","enabled":true,"name":"DealNews","url":"https://www.dealnews.com/rss/","category":"trending_offer"}]';

async function enableNews() {
    console.log('\n=== Enabling News feature ===\n');

    if (data.settings) {
        data.settings.enable_news = true;
        if (!data.settings.trade_news_sources) {
            data.settings.trade_news_sources = RSS_SOURCES;
        }
        console.log('In-memory settings updated');
    }

    await settingsService.updateSettings({
        enable_news: true,
        news_cache_auto_refresh: true,
    });

    const host = process.env.DB_HOST || 'localhost';
    const isRemote = host !== 'localhost' && host !== '127.0.0.1';
    console.log('Connecting to database host:', isRemote ? 'remote' : 'local');

    const pool = mysql.createPool({
        host,
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'root',
        database: process.env.DB_NAME || 'qr_queue',
        waitForConnections: true,
        connectionLimit: 2,
        ...(isRemote ? { ssl: { rejectUnauthorized: false } } : {}),
    });

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS system_settings (
                key_name VARCHAR(50) PRIMARY KEY,
                value TEXT
            )
        `);

        const flags = [
            ['enable_news', 'true'],
            ['news_cache_auto_refresh', 'true'],
        ];
        for (const [key, value] of flags) {
            await pool.query(
                'INSERT INTO system_settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?',
                [key, value, value]
            );
        }

        const [sourcesRow] = await pool.query(
            "SELECT value FROM system_settings WHERE key_name = 'trade_news_sources' LIMIT 1"
        );
        const hasSources = sourcesRow?.[0]?.value && String(sourcesRow[0].value).trim().length > 2;
        if (!hasSources) {
            await pool.query(
                'INSERT INTO system_settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?',
                ['trade_news_sources', RSS_SOURCES, RSS_SOURCES]
            );
            console.log('Seeded trade_news_sources (Google RSS feeds)');
        } else {
            console.log('trade_news_sources already present — kept existing');
        }

        const keyNames = ['enable_news', 'telegram_bot_token', 'telegram_channel', 'gnews_api_key', 'newsapi_api_key', 'trade_news_sources'];
        const [rows] = await pool.query(
            `SELECT key_name, value FROM system_settings WHERE key_name IN (${keyNames.map(() => '?').join(',')})`,
            keyNames
        );
        console.log('\nNews-related settings (values masked):');
        for (const row of rows) {
            const v = String(row.value || '');
            const masked = /token|key|secret/i.test(row.key_name) && v.length > 4
                ? `${v.slice(0, 4)}…(${v.length} chars)`
                : v.length > 80 ? `${v.slice(0, 80)}…` : v;
            console.log(`  ${row.key_name}: ${masked || '(empty)'}`);
        }
    } finally {
        await pool.end();
    }

    const finalSettings = await settingsService.getSettings();
    console.log('\nFinal enable_news:', finalSettings.enable_news);
    console.log('Has trade_news_sources:', !!(finalSettings.trade_news_sources && String(finalSettings.trade_news_sources).length > 2));
    console.log('Has telegram_bot_token:', !!(finalSettings.telegram_bot_token && String(finalSettings.telegram_bot_token).length > 4));
    console.log('Has gnews_api_key:', !!(finalSettings.gnews_api_key && String(finalSettings.gnews_api_key).length > 4));

    try {
        console.log('\nRefreshing news cache…');
        const result = await newsCacheService.refreshNews(50, finalSettings);
        const count = (result?.categories || []).reduce((n, c) => n + (c.items?.length || 0), 0);
        console.log(`News cache refreshed: ${result?.categories?.length || 0} categories, ${count} items`);
    } catch (e) {
        console.warn('News cache refresh failed (RSS may still work on next request):', e.message);
    }

    console.log('\nNews feature enabled.\n');
}

enableNews()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('Failed to enable news:', err);
        process.exit(1);
    });
