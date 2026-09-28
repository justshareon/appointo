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

function normalizeSmartVendorId(vendorId) {
  const raw = String(vendorId || 'v_smart1').trim();
  if (!raw) return 'v_smart1';
  const stripped = raw.replace(/^beacon-(?:wifi|ble|ir|nfc|rf)-/i, '');
  return stripped || 'v_smart1';
}

function isExcludedSmartUserId(userId) {
  if (!userId) return false;
  const u = String(userId).trim().toLowerCase();
  return (
    u === 'tvendor1' ||
    u === 'usr_admin' ||
    u === 'usr_smartvendor1' ||
    u.startsWith('u_sgate_val_') ||
    u.startsWith('usr_demo_')
  );
}

function toMysqlUtcDatetime(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  const valid = !Number.isNaN(d.getTime()) && d.getTime() <= Date.now() + 60000 ? d : new Date();
  return valid.toISOString().slice(0, 23).replace('T', ' ');
}

function formatRowUtcIso(row) {
  if (row?.created_at_utc) {
    return String(row.created_at_utc);
  }
  if (row?.created_at instanceof Date) {
    return row.created_at.toISOString();
  }
  if (typeof row?.created_at === 'string' && row.created_at.trim()) {
    const s = row.created_at.trim();
    if (s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s)) return s;
    return `${s.replace(' ', 'T')}Z`;
  }
  return new Date().toISOString();
}

function rowToEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    vendorId: normalizeSmartVendorId(row.vendor_id),
    userId: row.user_id,
    sessionId: row.session_id,
    imageBase64: row.image_base64?.startsWith('data:')
      ? row.image_base64
      : row.image_base64
        ? `data:image/jpeg;base64,${row.image_base64}`
        : '',
    width: row.width,
    height: row.height,
    savedLocally: !!row.saved_locally,
    at: formatRowUtcIso(row),
  };
}

