const express = require('express');
const router = express.Router();
const marketplaceSliceService = require('../services/marketplaceSliceService');
const LOG = require('../utils/logger');

/**
 * GET /api/marketplace/slice
 * Lazy load — only requested sources for active scope/category/type.
 * Query: scope, category, type, sources (deals|vendors|products), limit, city, locality
 */
router.get('/marketplace/slice', async (req, res) => {
  try {
    const data = await marketplaceSliceService.getSlice({
      scope: req.query.scope || 'All',
      category: req.query.category || 'all',
      type: req.query.type || 'all',
      sources: req.query.sources || 'deals',
      limit: Math.min(parseInt(req.query.limit, 10) || 20, 30),
      city: req.query.city || '',
      town: req.query.town || req.query.locality || '',
      locality: req.query.locality || req.query.town || '',
      state: req.query.state || '',
      language: req.query.language || 'hi',
      refresh: String(req.query.refresh || '') === '1',
    });
    res.json({ success: true, data });
  } catch (err) {
    LOG.error('[Marketplace] slice failed:', err.message);
    res.status(500).json({ error: err.message || 'Slice failed' });
  }
});

module.exports = router;
