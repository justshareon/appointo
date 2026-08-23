/**
 * Shopping feature DB (products + orders) — in-memory first.
 * Products are unique per vendor by normalized name (trim + case-insensitive).
 */
module.exports = function createShoppingFeature(ctx) {
    const getPool = () => ctx.getPool();
    const LOG = ctx.LOG;
    const mem = () => ctx.inMemoryDb;
    const normalizeProductRow = (row) => ctx.normalizeProductRow(row);

    const productNameKey = (name) =>
        String(name || '')
            .trim()
            .replace(/\s+/g, ' ')
            .toLowerCase();

    const api = {
        feature: 'shopping',
        productNameKey,

        ensureTables: async (mainDb) => {
            if (mainDb?.ensureFeatureSchema) await mainDb.ensureFeatureSchema('shopping');
        },

        getProductsByVendor: async (vendorId) => {
            const inMemoryDb = mem();
            const ids = new Set([String(vendorId)]);
            const localVendor = (inMemoryDb.vendors || []).find((v) => String(v.id) === String(vendorId));
            const shopName = localVendor?.shop_name;
            if (shopName) {
                (inMemoryDb.vendors || []).forEach((v) => {
                    if (v.shop_name === shopName) ids.add(String(v.id));
                });
            }

            let mysqlRows = [];
            try {
                if (getPool()) {
                    const idList = [...ids];
                    const placeholders = idList.map(() => '?').join(',');
                    const [rows] = await getPool().query(
                        `SELECT p.*, v.category AS vendor_category
                         FROM products p
                         LEFT JOIN vendors v ON p.vendor_id = v.id
                         WHERE p.vendor_id IN (${placeholders})
                         ORDER BY p.id DESC`,
                        idList
                    );
                    mysqlRows = (rows || []).map(normalizeProductRow);
                }
            } catch (err) {
                LOG.error(`MySQL getProductsByVendor failed for ${vendorId}, falling back to local`, err.message);
            }

            const localRows = (inMemoryDb.products || [])
                .filter((p) => ids.has(String(p.vendor_id)))
                .map(normalizeProductRow);
            const merged = new Map();
            [...mysqlRows, ...localRows].forEach((p) => {
                if (p?.id != null) merged.set(String(p.id), p);
            });
            // Collapse name-duplicates per vendor (keep smallest id)
            const byName = new Map();
            [...merged.values()]
                .sort((a, b) => Number(a.id) - Number(b.id))
                .forEach((p) => {
                    const k = `${String(p.vendor_id)}::${productNameKey(p.name)}`;
                    if (!byName.has(k)) byName.set(k, p);
                });
            return [...byName.values()];
        },

        findDuplicateForVendor: async (vendorId, name, excludeId = null) => {
            const key = productNameKey(name);
            if (!key || !vendorId) return null;
            const list = await api.getProductsByVendor(vendorId);
            return (
                list.find((p) => {
                    if (excludeId != null && String(p.id) === String(excludeId)) return false;
                    return productNameKey(p.name) === key;
                }) || null
            );
        },

        getProductById: async (id) => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    const [rows] = await getPool().query(
                        `SELECT p.*, v.category AS vendor_category
                         FROM products p
                         LEFT JOIN vendors v ON p.vendor_id = v.id
                         WHERE p.id = ?`,
                        [id]
                    );
                    if (rows && rows.length > 0) return normalizeProductRow(rows[0]);
                }
            } catch (err) {
                LOG.error(`MySQL getProductById failed for ${id}, falling back to local`, err.message);
            }
            const item = inMemoryDb.products.find((p) => String(p.id) === String(id));
            return item ? normalizeProductRow(item) : null;
        },

        getAllProductsWithVendors: async () => {
            const inMemoryDb = mem();
            let mysqlRows = [];
            try {
                if (getPool()) {
                    const [rows] = await getPool().query(
                        `SELECT p.*, v.shop_name, v.category AS vendor_category, v.features_payments, v.features_products
                         FROM products p
                         LEFT JOIN vendors v ON p.vendor_id = v.id
                         WHERE (v.id IS NULL OR v.is_active = TRUE)
                           AND (v.features_products IS NULL OR v.features_products = 1 OR v.features_products = TRUE OR v.id IS NULL)
                         ORDER BY p.id DESC`
                    );
                    mysqlRows = (rows || []).map(normalizeProductRow);
                }
            } catch (err) {
                LOG.error('MySQL getAllProductsWithVendors failed, falling back to local', err.message);
            }

            const localRows = (inMemoryDb.products || [])
                .filter((p) => {
                    const v = (inMemoryDb.vendors || []).find((x) => String(x.id) === String(p.vendor_id));
                    if (!v) return true;
                    return v.features_products !== false && v.features_products !== 0;
                })
                .map((p) => {
                    const v = (inMemoryDb.vendors || []).find((x) => String(x.id) === String(p.vendor_id)) || {};
                    return {
                        ...normalizeProductRow(p),
                        shop_name: v.shop_name || 'Unknown Shop',
                        vendor_category: v.category || p.vendor_category,
                        features_payments: v.features_payments !== false,
                        features_products: v.features_products !== false,
                    };
                });

            const byId = new Map();
            [...mysqlRows, ...localRows].forEach((p) => {
                if (p?.id != null) byId.set(String(p.id), p);
            });
            const byVendorName = new Map();
            [...byId.values()]
                .sort((a, b) => Number(a.id) - Number(b.id))
                .forEach((p) => {
                    const k = `${String(p.vendor_id)}::${productNameKey(p.name)}`;
                    if (!byVendorName.has(k)) byVendorName.set(k, p);
                });
            return [...byVendorName.values()];
        },

        addProduct: async (productData) => {
            const inMemoryDb = mem();
            const trimmedName = String(productData.name || '')
                .trim()
                .replace(/\s+/g, ' ');
            if (!trimmedName) {
                throw new Error('Product name is required');
            }
            const nameKey = productNameKey(trimmedName);
            productData = { ...productData, name: trimmedName, name_key: nameKey };

            const dup = await api.findDuplicateForVendor(productData.vendor_id, trimmedName);
            if (dup) {
                const err = new Error(`Product "${trimmedName}" already exists for this vendor`);
                err.code = 'DUPLICATE_PRODUCT';
                throw err;
            }

            const imageUrls = Array.isArray(productData.image_urls) ? productData.image_urls.filter(Boolean) : [];
            let saved = null;

            const memId = productData.id || (inMemoryDb.products[inMemoryDb.products.length - 1]?.id || 0) + 1;
            const memItem = {
                id: memId,
                ...productData,
                name: trimmedName,
                name_key: nameKey,
                image_urls: imageUrls,
            };
            inMemoryDb.products.push(memItem);
            saved = normalizeProductRow(memItem);

            try {
                if (getPool()) {
                    const payload = {
                        vendor_id: productData.vendor_id,
                        name: trimmedName,
                        name_key: nameKey,
                        price: productData.price,
                        description: productData.description || '',
                        offer: productData.offer || '',
                        offer_amount: productData.offer_amount || 0,
                        image_urls_json: JSON.stringify(imageUrls),
                        validity_from: productData.validity_from || null,
                        validity_to: productData.validity_to || null,
                        category: productData.category || '',
                        stock: productData.stock != null ? productData.stock : 100,
                    };
                    const [result] = await getPool().query(
                        `INSERT INTO products (vendor_id, name, name_key, price, description, offer, offer_amount, image_urls_json, validity_from, validity_to, category, stock)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            payload.vendor_id,
                            payload.name,
                            payload.name_key,
                            payload.price,
                            payload.description,
                            payload.offer,
                            payload.offer_amount,
                            payload.image_urls_json,
                            payload.validity_from,
                            payload.validity_to,
                            payload.category,
                            payload.stock,
                        ]
                    );
                    const insertId = result?.insertId;
                    if (insertId) {
                        const idx = inMemoryDb.products.findIndex((p) => String(p.id) === String(memId));
                        if (idx >= 0) {
                            inMemoryDb.products[idx].id = insertId;
                            saved = normalizeProductRow(inMemoryDb.products[idx]);
                        }
                    }
                } else {
                    const { mirrorQuery } = require('../mysqlMirror');
                    await mirrorQuery(
                        `INSERT INTO products (vendor_id, name, name_key, price, description, offer, offer_amount, image_urls_json, validity_from, validity_to, category, stock)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            productData.vendor_id,
                            trimmedName,
                            nameKey,
                            productData.price,
                            productData.description || '',
                            productData.offer || '',
                            productData.offer_amount || 0,
                            JSON.stringify(imageUrls),
                            productData.validity_from || null,
                            productData.validity_to || null,
                            productData.category || '',
                            productData.stock != null ? productData.stock : 100,
                        ]
                    );
                }
            } catch (err) {
                if (err.code === 'DUPLICATE_PRODUCT') throw err;
                if (err.code === 'ER_DUP_ENTRY' || /duplicate/i.test(String(err.message || ''))) {
                    inMemoryDb.products = inMemoryDb.products.filter((p) => String(p.id) !== String(memId));
                    const e = new Error(`Product "${trimmedName}" already exists for this vendor`);
                    e.code = 'DUPLICATE_PRODUCT';
                    throw e;
                }
                LOG.error('MySQL addProduct failed, in-memory product kept', err.message);
            }
            return saved;
        },

        updateProduct: async (productId, updateData) => {
            const inMemoryDb = mem();
            const existing = await api.getProductById(productId);
            if (!existing) return null;

            const payload = { ...updateData };
            if (payload.name != null) {
                const trimmedName = String(payload.name)
                    .trim()
                    .replace(/\s+/g, ' ');
                payload.name = trimmedName;
                payload.name_key = productNameKey(trimmedName);
                const dup = await api.findDuplicateForVendor(existing.vendor_id, trimmedName, productId);
                if (dup) {
                    const err = new Error(`Product "${trimmedName}" already exists for this vendor`);
                    err.code = 'DUPLICATE_PRODUCT';
                    throw err;
                }
            }

            const imageUrls = Array.isArray(payload.image_urls) ? payload.image_urls.filter(Boolean) : null;
            try {
                if (getPool()) {
                    const mysqlPayload = { ...payload };
                    if (imageUrls) mysqlPayload.image_urls_json = JSON.stringify(imageUrls);
                    delete mysqlPayload.image_urls;
                    await getPool().query('UPDATE products SET ? WHERE id = ?', [mysqlPayload, productId]);
                    return api.getProductById(productId);
                }
            } catch (err) {
                if (err.code === 'DUPLICATE_PRODUCT') throw err;
                if (err.code === 'ER_DUP_ENTRY' || /duplicate/i.test(String(err.message || ''))) {
                    const e = new Error(`Product "${payload.name}" already exists for this vendor`);
                    e.code = 'DUPLICATE_PRODUCT';
                    throw e;
                }
                LOG.error(`MySQL updateProduct failed for ${productId}, falling back to local`, err.message);
            }
            const item = inMemoryDb.products.find((p) => String(p.id) === String(productId));
            if (!item) return null;
            Object.assign(item, payload);
            if (imageUrls) item.image_urls = imageUrls;
            return normalizeProductRow(item);
        },

        deleteProduct: async (productId) => {
            const inMemoryDb = mem();
            const before = (inMemoryDb.products || []).length;
            inMemoryDb.products = (inMemoryDb.products || []).filter((p) => String(p.id) !== String(productId));
            try {
                if (getPool()) {
                    await getPool().query('DELETE FROM products WHERE id = ?', [productId]);
                } else {
                    const { mirrorQuery } = require('../mysqlMirror');
                    await mirrorQuery('DELETE FROM products WHERE id = ?', [productId]);
                }
            } catch (err) {
                LOG.error(`MySQL deleteProduct failed for ${productId}`, err.message);
            }
            return before !== inMemoryDb.products.length;
        },

        /**
         * Remove duplicate products per vendor (case-insensitive name). Keeps lowest id.
         */
        dedupeProductsByVendor: async () => {
            const inMemoryDb = mem();
            const keep = new Map();
            const removeIds = [];
            const sorted = [...(inMemoryDb.products || [])].sort((a, b) => Number(a.id) - Number(b.id));
            sorted.forEach((p) => {
                const k = `${String(p.vendor_id)}::${productNameKey(p.name)}`;
                if (!keep.has(k)) {
                    keep.set(k, p);
                    if (p && !p.name_key) p.name_key = productNameKey(p.name);
                } else {
                    removeIds.push(p.id);
                }
            });
            if (removeIds.length) {
                const removeSet = new Set(removeIds.map(String));
                inMemoryDb.products = inMemoryDb.products.filter((p) => !removeSet.has(String(p.id)));
                LOG.info(`[Shopping] Removed ${removeIds.length} duplicate in-memory products`);
            }

            let mysqlRemoved = 0;
            try {
                if (getPool()) {
                    await getPool().query(`
                        UPDATE products
                        SET name_key = LOWER(TRIM(name))
                        WHERE name_key IS NULL OR name_key = ''
                    `).catch(() => {});

                    const [result] = await getPool().query(`
                        DELETE p FROM products p
                        INNER JOIN (
                            SELECT vendor_id, LOWER(TRIM(name)) AS nk, MIN(id) AS keep_id
                            FROM products
                            GROUP BY vendor_id, LOWER(TRIM(name))
                            HAVING COUNT(*) > 1
                        ) d ON p.vendor_id = d.vendor_id
                            AND LOWER(TRIM(p.name)) = d.nk
                            AND p.id <> d.keep_id
                    `);
                    mysqlRemoved = result?.affectedRows || 0;
                    if (mysqlRemoved) {
                        LOG.info(`[Shopping] Removed ${mysqlRemoved} duplicate MySQL products`);
                    }
                }
            } catch (err) {
                LOG.warning('[Shopping] MySQL dedupe failed:', err.message);
            }

            return { removedMemory: removeIds.length, removedMysql: mysqlRemoved, removeIds };
        },

        addOrder: async (orderData) => {
            const inMemoryDb = mem();
            const payload = {
                vendor_id: orderData.vendor_id,
                user_id: orderData.user_id,
                total_amount: orderData.total_amount,
                payment_gateway: orderData.payment_gateway || null,
                payment_ref: orderData.payment_ref || null,
                status: orderData.status || 'paid',
                items_json: typeof orderData.items_json === 'string'
                    ? orderData.items_json
                    : JSON.stringify(orderData.items || orderData.items_json || []),
                fulfillment_status: orderData.fulfillment_status || 'received',
                current_location: orderData.current_location || 'Shop counter',
                location_updated_at: orderData.location_updated_at || new Date(),
            };
            try {
                if (getPool()) {
                    const [result] = await getPool().query(
                        `INSERT INTO orders (vendor_id, user_id, total_amount, payment_gateway, payment_ref, status, items_json, fulfillment_status, current_location, location_updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            payload.vendor_id,
                            payload.user_id,
                            payload.total_amount,
                            payload.payment_gateway,
                            payload.payment_ref,
                            payload.status,
                            payload.items_json,
                            payload.fulfillment_status,
                            payload.current_location,
                            payload.location_updated_at,
                        ]
                    );
                    const insertId = result?.insertId;
                    if (insertId) {
                        payload.id = insertId;
                        const memItem = { ...orderData, ...payload, id: insertId };
                        inMemoryDb.orders = inMemoryDb.orders || [];
                        inMemoryDb.orders.push(memItem);
                        return memItem;
                    }
                    return { ...orderData, ...payload };
                }
            } catch (err) {
                LOG.error('MySQL addOrder failed, falling back to local', err.message);
            }
            const newId = (inMemoryDb.orders[inMemoryDb.orders.length - 1]?.id || 0) + 1;
            const item = { ...orderData, ...payload, id: newId };
            inMemoryDb.orders.push(item);
            return item;
        },

        getOrdersByUser: async (userId) => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    const [rows] = await getPool().query(
                        `SELECT o.*, v.shop_name
                         FROM orders o
                         LEFT JOIN vendors v ON o.vendor_id = v.id
                         WHERE o.user_id = ?
                         ORDER BY o.created_at DESC`,
                        [userId]
                    );
                    if (rows) return rows;
                }
            } catch (err) {
                LOG.error(`MySQL getOrdersByUser failed for ${userId}`, err.message);
            }
            return (inMemoryDb.orders || [])
                .filter((o) => String(o.user_id) === String(userId))
                .map((o) => ({
                    ...o,
                    shop_name: (inMemoryDb.vendors || []).find((v) => String(v.id) === String(o.vendor_id))?.shop_name || 'Shop',
                }))
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        },

        getOrderById: async (orderId) => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    const [rows] = await getPool().query(
                        `SELECT o.*, v.shop_name, v.owner_id, u.name as user_name
                         FROM orders o
                         LEFT JOIN vendors v ON o.vendor_id = v.id
                         LEFT JOIN users u ON o.user_id = u.id
                         WHERE o.id = ?
                         LIMIT 1`,
                        [orderId]
                    );
                    if (rows && rows[0]) return rows[0];
                }
            } catch (err) {
                LOG.error(`MySQL getOrderById failed for ${orderId}`, err.message);
            }
            const o = (inMemoryDb.orders || []).find((x) => String(x.id) === String(orderId));
            if (!o) return null;
            const v = (inMemoryDb.vendors || []).find((x) => String(x.id) === String(o.vendor_id));
            const u = (inMemoryDb.users || []).find((x) => String(x.id) === String(o.user_id));
            return {
                ...o,
                shop_name: v?.shop_name || 'Shop',
                owner_id: v?.owner_id,
                user_name: u?.name || 'User',
            };
        },

        updateOrderTracking: async (orderId, { fulfillment_status, current_location } = {}) => {
            const inMemoryDb = mem();
            const existing = await api.getOrderById(orderId);
            if (!existing) return null;

            const patch = {};
            if (fulfillment_status != null) patch.fulfillment_status = String(fulfillment_status);
            if (current_location != null) {
                patch.current_location = String(current_location);
                patch.location_updated_at = new Date();
            }
            if (!Object.keys(patch).length) return existing;

            try {
                if (getPool()) {
                    await getPool().query('UPDATE orders SET ? WHERE id = ?', [patch, orderId]);
                    return api.getOrderById(orderId);
                }
            } catch (err) {
                LOG.error(`MySQL updateOrderTracking failed for ${orderId}`, err.message);
            }

            const item = (inMemoryDb.orders || []).find((o) => String(o.id) === String(orderId));
            if (!item) return null;
            Object.assign(item, patch);
            return api.getOrderById(orderId);
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
            const ownedVendorIds = inMemoryDb.vendors.filter((v) => v.owner_id === ownerId).map((v) => v.id);
            return inMemoryDb.orders
                .filter((o) => ownedVendorIds.includes(o.vendor_id))
                .map((o) => ({
                    ...o,
                    shop_name: inMemoryDb.vendors.find((v) => v.id === o.vendor_id)?.shop_name || 'Unknown Shop',
                    user_name: inMemoryDb.users.find((u) => u.id === o.user_id)?.name || 'User',
                }))
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        },

        getOrdersByVendorId: async (vendorId) => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    const [rows] = await getPool().query(
                        `SELECT o.*, v.shop_name, u.name as user_name
                         FROM orders o
                         JOIN vendors v ON o.vendor_id = v.id
                         LEFT JOIN users u ON o.user_id = u.id
                         WHERE o.vendor_id = ?
                         ORDER BY o.created_at DESC`,
                        [vendorId]
                    );
                    if (rows) return rows;
                }
            } catch (err) {
                LOG.error(`MySQL getOrdersByVendorId failed for ${vendorId}, falling back to local`, err.message);
            }
            return (inMemoryDb.orders || [])
                .filter((o) => String(o.vendor_id) === String(vendorId))
                .map((o) => ({
                    ...o,
                    shop_name: inMemoryDb.vendors.find((v) => v.id === o.vendor_id)?.shop_name || 'Unknown Shop',
                    user_name: inMemoryDb.users.find((u) => u.id === o.user_id)?.name || 'User',
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
                LOG.error('MySQL getAllOrders failed', err.message);
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
                LOG.error('MySQL getAllProducts failed', err.message);
            }
            return inMemoryDb.products;
        },
    };

    return api;
};
