'use strict';

const LOG = require('../utils/logger');
const { insertMany } = require('../database/sqlBatch');

const VENDOR_ID = 'v_realestate1';

const DEMO_PROPERTIES = [
    {
        id: 9001,
        vendor_id: VENDOR_ID,
        property_type: 'apartment',
        title: '3 BHK in Whitefield',
        description: 'Corner unit, clubhouse and pool. Ready to move.',
        address: 'ITPL Main Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560066',
        locality: 'Whitefield',
        price: 95,
        price_unit: 'lakhs',
        area_sqft: 1650,
        bedrooms: 3,
        bathrooms: 3,
        rera_registered: 1,
        rera_number: 'PRM/KA/RERA/1251/446/PR/210223/004567',
        availability_status: 'available',
        is_active: 1,
        is_featured: 1,
    },
    {
        id: 9002,
        vendor_id: VENDOR_ID,
        property_type: 'villa',
        title: '4 BHK villa · Sarjapur',
        description: 'Gated community villa with private garden.',
        address: 'Sarjapur Outer Ring',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560035',
        locality: 'Sarjapur',
        price: 2.4,
        price_unit: 'crore',
        area_sqft: 3200,
        bedrooms: 4,
        bathrooms: 4,
        rera_registered: 1,
        rera_number: 'PRM/KA/RERA/1251/309/PR/180101/002891',
        availability_status: 'available',
        is_active: 1,
        is_featured: 1,
    },
    {
        id: 9003,
        vendor_id: VENDOR_ID,
        property_type: 'apartment',
        title: '2 BHK in Koramangala',
        description: 'Walk to cafes and metro feeder. Semi-furnished.',
        address: '80 Feet Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560095',
        locality: 'Koramangala',
        price: 78,
        price_unit: 'lakhs',
        area_sqft: 1180,
        bedrooms: 2,
        bathrooms: 2,
        rera_registered: 0,
        rera_number: null,
        availability_status: 'available',
        is_active: 1,
        is_featured: 0,
    },
    {
        id: 9004,
        vendor_id: VENDOR_ID,
        property_type: 'plot',
        title: '2400 sqft plot · Electronic City',
        description: 'Clear title residential plot near Phase 1.',
        address: 'Neeladri Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560100',
        locality: 'Electronic City',
        price: 62,
        price_unit: 'lakhs',
        area_sqft: 2400,
        bedrooms: 0,
        bathrooms: 0,
        rera_registered: 0,
        rera_number: null,
        availability_status: 'available',
        is_active: 1,
        is_featured: 0,
    },
];

const PROP_COLS = [
    'id', 'vendor_id', 'property_type', 'title', 'description', 'address', 'city', 'state',
    'pincode', 'locality', 'price', 'price_unit', 'area_sqft', 'bedrooms', 'bathrooms',
    'rera_registered', 'rera_number', 'availability_status', 'is_active', 'is_featured',
];

function mem() {
    const db = require('../database');
    const m = db.inMemoryDb || db;
    if (!Array.isArray(m.real_estate_properties)) m.real_estate_properties = [];
    if (!Array.isArray(m.real_estate_enquiries)) m.real_estate_enquiries = [];
    return m;
}

function pool() {
    const db = require('../database');
    return typeof db.getPool === 'function' ? db.getPool() : null;
}

function seedMemory() {
    const m = mem();
    const seen = new Set(m.real_estate_properties.map((p) => String(p.id)));
    for (const row of DEMO_PROPERTIES) {
        if (!seen.has(String(row.id))) {
            m.real_estate_properties.push({ ...row, created_at: new Date() });
            seen.add(String(row.id));
        }
    }
    LOG.info(`[RE-DASH] memory properties=${m.real_estate_properties.length} enquiries=${m.real_estate_enquiries.length}`);
    return m;
}

