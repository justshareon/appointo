/**
 * One-command onboarding: align in-memory seed with MySQL (users, vendors, mappings).
 * Also used by automatic drift sync — see services/driftSyncService.js
 *
 * Usage: node onboardSync.js
 *   npm run sync:onboard
 */
require('./loadEnv');
const LOG = require('./utils/logger');
const { runDriftSync } = require('./services/driftSyncService');

async function onboardSync() {
  LOG.info('[Onboard] Starting in-memory ↔ MySQL alignment...');
  const result = await runDriftSync('onboard');
  if (!result.ok && !result.skipped) {
    throw new Error(result.error || 'Onboard sync failed');
  }
  LOG.success('[Onboard] Complete');
  return result;
}

if (require.main === module) {
  onboardSync()
    .then(() => process.exit(0))
    .catch((err) => {
      LOG.error('[Onboard] Failed:', err.message);
      process.exit(1);
    });
}

module.exports = { onboardSync };
