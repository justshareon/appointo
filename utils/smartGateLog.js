/**
 * SMART SGATE — server-side trace for vendor console / connect debugging.
 */
const LOG = require('./logger');
const { recordBackendFeatureScan } = require('../services/featureScanLogService');

const TRACE_MAX = 100;

function ensureTrace(mem) {
  if (!mem) return [];
  if (!Array.isArray(mem.smartGateTrace)) mem.smartGateTrace = [];
  return mem.smartGateTrace;
}

function logSmartGate(stage, detail = {}) {
  const st = String(stage || 'info').slice(0, 64);
  const payload = { ...detail, logSource: 'smart_gate' };
  const msg =
    payload.message ||
    [st, payload.vendorId, payload.sessionId, payload.userId].filter(Boolean).join(' · ').slice(0, 400);

  LOG.info(`[SmartGate] ${st}`, msg);

  try {
    recordBackendFeatureScan('smart_scan', st, msg, payload);
  } catch (_) {
    /* optional APS log */
  }

  try {
    const db = require('../database');
    const mem = db.inMemoryDb;
    const trace = ensureTrace(mem);
    trace.unshift({
      at: new Date().toISOString(),
      stage: st,
      message: msg,
      vendorId: payload.vendorId != null ? String(payload.vendorId) : undefined,
      sessionId: payload.sessionId,
      userId: payload.userId != null ? String(payload.userId) : undefined,
      extra: Object.keys(payload).length > 6 ? JSON.stringify(payload).slice(0, 280) : undefined,
    });
    if (trace.length > TRACE_MAX) trace.length = TRACE_MAX;
  } catch (_) {
    /* in-memory unavailable */
  }

  return { stage: st, message: msg };
}

function getSmartGateTrace(limit = 30) {
  try {
    const db = require('../database');
    return (db.inMemoryDb?.smartGateTrace || []).slice(0, limit);
  } catch (_) {
    return [];
  }
}

module.exports = { logSmartGate, getSmartGateTrace, TRACE_MAX };
