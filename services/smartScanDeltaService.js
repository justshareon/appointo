/**
 * Compare new SMART scan vs last snapshot for vendor+user — WiFi & device add/remove.
 */
const db = require('../database');
const { logSmartGate } = require('../utils/smartGateLog');

const MAX_ALERTS = 120;

function mem() {
  const m = db.inMemoryDb;
  if (!m) return null;
  if (!m.smartNearbyScanSnapshots) m.smartNearbyScanSnapshots = {};
  if (!Array.isArray(m.smartNearbyScanAlerts)) m.smartNearbyScanAlerts = [];
  return m;
}

function wifiKey(w) {
  const ssid = String(w?.ssid || w?.id || '').trim();
  return ssid ? ssid.toLowerCase() : null;
}

function deviceKey(d) {
  const id = String(d?.id || '').trim();
  if (id) return `id:${id.toLowerCase()}`;
  const name = String(d?.name || d?.label || '').trim().toLowerCase();
  const mac = String(d?.mac || d?.address || '').trim().toLowerCase();
  if (name && mac) return `nm:${name}|${mac}`;
  if (name) return `nm:${name}`;
  return null;
}

function labelWifi(w) {
  return String(w?.ssid || w?.id || 'WiFi network');
}

function labelDevice(d) {
  return String(d?.name || d?.label || d?.brand || d?.type || 'Device');
}

function diffByKey(prevKeys, items, keyFn) {
  const prev = new Set(Array.isArray(prevKeys) ? prevKeys : []);
  const added = [];
  const nextKeys = [];
  (items || []).forEach((item) => {
    const k = keyFn(item);
    if (!k) return;
    nextKeys.push(k);
    if (!prev.has(k)) added.push(item);
  });
  const nextSet = new Set(nextKeys);
  const removed = [...prev].filter((k) => !nextSet.has(k));
  return { added, removed, keys: nextKeys, count: nextSet.size };
}

function snapshotKey(vendorId, userId) {
  return `${String(vendorId)}:${String(userId)}`;
}

function emptyPrev() {
  return {
    wifiKeys: [],
    deviceKeys: [],
    wifiCount: 0,
    deviceCount: 0,
  };
}

