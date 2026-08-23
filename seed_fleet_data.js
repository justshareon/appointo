const mysql = require('mysql2/promise');
require('./loadEnv');
const { applyMumbaiPuneFleetSeed, VENDOR_ID } = require('./database/features/fleetRouteSeed');

const LOG = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    error: (msg, detail = '') => console.error(`[ERROR] ${msg} ${detail}`),
    success: (msg) => console.log(`[SUCCESS] ${msg}`),
};

const seedFleetData = async () => {
    let connection;
    try {
        const dbConfig = {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT, 10) || 3306,
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || 'root',
            database: process.env.DB_NAME || 'qr_queue',
        };

        if (dbConfig.host !== 'localhost' && dbConfig.host !== '127.0.0.1') {
            dbConfig.ssl = { rejectUnauthorized: false };
        }

        connection = await mysql.createConnection(dbConfig);
        LOG.info('Connected to MySQL for Mumbai → Pune fleet seed.');
        await applyMumbaiPuneFleetSeed(connection);
        LOG.success('Western Express Logistics seeded: Bhiwandi → Panvel → Lonavala → Talegaon → Hinjewadi');
        LOG.info(`Vendor: ${VENDOR_ID} | Drivers: Amit Sharma, Suresh Jadhav, Priya Kulkarni`);
    } catch (err) {
        LOG.error('Failed to seed fleet data:', err.message);
        console.error(err);
    } finally {
        if (connection) await connection.end();
    }
};

seedFleetData();
