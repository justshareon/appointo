/**
 * Shopping feature DB (products + orders) — in-memory first.
 * Connected from backend/database.js via dbContext.
 */
module.exports = function createShoppingFeature(ctx) {
    const getPool = () => ctx.getPool();
    const LOG = ctx.LOG;
    const mem = () => ctx.inMemoryDb;
    const normalizeProductRow = (row) => ctx.normalizeProductRow(row);

    return {
        feature: 'shopping',
        getProductsByVendor: async (vendorId) => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    const [rows] = await getPool().query('SELECT * FROM products WHERE vendor_id = ? ORDER BY id DESC', [vendorId]);
                    if (rows) return rows.map(normalizeProductRow);
                }
            } catch (err) {
                LOG.error(`MySQL getProductsByVendor failed for ${vendorId}, falling back to local`, err.message);
            }
            return inMemoryDb.products.filter(p => p.vendor_id === vendorId).map(normalizeProductRow);
        },

        getProductById: async (id) => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    const [rows] = await getPool().query('SELECT * FROM products WHERE id = ?', [id]);
                    if (rows && rows.length > 0) return normalizeProductRow(rows[0]);
                }
            } catch (err) {
                LOG.error(`MySQL getProductById failed for ${id}, falling back to local`, err.message);
            }
            const item = inMemoryDb.products.find(p => String(p.id) === String(id));
            return item ? normalizeProductRow(item) : null;
        },

        getAllProductsWithVendors: async () => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    const [rows] = await getPool().query(
                        `SELECT p.*, v.shop_name, v.features_payments, v.features_products
                         FROM products p JOIN vendors v ON p.vendor_id = v.id
                         WHERE v.is_active = TRUE AND v.features_products = TRUE
                         ORDER BY p.id DESC`
                    );
                    if (rows) return rows.map(normalizeProductRow);
                }
            } catch (err) {
                LOG.error("MySQL getAllProductsWithVendors failed, falling back to local", err.message);
            }
            return inMemoryDb.products
                .filter((p) => (inMemoryDb.vendors.find((x) => x.id === p.vendor_id)?.features_products !== false))
                .map((p) => {
                    const v = inMemoryDb.vendors.find((x) => x.id === p.vendor_id) || {};
                    return {
                        ...normalizeProductRow(p),
                        shop_name: v.shop_name || 'Unknown Shop',
                        features_payments: v.features_payments !== false,
                        features_products: v.features_products !== false
                    };
                });
        },

        addProduct: async (productData) => {
            const inMemoryDb = mem();
            const imageUrls = Array.isArray(productData.image_urls) ? productData.image_urls.filter(Boolean) : [];
            try {
                if (getPool()) {
                    const payload = { ...productData, image_urls_json: JSON.stringify(imageUrls) };
                    delete payload.image_urls;
                    await getPool().query('INSERT INTO products SET ?', [payload]);
                    const [rows] = await getPool().query('SELECT * FROM products WHERE id = LAST_INSERT_ID()');
                    if (rows && rows[0]) return normalizeProductRow(rows[0]);
                }
            } catch (err) {
                LOG.error("MySQL addProduct failed, falling back to local", err.message);
            }
            const newId = (inMemoryDb.products[inMemoryDb.products.length - 1]?.id || 0) + 1;
            const item = { id: newId, ...productData, image_urls: imageUrls };
            inMemoryDb.products.push(item);
            return normalizeProductRow(item);
        },

        updateProduct: async (productId, updateData) => {
            const inMemoryDb = mem();
            const imageUrls = Array.isArray(updateData.image_urls) ? updateData.image_urls.filter(Boolean) : null;
            try {
                if (getPool()) {
                    const payload = { ...updateData };
                    if (imageUrls) payload.image_urls_json = JSON.stringify(imageUrls);
                    delete payload.image_urls;
                    await getPool().query('UPDATE products SET ? WHERE id = ?', [payload, productId]);
                    return ctx.db.getProductById(productId);
                }
            } catch (err) {
                LOG.error(`MySQL updateProduct failed for ${productId}, falling back to local`, err.message);
            }
            const item = inMemoryDb.products.find(p => String(p.id) === String(productId));
            if (!item) return null;
            Object.assign(item, updateData);
            if (imageUrls) item.image_urls = imageUrls;
            return normalizeProductRow(item);
        },

        addOrder: async (orderData) => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    await getPool().query('INSERT INTO orders SET ?', [orderData]);
                    return orderData;
                }
            } catch (err) {
                LOG.error("MySQL addOrder failed, falling back to local", err.message);
            }
            const newId = (inMemoryDb.orders[inMemoryDb.orders.length - 1]?.id || 0) + 1;
            const item = { id: newId, ...orderData };
            inMemoryDb.orders.push(item);
            return item;
        },

        getOrdersByVendorOwner: async (ownerId) => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    const [rows] = await getPool().query(
                        `SELECT o.*, v.shop_name, u.name as user_name
                         FROM orders o
                         JOIN vendors v ON o.vendor_id = v.id
                         LEFT JOIN users u ON o.user_id = u.id
                         WHERE v.owner_id = ?
                         ORDER BY o.created_at DESC`,
                        [ownerId]
                    );
                    if (rows) return rows;
                }
            } catch (err) {
                LOG.error(`MySQL getOrdersByVendorOwner failed for ${ownerId}, falling back to local`, err.message);
            }
            const ownedVendorIds = inMemoryDb.vendors.filter(v => v.owner_id === ownerId).map(v => v.id);
            return inMemoryDb.orders
                .filter(o => ownedVendorIds.includes(o.vendor_id))
                .map(o => ({
                    ...o,
                    shop_name: inMemoryDb.vendors.find(v => v.id === o.vendor_id)?.shop_name || 'Unknown Shop',
                    user_name: inMemoryDb.users.find(u => u.id === o.user_id)?.name || 'User'
                }))
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        },

        getAllOrders: async () => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    const [rows] = await getPool().query('SELECT * FROM orders');
                    return rows;
                }
            } catch (err) {
                LOG.error("MySQL getAllOrders failed", err.message);
            }
            return inMemoryDb.orders;
        },

        getAllProducts: async () => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    const [rows] = await getPool().query('SELECT * FROM products');
                    return rows;
                }
            } catch (err) {
                LOG.error("MySQL getAllProducts failed", err.message);
            }
            return inMemoryDb.products;
        },
    };
};
