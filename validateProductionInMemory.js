#!/usr/bin/env node
/**
 * Smoke-check SMART, R-Detector, news, offers, trading in in-memory mode before release.
 * Run: npm run validate:production
 */
require('./loadEnv');
const LOG = require('./utils/logger');
const { runProductionInMemoryValidation } = require('./services/productionInMemoryValidateService');

(async () => {
  console.log('=== Production in-memory validation ===');
  const result = await runProductionInMemoryValidation();
  for (const c of result.checks) {
    const mark = c.ok ? '✓' : '✗';
    console.log(`  ${mark} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  }
  console.log('\n=== Summary ===');
  console.log(`Passed: ${result.passed}/${result.total}`);
  if (!result.success) {
    console.log(`FAILED: ${result.failed} check(s)\n`);
    process.exit(1);
  }
  console.log('All in-memory production checks passed.\n');
  process.exit(0);
})().catch((err) => {
  LOG.error('validateProductionInMemory failed:', err);
  process.exit(1);
});
