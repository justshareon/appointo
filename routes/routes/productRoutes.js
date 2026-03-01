const express = require('express');
const router = express.Router();
const productService = require('../services/productService');
const { authenticateToken } = require('../middleware/auth');
const LOG = require('../utils/logger');

/**
 * GET /api/products
 * Get all products with vendor information
 */
router.get('/', async (req, res) => {
    try {
        const products = await productService.getAllProducts();
        res.json(products);
    } catch (err) {
        LOG.error("Failed to fetch products", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/products/:id
 * Get product by ID
 */
router.get('/:id', async (req, res) => {
    try {
        const product = await productService.getProductById(req.params.id);
        res.json(product);
    } catch (err) {
        LOG.error("Failed to fetch product details", err.message);
        const statusCode = err.message.includes('not found') || err.message.includes('not available') ? 404 : 500;
        res.status(statusCode).json({ error: err.message });
    }
});


module.exports = router;

