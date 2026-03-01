const express = require('express');
const router = express.Router();
const dealsService = require('../dealsService');
const { authenticateToken } = require('../middleware/auth');
const LOG = require('../utils/logger');

// Get deals with filters
router.get('/deals', async (req, res) => {
    try {
        const filters = {
            company_id: req.query.company_id ? parseInt(req.query.company_id) : null,
            category_id: req.query.category_id ? parseInt(req.query.category_id) : null,
            min_discount_percentage: req.query.min_discount ? parseFloat(req.query.min_discount) : null,
            limit: req.query.limit ? parseInt(req.query.limit) : 100
        };
        const deals = await dealsService.getDealsFromDB(filters);
        res.json(deals);
    } catch (err) {
        LOG.error("Failed to fetch deals", err.message);
        res.status(500).json({ error: err.message });
    }
});

// Sync deals for a company (admin only)
router.post('/deals/sync/:companyId', authenticateToken, async (req, res) => {
    if (req.user.role !== 'super_admin') return res.sendStatus(403);
    try {
        await dealsService.syncCompanyDeals(parseInt(req.params.companyId));
        res.json({ success: true, message: 'Deals synced successfully' });
    } catch (err) {
        LOG.error("Failed to sync deals", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

