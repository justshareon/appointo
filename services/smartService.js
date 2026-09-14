/**
 * SMART module — nearby scan, device control (in-memory only).
 */
const memStore = require('./smartMemoryStore');
const LOG = require('../utils/logger');
const { sortLatestFirst } = require('../utils/sortLatest');
const db = require('../database');

const DEFAULT_POLICY = {
  wifiScan: true,
  bleScan: true,
  locationShare: true,
  cameraOffer: true,
  micAmbientCheck: true,
  autoPromptOnVisit: false,
  dataRetentionDays: 30,
};

function mem() {
  return memStore.initStore();
}

function seedBeacons(vendor) {
  const name = String(vendor.shop_name || 'Vendor').replace(/\s+/g, '');
  return [
    {
      id: `beacon-wifi-${vendor.id}`,
      kind: 'wifi',
      ssid: `${name}_Secure`,
      vendorName: vendor.shop_name,
      security: 'WPA3',
      signal: -48,
    },
    {
      id: `beacon-ble-${vendor.id}`,
      kind: 'ble',
      bleName: `${name}_Smart`,
      vendorName: vendor.shop_name,
      deviceType: 'beacon',
      rssi: -52,
      connectable: true,
    },
    {
      id: `beacon-ir-${vendor.id}`,
      kind: 'infrared',
      label: `${name}_IR_Gate`,
      vendorName: vendor.shop_name,
      distanceM: 5,
      signalStrength: 78,
    },
    {
      id: `beacon-nfc-${vendor.id}`,
      kind: 'nfc',
      label: `${name}_NFC_Gate`,
      vendorName: vendor.shop_name,
      distanceCm: 12,
      protocol: 'NDEF',
    },
  ];
}

function getSmartVendors(limit = 40) {
  const rows = mem().smartNearbyVendors || [];
  return rows
    .filter((v) => v.features_smart === true || v.features_smart === 1 || v.features_smart === '1')
    .slice(0, limit);
}

function getVendorPolicy(vendorId) {
  const key = String(vendorId);
  const policies = mem().smartNearbyPolicies || [];
  const row = policies.find((p) => String(p.vendorId) === key);
  return { vendorId: key, ...DEFAULT_POLICY, ...(row || {}) };
}

function setVendorPolicy(vendorId, patch = {}) {
  const key = String(vendorId);
  const policies = mem().smartNearbyPolicies;
  const next = {
    ...getVendorPolicy(key),
    ...patch,
    vendorId: key,
    updatedAt: new Date().toISOString(),
  };
  const idx = policies.findIndex((p) => String(p.vendorId) === key);
  if (idx >= 0) policies[idx] = next;
  else policies.push(next);
  return next;
}

function hash(id) {
  return String(id).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
}

async function listNearbyVendors({ city = '', lat, lng } = {}) {
  const vendors = getSmartVendors(50);
  const cityNorm = String(city || '').trim().toLowerCase();
  let list = vendors;
  if (cityNorm) {
    list = list.filter((v) => String(v.location_name || '').toLowerCase().includes(cityNorm));
  }
  if (!list.length) list = vendors.slice(0, 12);

  return list.map((v) => ({
    ...v,
    policy: getVendorPolicy(v.id),
    beacons: seedBeacons(v),
    distanceKm: lat != null && lng != null ? Number((0.3 + (hash(v.id) % 20) / 10).toFixed(1)) : null,
  }));
}

