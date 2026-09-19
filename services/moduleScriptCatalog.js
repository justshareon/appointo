/**
 * Maps maintenance/sync scripts to APS modules (manual node scripts — not APK runtime).
 */
const fs = require('fs');
const path = require('path');
const { SYNC_MODULES } = require('./syncStatusService');

const BACKEND_ROOT = path.join(__dirname, '..');

const MODULE_SCRIPT_PATTERNS = [
  { module: 'news', patterns: [/news/i] },
  { module: 'offers', patterns: [/offer/i, /marketplace/i] },
  { module: 'trading', patterns: [/trad/i] },
  { module: 'r_detector', patterns: [/rdetector/i, /scan/i, /commute/i, /road/i] },
  { module: 'smart', patterns: [/smart/i] },
  { module: 'cyber', patterns: [/cyber/i, /suraksha/i] },
  { module: 'trust_score', patterns: [/trust/i, /rera/i] },
  { module: 'fleet', patterns: [/fleet/i] },
  { module: 'core', patterns: [/lazy/i, /load-safety/i, /header/i, /footer/i, /menu/i, /home-timeout/i] },
];

function classifyFile(name) {
  if (name.startsWith('patch-')) return 'patch';
  if (name.startsWith('validate')) return 'validate';
  if (name.startsWith('sync') || name.includes('sync')) return 'sync';
  if (name.startsWith('ensure')) return 'ensure';
  return 'script';
}

function moduleForFile(name) {
  for (const row of MODULE_SCRIPT_PATTERNS) {
    if (row.patterns.some((p) => p.test(name))) return row.module;
  }
  return 'core';
}

let cachedScan = null;

function scanBackendScripts() {
  if (cachedScan) return cachedScan;
  const files = [];
  try {
    const names = fs.readdirSync(BACKEND_ROOT);
    for (const name of names) {
      if (!/\.js$/i.test(name)) continue;
      if (!/^(patch-|validate|sync|ensure|onboard)/i.test(name)) continue;
      files.push({
        file: name,
        path: `backend/${name}`,
        type: classifyFile(name),
        module: moduleForFile(name),
        runtime: 'manual',
        description: 'Run on server/dev machine: node backend/' + name,
      });
    }
  } catch (_) {
    /* ignore */
  }
  cachedScan = files;
  return files;
}

function getScriptsForModule(moduleKey) {
  const all = scanBackendScripts();
  const matched = all.filter((s) => s.module === moduleKey);
  return {
    totalInCatalog: matched.length,
    totalInRepo: all.length,
    globalSyncSteps: SYNC_MODULES.length,
    items: matched,
    note:
      'Sync steps run via APS “Sync now” (sync_module_state). After a successful bulk sync, release maintenance runs ensure R-Detector scripts + drift (SYNC_RECENT_HOURS, default 2h). Patch/validate scripts stay manual.',
  };
}

function summarizeSyncPipeline(syncKeys = [], syncModules = []) {
  const rows = syncModules.filter((m) => syncKeys.includes(m.key));
  const success = rows.filter((m) => m.status === 'SUCCESS' || m.status === 'SKIPPED').length;
  const failed = rows.filter((m) => m.status === 'FAILED').length;
  const pending = rows.filter((m) => m.status === 'PENDING' || m.status === 'IN_PROGRESS').length;
  let queriesSynced = 0;
  let itemsSynced = 0;
  const steps = rows.map((m) => ({
    key: m.key,
    label: m.label || m.key,
    status: m.status,
    lastError: m.lastError || m.last_error || null,
    queriesSynced: Number(m.queriesSynced ?? m.queries_synced) || 0,
    itemsSynced: Number(m.itemsSynced ?? m.items_synced) || 0,
    version: m.version ?? 0,
    lastCompletedAt: m.lastCompletedAt || m.last_completed_at || null,
  }));
  steps.forEach((s) => {
    queriesSynced += s.queriesSynced;
    itemsSynced += s.itemsSynced;
  });
  return {
    assignedSteps: syncKeys.length,
    trackedSteps: rows.length,
    success,
    failed,
    pending,
    queriesSynced,
    itemsSynced,
    steps,
    executedLabel: `${success}/${syncKeys.length || rows.length || 0} sync step(s) SUCCESS`,
  };
}

module.exports = {
  scanBackendScripts,
  getScriptsForModule,
  summarizeSyncPipeline,
  SYNC_MODULE_TOTAL: SYNC_MODULES.length,
};
