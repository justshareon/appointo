const express = require('express');
const router = express.Router();
const newsCacheService = require('../services/newsCacheService');
const settingsService = require('../services/settingsService');
const { recordNewsLog } = require('../services/newsLogService');
const LOG = require('../utils/logger');

/**
 * GET /api/trading/news/meta
 * Category counts from MySQL / in-memory — no full RSS refresh.
 */
router.get('/news/meta', async (req, res) => {
  try {
    const settings = await settingsService.getSettings();
    if (!settings.enable_news) {
      recordNewsLog({ level: 'L1', stage: 'meta', message: 'GET /news/meta — enable_news OFF' });
      return res.json({ success: true, data: { categories: [], total: 0 }, disabled: true });
    }
    const meta = await newsCacheService.getMeta(settings);
    return res.json({ success: true, data: meta, cached: true });
  } catch (error) {
    LOG.error('[News Slice] meta failed:', error);
    recordNewsLog({ level: 'L1', stage: 'meta', message: `Meta failed: ${error.message}` });
    res.status(500).json({ error: error.message || 'Failed to fetch news meta' });
  }
});

/**
 * GET /api/trading/news/slice
 * Lazy slice for active scope + category only.
 */
router.get('/news/slice', async (req, res) => {
  try {
    const settings = await settingsService.getSettings();
    if (!settings.enable_news) {
      recordNewsLog({
        level: 'L1',
        stage: 'slice',
        message: `GET /news/slice blocked — enable_news OFF · scope=${req.query.scope || 'All'}`,
      });
      return res.json({ success: true, data: { categories: [] }, disabled: true });
    }
    const refresh = String(req.query.refresh || '') === '1';
    const locationCtx = {
      city: req.query.city || '',
      town: req.query.town || req.query.locality || '',
      locality: req.query.locality || req.query.town || '',
      state: req.query.state || '',
      district: req.query.district || '',
      placeLabel: req.query.placeLabel || '',
      language: req.query.language || settings.gnews_language || settings.newsapi_language || 'hi',
    };
    const slice = await newsCacheService.getSlice({
      category: req.query.category || 'All',
      scope: req.query.scope || 'All',
      limit: Math.min(parseInt(req.query.limit, 10) || 15, 20),
      locationCtx,
      settings,
      refresh,
    });
    return res.json({
      success: true,
      data: slice,
      cached: true,
      slice: true,
      location: locationCtx.city || locationCtx.locality ? locationCtx : null,
    });
  } catch (error) {
    LOG.error('[News Slice] slice failed:', error);
    recordNewsLog({
      level: 'L1',
      stage: 'slice',
      message: `Slice route failed: ${error.message}`,
      meta: { scope: req.query.scope, category: req.query.category },
    });
    res.status(500).json({ error: error.message || 'Failed to fetch news slice' });
  }
});

module.exports = router;
