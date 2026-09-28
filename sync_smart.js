/**
 * Sync SMART module user + vendor + streams to MySQL
 * Delegates to the single canonical backend/syncSmartToMysql.js module.
 * Run: node backend/syncSmartToMysql.js  |  node backend/sync_smart.js  |  npm run sync:smart
 */
require('./loadEnv');
const LOG = require('./utils/logger');
const { syncSmartToMysql, ensureSmartSchema, ensureSmartUsersAndVendor } = require('./syncSmartToMysql');

async function main() {
    console.log('\n=== SMART module MySQL sync ===\n');
    const result = await syncSmartToMysql({ triggerSource: 'sync_smart_cli' });
    console.log('\nLogin credentials:');
    console.log('  User:   smart1@test.com / 8000000021');
    console.log('  Vendor: smartvendor1@test.com / 8000000022\n');
    LOG.success(`SMART sync complete (${result?.itemsSynced ?? 0} items, ${result?.queriesSynced ?? 0} queries)`);
    process.exit(0);
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = {
    main,
    syncSmartToMysql,
    syncSmartData: syncSmartToMysql,
    ensureSmartSchema,
    ensureSmartUsersAndVendor,
};