function computeScanDelta({ vendorId, userId, userDisplayName, scan, prev, store, sk }) {
  const wifiList = Array.isArray(scan.wifi) ? scan.wifi : [];
  const deviceList = [
    ...(Array.isArray(scan.smartDevices) ? scan.smartDevices : []),
    ...(Array.isArray(scan.bluetooth) ? scan.bluetooth : []),
  ];

  const wifiDiff = diffByKey(prev.wifiKeys, wifiList, wifiKey);
  const deviceDiff = diffByKey(prev.deviceKeys, deviceList, deviceKey);

  const isBaseline = !prev.updatedAt;
  const updatedAt = new Date().toISOString();
  const nextSnapshot = {
    vendorId: String(vendorId),
    userId: String(userId),
    wifiKeys: wifiDiff.keys,
    deviceKeys: deviceDiff.keys,
    wifiCount: wifiDiff.count,
    deviceCount: deviceDiff.count,
    updatedAt,
  };

  if (store && sk) {
    store.smartNearbyScanSnapshots[sk] = nextSnapshot;
  }

  if (isBaseline) {
    return {
      delta: {
        changed: false,
        baseline: true,
        wifiCount: wifiDiff.count,
        deviceCount: deviceDiff.count,
        netWifi: 0,
        netDevices: 0,
      },
      nextSnapshot,
      alert: null,
    };
  }

  const hasChange =
    wifiDiff.added.length
    || wifiDiff.removed.length
    || deviceDiff.added.length
    || deviceDiff.removed.length;

  if (!hasChange) {
    return {
      delta: {
        changed: false,
        wifiCount: wifiDiff.count,
        deviceCount: deviceDiff.count,
        netWifi: 0,
        netDevices: 0,
      },
      nextSnapshot,
      alert: null,
    };
  }

  const delta = {
    changed: true,
    wifiCount: wifiDiff.count,
    deviceCount: deviceDiff.count,
    netWifi: wifiDiff.added.length - wifiDiff.removed.length,
    netDevices: deviceDiff.added.length - deviceDiff.removed.length,
    addedWifi: wifiDiff.added.map(labelWifi),
    removedWifi: wifiDiff.removed,
    addedDevices: deviceDiff.added.map(labelDevice),
    removedDevices: deviceDiff.removed,
    at: updatedAt,
  };

  const alert = {
    id: `sal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    vendorId: String(vendorId),
    userId: String(userId),
    userDisplayName: userDisplayName || null,
    ...delta,
  };

  if (store) {
    store.smartNearbyScanAlerts.unshift(alert);
    if (store.smartNearbyScanAlerts.length > MAX_ALERTS) {
      store.smartNearbyScanAlerts.length = MAX_ALERTS;
    }
  }

  logSmartGate('scan_delta_vendor', {
    vendorId,
    userId,
    message: `WiFi ${delta.netWifi >= 0 ? '+' : ''}${delta.netWifi} · devices ${delta.netDevices >= 0 ? '+' : ''}${delta.netDevices}`,
    addedWifi: delta.addedWifi.slice(0, 5),
    addedDevices: delta.addedDevices.slice(0, 5),
  });

  return { delta, nextSnapshot, alert };
}

/**
 * @returns {null|object} delta summary stored on scan session (in-memory prev only)
 */
function applyScanDelta({ vendorId, userId, userDisplayName, scan, sharedWithVendor }) {
  if (!sharedWithVendor || !vendorId || !userId || !scan) return null;

  const store = mem();
  if (!store) return null;

  const sk = snapshotKey(vendorId, userId);
  const prev = store.smartNearbyScanSnapshots[sk] || emptyPrev();
  const { delta } = computeScanDelta({
    vendorId,
    userId,
    userDisplayName,
    scan,
    prev,
    store,
    sk,
  });
  return delta;
}

/** Render-safe: load/save snapshot + alerts in MySQL when DB_TYPE=mysql. */
async function applyScanDeltaAsync({ vendorId, userId, userDisplayName, scan, sharedWithVendor }) {
  if (!sharedWithVendor || !vendorId || !userId || !scan) return null;

  const store = mem();
  const sk = snapshotKey(vendorId, userId);
  const mysql = require('./smartScanDeltaMysqlService');

  let prev = emptyPrev();
  if (mysql.mysqlScanDeltaEnabled()) {
    const fromDb = await mysql.loadSnapshot(vendorId, userId);
    if (fromDb) prev = fromDb;
  } else if (store?.smartNearbyScanSnapshots?.[sk]) {
    prev = store.smartNearbyScanSnapshots[sk];
  }

  const { delta, nextSnapshot, alert } = computeScanDelta({
    vendorId,
    userId,
    userDisplayName,
    scan,
    prev,
    store: store || null,
    sk: store ? sk : null,
  });

  if (mysql.mysqlScanDeltaEnabled()) {
    await mysql.saveSnapshot(nextSnapshot);
    if (alert) await mysql.insertAlert(alert);
  }

  return delta;
}

function getVendorScanAlerts(vendorId, limit = 25) {
  const store = mem();
  if (!store) return [];
  const key = String(vendorId);
  return (store.smartNearbyScanAlerts || [])
    .filter((a) => a.vendorId === key)
    .slice(0, limit);
}

async function getVendorScanAlertsAsync(vendorId, limit = 25) {
  const mysql = require('./smartScanDeltaMysqlService');
  if (mysql.mysqlScanDeltaEnabled()) {
    const rows = await mysql.listVendorAlerts(vendorId, limit);
    if (rows) return rows;
  }
  return getVendorScanAlerts(vendorId, limit);
}

function getVendorScanTotals(vendorId) {
  const store = mem();
  if (!store) return { wifiCount: 0, deviceCount: 0, customerScans: 0 };
  const key = String(vendorId);
  const snaps = Object.values(store.smartNearbyScanSnapshots || {}).filter(
    (s) => String(s.vendorId) === key
  );
  let wifiCount = 0;
  let deviceCount = 0;
  snaps.forEach((s) => {
    wifiCount += s.wifiCount || 0;
    deviceCount += s.deviceCount || 0;
  });
  return { wifiCount, deviceCount, customerScans: snaps.length };
}

async function getVendorScanTotalsAsync(vendorId) {
  const mysql = require('./smartScanDeltaMysqlService');
  const memTotals = getVendorScanTotals(vendorId);
  if (mysql.mysqlScanDeltaEnabled()) {
    const totals = await mysql.vendorScanTotals(vendorId);
    if (totals) {
      return {
        wifiCount: Math.max(totals.wifiCount || 0, memTotals.wifiCount || 0),
        deviceCount: Math.max(totals.deviceCount || 0, memTotals.deviceCount || 0),
        customerScans: Math.max(totals.customerScans || 0, memTotals.customerScans || 0),
      };
    }
  }
  return memTotals;
}

/** Latest shared scan per customer — fallback when snapshots missing (same server / before MySQL sync). */
function deriveTotalsFromSharedScans(sessions) {
  const latestByUser = new Map();
  (sessions || []).forEach((s) => {
    if (!s?.sharedWithVendor || !s.userId) return;
    const prev = latestByUser.get(s.userId);
    if (!prev || String(s.createdAt || '') > String(prev.createdAt || '')) {
      latestByUser.set(s.userId, s);
    }
  });
  let wifiCount = 0;
  let deviceCount = 0;
  latestByUser.forEach((s) => {
    const scan = s.scan || {};
    const w = scan.counts?.wifi;
    const d = scan.counts?.smartDevices ?? scan.counts?.devices;
    wifiCount += Number.isFinite(Number(w))
      ? Number(w)
      : (Array.isArray(scan.wifi) ? scan.wifi.length : 0);
    if (Number.isFinite(Number(d))) {
      deviceCount += Number(d);
    } else {
      const sm = Array.isArray(scan.smartDevices) ? scan.smartDevices.length : 0;
      const ble = Array.isArray(scan.bluetooth) ? scan.bluetooth.length : 0;
      deviceCount += sm || ble;
    }
  });
  return { wifiCount, deviceCount, customerScans: latestByUser.size };
}

module.exports = {
  applyScanDelta,
  applyScanDeltaAsync,
  getVendorScanAlerts,
  getVendorScanAlertsAsync,
  getVendorScanTotals,
  getVendorScanTotalsAsync,
  deriveTotalsFromSharedScans,
};
