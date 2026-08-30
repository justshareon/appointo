const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, 'routes', 'tradingRoutes.js');
let src = fs.readFileSync(target, 'utf8');

if (src.includes('/news/meta')) {
  console.log('tradingRoutes already has news meta/slice');
  process.exit(0);
}

const metaRoute = `
/**
 * GET /api/trading/news/meta
 * Lightweight category counts (MySQL / in-memory) — no full RSS pull.
 */
router.get('/news/meta', async (req, res) => {
    try {
        const settings = await settingsService.getSettings();
        if (!settings.enable_news) {
            return res.json({ success: true, data: { categories: [], total: 0 }, disabled: true });
        }
        const meta = await newsCacheService.getMeta(settings);
        return res.json({ success: true, data: meta, cached: true });
    } catch (error) {
        LOG.error('[Trading Routes] Error fetching news meta:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch news meta' });
    }
});

`;

src = src.replace(
  "router.get('/news', async (req, res) => {",
  metaRoute + "router.get('/news', async (req, res) => {"
);

const sliceBlock = `        if (String(req.query.slice || '') === '1') {
            const slice = await newsCacheService.getSlice({
                category: req.query.category || 'All',
                scope: req.query.scope || 'All',
                limit: parseInt(req.query.limit, 10) || 15,
                locationCtx,
                settings,
                refresh,
            });
            return res.json({ success: true, data: slice, cached: true, slice: true, location: hasLocation ? locationCtx : null });
        }

`;

src = src.replace(
  "        if (!settings.enable_news) {\n            return res.json({ success: true, data: { categories: [] }, disabled: true });\n        }",
  "        if (!settings.enable_news) {\n            return res.json({ success: true, data: { categories: [] }, disabled: true });\n        }\n" + sliceBlock
);

fs.writeFileSync(target, src);
console.log('tradingRoutes patched');
