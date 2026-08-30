/**
 * Ensure r_detector_scan_results table exists in MySQL and seed in-memory array.
 *
 * Usage:
 *   node backend/ensureRDetectorScanResults.js
 *   npm run sync:rdetector-scans
 */
require('./loadEnv');
const db = require('./database');
const rDetectorService = require('./services/rDetectorService');
const LOG = require('./utils/logger');

async function ensureRDetectorScanResults() {
  if (!db.inMemoryDb.r_detector_scan_results) {
    db.inMemoryDb.r_detector_scan_results = [];
  }

  if (db.getType() !== 'mysql') {
    LOG.info('[R-Detector Scans] In-memory mode — array ready');
    return { mode: 'memory', count: db.inMemoryDb.r_detector_scan_results.length };
  }

  const pool = db.getPool();
  if (!pool) {
    const featureConnectionManager = require('./database/featureConnectionManager');
    const acquired = await featureConnectionManager.acquireForSync('core');
    if (!acquired) {
      LOG.warning('[R-Detector Scans] No MySQL pool');
      return { mode: 'memory', count: 0 };
    }
    await rDetectorService.ensureScanResultsTable(acquired);
    const [rows] = await acquired.query('SELECT COUNT(*) AS c FROM r_detector_scan_results');
    LOG.success(`[R-Detector Scans] MySQL table ready (${rows[0]?.c || 0} rows)`);
    return { mode: 'mysql', count: rows[0]?.c || 0 };
  }

  await rDetectorService.ensureScanResultsTable(pool);
  const [rows] = await pool.query('SELECT COUNT(*) AS c FROM r_detector_scan_results');
  LOG.success(`[R-Detector Scans] MySQL table ready (${rows[0]?.c || 0} rows)`);
  return { mode: 'mysql', count: rows[0]?.c || 0 };
}

if (require.main === module) {
  ensureRDetectorScanResults()
    .then((r) => {
      console.log(JSON.stringify(r));
      process.exit(0);
    })
    .catch((err) => {
      LOG.error('[R-Detector Scans] Failed:', err.message);
      process.exit(1);
    });
}

module.exports = { ensureRDetectorScanResults };
