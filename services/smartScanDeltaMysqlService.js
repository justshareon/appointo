/**
 * SMART scan snapshots & alerts — shared across Render instances when DB_TYPE=mysql.
 */
const db = require('../database');
const LOG = require('../utils/logger');
const { ensureFeatureSchema } = require('../database/schema/featureTables');

let tableReady = false;

async function resolveSmartPool() {
  if (db.getType() !== 'mysql') return null;
  let pool = typeof db.getPool === 'function' ? db.getPool() : null;
  const fcm = db.featureConnectionManager;
  if (!pool && fcm?.getCachedPool) {
    pool = fcm.getCachedPool('smart') || fcm.getCachedPool('core');
  }
  if (!pool && fcm?.acquireForSync) {
    try {
      pool = await fcm.acquireForSync('smart');
    } catch (err) {
      LOG.error('[Smart] scan delta MySQL pool failed:', err.message);
      return null;
    }
  }
  return pool || null;
}

async function getPool() {
  const pool = await resolveSmartPool();
  if (!pool) return null;
  if (!tableReady) {
    await ensureFeatureSchema('smart', db);
    tableReady = true;
  }
  return pool;
}

function parseJson(val, fallback) {
  if (val == null) return fallback;
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch (_) {
    return fallback;
  }
}

function rowToSnapshot(row) {
  if (!row) return null;
  const updatedAt = row.updated_at instanceof Date
    ? row.updated_at.toISOString()
    : row.updated_at || null;
  return {
    vendorId: row.vendor_id,
    userId: row.user_id,
    wifiKeys: parseJson(row.wifi_keys, []),
    deviceKeys: parseJson(row.device_keys, []),
    wifiCount: row.wifi_count || 0,
    deviceCount: row.device_count || 0,
    updatedAt,
  };
}

function rowToAlert(row) {
  if (!row) return null;
  const payload = parseJson(row.payload, {});
  const at = row.created_at instanceof Date
    ? row.created_at.toISOString()
    : row.created_at || payload.at;
  return {
    id: row.id,
    vendorId: row.vendor_id,
    userId: row.user_id,
    userDisplayName: row.user_display_name || payload.userDisplayName || null,
    ...payload,
    at: at || payload.at,
  };
}

async function loadSnapshot(vendorId, userId) {
  const pool = await getPool();
  if (!pool) return null;
  try {
    const [rows] = await pool.query(
      `SELECT vendor_id, user_id, wifi_keys, device_keys, wifi_count, device_count, updated_at
       FROM smart_scan_snapshots WHERE vendor_id = ? AND user_id = ? LIMIT 1`,
      [String(vendorId), String(userId)]
    );
    return rowToSnapshot(rows?.[0]);
  } catch (err) {
    LOG.error('[Smart] scan snapshot load failed:', err.message);
    return null;
  }
}

async function saveSnapshot(snapshot) {
  const pool = await getPool();
  if (!pool || !snapshot?.vendorId || !snapshot?.userId) return false;
  try {
    await pool.query(
      `INSERT INTO smart_scan_snapshots
        (vendor_id, user_id, wifi_keys, device_keys, wifi_count, device_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         wifi_keys = VALUES(wifi_keys),
         device_keys = VALUES(device_keys),
         wifi_count = VALUES(wifi_count),
         device_count = VALUES(device_count),
         updated_at = VALUES(updated_at)`,
      [
        String(snapshot.vendorId),
        String(snapshot.userId),
        JSON.stringify(snapshot.wifiKeys || []),
        JSON.stringify(snapshot.deviceKeys || []),
        snapshot.wifiCount || 0,
        snapshot.deviceCount || 0,
        snapshot.updatedAt ? new Date(snapshot.updatedAt) : new Date(),
      ]
    );
    return true;
  } catch (err) {
    LOG.error('[Smart] scan snapshot save failed:', err.message);
    return false;
  }
}

async function insertAlert(alert) {
  const pool = await getPool();
  if (!pool || !alert?.id) return false;
  const { id, vendorId, userId, userDisplayName, ...rest } = alert;
  try {
    await pool.query(
      `INSERT INTO smart_scan_alerts
        (id, vendor_id, user_id, user_display_name, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE payload = VALUES(payload)`,
      [
        id,
        String(vendorId),
        userId ? String(userId) : null,
        userDisplayName || null,
        JSON.stringify(rest),
        rest.at ? new Date(rest.at) : new Date(),
      ]
    );
    return true;
  } catch (err) {
    LOG.error('[Smart] scan alert insert failed:', err.message);
    return false;
  }
}

async function listVendorAlerts(vendorId, limit = 25) {
  const pool = await getPool();
  if (!pool) return null;
  try {
    const [rows] = await pool.query(
      `SELECT id, vendor_id, user_id, user_display_name, payload, created_at
       FROM smart_scan_alerts
       WHERE vendor_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [String(vendorId), Math.min(Math.max(limit, 1), 120)]
    );
    return (rows || []).map(rowToAlert).filter(Boolean);
  } catch (err) {
    LOG.error('[Smart] scan alerts list failed:', err.message);
    return null;
  }
}

async function vendorScanTotals(vendorId) {
  const pool = await getPool();
  if (!pool) return null;
  try {
    const [rows] = await pool.query(
      `SELECT
         COALESCE(SUM(wifi_count), 0) AS wifiCount,
         COALESCE(SUM(device_count), 0) AS deviceCount,
         COUNT(*) AS customerScans
       FROM smart_scan_snapshots
       WHERE vendor_id = ?`,
      [String(vendorId)]
    );
    const r = rows?.[0] || {};
    return {
      wifiCount: Number(r.wifiCount) || 0,
      deviceCount: Number(r.deviceCount) || 0,
      customerScans: Number(r.customerScans) || 0,
    };
  } catch (err) {
    LOG.error('[Smart] scan totals failed:', err.message);
    return null;
  }
}

function mysqlScanDeltaEnabled() {
  return db.getType() === 'mysql';
}

module.exports = {
  mysqlScanDeltaEnabled,
  loadSnapshot,
  saveSnapshot,
  insertAlert,
  listVendorAlerts,
  vendorScanTotals,
};
