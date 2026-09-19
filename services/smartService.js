/**
 * SMART module — mic text in memory; camera frames in memory + MySQL when DB_TYPE=mysql.
 * Retention days: super_admin setting smart_live_retention_days (default 1).
 */
const memStore = require('./smartMemoryStore');
const LOG = require('../utils/logger');
const { logSmartGate, getSmartGateTrace } = require('../utils/smartGateLog');
const { sortLatestFirst } = require('../utils/sortLatest');
const db = require('../database');
const smartCameraMysql = require('./smartCameraMysqlService');
const { getSmartLiveRetentionDaysSync } = require('./smartLiveSettingsService');

/** Camera live feed persisted to MySQL when mysql mode (set SMART_CAMERA_MEMORY_ONLY=true to disable). */
function smartCameraPersistMysql() {
  const memOnly = String(process.env.SMART_CAMERA_MEMORY_ONLY || '').trim().toLowerCase();
  if (memOnly === '1' || memOnly === 'true' || memOnly === 'yes') return false;
  return db.getType() === 'mysql';
}

function defaultCameraAiEnabled() {
  const raw = process.env.SMART_CAMERA_AI_DEFAULT;
  if (raw == null || String(raw).trim() === '') return true;
  const v = String(raw).trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'no');
}

const DEFAULT_POLICY = {
  wifiScan: true,
  bleScan: true,
  locationShare: true,
  cameraOffer: true,
  micAmbientCheck: true,
  autoPromptOnVisit: false,
  dataRetentionDays: 1,
  /** true = event recordings + live preview; false = live stream only (no Recent gallery) */
  cameraAiEnabled: defaultCameraAiEnabled(),
};

const MYSQL_LIVE_PURGE_INTERVAL_MS = 60 * 60 * 1000;
let lastMysqlLivePurgeAt = 0;

function smartLiveRetentionDays() {
  return getSmartLiveRetentionDaysSync();
}

function smartLiveRetentionCutoffDate() {
  return new Date(Date.now() - smartLiveRetentionDays() * 24 * 60 * 60 * 1000);
}

function isLiveStreamRowFresh(row, cutoffMs) {
  const t = new Date(row?.at || row?.createdAt || 0).getTime();
  return Number.isFinite(t) && t >= cutoffMs;
}

function purgeExpiredLiveStreamsMemory() {
  const cutoffMs = smartLiveRetentionCutoffDate().getTime();
  const store = mem();
  let voiceRemoved = 0;
  let cameraRemoved = 0;
  if (Array.isArray(store.smartNearbyVoiceStreams)) {
    const before = store.smartNearbyVoiceStreams.length;
    store.smartNearbyVoiceStreams = store.smartNearbyVoiceStreams.filter((r) =>
      isLiveStreamRowFresh(r, cutoffMs)
    );
    voiceRemoved = before - store.smartNearbyVoiceStreams.length;
  }
  const camList = ensureCameraStore();
  const camBefore = camList.length;
  for (let i = camList.length - 1; i >= 0; i -= 1) {
    if (!isLiveStreamRowFresh(camList[i], cutoffMs)) camList.splice(i, 1);
  }
  cameraRemoved = camBefore - camList.length;
  return { voiceRemoved, cameraRemoved, retentionDays: smartLiveRetentionDays() };
}

async function purgeExpiredLiveStreamsMysql(force = false) {
  if (!smartCameraPersistMysql()) {
    return { camera: 0, voice: 0, skipped: true };
  }
  const now = Date.now();
  if (!force && now - lastMysqlLivePurgeAt < MYSQL_LIVE_PURGE_INTERVAL_MS) {
    return { camera: 0, voice: 0, skipped: true, reason: 'throttled' };
  }
  lastMysqlLivePurgeAt = now;
  const cutoff = smartLiveRetentionCutoffDate();
  const result = await smartCameraMysql.deleteLiveStreamsOlderThan(cutoff);
  if (result.camera > 0 || result.voice > 0) {
    logSmartGate('live_stream_retention_mysql', {
      message: `Purged mic/camera rows older than ${smartLiveRetentionDays()}d`,
      ...result,
      cutoff: cutoff.toISOString(),
    });
  }
  return result;
}

