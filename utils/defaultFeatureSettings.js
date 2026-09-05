/**
 * Default feature flags + RSS sources — fills missing keys only.
 * MySQL settings remain authoritative; in-memory used as bootstrap until MySQL is synced.
 */
const DEFAULT_RSS_SOURCES = '[{"id":"google-global","type":"rss","enabled":true,"name":"Google News Global","url":"https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"global_news"},{"id":"google-tech","type":"rss","enabled":true,"name":"Google News Technology","url":"https://news.google.com/rss/search?q=technology&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"new_technology"},{"id":"google-sports","type":"rss","enabled":true,"name":"Google News Sports","url":"https://news.google.com/rss/search?q=sports&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"sports"},{"id":"google-travel","type":"rss","enabled":true,"name":"Google News Travel","url":"https://news.google.com/rss/search?q=travel%20deals&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"travel"},{"id":"google-coupons","type":"rss","enabled":true,"name":"Google News Coupons","url":"https://news.google.com/rss/search?q=local%20coupons%20OR%20food%20coupons&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"food_coupons"},{"id":"google-deals","type":"rss","enabled":true,"name":"Google News Deals","url":"https://news.google.com/rss/search?q=deal%20of%20the%20day%20OR%20flash%20sale&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"trending_deals"},{"id":"google-flash-sale","type":"rss","enabled":true,"name":"Google News Flash Sale","url":"https://news.google.com/rss/search?q=flash%20sale%20OR%20limited%20time%20offer%20OR%20mega%20sale&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"trending_offer"},{"id":"slickdeals","type":"rss","enabled":true,"name":"Slickdeals Frontpage","url":"https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1","category":"trending_deals"},{"id":"dealnews","type":"rss","enabled":true,"name":"DealNews","url":"https://www.dealnews.com/rss/","category":"trending_offer"}]';

const DEFAULT_CYBER_THREAT_SOURCES = '[{"id":"cyber_cisa","name":"CISA Alerts","url":"https://www.cisa.gov/news-events/cybersecurity-advisories/rss.xml","type":"rss","enabled":true},{"id":"cyber_us_cert","name":"US-CERT","url":"https://www.us-cert.gov/ncas/alerts.xml","type":"rss","enabled":true},{"id":"cyber_krebs","name":"Krebs on Security","url":"https://krebsonsecurity.com/feed/","type":"rss","enabled":true},{"id":"cyber_bleeping","name":"Bleeping Computer","url":"https://www.bleepingcomputer.com/feed/","type":"rss","enabled":true},{"id":"cyber_hacker_news","name":"The Hacker News","url":"https://feeds.feedburner.com/TheHackersNews","type":"rss","enabled":true}]';

const DEFAULT_TRADING_EXTERNAL_URLS = '[{"id":"trade_yahoo","name":"Yahoo Finance API","url":"https://query1.finance.yahoo.com/v8/finance/chart/","type":"api","enabled":false,"category":"market_data"},{"id":"trade_excel","name":"Excel sync file","url":"./India_Stock_Market_Tracker_v1.0.xlsx","type":"file","enabled":true,"category":"excel"}]';

/** Fill only missing keys — never override values already loaded from MySQL. */
function ensureFeatureSettings(settings = {}) {
  const s = { ...settings };
  const fill = (key, fallback) => {
    if (s[key] === undefined || s[key] === null || s[key] === '') {
      s[key] = fallback;
    }
  };
  fill('enable_queue', true);
  fill('enable_appointments', true);
  fill('enable_shopping', true);
  fill('enable_matchmaking', true);
  fill('enable_offer', true);
  fill('enable_trade', true);
  fill('enable_qless', true);
  fill('enable_fleet', true);
  fill('enable_r_detector', true);
  fill('enable_realestate', true);
  fill('enable_cyber', true);
  fill('enable_trust_score', true);
  fill('enable_news', true);
  if (s.news_cache_auto_refresh === undefined) s.news_cache_auto_refresh = true;
  if (!s.trade_news_sources || String(s.trade_news_sources).trim().length < 4) {
    s.trade_news_sources = DEFAULT_RSS_SOURCES;
  }
  fill('news_default_city', 'Delhi');
  fill('news_default_lat', '28.6139');
  fill('news_default_lng', '77.2090');
  fill('db_pool_min_limit', 3);
  fill('db_pool_default_limit', 5);
  fill('db_pool_idle_close_minutes', 10);
  if (!s.db_pool_feature_limits || typeof s.db_pool_feature_limits !== 'object') {
    s.db_pool_feature_limits = {};
  }
  if (!s.cyber_threat_sources || String(s.cyber_threat_sources).trim().length < 4) {
    s.cyber_threat_sources = DEFAULT_CYBER_THREAT_SOURCES;
  } else {
    try {
      const cyber = JSON.parse(String(s.cyber_threat_sources));
      if (!Array.isArray(cyber) || cyber.length < 3) s.cyber_threat_sources = DEFAULT_CYBER_THREAT_SOURCES;
    } catch (_) {
      s.cyber_threat_sources = DEFAULT_CYBER_THREAT_SOURCES;
    }
  }
  if (!s.trading_external_urls || String(s.trading_external_urls).trim().length < 4) {
    s.trading_external_urls = DEFAULT_TRADING_EXTERNAL_URLS;
  } else {
    try {
      const trade = JSON.parse(String(s.trading_external_urls));
      if (!Array.isArray(trade) || trade.length < 1) s.trading_external_urls = DEFAULT_TRADING_EXTERNAL_URLS;
    } catch (_) {
      s.trading_external_urls = DEFAULT_TRADING_EXTERNAL_URLS;
    }
  }
  return s;
}

module.exports = {
  DEFAULT_RSS_SOURCES,
  DEFAULT_CYBER_THREAT_SOURCES,
  DEFAULT_TRADING_EXTERNAL_URLS,
  ensureFeatureSettings,
};
