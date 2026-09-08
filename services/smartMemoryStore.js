/**
 * SMART — isolated in-memory store.
 * Initializes on first API use; cleared after idle timeout or explicit session/end.
 */
const LOG = require('../utils/logger');

const STORE_KEYS = [
  'smartNearbyVendors',
  'smartNearbyScanSessions',
  'smartNearbyDeviceControls',
  'smartNearbyPolicies',
  'smartNearbyVoiceStreams',
];

const IDLE_MS = parseInt(
  process.env.SMART_IDLE_MS || process.env.FEATURE_IDLE_MS || String(10 * 60 * 1000),
  10
);
const MAX_SESSIONS = 500;
const MAX_DEVICE_LOG = 300;

const SEED_VENDORS = [
  { id: 'v_smart1', shop_name: 'Smart Home Hub', location_name: 'Mumbai', category: 'Smart Devices', features_smart: true },
  { id: 'v_smart2', shop_name: 'IoT Connect Store', location_name: 'Delhi', category: 'Smart Devices', features_smart: true },
  { id: 'v_smart3', shop_name: 'Home Automation Pro', location_name: 'Bangalore', category: 'Smart Devices', features_smart: true },
];

let active = false;
let refCount = 0;
let idleTimer = null;

function getMem() {
  const db = require('../database');
  return db.inMemoryDb || null;
}

function ensureArrays(mem) {
  STORE_KEYS.forEach((key) => {
    if (!Array.isArray(mem[key])) mem[key] = [];
  });
}

function loadSeed() {
  const mem = getMem();
  if (!mem) return;
  mem.smartNearbyVendors = SEED_VENDORS.map((v) => ({ ...v }));
  mem.smartNearbyScanSessions = [];
  mem.smartNearbyDeviceControls = [];
  mem.smartNearbyPolicies = [];
  mem.smartNearbyVoiceStreams = [];
}

function scheduleDispose() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (refCount === 0) dispose();
  }, IDLE_MS);
  if (typeof idleTimer.unref === 'function') idleTimer.unref();
}

function initStore() {
  const mem = getMem();
  if (!mem) throw new Error('In-memory database unavailable');
  if (!active) {
    loadSeed();
    ensureArrays(mem);
    active = true;
    LOG.info('[SmartMem] Initialized in-memory store');
  }
  scheduleDispose();
  return mem;
}

function acquire() {
  refCount += 1;
  return initStore();
}

function release() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0) scheduleDispose();
}

function dispose() {
  if (refCount > 0) return { disposed: false, reason: 'in_use' };
  const mem = getMem();
  if (!mem || !active) return { disposed: false, reason: 'not_active' };

  STORE_KEYS.forEach((key) => {
    if (Array.isArray(mem[key])) mem[key].length = 0;
  });

  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  active = false;
  LOG.info('[SmartMem] Disposed in-memory store (all nearby data cleared)');
  return { disposed: true };
}

function capSessions(mem) {
  if (mem.smartNearbyScanSessions.length > MAX_SESSIONS) {
    mem.smartNearbyScanSessions.length = MAX_SESSIONS;
  }
}

function capDeviceLog(mem) {
  if (mem.smartNearbyDeviceControls.length > MAX_DEVICE_LOG) {
    mem.smartNearbyDeviceControls.length = MAX_DEVICE_LOG;
  }
}

function middleware() {
  return (req, res, next) => {
    try {
      acquire();
    } catch (err) {
      return next(err);
    }
    let released = false;
    const onFinish = () => {
      if (released) return;
      released = true;
      release();
      res.removeListener('finish', onFinish);
      res.removeListener('close', onFinish);
    };
    res.on('finish', onFinish);
    res.on('close', onFinish);
    next();
  };
}

function status() {
  const mem = getMem();
  return {
    active,
    refCount,
    idleMs: IDLE_MS,
    counts: mem && active
      ? {
          vendors: mem.smartNearbyVendors?.length || 0,
          sessions: mem.smartNearbyScanSessions?.length || 0,
          deviceControls: mem.smartNearbyDeviceControls?.length || 0,
          policies: mem.smartNearbyPolicies?.length || 0,
          voiceStreams: mem.smartNearbyVoiceStreams?.length || 0,
        }
      : null,
  };
}

module.exports = {
  STORE_KEYS,
  MAX_SESSIONS,
  MAX_DEVICE_LOG,
  acquire,
  release,
  initStore,
  dispose,
  middleware,
  status,
  capSessions,
  capDeviceLog,
  isActive: () => active,
};