async function ensureAndSeed() {
    const db = require('../database');
    try {
        if (db.ensureFeatureSchema) await db.ensureFeatureSchema('realestate');
    } catch (err) {
        LOG.warning('[RE-DASH] schema ensure skipped', err.message);
    }
    seedMemory();
    const p = pool();
    if (!p) {
        LOG.info('[RE-DASH] no MySQL pool — serving in-memory listings');
        return { mysql: false, memory: mem().real_estate_properties.length };
    }
    try {
        await insertMany(p, 'real_estate_properties', PROP_COLS, DEMO_PROPERTIES.map((row) => ({
            ...row,
            rera_registered: row.rera_registered ? 1 : 0,
            is_active: 1,
            is_featured: row.is_featured ? 1 : 0,
        })), { ignore: true });
        LOG.info('[RE-DASH] MySQL demo listings inserted (IGNORE duplicates)');
        return { mysql: true, memory: mem().real_estate_properties.length };
    } catch (err) {
        LOG.warning('[RE-DASH] MySQL seed failed, memory still used', err.message);
        return { mysql: false, error: err.message, memory: mem().real_estate_properties.length };
    }
}

function formatPrice(row) {
    const n = Number(row.price);
    if (!Number.isFinite(n)) return 'Price on request';
    const unit = String(row.price_unit || 'lakhs').toLowerCase();
    if (unit.startsWith('cr')) return `₹${n} Cr`;
    return `₹${n} L`;
}

async function listProperties({ vendorId } = {}) {
    const seed = await ensureAndSeed();
    const m = mem();
    let rows = [...(m.real_estate_properties || [])];
    const p = pool();
    if (p) {
        try {
            const sql = vendorId
                ? 'SELECT * FROM real_estate_properties WHERE is_active = 1 AND vendor_id = ? ORDER BY is_featured DESC, id DESC'
                : 'SELECT * FROM real_estate_properties WHERE is_active = 1 ORDER BY is_featured DESC, id DESC';
            const [mysqlRows] = await p.query(sql, vendorId ? [vendorId] : []);
            if (mysqlRows?.length) {
                const seen = new Set(mysqlRows.map((r) => String(r.id)));
                rows = [...mysqlRows, ...rows.filter((r) => !seen.has(String(r.id)))];
            }
            LOG.info(`[RE-DASH] listProperties mysql=${mysqlRows?.length || 0} merged=${rows.length} vendorId=${vendorId || 'all'}`);
        } catch (err) {
            LOG.warning('[RE-DASH] listProperties MySQL failed', err.message);
        }
    }
    if (vendorId) rows = rows.filter((r) => String(r.vendor_id) === String(vendorId));
    return {
        properties: rows.map((r) => ({ ...r, price_label: formatPrice(r) })),
        debug: seed,
    };
}

