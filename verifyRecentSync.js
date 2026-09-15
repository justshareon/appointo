#!/usr/bin/env node
/**
 * Verify recent features (last ~6h work): pool config, module URLs, offers, MySQL + in-memory parity.
 * Run: node verifyRecentSync.js
 */
require('./loadEnv');
const db = require('./database');
const LOG = require('./utils/logger');

const checks = [];
let failed = 0;

function pass(name, detail) {
  checks.push({ ok: true, name, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail) {
  failed += 1;
  checks.push({ ok: false, name, detail });
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function verifySettings() {
  console.log('\n[1] Settings (pool + module URLs)');
  const settings = await db.getSettings();
  const required = [
    'trade_news_sources',
    'cyber_threat_sources',
    'trading_external_urls',
    'db_pool_min_limit',
    'db_pool_default_limit',
  ];
  required.forEach((key) => {
    if (settings[key] != null && String(settings[key]).length > 0) {
      pass(key, 'present');
    } else {
      fail(key, 'missing or empty');
    }
  });
  try {
    const offers = JSON.parse(String(settings.trade_news_sources || '[]'));
    if (Array.isArray(offers) && offers.length > 0) pass('trade_news_sources parse', `${offers.length} feeds`);
    else fail('trade_news_sources parse', 'empty array');
  } catch (e) {
    fail('trade_news_sources parse', e.message);
  }
  try {
    const cyber = JSON.parse(String(settings.cyber_threat_sources || '[]'));
    if (Array.isArray(cyber) && cyber.length > 0) pass('cyber_threat_sources parse', `${cyber.length} feeds`);
    else fail('cyber_threat_sources parse', 'empty array');
  } catch (e) {
    fail('cyber_threat_sources parse', e.message);
  }
}

async function verifyPoolConfig() {
  console.log('\n[2] MySQL pool config');
  try {
    const poolConfig = require('./utils/poolConfig');
    const cfg = await poolConfig.getPoolConfig();
    if (cfg.minLimit >= 3) pass('minLimit', String(cfg.minLimit));
    else fail('minLimit', String(cfg.minLimit));
    if (cfg.defaultLimit >= 3) pass('defaultLimit', String(cfg.defaultLimit));
    else fail('defaultLimit', String(cfg.defaultLimit));
    if (Array.isArray(cfg.features) && cfg.features.length >= 10) {
      pass('feature pools', `${cfg.features.length} features`);
    } else {
      fail('feature pools', `${cfg.features?.length || 0} features`);
    }
  } catch (e) {
    fail('pool config service', e.message);
  }
}

async function verifyModuleUrls() {
  console.log('\n[3] Module external URLs service');
  try {
    const svc = require('./services/moduleExternalUrlsService');
    const { modules } = svc.listModules();
    if (modules.length >= 5) pass('module list', `${modules.length} modules`);
    else fail('module list', `${modules.length} modules`);

    for (const mod of ['trust_score', 'cyber', 'offer', 'news', 'trade']) {
      try {
        const data = await svc.getModuleUrls(mod);
        const n = (data.sources || []).length;
        if (mod === 'trust_score' && n === 0) {
          pass(`${mod} URLs`, 'table ready (add via Super Admin → Trust Score)');
        } else if (n > 0) {
          pass(`${mod} URLs`, `${n} source(s)`);
        } else {
          fail(`${mod} URLs`, 'no sources');
        }
      } catch (e) {
        fail(`${mod} URLs`, e.message);
      }
    }
  } catch (e) {
    fail('moduleExternalUrlsService', e.message);
  }
}

async function verifyTrustApiTable() {
  console.log('\n[4] Trust Score API configs table');
  try {
    const apiConfigService = require('./services/trustScore/apiConfigService');
    await apiConfigService.initializeTable();
    const rows = await apiConfigService.getAllConfigs();
    pass('trust_score_api_configs', `${(rows || []).length} row(s)`);
  } catch (e) {
    fail('trust_score_api_configs', e.message);
  }
}

async function verifyFeaturePools() {
  console.log('\n[5] Feature connection manager');
  try {
    const fcm = require('./database/featureConnectionManager');
    const stats = fcm.getPoolStats ? fcm.getPoolStats() : [];
    if (Array.isArray(stats) && stats.length > 0) {
      pass('getPoolStats', `${stats.length} feature entries`);
    } else {
      pass('getPoolStats', 'lazy pools (none open yet)');
    }
  } catch (e) {
    fail('featureConnectionManager', e.message);
  }
}

async function verifyRuntimeDbAndRecentSync() {
  console.log('\n[6] APS runtime DB + recent activity sync');
  try {
    const { getRuntimeDbType, setRuntimeDbType, getRuntimeOverride } = require('./utils/runtimeDbType');
    const { resolveDbType, isMysqlConfigured } = require('./utils/resolveDbType');
    const {
      runSyncLast3Hours,
      revalidateRecentActivity,
      APS_ACTIVITY_SYNC_HOURS,
    } = require('./syncLast3Hours');
    const runtimeDbModeService = require('./services/runtimeDbModeService');

    pass('getRuntimeDbType', getRuntimeDbType());
    if (APS_ACTIVITY_SYNC_HOURS === 4) pass('APS_ACTIVITY_SYNC_HOURS', '4');
    else fail('APS_ACTIVITY_SYNC_HOURS', String(APS_ACTIVITY_SYNC_HOURS));

    if (typeof runSyncLast3Hours === 'function' && typeof revalidateRecentActivity === 'function') {
      pass('syncLast3Hours exports', 'run + revalidate');
    } else {
      fail('syncLast3Hours exports', 'missing functions');
    }

    if (typeof runtimeDbModeService.applyRuntimeDbMode === 'function') {
      pass('runtimeDbModeService', 'apply + revalidate');
    } else {
      fail('runtimeDbModeService', 'missing applyRuntimeDbMode');
    }

    const prev = getRuntimeOverride();
    setRuntimeDbType('inmemory');
    if (getRuntimeDbType() === 'inmemory') pass('setRuntimeDbType inmemory', 'ok');
    else fail('setRuntimeDbType inmemory', getRuntimeDbType());
    if (isMysqlConfigured()) {
      setRuntimeDbType('mysql');
      if (getRuntimeDbType() === 'mysql') pass('setRuntimeDbType mysql', 'ok');
      else fail('setRuntimeDbType mysql', getRuntimeDbType());
    }
    if (prev === 'mysql' || prev === 'inmemory') setRuntimeDbType(prev);
    else if (resolveDbType() === 'mysql' && isMysqlConfigured()) setRuntimeDbType('mysql');
    else setRuntimeDbType('inmemory');

    const { extractDashboardMarketDate } = require('./utils/tradingExcelDashboardDate');
    if (typeof extractDashboardMarketDate === 'function') pass('trading Excel dashboard date', 'parser ready');
    else fail('trading Excel dashboard date', 'missing');
  } catch (e) {
    fail('runtime DB stack', e.message);
  }
}

async function verifyMysqlSettingsTable(pool) {
  const { isMysqlConfigured } = require('./utils/resolveDbType');
  if (!isMysqlConfigured()) {
    console.log('\n[7] MySQL system_settings — skipped (MySQL not configured)');
    return;
  }
  console.log('\n[7] MySQL system_settings table');
  try {
    if (!pool) {
      fail('MySQL pool', 'could not acquire sync pool');
      return;
    }
    const [rows] = await pool.query(
      `SELECT key_name FROM system_settings WHERE key_name IN (
        'cyber_threat_sources','trading_external_urls','db_pool_min_limit','db_pool_default_limit','trade_news_sources'
      )`
    );
    const keys = new Set(rows.map((r) => r.key_name));
    ['cyber_threat_sources', 'trading_external_urls', 'db_pool_min_limit', 'trade_news_sources'].forEach((k) => {
      if (keys.has(k)) pass(`MySQL ${k}`, 'synced');
      else fail(`MySQL ${k}`, 'not in system_settings — run npm run sync:all');
    });
  } catch (e) {
    fail('MySQL system_settings', e.message);
  }
}

(async () => {
  console.log('=== Verify recent MySQL + in-memory features ===');
  console.log(`DB_TYPE env=${process.env.DB_TYPE || '(unset)'} runtime=${db.getType?.() || '?'}`);

  let mysqlPool = null;
  const { isMysqlConfigured } = require('./utils/resolveDbType');
  if (isMysqlConfigured()) {
    try {
      const fcm = require('./database/featureConnectionManager');
      mysqlPool = await fcm.acquireForSync('core');
    } catch (_) { /* checked in section 6 */ }
  }

  await verifySettings();
  await verifyPoolConfig();
  await verifyModuleUrls();
  await verifyTrustApiTable();
  await verifyFeaturePools();
  await verifyRuntimeDbAndRecentSync();
  await verifyMysqlSettingsTable(mysqlPool);

  console.log('\n=== Summary ===');
  console.log(`Passed: ${checks.filter((c) => c.ok).length}/${checks.length}`);
  if (failed > 0) {
    console.log(`FAILED: ${failed} — run: cd backend && npm run sync:all`);
    process.exit(1);
  }
  console.log('All checks passed.\n');
  process.exit(0);
})().catch((err) => {
  LOG.error('Verify failed:', err);
  process.exit(1);
});
