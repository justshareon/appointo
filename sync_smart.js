/**
 * Sync SMART module user + vendor to MySQL
 * Run: node backend/sync_smart.js
 */
require('./loadEnv');
const db = require('./database');

async function main() {
  console.log('\n=== SMART module MySQL sync ===\n');
  if (typeof db.ensureSmartUsersAndVendor !== 'function') {
    console.error('ensureSmartUsersAndVendor not found');
    process.exit(1);
  }
  await db.ensureSmartUsersAndVendor();
  console.log('\nLogin credentials:');
  console.log('  User:   smart1@test.com / 8000000021');
  console.log('  Vendor: smartvendor1@test.com / 8000000022\n');
  console.log('✅ SMART sync complete\n');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
