const db = require('../database');
const LOG = require('../utils/logger');
const { resolveProductImages } = require('../../../utils/categoryImages');

/**
 * Product Service
 * Handles product-related business logic
 */
class ProductService {
    /**
     * Get all products with vendor information
     */
    async getAllProducts() {
        return await db.getAllProductsWithVendors() || [];
    }

    /**
     * Get product by ID with vendor information
     */
    async getProductById(productId) {
        const product = await db.getProductById(productId);
        if (!product) {
            throw new Error("Product not found");
        }

        const vendor = await db.getVendorById(product.vendor_id);
        if (!vendor || vendor.features_products === false) {
            throw new Error("Product not available");
        }

        return {
            ...product,
            shop_name: vendor.shop_name,
            vendor_category: vendor.category,
            category: product.category || vendor.category,
        };
    }

    /**
     * Add product for vendor
     */
    async addProduct(userId, productData) {
        let vendor = await db.getVendorByOwnerId(userId);

        // Auto-create vendor profile if missing
        if (!vendor) {
            LOG.warning(`No vendor profile found for user ${userId}. Creating default...`);
            const user = await db.getUserById(userId);
            vendor = {
                id: 'v_' + Math.random().toString(36).substring(2, 10),
                owner_id: userId,
                shop_name: user?.name ? `${user.name}'s Shop` : "My New Shop",
                category: 'General',
                is_active: true,
                is_promoted: false,
                latitude: 0,
                longitude: 0,
                features_products: true,
                features_payments: true,
                features_appointments: true,
                features_queue: true,
                features_matchmaking: false
            };
            await db.addVendor(vendor);
            LOG.success(`Auto-created vendor profile: ${vendor.id}`);
        }

        const { name, price, offer, offer_amount, validity_from, validity_to, description, image_urls } = productData;
        if (!name || !price) {
            throw new Error("name and price are required");
        }

        const normalizedImages = Array.isArray(image_urls) ? image_urls.filter(Boolean) : [];
        const finalImages = resolveProductImages(normalizedImages, vendor.category, name);

        const product = {
            vendor_id: vendor.id,
            name,
            price: Number(price),
            offer: offer || '',
            offer_amount: Number(offer_amount || 0),
            validity_from: validity_from || null,
            validity_to: validity_to || null,
            description: description || '',
            image_urls: finalImages,
            category: vendor.category || 'General',
            stock: 100
        };

        const added = await db.addProduct(product);
        LOG.success(`Product added to vendor ${vendor.id}: ${name}`);
        return { success: true, product: added };
    }

    /**
     * Update product
     */
    async updateProduct(userId, productId, updateData) {
        const vendor = await db.getVendorByOwnerId(userId);
        if (!vendor) {
            throw new Error("Vendor profile not found");
        }

        const existing = await db.getProductById(productId);
        if (!existing || existing.vendor_id !== vendor.id) {
            throw new Error("Product not found for this vendor");
        }

        const fields = ['name', 'price', 'offer', 'offer_amount', 'validity_from', 'validity_to', 'description', 'image_urls', 'stock'];
        const updateFields = {};
        
        fields.forEach((f) => {
            if (Object.prototype.hasOwnProperty.call(updateData, f)) {
                updateFields[f] = updateData[f];
            }
        });

        // Keep first/default image fixed
        if (Object.prototype.hasOwnProperty.call(updateFields, 'image_urls')) {
            const existingImages = Array.isArray(existing.image_urls) ? existing.image_urls.filter(Boolean) : [];
            const incoming = Array.isArray(updateFields.image_urls) ? updateFields.image_urls.filter(Boolean) : [];
            updateFields.image_urls = resolveProductImages(
                incoming.length ? incoming : existingImages,
                vendor.category,
                productId
            );
        }

        const updated = await db.updateProduct(productId, updateFields);
        return { success: true, product: updated };
    }
}

module.exports = new ProductService();

