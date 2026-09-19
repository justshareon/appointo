/**
 * SMART live camera — MySQL when DB_TYPE=mysql (plus in-memory ring buffer for live poll).
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
      LOG.error('[Smart] MySQL pool acquire failed:', err.message);
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

function rowToEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    vendorId: row.vendor_id,
    userId: row.user_id,
    sessionId: row.session_id,
    imageBase64: row.image_base64,
    width: row.width,
    height: row.height,
    savedLocally: !!row.saved_locally,
    at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

async function insertCameraFrame(entry) {
  const pool = await getPool();
  if (!pool || !entry?.id) return false;
  try {
    await pool.query(
      `INSERT INTO smart_camera_frames
        (id, vendor_id, user_id, session_id, image_base64, width, height, saved_locally, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE image_base64 = VALUES(image_base64), created_at = VALUES(created_at)`,
      [
        entry.id,
        String(entry.vendorId),
        entry.userId || null,
        entry.sessionId || null,
        entry.imageBase64,
        entry.width || null,
        entry.height || null,
        entry.savedLocally ? 1 : 0,
        entry.at ? new Date(entry.at) : new Date(),
      ]
    );
    return true;
  } catch (err) {
    LOG.error('[Smart] MySQL camera frame insert failed:', err.message);
    return false;
  }
}

async function listVendorFrames(vendorId, { since = null, limit = 12 } = {}) {
  const pool = await getPool();
  if (!pool) return [];
  const key = String(vendorId);
  const lim = Math.min(Math.max(Number(limit) || 12, 1), 50);
  try {
    let sql = `SELECT id, vendor_id, user_id, session_id, image_base64, width, height, saved_locally, created_at
               FROM smart_camera_frames WHERE vendor_id = ?`;
    const params = [key];
    if (since) {
      sql += ' AND created_at > ?';
      params.push(new Date(since));
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(lim);
    const [rows] = await pool.query(sql, params);
    return (rows || []).map(rowToEntry).filter(Boolean);
  } catch (err) {
    LOG.error('[Smart] MySQL camera frame list failed:', err.message);
    return [];
  }
}

async function deleteLiveStreamsOlderThan(cutoffDate) {
  const pool = await getPool();
  if (!pool || !cutoffDate) return { camera: 0, voice: 0 };
  const cutoff = cutoffDate instanceof Date ? cutoffDate : new Date(cutoffDate);
  try {
    const [camRes] = await pool.query('DELETE FROM smart_camera_frames WHERE created_at < ?', [cutoff]);
    let voice = 0;
    try {
      const [voiceRes] = await pool.query('DELETE FROM smart_voice_lines WHERE created_at < ?', [cutoff]);
      voice = voiceRes?.affectedRows || 0;
    } catch (voiceErr) {
      if (!/doesn't exist|Unknown table/i.test(String(voiceErr.message))) {
        LOG.warning('[Smart] MySQL voice line retention purge:', voiceErr.message);
      }
    }
    return { camera: camRes?.affectedRows || 0, voice };
  } catch (err) {
    LOG.error('[Smart] MySQL live stream retention purge failed:', err.message);
    return { camera: 0, voice: 0, error: err.message };
  }
}

module.exports = {
  insertCameraFrame,
  listVendorFrames,
  deleteLiveStreamsOlderThan,
};
