/**
 * Database Core Module
 * Common utilities, connection, and in-memory data structure
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const LOG_FILE = path.join(__dirname, '..', 'error.log');

const appendErrorLog = (msg, detail) => {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ERROR: ${msg} | DETAIL: ${detail}\n`;
    fs.appendFile(LOG_FILE, (err) => {
        if (err) console.error("Failed to write to error log file:", err);
    });
};

const LOG_CONFIG = {
    ENABLED: true,
    PERF_THRESHOLD: 50 // ms
};

const LOG = {
    info: (msg) => { if(LOG_CONFIG.ENABLED) console.log(`[DB INFO] ${new Date().toLocaleTimeString()} | ${msg}`) },
    error: (msg, detail = "") => {
        console.error(`[DB ERROR] ${new Date().toLocaleTimeString()} | ${msg} ${detail}`);
        appendErrorLog(msg, detail);
    },
    success: (msg) => { if(LOG_CONFIG.ENABLED) console.log(`[DB SUCCESS] ${new Date().toLocaleTimeString()} | ${msg}`) },
    warning: (msg) => { if(LOG_CONFIG.ENABLED) console.log(`[DB WARN] ${new Date().toLocaleTimeString()} | ${msg}`) }
};

const DB_TYPE = process.env.DB_TYPE || 'inmemory';
const { resolveProductImages, getCategoryImage } = require('../../utils/categoryImages');

// Helper for dynamic seed dates
const now = new Date();
const todayStr = now.toISOString().split('T')[0];
const currentTime = now.toTimeString().slice(0, 5);

const tomorrow = new Date(now);
tomorrow.setDate(tomorrow.getDate() + 1);
const tomorrowStr = tomorrow.toISOString().split('T')[0];

const dayAfter = new Date(now);
dayAfter.setDate(dayAfter.getDate() + 2);
const dayAfterStr = dayAfter.toISOString().split('T')[0];

// Helper to format Date for MySQL (Local Server Time)
const toMysqlDateTime = (date) => {
    const d = new Date(date);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const normalizeProductRow = (row) => {
    const product = { ...row };
    let imageUrls = [];
    try {
        const raw = product.image_urls_json || product.image_urls || '[]';
        if (Array.isArray(raw)) {
            imageUrls = raw;
        } else if (typeof raw === 'string') {
            imageUrls = JSON.parse(raw || '[]');
        }
    } catch (e) {
        imageUrls = [];
    }
    const cleaned = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [];
    const category = product.vendor_category || product.category;
    product.image_urls = resolveProductImages(cleaned, category, product.id || product.name);
    return product;
};

// MySQL pools live in featureConnectionManager. Do not open a second
// 10-connection pool here — requiring this file for dates used to do that
// and the extra sockets got killed by TiDB/cloud wait_timeout.
let pool = null;

module.exports = {
    LOG,
    DB_TYPE,
    DEFAULT_PRODUCT_IMAGE: getCategoryImage('shop', 'default'),
    todayStr,
    tomorrowStr,
    dayAfterStr,
    currentTime,
    toMysqlDateTime,
    normalizeProductRow,
    getPool: () => pool,
    pool,
    getType: () => DB_TYPE
};

