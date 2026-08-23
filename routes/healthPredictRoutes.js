'use strict';

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const healthPredictService = require('../services/healthPredictService');
const LOG = require('../utils/logger');

router.use(authenticateToken);

router.get('/access', async (req, res) => {
    try {
        const { allowed, healthShops } = await healthPredictService.assertAccess(req.user);
        res.json({
            allowed,
            shops: (healthShops || []).map((s) => ({ id: s.id, shop_name: s.shop_name, category: s.category })),
        });
    } catch (err) {
        LOG.error('[HealthPredict] access', err.message);
        res.status(500).json({ allowed: false, error: err.message });
    }
});

router.get('/dashboard', async (req, res) => {
    try {
        const data = await healthPredictService.getDashboard(req.user);
        res.json(data);
    } catch (err) {
        LOG.error('[HealthPredict] dashboard', err.message);
        res.status(err.status || 500).json({ error: err.message });
    }
});

router.post('/reports', async (req, res) => {
    try {
        const data = await healthPredictService.addReport(req.user, req.body || {});
        res.json(data);
    } catch (err) {
        LOG.error('[HealthPredict] report', err.message);
        res.status(err.status || 500).json({ error: err.message });
    }
});

module.exports = router;
