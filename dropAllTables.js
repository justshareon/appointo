/**
 * DROP ALL TABLES UTILITY FOR TIDB CLOUD
 * Dynamically lists all tables in the database, drops them, and exits.
 * Disables foreign key checks to ensure clean drop.
 */

require('./loadEnv');
const featureConnectionManager = require('./database/featureConnectionManager');
const LOG = require('./utils/logger');

async function dropAllTables() {
    LOG.info('==================================================');
    LOG.info('   STARTING DATABASE PURGE: DROPPING ALL TABLES');
    LOG.info('==================================================');

    let pool;
    try {
        pool = await featureConnectionManager.acquireForSync('core');
    } catch (err) {
        LOG.error('Failed to connect to database for purging:', err.message);
        process.exit(1);
    }

    try {
        // 1. Disable foreign key checks
        LOG.info('Disabling foreign key checks...');
        await pool.query('SET FOREIGN_KEY_CHECKS = 0');

        // 2. Fetch all tables
        LOG.info('Fetching list of all tables...');
        const [rows] = await pool.query('SHOW TABLES');
        
        if (rows.length === 0) {
            LOG.success('No tables found in the database. Database is already clean!');
            await pool.query('SET FOREIGN_KEY_CHECKS = 1');
            return;
        }

        const dbNameResult = await pool.query('SELECT DATABASE() as db');
        const dbName = dbNameResult[0][0].db;
        const keyName = `Tables_in_${dbName}`;

        const tables = rows.map(row => row[keyName] || Object.values(row)[0]);
        LOG.info(`Found ${tables.length} tables to drop: ${tables.join(', ')}`);

        // 3. Drop each table
        for (const table of tables) {
            LOG.info(`Dropping table: ${table}...`);
            await pool.query(`DROP TABLE IF EXISTS \`${table}\``);
        }

        // 4. Re-enable foreign key checks
        LOG.info('Re-enabling foreign key checks...');
        await pool.query('SET FOREIGN_KEY_CHECKS = 1');

        LOG.success('==================================================');
        LOG.success('   ✓ ALL TABLES DROPPED SUCCESSFULLY');
        LOG.success('==================================================');
    } catch (err) {
        LOG.error('Error during database purge:', err);
        try {
            await pool.query('SET FOREIGN_KEY_CHECKS = 1');
        } catch (e) {}
        throw err;
    } finally {
        // End the pool connection
        try {
            await pool.end();
        } catch (e) {}
    }
}

if (require.main === module) {
    dropAllTables()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = { dropAllTables };
