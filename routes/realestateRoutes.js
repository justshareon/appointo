const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const listing = require('../services/realestateListingService');
const LOG = require('../utils/logger');
const { authenticateToken } = require('../middleware/auth');

function peekUser(req) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return null;
    try {
        return jwt.verify(token, process.env.JWT_SECRET || 'secret');
    } catch (e) {
        return null;
    }
}

router.get('/debug', async (req, res) => {
    try {
        const snap = await listing.debugSnapshot();
        const user = peekUser(req);
        LOG.info(`[RE-DASH] GET /debug user=${user?.email || user?.id || 'anon'}`);
        res.json({ ...snap, user: user ? { id: user.id, email: user.email, role: user.role } : null });
    } catch (err) {
        LOG.error('[RE-DASH] debug failed', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.get('/properties', async (req, res) => {
    try {
        const vendorId = req.query.vendorId || req.query.vendor_id || '';
        const result = await listing.listProperties({ vendorId: vendorId || undefined });
        LOG.info(`[RE-DASH] GET /properties count=${result.properties.length} vendor=${vendorId || 'all'}`);
        res.json({ success: true, properties: result.properties, debug: result.debug });
    } catch (err) {
        LOG.error('[RE-DASH] GET /properties failed', err.message);
        res.status(500).json({ success: false, error: err.message, properties: [] });
    }
});

router.post('/properties', authenticateToken, async (req, res) => {
    try {
        const row = await listing.addProperty(req.body || {}, req.body?.vendor_id);
        LOG.info(`[RE-DASH] POST /properties id=${row.id} by=${req.user?.email || req.user?.id}`);
        res.json({ success: true, property: row });
    } catch (err) {
        LOG.error('[RE-DASH] POST /properties failed', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/enquiries', authenticateToken, async (req, res) => {
    try {
        const rows = await listing.listEnquiries({
            vendorId: req.query.vendorId || req.query.vendor_id,
            userId: req.query.mine === '1' ? req.user.id : req.query.userId,
        });
        LOG.info(`[RE-DASH] GET /enquiries count=${rows.length}`);
        res.json({ success: true, enquiries: rows });
    } catch (err) {
        LOG.error('[RE-DASH] GET /enquiries failed', err.message);
        res.status(500).json({ success: false, error: err.message, enquiries: [] });
    }
});

router.post('/enquiries', authenticateToken, async (req, res) => {
    try {
        const body = req.body || {};
        const row = await listing.addEnquiry({
            property_id: body.property_id,
            user_id: req.user.id,
            name: body.name || req.user.name || 'Buyer',
            email: body.email || req.user.email || '',
            mobile: body.mobile || req.user.mobile || '',
            message: body.message,
            enquiry_type: body.enquiry_type,
        });
        LOG.info(`[RE-DASH] POST /enquiries id=${row.id} property=${row.property_id}`);
        res.json({ success: true, enquiry: row });
    } catch (err) {
        LOG.error('[RE-DASH] POST /enquiries failed', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
