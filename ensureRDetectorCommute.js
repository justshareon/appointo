/**
 * Ensure R-Detector commute tables exist (MySQL) and in-memory arrays are ready.
 *
 * Usage:
 *   node backend/ensureRDetectorCommute.js
 */
require('./loadEnv');
const db = require('./database');
const LOG = require('./utils/logger');

async function ensureRDetectorCommute() {
  mem();
  if (db.getType() !== 'mysql') {
    LOG.info('[R-Detector Commute] In-memory mode — arrays ready');
    return { mode: 'memory' };
  }

  let pool = db.getPool();
  if (!pool) {
    const featureConnectionManager = require('./database/featureConnectionManager');
    pool = await featureConnectionManager.acquireForSync('core');
  }
  if (!pool) {
    LOG.warning('[R-Detector Commute] No MySQL pool — arrays ready in memory only');
    return { mode: 'memory' };
  }

  const commuteService = require('./services/rDetectorCommuteService');
  await commuteService.ensureCommuteTables();
  const [rows] = await pool.query('SELECT COUNT(*) AS c FROM r_detector_commute_schedules');
  LOG.success(`[R-Detector Commute] MySQL tables ready (${rows[0]?.c || 0} schedules)`);
  return { mode: 'mysql', schedules: rows[0]?.c || 0 };
}

function mem() {
  if (!db.inMemoryDb) db.inMemoryDb = {};
  if (!db.inMemoryDb.r_detector_activity_pings) db.inMemoryDb.r_detector_activity_pings = [];
  if (!db.inMemoryDb.r_detector_commute_trips) db.inMemoryDb.r_detector_commute_trips = [];
  if (!db.inMemoryDb.r_detector_commute_schedules) db.inMemoryDb.r_detector_commute_schedules = [];
}

if (require.main === module) {
  ensureRDetectorCommute()
    .then((r) => {
      console.log(JSON.stringify(r));
      process.exit(0);
    })
    .catch((err) => {
      LOG.error('[R-Detector Commute] Failed:', err.message);
      process.exit(1);
    });
}

module.exports = { ensureRDetectorCommute };
