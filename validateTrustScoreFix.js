#!/usr/bin/env node
/**
 * Revalidate Trust Score + RERA filings + MySQL sync (run from backend/).
 * Usage: node validateTrustScoreFix.js
 */
require('./loadEnv');
const LOG = require('./utils/logger');

const checks = [];
let failed = 0;

function pass(name, detail = '') {
  checks.push({ ok: true, name, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, err) {
  failed += 1;
  const msg = err?.message || String(err);
  checks.push({ ok: false, name, detail: msg });
  console.error(`✗ ${name} — ${msg}`);
}

async function main() {
  console.log('\n=== Trust Score / RERA revalidation ===\n');
  console.log(`DB_TYPE=${process.env.DB_TYPE || 'inmemory'}`);

  // 1) Module load (syntax / require graph)
  try {
    require('./services/trustScore/trustScoreHydrateService');
    require('./services/trustScore/reraFilingsService');
    require('./services/trustScore/projectValidationService');
    require('./utils/reraFilingsLog');
    require('./data/rera_public_filings_march_2026.json');
    pass('Module imports');
  } catch (e) {
    fail('Module imports', e);
  }

  // 2) Feature init + MySQL sync
  try {
    const fcm = require('./database/featureConnectionManager');
    if (fcm.isMysqlEnabled && fcm.isMysqlEnabled()) {
      await fcm.acquireForSync('trust_score');
    }
    const fm = require('./database/featureMemoryManager');
    await fm.ensureFeature('trust_score', { mode: 'basic' });
    const db = require('./database');
    const memCount = (db.trustScoreProjects || db.inMemoryDb?.trustScoreProjects || []).length;
    pass('Feature init (trust_score)', `${memCount} projects in memory`);
  } catch (e) {
    fail('Feature init (trust_score)', e);
  }

  // 3) Hydrate service round-trip counts
  try {
    const h = require('./services/trustScore/trustScoreHydrateService');
    const mysqlCount = await h.getProjectMysqlCount();
    const memoryCount = h.getProjectMemoryCount();
    pass('Hydrate counts', `mysql=${mysqlCount} memory=${memoryCount}`);
  } catch (e) {
    fail('Hydrate counts', e);
  }

  // 4) RERA filings load preview
  try {
    const rera = require('./services/trustScore/reraFilingsService');
    const preview = await rera.loadPreview({ useReraApi: false });
    if (!preview?.total || preview.total < 1) {
      throw new Error(`Expected filings preview, got ${preview?.total}`);
    }
    pass('RERA filings load', `${preview.total} projects preview`);
  } catch (e) {
    fail('RERA filings load', e);
  }

  // 5) RERA filings save (MySQL + memory)
  try {
    const rera = require('./services/trustScore/reraFilingsService');
    const result = await rera.saveToDatabase();
    if (!result?.total) throw new Error('Save returned no total');
    const h = require('./services/trustScore/trustScoreHydrateService');
    const mysqlAfter = await h.getProjectMysqlCount();
    if (process.env.DB_TYPE === 'mysql' && mysqlAfter < 1) {
      throw new Error(`Expected MySQL rows after save, got ${mysqlAfter}`);
    }
    pass('RERA filings save', `${result.total} rows (${result.storage}), mysql=${mysqlAfter}`);
  } catch (e) {
    fail('RERA filings save', e);
  }

  // 6) Validation builder (Sunshine escrow fields)
  try {
    const { buildProjectValidation } = require('./services/trustScore/projectValidationService');
    const db = require('./database');
    const projects = db.trustScoreProjects || db.inMemoryDb?.trustScoreProjects || [];
    const sunshine = projects.find((p) => p.id === 'proj_sunshine' || p.reraNumber === 'P52100012345');
    if (!sunshine) throw new Error('proj_sunshine not in memory after save');
    const v = buildProjectValidation(sunshine);
    if (!v?.financialReserve?.estimatedProjectCost && !v?.financialReserve?.deposited) {
      throw new Error('Validation missing financial reserve fields');
    }
    pass('Project validation', `score ${v.totalScore}/${v.maxTotal}, escrow OK`);
  } catch (e) {
    fail('Project validation', e);
  }

  // 7) Last 3h sync (includes trust_score)
  try {
    const { syncLast3Hours } = require('./syncLast3Hours');
    const counts = await syncLast3Hours({ exit: false });
    const ts = counts?.trust_score ?? 0;
    pass('syncLast3Hours', `trust_score=${ts} hydrated=${counts?.hydrated ?? 0}`);
  } catch (e) {
    fail('syncLast3Hours', e);
  }

  // 8) Admin status shape
  try {
    const rera = require('./services/trustScore/reraFilingsService');
    const status = await rera.getStatus();
    if (status.memoryCount == null || status.mysqlCount == null) {
      throw new Error('Status missing counts');
    }
    pass('Admin status', `mysql=${status.mysqlCount} memory=${status.memoryCount}`);
  } catch (e) {
    fail('Admin status', e);
  }

  console.log('\n=== Summary ===');
  console.log(`Passed: ${checks.filter((c) => c.ok).length}/${checks.length}`);
  if (failed) {
    console.error(`FAILED: ${failed} check(s)\n`);
    process.exit(1);
  }
  console.log('All checks passed — Trust Score should start smoothly with MySQL.\n');
  process.exit(0);
}

main().catch((err) => {
  LOG.error('validateTrustScoreFix fatal:', err);
  process.exit(1);
});
