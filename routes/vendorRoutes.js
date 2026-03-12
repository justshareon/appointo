const express = require('express');
const router = express.Router();
const vendorService = require('../services/vendorService');
const notificationService = require('../services/notificationService');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const LOG = require('../utils/logger');

/**
 * GET /api/vendors
 * Get all vendors with optional filtering
 */
router.get('/', async (req, res) => {
    try {
        const vendors = await vendorService.getVendors(req);
        res.json(vendors);
    } catch (err) {
        LOG.error("Failed to fetch vendors", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/vendors/me
 * Get vendor profile for logged-in user
 */
router.get('/me', authenticateToken, async (req, res) => {
    try {
        let userEmail = req.user.email;
        if (!userEmail && req.user.id) {
            const user = await db.getUserById(req.user.id);
            userEmail = user?.email;
        }

        const vendor = await vendorService.getMyVendorProfile(req.user.id, userEmail);
        res.json(vendor);
    } catch (err) {
        LOG.error("Failed to fetch vendor profile", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/vendors/create-my-shop
 * Create vendor shop for logged-in user
 */
router.post('/create-my-shop', authenticateToken, async (req, res) => {
    try {
        const result = await vendorService.createMyShop(req.user.id, req.body);
            notificationService.notify('vendor_created', {
                userId: req.user.id,
                vendorId: result?.vendor_id || result?.id
            }).catch(err => LOG.error('Vendor create notification failed', err.message));
        res.json(result);
    } catch (err) {
        LOG.error('Failed to create vendor profile', err.message);
        const statusCode = err.message.includes('not found') ? 404 : 500;
        res.status(statusCode).json({ error: err.message });
    }
});

/**
 * POST /api/vendors/update-my-profile
 * Update vendor profile
 */
router.post('/update-my-profile', authenticateToken, async (req, res) => {
    try {
        const result = await vendorService.updateMyProfile(req.user.id, req.body);
            notificationService.notify('vendor_updated', {
                userId: req.user.id,
                vendorId: result?.vendor_id || result?.id
            }).catch(err => LOG.error('Vendor update notification failed', err.message));
        res.json(result);
    } catch (err) {
        LOG.error('Failed to update vendor profile', err.message);
        const statusCode = err.message.includes('not found') ? 404 : 500;
        res.status(statusCode).json({ error: err.message });
    }
});

/**
 * GET /api/vendors/:id
 * Get vendor by ID
 */
router.get('/:id', async (req, res) => {
    try {
        const vendor = await vendorService.getVendorById(req.params.id);
        res.json(vendor);
    } catch (err) {
        LOG.error("Failed to fetch vendor details", err.message);
        const statusCode = err.message.includes('not found') ? 404 : 500;
        res.status(statusCode).json({ error: err.message });
    }
});

/**
 * GET /api/vendors/:id/queue
 * Get vendor queue
 */
router.get('/:id/queue', async (req, res) => {
    try {
        const queue = await vendorService.getVendorQueue(req.params.id);
        res.json(queue);
    } catch (err) {
        LOG.error("Failed to fetch queue", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/vendors/:id/products
 * Get vendor products
 */
router.get('/:id/products', async (req, res) => {
    try {
        const products = await vendorService.getVendorProducts(req.params.id);
        res.json(products);
    } catch (err) {
        LOG.error("Failed to fetch vendor products", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/vendors/:id/matchmaking/template
 * Get vendor matchmaking template (public)
 */
router.get('/:id/matchmaking/template', async (req, res, next) => {
    try {
        // Let explicit self/me routes handle these reserved IDs
        if (req.params.id === 'me' || req.params.id === 'self') {
            return next();
        }
        const template = await matchmakingService.getVendorTemplate(req.params.id);
        res.json(template);
    } catch (err) {
        LOG.error("Failed to fetch vendor matchmaking template", err.message);
        const statusCode = err.message.includes('not enabled') || err.message.includes('not found') ? 404 : 500;
        res.status(statusCode).json({ error: err.message });
    }
});

/**
 * GET /api/vendors/me/products
 * Get my products (for logged-in vendor)
 */
router.get('/me/products', authenticateToken, async (req, res) => {
    try {
        const products = await vendorService.getMyProducts(req.user.id);
        res.json(products);
    } catch (err) {
        LOG.error("Failed to fetch own products", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/vendors/me/appointments
 * Get my appointments (for logged-in vendor)
 */
router.get('/me/appointments', authenticateToken, async (req, res) => {
    try {
        const appointments = await vendorService.getMyAppointments(req.user.id);
        res.json(appointments);
    } catch (err) {
        LOG.error("Failed to fetch vendor appointments", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/vendors/me/products/add
 * Add product for logged-in vendor
 */
router.post('/me/products/add', authenticateToken, async (req, res) => {
    try {
        const productService = require('../services/productService');
        const result = await productService.addProduct(req.user.id, req.body);
            notificationService.notify('product_added', {
                userId: req.user.id,
                productId: result?.product_id || result?.id
            }).catch(err => LOG.error('Product add notification failed', err.message));
        res.json(result);
    } catch (err) {
        LOG.error("Failed to add product", err.message);
        const statusCode = err.message.includes('required') ? 400 : 500;
        res.status(statusCode).json({ error: err.message });
    }
});

/**
 * POST /api/vendors/me/products/:id/update
 * Update product for logged-in vendor
 */
router.post('/me/products/:id/update', authenticateToken, async (req, res) => {
    try {
        const productService = require('../services/productService');
        const result = await productService.updateProduct(req.user.id, req.params.id, req.body);
            notificationService.notify('product_updated', {
                userId: req.user.id,
                productId: req.params.id
            }).catch(err => LOG.error('Product update notification failed', err.message));
        res.json(result);
    } catch (err) {
        LOG.error("Failed to update product", err.message);
        const statusCode = err.message.includes('not found') ? 404 : 500;
        res.status(statusCode).json({ error: err.message });
    }
});

module.exports = router;

