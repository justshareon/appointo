/**
 * Database Core Module
 * Common utilities, connection, and in-memory data structure
 */
const mysql = require('mysql2');
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
const DEFAULT_PRODUCT_IMAGE = 'https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=800';

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
    product.image_urls = cleaned.length ? cleaned : [DEFAULT_PRODUCT_IMAGE];
    return product;
};

// --- MYSQL CONNECTION ---
let pool;
if (DB_TYPE === 'mysql') {
    LOG.info(`Connecting to MySQL at ${process.env.DB_HOST}:${process.env.DB_PORT || 3306}...`);
    pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'root',
        database: process.env.DB_NAME || 'qr_queue',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        ssl: {
            rejectUnauthorized: false
        }
    }).promise();

    // Error handling for the pool
    pool.on('error', (err) => {
        LOG.error('Unexpected database pool error', err.message);
        if (err.code === 'PROTOCOL_CONNECTION_LOST') {
            LOG.warning('Database connection lost. Reconnecting...');
        }
    });

    // Test connection after a delay to ensure the server starts up first
    setTimeout(() => {
        LOG.info("Testing database connection (delayed)...");
        pool.getConnection()
            .then(conn => {
                LOG.success("MySQL Database Connected successfully!");
                conn.release();
            })
            .catch(err => {
                LOG.error("MySQL Connection Failed!", err.message);
                LOG.warning("Verify TiDB IP Whitelist (0.0.0.0/0) and Render Env Variables.");
            });
    }, 5000);
}

// Cleanup on exit
process.on('SIGINT', async () => {
    if (pool) {
        LOG.info('Closing database pool...');
        await pool.end();
    }
    process.exit(0);
});

module.exports = {
    LOG,
    DB_TYPE,
    DEFAULT_PRODUCT_IMAGE,
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

