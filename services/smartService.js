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
    payload: payload.payload != null ? String(payload.payload).slice(0, 500) : undefined,
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

function updateGateHeartbeat(sessionId, { inRange = true, match = null, gateOpen, vendorListening } = {}) {
  const store = mem();
  const rows = store.smartNearbyGateSessions || [];
  const idx = rows.findIndex((r) => r.id === sessionId && !r.disconnectedAt);
  if (idx < 0) return null;
  const row = rows[idx];
  row.lastHeartbeatAt = new Date().toISOString();
  row.inRange = !!inRange;
  if (match?.label) row.networkLabel = match.label;
  if (gateOpen != null) {
    row.vendorSide = {
      ...row.vendorSide,
      gateOpen: !!gateOpen,
      status: gateOpen ? 'connected' : 'idle',
    };
  }
  if (vendorListening != null) {
    row.vendorSide = {
      ...row.vendorSide,
      vendorListening: !!vendorListening,
      vendorListeningAt: vendorListening ? new Date().toISOString() : row.vendorSide?.vendorListeningAt || null,
    };
  }
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

/** Vendor console — mark all active SGATE sessions as listen mode for connected customers. */
function setVendorVoiceListen(vendorId, listening = false) {
  const key = String(vendorId || '');
  if (!key) return { updated: 0 };
  const rows = mem().smartNearbyGateSessions || [];
  let updated = 0;
  rows.forEach((r, i) => {
    if (r.vendorId !== key || r.disconnectedAt) return;
    rows[i] = {
      ...r,
      vendorSide: {
        ...r.vendorSide,
        vendorListening: !!listening,
        vendorListeningAt: listening ? new Date().toISOString() : r.vendorSide?.vendorListeningAt || null,
      },
      lastHeartbeatAt: new Date().toISOString(),
    };
    updated += 1;
  });
  return { updated, listening: !!listening };
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
  (mem().smartNearbyConnectInvites || [])
    .filter((i) => i.vendorId === key && i.targetUserId && ['pending', 'accepted'].includes(i.status))
    .forEach((i) => ids.add(i.targetUserId));
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

const MAX_CONNECT_INVITES = 300;
const INVITE_TTL_MS = 30 * 60 * 1000;
const OPEN_CONNECT_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CONNECT_LINKS = 80;

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').slice(-10);
}

function findUserByTarget({ userId, mobile, email } = {}) {
  const users = db.inMemoryDb?.users || [];
  if (userId) {
    const hit = users.find((u) => String(u.id) === String(userId));
    if (hit) return hit;
  }
  const phone = normalizePhone(mobile);
  if (phone) {
    const hit = users.find((u) => normalizePhone(u.mobile) === phone);
    if (hit) return hit;
  }
  const em = String(email || '').trim().toLowerCase();
  if (em) {
    const hit = users.find((u) => String(u.email || '').trim().toLowerCase() === em);
    if (hit) return hit;
  }
  return null;
}

function createConnectInvite(vendorId, payload = {}) {
  const store = mem();
  if (!Array.isArray(store.smartNearbyConnectInvites)) store.smartNearbyConnectInvites = [];
  const key = String(vendorId);
  let target = findUserByTarget(payload);
  if (!target?.id && payload.userId) {
    target = {
      id: String(payload.userId),
      name: payload.targetUserName || payload.userDisplayName || String(payload.userId),
      email: payload.email || '',
      mobile: payload.mobile || '',
    };
  }
  if (!target?.id) {
    throw new Error('User not found — enter mobile, email, or user id from your customer list');
  }
  const existing = store.smartNearbyConnectInvites.find(
    (i) =>
      i.vendorId === key
      && i.targetUserId === target.id
      && i.status === 'pending'
      && new Date(i.expiresAt).getTime() > Date.now()
  );
  if (existing) return existing;

  const vendors = getSmartVendors(100);
  const vendor = vendors.find((v) => String(v.id) === key);
  const entry = {
    id: `sginv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    vendorId: key,
    vendorName: vendor?.shop_name || payload.vendorName || key,
    targetUserId: target.id,
    targetUserName: target.name || target.email || target.id,
    channel: payload.channel || 'wifi',
    message: String(payload.message || '').slice(0, 280),
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    sessionId: null,
  };
  store.smartNearbyConnectInvites.unshift(entry);
  if (store.smartNearbyConnectInvites.length > MAX_CONNECT_INVITES) {
    store.smartNearbyConnectInvites.length = MAX_CONNECT_INVITES;
  }
  return entry;
}

function listPendingInvitesForUser(userId) {
  const uid = String(userId || '');
  const now = Date.now();
  return sortLatestFirst(
    (mem().smartNearbyConnectInvites || []).filter(
      (i) => i.targetUserId === uid && i.status === 'pending' && new Date(i.expiresAt).getTime() > now
    ),
    { dateFields: ['createdAt'] }
  );
}

function listInvitesForVendor(vendorId, { limit = 40 } = {}) {
  const key = String(vendorId);
  return sortLatestFirst(
    (mem().smartNearbyConnectInvites || []).filter((i) => i.vendorId === key),
    { dateFields: ['createdAt'] }
  ).slice(0, limit);
}

function acceptConnectInvite(inviteId, userId, { userDisplayName = null } = {}) {
  const store = mem();
  const uid = String(userId || '');
  const idx = (store.smartNearbyConnectInvites || []).findIndex((i) => i.id === inviteId);
  if (idx < 0) throw new Error('Invite not found');
  const invite = store.smartNearbyConnectInvites[idx];
  if (invite.status !== 'pending') throw new Error('Invite is no longer pending');
  if (String(invite.targetUserId) !== uid) throw new Error('This invite is for another user');
  if (new Date(invite.expiresAt).getTime() < Date.now()) {
    invite.status = 'expired';
    throw new Error('Invite expired — ask vendor to send again');
  }

  const active = getUserActiveGate(uid);
  if (active) {
    invite.status = 'accepted';
    invite.sessionId = active.id;
    invite.acceptedAt = new Date().toISOString();
    store.smartNearbyConnectInvites[idx] = invite;
    return { invite, session: active, alreadyConnected: true };
  }

  const session = recordGateConnection({
    userId: uid,
    userDisplayName: userDisplayName || invite.targetUserName,
    vendorId: invite.vendorId,
    channel: invite.channel || 'wifi',
    networkLabel: `${invite.vendorName} · vendor invite`,
    userSide: { role: 'user', status: 'connected', via: 'vendor_invite' },
    vendorSide: { role: 'vendor', status: 'connected', gateOpen: true, via: 'vendor_invite' },
  });
  invite.status = 'accepted';
  invite.sessionId = session.id;
  invite.acceptedAt = new Date().toISOString();
  store.smartNearbyConnectInvites[idx] = invite;
  return { invite, session, alreadyConnected: false };
}

function declineConnectInvite(inviteId, userId) {
  const store = mem();
  const uid = String(userId || '');
  const idx = (store.smartNearbyConnectInvites || []).findIndex((i) => i.id === inviteId);
  if (idx < 0) return null;
  const invite = store.smartNearbyConnectInvites[idx];
  if (String(invite.targetUserId) !== uid) throw new Error('Not allowed');
  invite.status = 'declined';
  invite.declinedAt = new Date().toISOString();
  store.smartNearbyConnectInvites[idx] = invite;
  return invite;
}

function listReachableUsersForVendor(vendorId) {
  const key = String(vendorId);
  const ids = linkedUserIdsForVendor(key);
  return [...ids].map((id) => resolveUserBrief(id));
}

function newConnectLinkCode() {
  return `sg${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 14);
}

/** Reusable vendor QR / URL — any logged-in customer can join SGATE + SMART devices. */
function getOrCreateVendorConnectLink(vendorId, { message, forceNew = false } = {}) {
  const store = mem();
  if (!Array.isArray(store.smartVendorConnectLinks)) store.smartVendorConnectLinks = [];
  const key = String(vendorId);
  const now = Date.now();
  if (!forceNew) {
    const existing = store.smartVendorConnectLinks.find(
      (l) => l.vendorId === key && new Date(l.expiresAt).getTime() > now
    );
    if (existing) return existing;
  }
  const vendors = getSmartVendors(100);
  const vendor = vendors.find((v) => String(v.id) === key);
  const row = {
    vendorId: key,
    vendorName: vendor?.shop_name || key,
    linkCode: newConnectLinkCode(),
    message:
      String(message || '').slice(0, 280)
      || 'Connect on SMART — link WiFi, Bluetooth, IR & control nearby TV/AC with your vendor.',
    channel: 'wifi',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(now + OPEN_CONNECT_LINK_TTL_MS).toISOString(),
  };
  store.smartVendorConnectLinks.unshift(row);
  if (store.smartVendorConnectLinks.length > MAX_CONNECT_LINKS) {
    store.smartVendorConnectLinks.length = MAX_CONNECT_LINKS;
  }
  return row;
}

function joinVendorConnectLink(code, userId, { userDisplayName = null, vendorId = null } = {}) {
  const store = mem();
  const codeNorm = String(code || '').trim().toLowerCase();
  const link = (store.smartVendorConnectLinks || []).find(
    (l) => String(l.linkCode || '').toLowerCase() === codeNorm
  );
  if (!link) throw new Error('Invalid connect link — scan the vendor QR again');
  if (new Date(link.expiresAt).getTime() < Date.now()) {
    throw new Error('Connect link expired — ask vendor to refresh QR on their console');
  }
  if (vendorId && String(link.vendorId) !== String(vendorId)) {
    throw new Error('This link is for another shop');
  }

  const uid = String(userId || '');
  if (!uid) throw new Error('Sign in to connect');

  const active = getUserActiveGate(uid);
  if (active && String(active.vendorId) === String(link.vendorId)) {
    return { session: active, link, alreadyConnected: true };
  }

  const session = recordGateConnection({
    userId: uid,
    userDisplayName: userDisplayName || 'Customer',
    vendorId: link.vendorId,
    channel: link.channel || 'wifi',
    networkLabel: `${link.vendorName} · shared link`,
    userSide: { role: 'user', status: 'connected', via: 'connect_link' },
    vendorSide: { role: 'vendor', status: 'connected', gateOpen: true, via: 'connect_link' },
  });
  return { session, link, alreadyConnected: false };
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

  const connectInvites = listInvitesForVendor(key, { limit: 50 });
  const pendingOutbound = connectInvites.filter((i) => i.status === 'pending');

  const vendorRow = getSmartVendors(100).find((v) => String(v.id) === key);
  const connectLink = getOrCreateVendorConnectLink(key);

  return {
    vendorId: key,
    vendorName: vendorRow?.shop_name || key,
    connectLink: {
      linkCode: connectLink.linkCode,
      code: connectLink.linkCode,
      vendorName: connectLink.vendorName,
      expiresAt: connectLink.expiresAt,
      message: connectLink.message,
    },
    stats: {
      connectedNow: activeGates.length,
      totalUsers: users.length,
      sharedScans: scans.length,
      voiceLines: voiceLines.length,
      pendingInvites: pendingOutbound.length,
    },
    activeGates,
    users,
    recentGates,
    scans,
    voiceLines,
    deviceControls,
    connectInvites,
    reachableUsers: listReachableUsersForVendor(key),
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
  setVendorVoiceListen,
  endGateConnection,
  getUserActiveGate,
  getVendorGateSessions,
  resolveUserBrief,
  resolveVendorIdsForUser,
  vendorAccessAllowed,
  getVendorDeviceControls,
  buildVendorDashboard,
  createConnectInvite,
  listPendingInvitesForUser,
  listInvitesForVendor,
  acceptConnectInvite,
  declineConnectInvite,
  listReachableUsersForVendor,
  findUserByTarget,
  getOrCreateVendorConnectLink,
  joinVendorConnectLink,
};

