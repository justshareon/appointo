const express = require('express');
const router = express.Router();
const newsCacheService = require('../services/newsCacheService');
const settingsService = require('../services/settingsService');
const LOG = require('../utils/logger');

/**
 * GET /api/trading/news/meta
 * Category counts from MySQL / in-memory — no full RSS refresh.
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
    LOG.error('[News Slice] meta failed:', error);
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
      return res.json({ success: true, data: { categories: [] }, disabled: true });
    }
    const refresh = String(req.query.refresh || '') === '1';
    const locationCtx = {
      city: req.query.city || '',
      locality: req.query.locality || req.query.town || '',
      state: req.query.state || '',
      district: req.query.district || '',
      placeLabel: req.query.placeLabel || '',
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
    res.status(500).json({ error: error.message || 'Failed to fetch news slice' });
  }
});

module.exports = router;