function recordScanSession(payload = {}) {
  const store = mem();
  const entry = {
    id: `cns_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId: payload.userId || null,
    vendorId: payload.vendorId ? String(payload.vendorId) : null,
    sharedWithVendor: !!payload.sharedWithVendor,
    consent: payload.consent || {},
    scan: payload.scan || {},
    location: payload.location || null,
    createdAt: new Date().toISOString(),
  };
  store.smartNearbyScanSessions.unshift(entry);
  memStore.capSessions(store);
  return entry;
}

function activeGateUserIdsForVendor(vendorId) {
  const key = String(vendorId);
  return new Set(
    (mem().smartNearbyGateSessions || [])
      .filter((r) => r.vendorId === key && !r.disconnectedAt && r.inRange && r.userId)
      .map((r) => r.userId)
  );
}

function getVendorSessions(vendorId, limit = 50) {
  const key = String(vendorId);
  const activeUsers = activeGateUserIdsForVendor(key);
  return sortLatestFirst(
    (mem().smartNearbyScanSessions || []).filter(
      (s) => s.vendorId === key && (s.sharedWithVendor || activeUsers.has(s.userId))
    )
  ).slice(0, limit);
}

function getUserSessions(userId, limit = 20) {
  return sortLatestFirst(
    (mem().smartNearbyScanSessions || []).filter((s) => s.userId === userId)
  ).slice(0, limit);
}

function recordDeviceControl(payload = {}) {
  const store = mem();
  const entry = {
    id: `cdc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId: payload.userId || null,
    vendorId: payload.vendorId ? String(payload.vendorId) : null,
    deviceId: payload.deviceId ? String(payload.deviceId) : null,
    action: payload.action || 'toggle',
    deviceName: payload.deviceName || '',
    deviceType: payload.deviceType || '',
    powered: payload.powered,
    createdAt: new Date().toISOString(),
  };
  store.smartNearbyDeviceControls.unshift(entry);
  memStore.capDeviceLog(store);
  return entry;
}

function getUserDeviceControls(userId, limit = 30) {
  return sortLatestFirst(
    (mem().smartNearbyDeviceControls || []).filter((e) => e.userId === userId)
  ).slice(0, limit);
}

function endSession() {
  return memStore.dispose();
}

function getStoreStatus() {
  return memStore.status();
}

const MAX_VOICE_LINES = 400;

function appendVoiceTranscript({ vendorId, userId, sessionId, text, final = false }) {
  const store = mem();
  const key = String(vendorId || 'unknown');
  const line = String(text || '').trim();
  if (!line) return null;
  const entry = {
    id: `svt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    vendorId: key,
    userId: userId || null,
    sessionId: sessionId || null,
    text: line,
    final: !!final,
    at: new Date().toISOString(),
  };
  store.smartNearbyVoiceStreams.unshift(entry);
  if (store.smartNearbyVoiceStreams.length > MAX_VOICE_LINES) {
    store.smartNearbyVoiceStreams.length = MAX_VOICE_LINES;
  }
  return entry;
}

function getVendorVoiceStream(vendorId, { since = null, limit = 80 } = {}) {
  const key = String(vendorId);
  let rows = (mem().smartNearbyVoiceStreams || []).filter((r) => r.vendorId === key);
  if (since) {
    const t = new Date(since).getTime();
    rows = rows.filter((r) => new Date(r.at).getTime() > t);
  }
  return sortLatestFirst(rows, { dateFields: ['at'] }).slice(0, limit);
}

const MAX_GATE_SESSIONS = 200;

function recordGateConnection(payload = {}) {
  const store = mem();
  if (!Array.isArray(store.smartNearbyGateSessions)) store.smartNearbyGateSessions = [];
  const entry = {
    id: `sgate_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId: payload.userId || null,
    userDisplayName: payload.userDisplayName || payload.userName || null,
    vendorId: payload.vendorId ? String(payload.vendorId) : null,
    channel: payload.channel || 'wifi',
    networkLabel: payload.networkLabel || '',
    userSide: payload.userSide || { role: 'user', status: 'connected' },
    vendorSide: payload.vendorSide || { role: 'vendor', status: 'connected' },
    inRange: true,
    connectedAt: payload.connectedAt || new Date().toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
    disconnectedAt: null,
    disconnectReason: null,
  };
  store.smartNearbyGateSessions.unshift(entry);
  if (store.smartNearbyGateSessions.length > MAX_GATE_SESSIONS) {
    store.smartNearbyGateSessions.length = MAX_GATE_SESSIONS;
  }
  return entry;
}

