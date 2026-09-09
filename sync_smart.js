/**
 * Sync SMART module user + vendor to MySQL
 * Run: node backend/sync_smart.js  |  npm run sync:smart
 * Also runs automatically via auto-sync (syncAllToMysql smart_data step + drift sync).
 */
require('./loadEnv');
const LOG = require('./utils/logger');
const { syncSmartData } = require('./syncAllToMysql');

async function main() {
  console.log('\n=== SMART module MySQL sync ===\n');
  const result = await syncSmartData();
  console.log('\nLogin credentials:');
  console.log('  User:   smart1@test.com / 8000000021');
  console.log('  Vendor: smartvendor1@test.com / 8000000022\n');
  LOG.success(`SMART sync complete (${result?.itemsSynced ?? 0} items)`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

module.exports = { main };