async function addProperty(payload, ownerVendorId) {
    seedMemory();
    const m = mem();
    const id = payload.id || Date.now();
    const row = {
        id,
        vendor_id: payload.vendor_id || ownerVendorId || VENDOR_ID,
        property_type: payload.property_type || 'apartment',
        title: String(payload.title || '').trim() || 'Untitled listing',
        description: payload.description || '',
        address: payload.address || '',
        city: payload.city || 'Bengaluru',
        state: payload.state || 'Karnataka',
        pincode: payload.pincode || '',
        locality: payload.locality || '',
        price: Number(payload.price) || 0,
        price_unit: payload.price_unit || 'lakhs',
        area_sqft: Number(payload.area_sqft) || 0,
        bedrooms: Number(payload.bedrooms) || 0,
        bathrooms: Number(payload.bathrooms) || 0,
        rera_registered: payload.rera_registered ? 1 : 0,
        rera_number: payload.rera_number || null,
        availability_status: payload.availability_status || 'available',
        is_active: 1,
        is_featured: payload.is_featured ? 1 : 0,
        created_at: new Date(),
    };
    m.real_estate_properties.unshift(row);
    const p = pool();
    if (p) {
        try {
            await p.query(
                `INSERT INTO real_estate_properties
                 (id, vendor_id, property_type, title, description, address, city, state, pincode, locality,
                  price, price_unit, area_sqft, bedrooms, bathrooms, rera_registered, rera_number, availability_status, is_active, is_featured)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
                [
                    row.id, row.vendor_id, row.property_type, row.title, row.description, row.address,
                    row.city, row.state, row.pincode, row.locality, row.price, row.price_unit,
                    row.area_sqft, row.bedrooms, row.bathrooms, row.rera_registered, row.rera_number,
                    row.availability_status, row.is_featured,
                ]
            );
            LOG.info(`[RE-DASH] addProperty mysql id=${row.id}`);
        } catch (err) {
            LOG.warning('[RE-DASH] addProperty MySQL failed, memory kept', err.message);
        }
    }
    LOG.info(`[RE-DASH] addProperty memory id=${row.id} vendor=${row.vendor_id}`);
    return { ...row, price_label: formatPrice(row) };
}

async function addEnquiry(payload) {
    seedMemory();
    const m = mem();
    const row = {
        id: Date.now(),
        property_id: payload.property_id,
        user_id: payload.user_id || null,
        name: payload.name || 'Buyer',
        email: payload.email || '',
        mobile: payload.mobile || '',
        message: payload.message || 'Please share details.',
        enquiry_type: payload.enquiry_type || 'info',
        status: 'new',
        created_at: new Date(),
    };
    m.real_estate_enquiries.unshift(row);
    const p = pool();
    if (p) {
        try {
            const [res] = await p.query(
                `INSERT INTO real_estate_enquiries (property_id, user_id, name, email, mobile, message, enquiry_type, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'new')`,
                [row.property_id, row.user_id, row.name, row.email, row.mobile, row.message, row.enquiry_type]
            );
            if (res?.insertId) row.id = res.insertId;
            LOG.info(`[RE-DASH] addEnquiry mysql id=${row.id} property=${row.property_id}`);
        } catch (err) {
            LOG.warning('[RE-DASH] addEnquiry MySQL failed, memory kept', err.message);
        }
    }
    return row;
}

async function listEnquiries({ vendorId, userId } = {}) {
    seedMemory();
    const m = mem();
    let rows = [...(m.real_estate_enquiries || [])];
    const p = pool();
    if (p) {
        try {
            let sql = `SELECT e.*, pr.title AS property_title, pr.vendor_id
                       FROM real_estate_enquiries e
                       LEFT JOIN real_estate_properties pr ON pr.id = e.property_id`;
            const params = [];
            const where = [];
            if (vendorId) {
                where.push('pr.vendor_id = ?');
                params.push(vendorId);
            }
            if (userId) {
                where.push('e.user_id = ?');
                params.push(userId);
            }
            if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
            sql += ' ORDER BY e.created_at DESC LIMIT 100';
            const [mysqlRows] = await p.query(sql, params);
            if (mysqlRows?.length) rows = mysqlRows;
            LOG.info(`[RE-DASH] listEnquiries mysql=${mysqlRows?.length || 0} vendor=${vendorId || '-'} user=${userId || '-'}`);
        } catch (err) {
            LOG.warning('[RE-DASH] listEnquiries MySQL failed', err.message);
        }
    }
    const props = new Map((m.real_estate_properties || []).map((pr) => [String(pr.id), pr]));
    return rows.map((e) => ({
        ...e,
        property_title: e.property_title || props.get(String(e.property_id))?.title || 'Listing',
    }));
}

async function debugSnapshot() {
    const db = require('../database');
    const seed = await ensureAndSeed();
    const m = mem();
    return {
        ok: true,
        dbType: typeof db.getType === 'function' ? db.getType() : 'unknown',
        mysql: !!pool(),
        seed,
        properties: (m.real_estate_properties || []).length,
        enquiries: (m.real_estate_enquiries || []).length,
        vendors: (m.vendors || []).filter((v) => v.features_realestate).map((v) => ({
            id: v.id, shop_name: v.shop_name, owner_id: v.owner_id,
        })),
    };
}

module.exports = {
    DEMO_PROPERTIES,
    ensureAndSeed,
    listProperties,
    addProperty,
    addEnquiry,
    listEnquiries,
    debugSnapshot,
    VENDOR_ID,
};