function updateGateHeartbeat(sessionId, { inRange = true, match = null } = {}) {
  const store = mem();
  const rows = store.smartNearbyGateSessions || [];
  const idx = rows.findIndex((r) => r.id === sessionId && !r.disconnectedAt);
  if (idx < 0) return null;
  const row = rows[idx];
  row.lastHeartbeatAt = new Date().toISOString();
  row.inRange = !!inRange;
  if (match?.label) row.networkLabel = match.label;
  if (!inRange) {
    row.disconnectedAt = new Date().toISOString();
    row.disconnectReason = 'out_of_range';
    row.userSide = { ...row.userSide, status: 'disconnected' };
    row.vendorSide = { ...row.vendorSide, status: 'idle', gateOpen: false };
  }
  rows[idx] = row;
  return row;
}

function endGateConnection(sessionId, reason = 'manual') {
  const store = mem();
  const rows = store.smartNearbyGateSessions || [];
  const idx = rows.findIndex((r) => r.id === sessionId && !r.disconnectedAt);
  if (idx < 0) return null;
  const row = rows[idx];
  row.disconnectedAt = new Date().toISOString();
  row.disconnectReason = reason;
  row.inRange = false;
  row.userSide = { ...row.userSide, status: 'disconnected' };
  row.vendorSide = { ...row.vendorSide, status: 'idle', gateOpen: false };
  rows[idx] = row;
  return row;
}

function getUserActiveGate(userId) {
  return (mem().smartNearbyGateSessions || []).find(
    (r) => r.userId === userId && !r.disconnectedAt && r.inRange
  ) || null;
}

function getVendorGateSessions(vendorId, { activeOnly = false, limit = 40 } = {}) {
  const key = String(vendorId);
  let rows = (mem().smartNearbyGateSessions || []).filter((r) => r.vendorId === key);
  if (activeOnly) rows = rows.filter((r) => !r.disconnectedAt && r.inRange);
  return sortLatestFirst(rows, { dateFields: ['connectedAt', 'lastHeartbeatAt'] }).slice(0, limit);
}

function resolveUserBrief(userId) {
  if (!userId) {
    return { id: null, name: 'Unknown user', email: '', mobile: '', location_name: '' };
  }
  const users = db.inMemoryDb?.users || [];
  const u = users.find((x) => String(x.id) === String(userId));
  if (u) {
    return {
      id: u.id,
      name: u.name || u.email || u.id,
      email: u.email || '',
      mobile: u.mobile || '',
      location_name: u.location_name || '',
    };
  }
  return {
    id: userId,
    name: `User ${String(userId).slice(-6)}`,
    email: '',
    mobile: '',
    location_name: '',
  };
}

function resolveVendorIdsForUser(userId) {
  const uid = String(userId || '');
  if (!uid) return [];
  const vendors = getSmartVendors(100);
  const ids = new Set();
  vendors.forEach((v) => {
    if (String(v.owner_id) === uid) ids.add(String(v.id));
  });
  (db.inMemoryDb?.user_vendor_mappings || []).forEach((m) => {
    if (String(m.user_id) === uid && vendors.some((v) => String(v.id) === String(m.vendor_id))) {
      ids.add(String(m.vendor_id));
    }
  });
  return [...ids];
}

function vendorAccessAllowed(req, vendorId) {
  const role = String(req.user?.role || '').toLowerCase();
  if (role === 'super_admin' || role === 'admin') return true;
  const userId = req.user?.id || req.userId;
  const allowed = resolveVendorIdsForUser(userId);
  if (allowed.some((id) => String(id) === String(vendorId))) return true;
  if (role === 'vendor' && req.user?.vendor_id && String(req.user.vendor_id) === String(vendorId)) {
    return true;
  }
  return false;
}

function linkedUserIdsForVendor(vendorId) {
  const key = String(vendorId);
  const ids = activeGateUserIdsForVendor(key);
  (mem().smartNearbyGateSessions || [])
    .filter((r) => r.vendorId === key && r.userId)
    .forEach((r) => ids.add(r.userId));
  (mem().smartNearbyScanSessions || [])
    .filter((s) => s.vendorId === key && s.userId && (s.sharedWithVendor || ids.has(s.userId)))
    .forEach((s) => ids.add(s.userId));
  (mem().smartNearbyVoiceStreams || [])
    .filter((v) => v.vendorId === key && v.userId)
    .forEach((v) => ids.add(v.userId));
  return ids;
}

