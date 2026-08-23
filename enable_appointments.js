/**
 * Enable Appointments (and queue) in MySQL + in-memory settings.
 * Also turns on shop-level features_appointments for vendors.
 */
require('./loadEnv');
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const settingsService = require('./services/settingsService');
const data = require('./database/data');

dotenv.config({ path: path.join(__dirname, '.env'), override: true });

async function enableAppointments() {
    console.log('\n=== Enabling Appointments feature ===\n');

    if (data.settings) {
        data.settings.enable_appointments = true;
        data.settings.enable_queue = true;
        data.settings.enable_qless = true;
        console.log('In-memory settings updated');
    }

    await settingsService.updateSettings({
        enable_appointments: true,
        enable_queue: true,
        enable_qless: true,
    });

    const host = process.env.DB_HOST || 'localhost';
    const isRemote = host !== 'localhost' && host !== '127.0.0.1';
    console.log('Connecting to database host:', isRemote ? 'remote' : 'local', '| DB_TYPE=', process.env.DB_TYPE || 'unset');

    const pool = mysql.createPool({
        host,
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'root',
        database: process.env.DB_NAME || 'qr_queue',
        waitForConnections: true,
        connectionLimit: 2,
        ...(isRemote ? { ssl: { rejectUnauthorized: false } } : {}),
    });

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS system_settings (
                key_name VARCHAR(50) PRIMARY KEY,
                value TEXT
            )
        `);

        const flags = [
            ['enable_appointments', 'true'],
            ['enable_queue', 'true'],
            ['enable_qless', 'true'],
        ];
        for (const [key, value] of flags) {
            await pool.query(
                'INSERT INTO system_settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?',
                [key, value, value]
            );
        }

        const [rows] = await pool.query(
            "SELECT key_name, value FROM system_settings WHERE key_name IN ('enable_appointments','enable_queue','enable_qless')"
        );
        console.log('system_settings:', rows);

        try {
            const [vendorResult] = await pool.query(
                'UPDATE vendors SET features_appointments = 1, features_queue = 1 WHERE features_appointments IS NULL OR features_appointments = 0 OR features_qless = 1 OR LOWER(category) LIKE ? OR LOWER(shop_name) LIKE ?',
                ['%qless%', '%qless%']
            );
            console.log('Vendors updated for appointments:', vendorResult.affectedRows);
        } catch (vendorErr) {
            console.warn('Vendor flag update skipped:', vendorErr.message);
        }
    } finally {
        await pool.end();
    }

    const finalSettings = await settingsService.getSettings();
    console.log('Final enable_appointments:', finalSettings.enable_appointments);
    console.log('\nAppointments feature enabled.\n');
}

enableAppointments()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('Failed to enable appointments:', err);
        process.exit(1);
    });