function purgeExpiredLiveStreams(options = {}) {
  const memResult = purgeExpiredLiveStreamsMemory();
  if (memResult.voiceRemoved > 0 || memResult.cameraRemoved > 0) {
    logSmartGate('live_stream_retention_memory', {
      message: `Removed mic/camera older than ${memResult.retentionDays}d from memory`,
      voiceRemoved: memResult.voiceRemoved,
      cameraRemoved: memResult.cameraRemoved,
    });
  }
  if (options.mysql !== false) {
    purgeExpiredLiveStreamsMysql(options.forceMysql).catch((err) => {
      LOG.warning('[Smart] live stream MySQL retention purge failed:', err.message);
    });
  }
  return memResult;
}

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

const SYNTHETIC_SMART_USER_IDS = new Set(['usr_smart1', 'usr_smartvendor1']);

function isSyntheticSmartUserId(userId) {
  const s = String(userId || '');
  if (!s) return true;
  if (SYNTHETIC_SMART_USER_IDS.has(s)) return true;
  return /^u_(sgate_val|validate)_/i.test(s) || /^scf_val_/i.test(s);
}

const LIVE_CUSTOMER_RECENT_MS = 5 * 60 * 1000;

function isRecentLiveAt(iso) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && Date.now() - t < LIVE_CUSTOMER_RECENT_MS;
}