function getVendorDeviceControls(vendorId, { userIds = null, limit = 60 } = {}) {
  const key = String(vendorId);
  const idSet = userIds ? new Set(userIds.filter(Boolean)) : linkedUserIdsForVendor(key);
  if (!idSet.size) {
    return sortLatestFirst(
      (mem().smartNearbyDeviceControls || []).filter((c) => c.vendorId === key)
    ).slice(0, limit);
  }
  return sortLatestFirst(
    (mem().smartNearbyDeviceControls || []).filter(
      (c) => idSet.has(c.userId) && (!c.vendorId || c.vendorId === key)
    )
  ).slice(0, limit);
}

function buildVendorDashboard(vendorId) {
  const key = String(vendorId);
  const activeGates = getVendorGateSessions(key, { activeOnly: true, limit: 100 });
  const recentGates = getVendorGateSessions(key, { limit: 60 });
  const scans = getVendorSessions(key, 80);
  const voiceLines = getVendorVoiceStream(key, { limit: 200 });
  const deviceControls = getVendorDeviceControls(key, { limit: 80 });

  const userMap = new Map();
  const touch = (userId) => {
    const id = userId || 'unknown';
    if (!userMap.has(id)) {
      userMap.set(id, {
        userId: id,
        user: resolveUserBrief(userId),
        activeGate: null,
        gateHistory: [],
        scans: [],
        voiceLines: [],
        deviceControls: [],
      });
    }
    return userMap.get(id);
  };

  recentGates.forEach((g) => {
    const row = touch(g.userId);
    row.gateHistory.push(g);
    if (!g.disconnectedAt && g.inRange) row.activeGate = g;
  });
  scans.forEach((s) => touch(s.userId).scans.push(s));
  voiceLines.forEach((v) => touch(v.userId).voiceLines.push(v));
  deviceControls.forEach((c) => touch(c.userId).deviceControls.push(c));

  const users = [...userMap.values()].sort((a, b) => {
    const aLive = a.activeGate ? 1 : 0;
    const bLive = b.activeGate ? 1 : 0;
    if (bLive !== aLive) return bLive - aLive;
    const aT = a.activeGate?.lastHeartbeatAt || a.gateHistory[0]?.connectedAt || '';
    const bT = b.activeGate?.lastHeartbeatAt || b.gateHistory[0]?.connectedAt || '';
    return String(bT).localeCompare(String(aT));
  });

  users.forEach((u) => {
    const gateName = u.activeGate?.userDisplayName || u.gateHistory.find((g) => g.userDisplayName)?.userDisplayName;
    if (gateName && (!u.user?.name || String(u.user.name).startsWith('User '))) {
      u.user = { ...u.user, name: gateName };
    }
    u.gateHistory = sortLatestFirst(u.gateHistory, { dateFields: ['connectedAt', 'lastHeartbeatAt'] });
    u.scans = sortLatestFirst(u.scans, { dateFields: ['createdAt'] });
    u.voiceLines = sortLatestFirst(u.voiceLines, { dateFields: ['at'] });
    u.deviceControls = sortLatestFirst(u.deviceControls, { dateFields: ['createdAt'] });
  });

  return {
    vendorId: key,
    stats: {
      connectedNow: activeGates.length,
      totalUsers: users.length,
      sharedScans: scans.length,
      voiceLines: voiceLines.length,
    },
    activeGates,
    users,
    recentGates,
    scans,
    voiceLines,
    deviceControls,
  };
}

module.exports = {
  getSmartVendors,
  listNearbyVendors,
  getVendorPolicy,
  setVendorPolicy,
  recordScanSession,
  getVendorSessions,
  getUserSessions,
  recordDeviceControl,
  getUserDeviceControls,
  endSession,
  getStoreStatus,
  appendVoiceTranscript,
  getVendorVoiceStream,
  seedBeacons,
  recordGateConnection,
  updateGateHeartbeat,
  endGateConnection,
  getUserActiveGate,
  getVendorGateSessions,
  resolveUserBrief,
  resolveVendorIdsForUser,
  vendorAccessAllowed,
  getVendorDeviceControls,
  buildVendorDashboard,
};