async function insertCameraFrame(entry) {
  const pool = await getPool();
  if (!pool || !entry?.id) return false;
  if (entry.userId && isExcludedSmartUserId(entry.userId)) return false;
  const vendorKey = normalizeSmartVendorId(entry.vendorId);
  const utcStr = toMysqlUtcDatetime(entry.at);
  try {
    await pool.query(
      `INSERT INTO smart_camera_frames
        (id, vendor_id, user_id, session_id, image_base64, width, height, saved_locally, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE image_base64 = VALUES(image_base64), created_at = VALUES(created_at)`,
      [
        entry.id,
        vendorKey,
        entry.userId || null,
        entry.sessionId || null,
        entry.imageBase64,
        entry.width || null,
        entry.height || null,
        entry.savedLocally ? 1 : 0,
        utcStr,
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
  const key = normalizeSmartVendorId(vendorId);
  const lim = Math.min(Math.max(Number(limit) || 12, 1), 50);
  try {
    let sql = `SELECT id, vendor_id, user_id, session_id, image_base64, width, height, saved_locally,
                      created_at, DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS created_at_utc
               FROM smart_camera_frames
               WHERE vendor_id = ?
                 AND (user_id IS NULL OR (user_id NOT IN ('tvendor1', 'usr_admin', 'usr_smartvendor1') AND user_id NOT LIKE 'u_sgate_val_%'))
                 AND created_at <= UTC_TIMESTAMP(3) + INTERVAL 1 MINUTE`;
    const params = [key];
    if (since) {
      const sinceDate = new Date(since);
      if (!Number.isNaN(sinceDate.getTime()) && sinceDate.getTime() <= Date.now() + 60000) {
        sql += ' AND created_at > ?';
        params.push(toMysqlUtcDatetime(sinceDate));
      }
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

async function deleteVendorLiveMedia(vendorId) {
  const pool = await getPool();
  if (!pool || !vendorId) return { camera: 0, voice: 0, skipped: true };
  const key = normalizeSmartVendorId(vendorId);
  try {
    const [camRes] = await pool.query('DELETE FROM smart_camera_frames WHERE vendor_id = ?', [key]);
    let voice = 0;
    try {
      const [voiceRes] = await pool.query('DELETE FROM smart_voice_lines WHERE vendor_id = ?', [key]);
      voice = voiceRes?.affectedRows || 0;
    } catch (voiceErr) {
      if (!/doesn't exist|Unknown table/i.test(String(voiceErr.message))) {
        LOG.warning('[Smart] MySQL vendor voice purge:', voiceErr.message);
      }
    }
    return { camera: camRes?.affectedRows || 0, voice, skipped: false };
  } catch (err) {
    LOG.error('[Smart] MySQL vendor live media clear failed:', err.message);
    return { camera: 0, voice: 0, error: err.message, skipped: false };
  }
}

async function deleteLiveStreamsOlderThan(cutoffDate) {
  const pool = await getPool();
  if (!pool || !cutoffDate) return { camera: 0, voice: 0 };
  const cutoffStr = toMysqlUtcDatetime(cutoffDate);
  try {
    const [camRes] = await pool.query('DELETE FROM smart_camera_frames WHERE created_at < ?', [cutoffStr]);
    let voice = 0;
    try {
      const [voiceRes] = await pool.query('DELETE FROM smart_voice_lines WHERE created_at < ?', [cutoffStr]);
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

async function insertVoiceLine(entry) {
  const pool = await getPool();
  if (!pool || !entry?.id || !entry?.text) return false;
  if (entry.userId && isExcludedSmartUserId(entry.userId)) return false;
  const vendorKey = normalizeSmartVendorId(entry.vendorId);
  const utcStr = toMysqlUtcDatetime(entry.at);
  try {
    await pool.query(
      `INSERT INTO smart_voice_lines
        (id, vendor_id, user_id, session_id, line_text, is_final, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE line_text = VALUES(line_text), is_final = VALUES(is_final), created_at = VALUES(created_at)`,
      [
        entry.id,
        vendorKey,
        entry.userId || null,
        entry.sessionId || null,
        String(entry.text).slice(0, 2000),
        entry.final ? 1 : 0,
        utcStr,
      ]
    );
    return true;
  } catch (err) {
    if (!/doesn't exist|Unknown table/i.test(String(err.message))) {
      LOG.warning('[Smart] MySQL voice line insert failed:', err.message);
    }
    return false;
  }
}

async function listVendorVoiceLines(vendorId, { since = null, limit = 80 } = {}) {
  const pool = await getPool();
  if (!pool) return [];
  const key = normalizeSmartVendorId(vendorId);
  const lim = Math.min(Math.max(Number(limit) || 80, 1), 200);
  try {
    let sql = `SELECT id, vendor_id, user_id, session_id, line_text, is_final,
                      created_at, DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS created_at_utc
               FROM smart_voice_lines
               WHERE vendor_id = ?
                 AND (user_id IS NULL OR (user_id NOT IN ('tvendor1', 'usr_admin', 'usr_smartvendor1') AND user_id NOT LIKE 'u_sgate_val_%'))
                 AND created_at <= UTC_TIMESTAMP(3) + INTERVAL 1 MINUTE`;
    const params = [key];
    if (since) {
      const sinceDate = new Date(since);
      if (!Number.isNaN(sinceDate.getTime()) && sinceDate.getTime() <= Date.now() + 60000) {
        sql += ' AND created_at > ?';
        params.push(toMysqlUtcDatetime(sinceDate));
      }
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(lim);
    const [rows] = await pool.query(sql, params);
    return (rows || []).map((row) => ({
      id: row.id,
      vendorId: normalizeSmartVendorId(row.vendor_id),
      userId: row.user_id,
      sessionId: row.session_id,
      text: row.line_text,
      final: !!row.is_final,
      at: formatRowUtcIso(row),
    }));
  } catch (err) {
    if (!/doesn't exist|Unknown table/i.test(String(err.message))) {
      LOG.warning('[Smart] MySQL voice line list failed:', err.message);
    }
    return [];
  }
}

module.exports = {
  insertCameraFrame,
  listVendorFrames,
  insertVoiceLine,
  listVendorVoiceLines,
  deleteVendorLiveMedia,
  deleteLiveStreamsOlderThan,
};