/** Real customers at the shop right now (SGATE in range or mic/camera in last 5m). */
function liveCustomerUserIdsForVendor(vendorId) {
  const key = String(vendorId);
  const ids = activeGateUserIdsForVendor(key);
  (mem().smartNearbyVoiceStreams || []).forEach((v) => {
    if (String(v.vendorId) === key && v.userId && isRecentLiveAt(v.at)) ids.add(v.userId);
  });
  (mem().smartCameraLiveFrames || []).forEach((f) => {
    if (String(f.vendorId) === key && f.userId && isRecentLiveAt(f.at || f.createdAt)) ids.add(f.userId);
  });
  for (const uid of [...ids]) {
    if (isSyntheticSmartUserId(uid)) ids.delete(uid);
  }
  return ids;
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
const MAX_CAMERA_FRAMES = 48;

function ensureCameraStore() {
  const store = mem();
  if (!Array.isArray(store.smartCameraLiveFrames)) store.smartCameraLiveFrames = [];
  return store.smartCameraLiveFrames;
}

function ensureGateSessionForStream({ userId, vendorId, sessionId, userDisplayName, via = 'stream' }) {
  const uid = userId ? String(userId) : null;
  const vid = vendorId ? String(vendorId) : null;
  if (!uid || !vid) return null;
  const existing = (mem().smartNearbyGateSessions || []).find(
    (r) => r.userId === uid && String(r.vendorId) === vid && !r.disconnectedAt && r.inRange
  );
  if (existing) {
    existing.lastHeartbeatAt = new Date().toISOString();
    if (sessionId && !existing.id) existing.id = sessionId;
    return existing;
  }
  const session = recordGateConnection({
    userId: uid,
    userDisplayName: userDisplayName || `Customer ${uid.slice(-6)}`,
    vendorId: vid,
    channel: 'wifi',
    networkLabel: via === 'camera' ? 'Live · camera' : 'Live · mic',
    userSide: { role: 'user', status: 'connected', via },
    vendorSide: { role: 'vendor', status: 'connected', via },
  });
  logSmartGate('gate_session_from_stream', {
    vendorId: vid,
    userId: uid,
    sessionId: session.id,
    via,
  });
  return session;
}

function normalizeCameraDataUri(imageBase64) {
  const raw = String(imageBase64 || '').trim();
  if (!raw) return '';
  let frame = raw.startsWith('data:') ? raw : `data:image/jpeg;base64,${raw}`;
  const maxLen = 960000;
  if (frame.length > maxLen) {
    const comma = frame.indexOf(',');
    const prefix = comma >= 0 ? frame.slice(0, comma + 1) : 'data:image/jpeg;base64,';
    let b64 = comma >= 0 ? frame.slice(comma + 1) : frame;
    b64 = b64.slice(0, Math.floor((maxLen - prefix.length) / 4) * 4);
    frame = prefix + b64;
  }
  return frame;
}

function isAcceptableCameraPayload(imageBase64) {
  const uri = normalizeCameraDataUri(imageBase64);
  if (!uri) return false;
  const comma = uri.indexOf(',');
  const payload = comma >= 0 ? uri.slice(comma + 1) : uri;
  return payload.length >= 280;
}

function setVendorLivePreview(vendorId, entry) {
  const store = mem();
  if (!store.smartCameraLivePreview) store.smartCameraLivePreview = {};
  store.smartCameraLivePreview[String(vendorId)] = entry;
}

function getVendorLivePreview(vendorId) {
  return mem().smartCameraLivePreview?.[String(vendorId)] || null;
}

async function persistCameraFrameMysql(entry, { vendorId, userId, sessionId } = {}) {
  if (!smartCameraPersistMysql()) return;
  try {
    const ok = await smartCameraMysql.insertCameraFrame(entry);
    logSmartGate(ok ? 'camera_frame_mysql_ok' : 'camera_frame_mysql_fail', {
      vendorId: String(vendorId || entry.vendorId || ''),
      userId: userId || entry.userId || null,
      sessionId: sessionId || entry.sessionId || null,
      frameId: entry.id,
      message: ok ? 'Camera frame saved to MySQL + memory' : 'MySQL insert failed — vendor may only see memory buffer',
    });
    entry.mysqlPersisted = !!ok;
  } catch (err) {
    entry.mysqlPersisted = false;
    logSmartGate('camera_frame_mysql_fail', {
      vendorId: String(vendorId || entry.vendorId || ''),
      userId: userId || entry.userId || null,
      sessionId: sessionId || entry.sessionId || null,
      frameId: entry.id,
      message: err.message || 'MySQL insert error',
    });
  }
}

async function appendCameraLiveFrame({
  vendorId,
  userId,
  sessionId,
  imageBase64,
  width,
  height,
  savedLocally,
  eventCapture = false,
  liveOnly = false,
  eventRule = null,
  eventLabel = null,
}) {
  const key = String(vendorId || '');
  if (!key || !imageBase64 || !isAcceptableCameraPayload(imageBase64)) return null;
  if (userId) {
    ensureGateSessionForStream({ userId, vendorId: key, sessionId, via: 'camera' });
  }
  const policy = getVendorPolicy(key);
  const aiOn = policy.cameraAiEnabled === true;
  const isEvent = !!eventCapture;
  const isPreviewLive = !!liveOnly && !isEvent;

  if (!aiOn && isEvent) {
    return null;
  }

  const entry = {
    id: `scf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    vendorId: key,
    userId: userId || null,
    sessionId: sessionId || null,
    imageBase64: normalizeCameraDataUri(imageBase64),
    width: width || null,
    height: height || null,
    savedLocally: !!savedLocally,
    eventCapture: false,
    liveOnly: true,
    eventRule: null,
    eventLabel: null,
    at: new Date().toISOString(),
  };

  if (!aiOn) {
    setVendorLivePreview(key, entry);
    purgeExpiredLiveStreams({ mysql: false });
    await persistCameraFrameMysql(entry, { vendorId: key, userId, sessionId });
    return entry;
  }

  if (isEvent) {
    entry.eventCapture = true;
    entry.liveOnly = false;
    entry.eventRule = String(eventRule || '').slice(0, 64) || null;
    entry.eventLabel = String(eventLabel || '').slice(0, 160) || null;
    const list = ensureCameraStore();
    list.unshift(entry);
    if (list.length > MAX_CAMERA_FRAMES) list.length = MAX_CAMERA_FRAMES;
    setVendorLivePreview(key, entry);
  } else if (isPreviewLive || !isEvent) {
    entry.liveOnly = true;
    setVendorLivePreview(key, entry);
    return entry;
  } else {
    return null;
  }

  purgeExpiredLiveStreams({ mysql: false });
  if (!entry.eventCapture) {
    return entry;
  }
  await persistCameraFrameMysql(entry, { vendorId: key, userId, sessionId });
  return entry;
}

async function getVendorCameraLive(vendorId, { since = null, limit = 12, eventsOnly = false } = {}) {
  purgeExpiredLiveStreams();
  const key = String(vendorId);
  let rows = ensureCameraStore().filter(
    (r) => String(r.vendorId) === key && (r.eventCapture || r.eventRule)
  );
  if (since) {
    const t = new Date(since).getTime();
    rows = rows.filter((r) => new Date(r.at).getTime() > t);
  }
  let memoryRows = sortLatestFirst(rows, { dateFields: ['at'] }).slice(0, limit);
  if (smartCameraPersistMysql()) {
    const mysqlRows = await smartCameraMysql.listVendorFrames(key, { since, limit });
    const byId = new Map();
    [...mysqlRows, ...memoryRows].forEach((r) => {
      if (r?.id) byId.set(r.id, r);
    });
    memoryRows = sortLatestFirst([...byId.values()], { dateFields: ['at'] }).slice(0, limit);
  }
  if (eventsOnly) {
    return memoryRows
      .filter((r) => r.eventCapture || r.eventRule)
      .filter((r) => isAcceptableCameraPayload(r.imageBase64))
      .map((r) => ({
        ...r,
        imageBase64: normalizeCameraDataUri(r.imageBase64),
      }));
  }
  const preview = getVendorLivePreview(key);
  const usableMemory = memoryRows.filter((r) => isAcceptableCameraPayload(r.imageBase64));
  const latest =
    (preview && isAcceptableCameraPayload(preview.imageBase64) ? preview : null)
    || usableMemory[0]
    || null;
  const out = [];
  if (latest) {
    out.push({ ...latest, imageBase64: normalizeCameraDataUri(latest.imageBase64) });
  }
  usableMemory.forEach((e) => {
    if (!out.some((x) => x.id === e.id)) {
      out.push({ ...e, imageBase64: normalizeCameraDataUri(e.imageBase64) });
    }
  });
  return out.slice(0, limit);
}

function voiceUserLabel(userId, sessionId) {
  const uid = userId ? String(userId) : '';
  if (!uid) return null;
  const gate = (mem().smartNearbyGateSessions || []).find(
    (g) => g.userId === uid && (!sessionId || g.id === sessionId)
  );
  if (gate?.userDisplayName) return gate.userDisplayName;
  const brief = resolveUserBrief(uid);
  return brief?.name || brief?.email || uid;
}

function appendVoiceTranscript({ vendorId, userId, sessionId, text, final = false }) {
  const store = mem();
  const key = String(vendorId || 'unknown');
  const line = String(text || '').trim();
  if (!line) return null;
  const uid = userId ? String(userId) : null;
  const sid = sessionId ? String(sessionId) : null;
  const streams = store.smartNearbyVoiceStreams || (store.smartNearbyVoiceStreams = []);
  const nowIso = new Date().toISOString();
  const userLabel = voiceUserLabel(uid, sid);

  if (uid && key !== 'unknown') {
    ensureGateSessionForStream({ userId: uid, vendorId: key, sessionId: sid, via: 'mic' });
  }

  const isSystem = /^Microphone (ON|OFF)/i.test(line) || /^Mic live/i.test(line) || line.startsWith('🎤');
  const isFinal = !!final || isSystem;

  if (isSystem && uid) {
    const dup = streams.find(
      (r) =>
        r.vendorId === key
        && r.userId === uid
        && r.text === line
        && Date.now() - new Date(r.at || 0).getTime() < 120000
    );
    if (dup) return dup;
  }

  if (!isFinal && uid) {
    const idx = streams.findIndex(
      (r) => r.vendorId === key && r.userId === uid && r.sessionId === sid && !r.final
    );
    if (idx >= 0) {
      const row = streams[idx];
      if (row.text === line) return row;
      row.text = line;
      row.at = nowIso;
      row.userLabel = userLabel || row.userLabel;
      return row;
    }
  }

  if (isFinal && uid) {
    for (let i = 0; i < streams.length; i += 1) {
      const r = streams[i];
      if (r.vendorId === key && r.userId === uid && r.sessionId === sid && !r.final) {
        streams.splice(i, 1);
        break;
      }
    }
    const dupFinal = streams.find(
      (r) =>
        r.vendorId === key
        && r.userId === uid
        && r.final
        && r.text === line
        && Date.now() - new Date(r.at || 0).getTime() < 4000
    );
    if (dupFinal) return dupFinal;
  }

  const entry = {
    id: `svt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    vendorId: key,
    userId: uid,
    sessionId: sid,
    userLabel,
    text: line,
    final: isFinal,
    at: nowIso,
  };
  streams.unshift(entry);
  if (streams.length > MAX_VOICE_LINES) {
    streams.length = MAX_VOICE_LINES;
  }
  purgeExpiredLiveStreams({ mysql: false });
  return entry;
}

function getVendorVoiceStream(vendorId, { since = null, limit = 80 } = {}) {
  purgeExpiredLiveStreams();
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
    vendorName: payload.vendorName || resolveVendorDisplayName(payload.vendorId) || null,
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
  logSmartGate('gate_session_created', {
    vendorId: entry.vendorId,
    sessionId: entry.id,
    userId: entry.userId,
    channel: entry.channel,
    networkLabel: entry.networkLabel,
    message: `SGATE session ${entry.id} for shop ${entry.vendorId}`,
  });
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
    logSmartGate('gate_session_out_of_range', {
      vendorId: row.vendorId,
      sessionId: row.id,
      userId: row.userId,
    });
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
  logSmartGate('gate_session_ended', {
    vendorId: row.vendorId,
    sessionId: row.id,
    userId: row.userId,
    reason,
  });
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
    if (String(r.vendorId) !== key || r.disconnectedAt) return;
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

async function resolveUserBriefAsync(userId) {
  const base = resolveUserBrief(userId);
  if (!userId || (base.name && !String(base.name).startsWith('User '))) return base;
  try {
    if (typeof db.getUserById === 'function') {
      const u = await db.getUserById(userId);
      if (u) {
        return {
          id: u.id,
          name: u.name || u.email || u.id,
          email: u.email || '',
          mobile: u.mobile || '',
          location_name: u.location_name || '',
        };
      }
    }
  } catch (_) {
    /* keep base */
  }
  return base;
}

function resolveVendorDisplayName(vendorId) {
  const key = String(vendorId || '');
  if (!key) return '';
  const row = getSmartVendors(100).find((v) => String(v.id) === key);
  return row?.shop_name || '';
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
  return liveCustomerUserIdsForVendor(vendorId);
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
  return [...liveCustomerUserIdsForVendor(vendorId)].map((id) => resolveUserBrief(id));
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

async function buildVendorDashboard(vendorId) {
  purgeExpiredLiveStreams();
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

  activeGates.forEach((g) => {
    if (!g.userId || isSyntheticSmartUserId(g.userId)) return;
    const row = touch(g.userId);
    row.activeGate = g;
  });

  recentGates.forEach((g) => {
    const row = touch(g.userId);
    row.gateHistory.push(g);
    if (!g.disconnectedAt && g.inRange) row.activeGate = g;
  });
  scans.forEach((s) => touch(s.userId).scans.push(s));
  voiceLines.forEach((v) => touch(v.userId).voiceLines.push(v));
  deviceControls.forEach((c) => touch(c.userId).deviceControls.push(c));

  const cameraFrames = await getVendorCameraLive(key, { limit: 80 });
  const cameraByUser = new Map();
  cameraFrames.forEach((f) => {
    if (!f.userId) return;
    if (!cameraByUser.has(f.userId)) cameraByUser.set(f.userId, f);
    touch(f.userId);
  });

  const RECENT_MS = 5 * 60 * 1000;
  const isRecent = (iso) => iso && Date.now() - new Date(iso).getTime() < RECENT_MS;

  const users = [...userMap.values()].sort((a, b) => {
    const aLive = a.activeGate ? 1 : 0;
    const bLive = b.activeGate ? 1 : 0;
    if (bLive !== aLive) return bLive - aLive;
    const aT = a.activeGate?.lastHeartbeatAt || a.gateHistory[0]?.connectedAt || '';
    const bT = b.activeGate?.lastHeartbeatAt || b.gateHistory[0]?.connectedAt || '';
    return String(bT).localeCompare(String(aT));
  });

  await Promise.all(
    users.map(async (u) => {
      u.user = await resolveUserBriefAsync(u.userId);
    })
  );

  users.forEach((u) => {
    const gateName = u.activeGate?.userDisplayName || u.gateHistory.find((g) => g.userDisplayName)?.userDisplayName;
    if (gateName && (!u.user?.name || String(u.user.name).startsWith('User '))) {
      u.user = { ...u.user, name: gateName };
    }
    const shopName = u.activeGate?.vendorName || resolveVendorDisplayName(u.activeGate?.vendorId || key);
    if (shopName && u.activeGate) {
      u.activeGate.vendorName = shopName;
    }
    const lastVoice = u.voiceLines[0]?.at;
    const cam = cameraByUser.get(u.userId);
    u.micRecent = isRecent(lastVoice);
    u.cameraRecent = isRecent(cam?.at);
    u.lastCameraFrame = cam || null;
    if (!u.activeGate && (u.micRecent || u.cameraRecent)) {
      u.activeGate = {
        channel: 'wifi',
        networkLabel: u.cameraRecent && u.micRecent ? 'Mic + camera live' : u.cameraRecent ? 'Camera live' : 'Mic live',
        lastHeartbeatAt: cam?.at || lastVoice,
        streamOnly: true,
      };
    }
    if (u.micRecent && u.cameraRecent) u.pipelineStatus = 'mic_and_camera';
    else if (u.micRecent) u.pipelineStatus = 'mic_live';
    else if (u.cameraRecent) u.pipelineStatus = 'camera_live';
    else if (u.activeGate && !u.activeGate.streamOnly) u.pipelineStatus = 'sgate_live';
    else u.pipelineStatus = 'idle';
    u.gateHistory = sortLatestFirst(u.gateHistory, { dateFields: ['connectedAt', 'lastHeartbeatAt'] });
    u.scans = sortLatestFirst(u.scans, { dateFields: ['createdAt'] });
    u.voiceLines = sortLatestFirst(u.voiceLines, { dateFields: ['at'] });
    u.deviceControls = sortLatestFirst(u.deviceControls, { dateFields: ['createdAt'] });
  });

  const realActiveGates = activeGates.filter(
    (g) => g.userId && !isSyntheticSmartUserId(g.userId) && !g.disconnectedAt && g.inRange
  );

  const liveCustomers = users.filter(
    (u) =>
      !isSyntheticSmartUserId(u.userId)
      && (
        (u.activeGate && !u.activeGate.disconnectedAt && u.activeGate.inRange)
        || u.micRecent
        || u.cameraRecent
      )
  );

  const connectInvites = listInvitesForVendor(key, { limit: 50 });
  const pendingOutbound = connectInvites.filter((i) => i.status === 'pending');

  const vendorRow = getSmartVendors(100).find((v) => String(v.id) === key);
  const connectLink = getOrCreateVendorConnectLink(key);

  const allActive = (mem().smartNearbyGateSessions || []).filter((r) => !r.disconnectedAt && r.inRange);
  const activeOnOtherShops = allActive.filter((r) => String(r.vendorId) !== key);
  const memStatus = memStore.status();

  if (activeGates.length === 0 && allActive.length > 0) {
    logSmartGate('vendor_dashboard_id_mismatch', {
      vendorId: key,
      message: `${allActive.length} live SGATE on other shop id(s) — vendor console may be on wrong shop id`,
      otherVendorIds: [...new Set(activeOnOtherShops.map((r) => r.vendorId))].slice(0, 8),
    });
  }

  logSmartGate('vendor_dashboard_built', {
    vendorId: key,
    connectedNow: activeGates.length,
    totalUsers: users.length,
    allActiveGates: allActive.length,
    memActive: memStatus.active,
  });

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
      connectedNow: Math.max(liveCustomers.length, realActiveGates.length),
      sgateSessions: realActiveGates.length,
      totalUsers: Math.max(liveCustomers.length, realActiveGates.length),
      sharedScans: scans.length,
      voiceLines: voiceLines.length,
      cameraFrames: cameraFrames.length,
      pendingInvites: pendingOutbound.length,
    },
    activeGates,
    users: liveCustomers,
    recentGates,
    scans,
    voiceLines,
    cameraLive: (await getVendorCameraLive(key, { limit: 1 }))[0] || null,
    deviceControls,
    connectInvites,
    reachableUsers: listReachableUsersForVendor(key),
    diagnostics: {
      queriedVendorId: key,
      vendorFoundInCatalog: !!vendorRow,
      memStoreActive: memStatus.active,
      gateSessionsInMemory: memStatus.counts?.gateSessions ?? (mem().smartNearbyGateSessions || []).length,
      activeOnThisShop: activeGates.map((g) => ({
        sessionId: g.id,
        userId: g.userId,
        channel: g.channel,
        lastHeartbeatAt: g.lastHeartbeatAt,
      })),
      activeOnOtherShops: activeOnOtherShops.map((g) => ({
        vendorId: g.vendorId,
        sessionId: g.id,
        userId: g.userId,
      })),
      recentTrace: getSmartGateTrace(25),
    },
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
  appendCameraLiveFrame,
  getVendorCameraLive,
  seedBeacons,
  recordGateConnection,
  updateGateHeartbeat,
  setVendorVoiceListen,
  endGateConnection,
  getUserActiveGate,
  getVendorGateSessions,
  resolveUserBrief,
  resolveVendorDisplayName,
  resolveUserBriefAsync,
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
  purgeExpiredLiveStreams,
  purgeExpiredLiveStreamsMemory,
  purgeExpiredLiveStreamsMysql,
  smartCameraPersistMysql,
};

