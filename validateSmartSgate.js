/**
 * CLI: npm run validate:smart-sgate
 */
require('./loadEnv');

const { runSmartSgateValidation } = require('./services/smartSgateValidateService');

runSmartSgateValidation({ cleanup: true })
  .then((result) => {
    if (!result.success) {
      console.error('[validateSmartSgate] FAILED:', result.message);
      result.checks.filter((c) => !c.ok).forEach((c) => {
        console.error(`  ✗ ${c.name}: ${c.detail}`);
      });
      process.exit(1);
    }
    console.log(`[validateSmartSgate] ${result.message} (${result.passed}/${result.total})`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('[validateSmartSgate] FAILED:', err.message);
    process.exit(1);
  });
