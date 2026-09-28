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
  /** Store undelivered messages, voice lines, camera frames & invites while offline until user/vendor is online */
  storeOfflineUntilOnline: true,
  /** Master vendor switch: when true, all smart users automatically record mic & camera at cameraStreamIntervalSec; when false, recording is paused */
  recordingEnabled: true,
  /** true = event recordings + live preview; false = live stream only (no Recent gallery) */
  cameraAiEnabled: defaultCameraAiEnabled(),
  /** false = customer sees their own CSCAN preview; true = hidden on customer screen (vendor-only view) */
  customerCameraPreviewHidden: false,
  /** false = customer sees live voice data preview on their screen first; true = hidden on customer screen, records in background for vendor only */
  customerVoicePreviewHidden: false,
  /** contain = full frame; cover = crop fill (vendor display hint — client may ignore) */
  vendorCameraFit: 'contain',
  /** Seconds between live camera frames (5 | 30 | 60) — vendor sets load vs freshness */
  cameraStreamIntervalSec: 30,
};

const CAMERA_STREAM_INTERVALS = new Set([5, 30, 60]);

function normalizeCameraStreamIntervalSec(value) {
  const n = parseInt(String(value ?? ''), 10);
  if (CAMERA_STREAM_INTERVALS.has(n)) return n;
  return DEFAULT_POLICY.cameraStreamIntervalSec;
}

function normalizeDataRetentionDays(value, fallback = 1) {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return Math.max(1, fallback || 1);
  return Math.min(n, 365);
}

const MYSQL_LIVE_PURGE_INTERVAL_MS = 60 * 60 * 1000;
let lastMysqlLivePurgeAt = 0;

function smartLiveRetentionDays() {
  return getSmartLiveRetentionDaysSync();
}

function getVendorRetentionDays(vendorId) {
  const baseDays = smartLiveRetentionDays();
  if (!vendorId) return baseDays;
  const store = mem();
  const policies = store.smartNearbyPolicies || [];
  const row = policies.find((p) => String(p.vendorId) === String(vendorId));
  if (row?.dataRetentionDays != null) {
    return normalizeDataRetentionDays(row.dataRetentionDays, baseDays);
  }
  return baseDays;
}

function getVendorRetentionCutoffMs(vendorId) {
  return Date.now() - getVendorRetentionDays(vendorId) * 24 * 60 * 60 * 1000;
}

function smartLiveRetentionCutoffDate() {
  return new Date(Date.now() - smartLiveRetentionDays() * 24 * 60 * 60 * 1000);
}

function isLiveStreamRowFresh(row, cutoffMs) {
  const t = new Date(row?.at || row?.createdAt || 0).getTime();
  return Number.isFinite(t) && t >= cutoffMs;
}

function normalizeSmartVendorId(vendorId) {
  const raw = String(vendorId || '').trim();
  if (!raw) return '';
  return raw.replace(/^beacon-(?:wifi|ble|ir|nfc|rf)-/i, '') || raw;
}

function isRowFreshForVendorPolicy(row, defaultCutoffMs) {
  const cutoffMs = row?.vendorId ? getVendorRetentionCutoffMs(row.vendorId) : defaultCutoffMs;
  return isLiveStreamRowFresh(row, cutoffMs);
}

function isVendorOrAdminSmartUser(userId) {
  const s = String(userId || '').trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  if (
    lower.includes('vendor') ||
    lower === 'usr_admin' ||
    lower.includes('superadmin') ||
    lower.startsWith('u_sgate_val_') ||
    lower.startsWith('usr_demo_')
  ) {
    return true;
  }
  const users = db.inMemoryDb?.users || [];
  const u = users.find((x) => String(x.id) === s);
  if (u && (u.role === 'vendor' || u.role === 'admin' || u.role === 'super_admin')) {
    return true;
  }
  const vendors = db.inMemoryDb?.smartNearbyVendors || db.inMemoryDb?.vendors || [];
  if (vendors.some((v) => v?.owner_id && String(v.owner_id) === s)) {
    return true;
  }
  return false;
}

function purgeExpiredLiveStreamsMemory() {
  const defaultCutoffMs = smartLiveRetentionCutoffDate().getTime();
  const store = mem();
  let voiceRemoved = 0;
  let cameraRemoved = 0;
  if (Array.isArray(store.smartNearbyVoiceStreams)) {
    const before = store.smartNearbyVoiceStreams.length;
    store.smartNearbyVoiceStreams = store.smartNearbyVoiceStreams.filter(
      (r) => !isVendorOrAdminSmartUser(r?.userId) && isRowFreshForVendorPolicy(r, defaultCutoffMs)
    );
    voiceRemoved = before - store.smartNearbyVoiceStreams.length;
  }
  const camList = ensureCameraStore();
  const camBefore = camList.length;
  for (let i = camList.length - 1; i >= 0; i -= 1) {
    if (
      isVendorOrAdminSmartUser(camList[i]?.userId) ||
      !isRowFreshForVendorPolicy(camList[i], defaultCutoffMs)
    ) {
      camList.splice(i, 1);
    }
  }
  cameraRemoved = camBefore - camList.length;

  if (Array.isArray(store.smartNearbyGateSessions)) {
    const seenActivePair = new Set();
    const now = Date.now();
    const nowIso = new Date().toISOString();
    const STALE_GATE_MS = 10 * 60 * 1000;
    store.smartNearbyGateSessions = store.smartNearbyGateSessions.filter((g) => {
      if (!g) return false;
      if (g.userId && isVendorOrAdminSmartUser(g.userId)) return false;
      if (!g.disconnectedAt) {
        const hbMs = new Date(g.lastHeartbeatAt || g.connectedAt || 0).getTime();
        if (Number.isFinite(hbMs) && now - hbMs > STALE_GATE_MS) {
          g.disconnectedAt = nowIso;
          g.disconnectReason = 'stale_timeout';
          g.inRange = false;
        } else if (g.vendorId && g.userId) {
          const pairKey = `${g.vendorId}:${g.userId}`;
          if (seenActivePair.has(pairKey)) {
            g.disconnectedAt = nowIso;
            g.disconnectReason = 'deduped';
            g.inRange = false;
          } else {
            seenActivePair.add(pairKey);
          }
        }
      }
      return true;
    });
  }

  if (Array.isArray(store.smartNearbyUndeliveredMessages)) {
    const now = Date.now();
    store.smartNearbyUndeliveredMessages = store.smartNearbyUndeliveredMessages.filter((m) => {
      if (isVendorOrAdminSmartUser(m?.targetUserId)) return false;
      const exp = m?.expiresAt ? new Date(m.expiresAt).getTime() : 0;
      if (exp && exp < now) return false;
      return isRowFreshForVendorPolicy(m, defaultCutoffMs);
    });
  }

  if (Array.isArray(store.smartNearbyRemoteCommands)) {
    const now = Date.now();
    store.smartNearbyRemoteCommands = store.smartNearbyRemoteCommands.filter((c) => {
      if (isVendorOrAdminSmartUser(c?.targetUserId)) return false;
      const exp = c?.expiresAt ? new Date(c.expiresAt).getTime() : 0;
      if (exp && exp < now) return false;
      return isRowFreshForVendorPolicy(c, defaultCutoffMs);
    });
  }

  if (Array.isArray(store.smartNearbyConnectInvites)) {
    store.smartNearbyConnectInvites = store.smartNearbyConnectInvites.filter(
      (inv) => !isVendorOrAdminSmartUser(inv?.targetUserId)
    );
  }

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
  const baseRetention = smartLiveRetentionDays();
  return {
    vendorId: key,
    ...DEFAULT_POLICY,
    dataRetentionDays: baseRetention,
    ...(row || {}),
  };
}

function getUserMobileState(userId, vendorId = null) {
  const uid = String(userId || '');
  const store = mem();
  if (!store.smartUserMobileState || typeof store.smartUserMobileState !== 'object') {
    store.smartUserMobileState = {};
  }
  const existing = uid ? store.smartUserMobileState[uid] || {} : {};
  const vKey =
    vendorId && typeof vendorId === 'string'
      ? String(vendorId)
      : existing.vendorId || 'v_smart1';
  const policy = getVendorPolicy(vKey);
  const vendorRecOn = policy.recordingEnabled !== false;
  const intervalSec = normalizeCameraStreamIntervalSec(
    existing.streamIntervalSec || existing.cameraStreamIntervalSec || policy.cameraStreamIntervalSec
  );
  const micEnabled = vendorRecOn && existing.micEnabled !== false;
  const cameraEnabled = vendorRecOn && existing.cameraEnabled !== false;
  return {
    userId: uid || null,
    vendorId: vKey,
    operatingMode: existing.operatingMode || (vendorRecOn ? 'auto' : 'idle'),
    recordingEnabled: vendorRecOn && existing.recordingEnabled !== false && (micEnabled || cameraEnabled),
    micEnabled,
    cameraEnabled,
    userMicOverride: existing.micEnabled,
    userCameraOverride: existing.cameraEnabled,
    cameraFacing: existing.cameraFacing === 'front' ? 'front' : 'back',
    streamIntervalSec: intervalSec,
    cameraStreamIntervalSec: intervalSec,
    withWifiScan: existing.withWifiScan === true,
    activeScreen: existing.activeScreen || null,
    lastCommand: existing.lastCommand || null,
    lastCommandAt: existing.lastCommandAt || null,
    lastAckAt: existing.lastAckAt || null,
    updatedAt: existing.updatedAt || null,
  };
}

function updateUserMobileState(userId, vendorIdOrPatch, maybePatch = {}) {
  const uid = String(userId || '');
  if (!uid) return null;
  const isObjSecondArg =
    vendorIdOrPatch && typeof vendorIdOrPatch === 'object' && !Array.isArray(vendorIdOrPatch);
  const patch = isObjSecondArg ? vendorIdOrPatch : maybePatch || {};
  const explicitVendorId = isObjSecondArg
    ? vendorIdOrPatch.vendorId || null
    : vendorIdOrPatch
      ? String(vendorIdOrPatch)
      : null;
  const store = mem();
  if (!store.smartUserMobileState || typeof store.smartUserMobileState !== 'object') {
    store.smartUserMobileState = {};
  }
  const prev = store.smartUserMobileState[uid] || {};
  const nowIso = new Date().toISOString();
  const next = {
    ...prev,
    ...patch,
    userId: uid,
    vendorId: explicitVendorId || prev.vendorId || 'v_smart1',
    updatedAt: nowIso,
  };
  if (patch.streamIntervalSec != null || patch.cameraStreamIntervalSec != null) {
    const normSec = normalizeCameraStreamIntervalSec(
      patch.streamIntervalSec ?? patch.cameraStreamIntervalSec
    );
    next.streamIntervalSec = normSec;
    next.cameraStreamIntervalSec = normSec;
  }
  if (patch.cameraFacing != null || patch.facing != null) {
    const face = patch.cameraFacing ?? patch.facing;
    next.cameraFacing = face === 'front' ? 'front' : 'back';
  }
  store.smartUserMobileState[uid] = next;
  return getUserMobileState(uid, next.vendorId);
}

function attachStreamPolicyToSession(session) {
  if (!session?.vendorId) return session;
  const policy = getVendorPolicy(session.vendorId);
  const mobileState = session.userId
    ? getUserMobileState(session.userId, session.vendorId)
    : null;
  const sec = normalizeCameraStreamIntervalSec(
    mobileState?.streamIntervalSec || policy.cameraStreamIntervalSec
  );
  const ms = sec * 1000;
  const retentionDays = normalizeDataRetentionDays(policy.dataRetentionDays, smartLiveRetentionDays());
  const recordingEnabled = policy.recordingEnabled !== false;
  return {
    ...session,
    recordingEnabled,
    mobileState,
    streamPolicy: {
      recordingEnabled,
      micEnabled: mobileState ? mobileState.micEnabled : recordingEnabled,
      cameraEnabled: mobileState ? mobileState.cameraEnabled : recordingEnabled,
      cameraFacing: mobileState?.cameraFacing || 'back',
      operatingMode: mobileState?.operatingMode || (recordingEnabled ? 'auto' : 'idle'),
      cameraStreamIntervalSec: sec,
      cameraStreamIntervalMs: ms,
      streamFlushMs: ms,
      heartbeatMs: ms,
      dataRetentionDays: retentionDays,
      storeOfflineUntilOnline: policy.storeOfflineUntilOnline !== false,
      cameraAiEnabled: policy.cameraAiEnabled === true,
      customerCameraPreviewHidden: policy.customerCameraPreviewHidden !== false,
      customerVoicePreviewHidden: policy.customerVoicePreviewHidden === true,
    },
  };
}

function setVendorPolicy(vendorId, patch = {}) {
  const key = String(vendorId);
  const store = mem();
  const policies = store.smartNearbyPolicies;
  const prevPolicy = getVendorPolicy(key);
  const merged = { ...patch };
  if (merged.cameraStreamIntervalSec != null) {
    merged.cameraStreamIntervalSec = normalizeCameraStreamIntervalSec(merged.cameraStreamIntervalSec);
  }
  if (merged.dataRetentionDays != null) {
    merged.dataRetentionDays = normalizeDataRetentionDays(merged.dataRetentionDays, smartLiveRetentionDays());
  }
  if (merged.recordingEnabled != null) {
    merged.recordingEnabled =
      merged.recordingEnabled !== false &&
      merged.recordingEnabled !== 'false' &&
      merged.recordingEnabled !== 0;
  }
  if (merged.customerCameraPreviewHidden != null) {
    merged.customerCameraPreviewHidden =
      merged.customerCameraPreviewHidden === true ||
      merged.customerCameraPreviewHidden === 'true' ||
      merged.customerCameraPreviewHidden === 1;
  }
  if (merged.customerVoicePreviewHidden != null) {
    merged.customerVoicePreviewHidden =
      merged.customerVoicePreviewHidden === true ||
      merged.customerVoicePreviewHidden === 'true' ||
      merged.customerVoicePreviewHidden === 1;
  }
  const nowIso = new Date().toISOString();
  const next = {
    ...prevPolicy,
    ...merged,
    vendorId: key,
    updatedAt: nowIso,
  };
  const idx = policies.findIndex((p) => String(p.vendorId) === key);
  if (idx >= 0) policies[idx] = next;
  else policies.push(next);

  const recEnabled = next.recordingEnabled !== false;
  const sessions = store.smartNearbyGateSessions || [];
  sessions.forEach((g) => {
    if (String(g.vendorId) === key && !g.disconnectedAt) {
      g.recordingEnabled = recEnabled;
      g.vendorSide = {
        ...(g.vendorSide || {}),
        vendorListening: recEnabled,
        vendorListeningAt: nowIso,
        vendorRefreshRequestedAt: nowIso,
      };
      if (g.userId) {
        updateUserMobileState(g.userId, key, {
          micEnabled: recEnabled,
          cameraEnabled: recEnabled,
          operatingMode: recEnabled ? 'auto' : 'idle',
          streamIntervalSec: next.cameraStreamIntervalSec,
        });
      }
    }
  });

  if (recEnabled && (patch.recordingEnabled === true || patch.cameraStreamIntervalSec != null)) {
    try {
      const targetIds = mappedCustomerUserIdsForVendor(key);
      targetIds.forEach((uid) => {
        updateUserMobileState(uid, key, {
          micEnabled: true,
          cameraEnabled: true,
          operatingMode: 'auto',
          streamIntervalSec: next.cameraStreamIntervalSec,
        });
        const hasSession = sessions.some(
          (g) => String(g.vendorId) === key && String(g.userId) === String(uid) && !g.disconnectedAt
        );
        if (!hasSession) {
          directConnectVendorUser({
            vendorId: key,
            userId: uid,
            message: `Vendor enabled automatic mic & camera recording every ${next.cameraStreamIntervalSec}s.`,
          });
        }
      });
    } catch (_) {
      /* ignore */
    }
  }

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

async function recordScanSession(payload = {}) {
  const store = mem();
  const scanDeltaService = require('./smartScanDeltaService');
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
  if (entry.sharedWithVendor && entry.vendorId && entry.userId) {
    entry.scanDelta = await scanDeltaService.applyScanDeltaAsync({
      vendorId: entry.vendorId,
      userId: entry.userId,
      userDisplayName: payload.userDisplayName || null,
      scan: entry.scan,
      sharedWithVendor: true,
    });
  }
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

const DEMO_SMART_USER_IDS = new Set(['usr_smart1', 'usr_smartvendor1']);

/** Only validation/script users are hidden from vendor “live” counts. Demo accounts (smart1@test.com) count as real. */
function isSyntheticSmartUserId(userId) {
  const s = String(userId || '');
  if (!s) return true;
  if (process.env.SMART_HIDE_DEMO_LIVE === 'true' && DEMO_SMART_USER_IDS.has(s)) {
    return true;
  }
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
    if (isSyntheticSmartUserId(uid) || isVendorOrAdminSmartUser(uid)) ids.delete(uid);
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
  if (!uid || !vid || isVendorOrAdminSmartUser(uid)) return null;
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
  if (session) {
    logSmartGate('gate_session_from_stream', {
      vendorId: vid,
      userId: uid,
      sessionId: session.id,
      via,
    });
  }
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

/** Vendor-initiated wipe — mic transcripts + camera recordings (memory + MySQL). Does not end SGATE sessions. */
async function clearVendorLiveMedia(vendorId) {
  const key = String(vendorId || '').trim();
  if (!key) {
    return { voiceRemoved: 0, cameraRemoved: 0, previewCleared: false, mysql: { camera: 0, voice: 0 } };
  }
  const store = mem();
  let voiceRemoved = 0;
  if (Array.isArray(store.smartNearbyVoiceStreams)) {
    const before = store.smartNearbyVoiceStreams.length;
    store.smartNearbyVoiceStreams = store.smartNearbyVoiceStreams.filter(
      (r) => String(r.vendorId) !== key
    );
    voiceRemoved = before - store.smartNearbyVoiceStreams.length;
  }
  const camList = ensureCameraStore();
  let cameraRemoved = 0;
  for (let i = camList.length - 1; i >= 0; i -= 1) {
    if (String(camList[i].vendorId) === key) {
      camList.splice(i, 1);
      cameraRemoved += 1;
    }
  }
  let previewCleared = false;
  if (store.smartCameraLivePreview && Object.prototype.hasOwnProperty.call(store.smartCameraLivePreview, key)) {
    delete store.smartCameraLivePreview[key];
    previewCleared = true;
  }
  let mysql = { camera: 0, voice: 0, skipped: true };
  if (smartCameraPersistMysql()) {
    mysql = await smartCameraMysql.deleteVendorLiveMedia(key);
  }
  logSmartGate('vendor_clear_live_media', {
    vendorId: key,
    voiceRemoved,
    cameraRemoved,
    previewCleared,
    mysqlCamera: mysql.camera,
    mysqlVoice: mysql.voice,
  });
  return { voiceRemoved, cameraRemoved, previewCleared, mysql };
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
  capturedAt = null,
  forceRecord = false,
}) {
  const key = normalizeSmartVendorId(vendorId);
  if (!key || !imageBase64 || !isAcceptableCameraPayload(imageBase64)) return null;
  if (userId && isVendorOrAdminSmartUser(userId)) return null;
  if (userId) {
    recordUserOnlinePresence(userId, { vendorId: key, via: 'camera' });
  }
  const policy = getVendorPolicy(key);
  const mobileState = userId ? getUserMobileState(userId, key) : null;
  if (!forceRecord && policy.recordingEnabled === false) {
    return null;
  }
  if (userId && mobileState?.cameraEnabled === false) {
    updateUserMobileState(userId, key, { cameraEnabled: true, recordingEnabled: true });
  }
  if (userId) {
    ensureGateSessionForStream({ userId, vendorId: key, sessionId, via: 'camera' });
  }
  const aiOn = policy.cameraAiEnabled === true;
  const isEvent = !!eventCapture;
  const isPreviewLive = !!liveOnly && !isEvent;

  if (!aiOn && isEvent) {
    return null;
  }

  const parsedAtMs = capturedAt ? new Date(capturedAt).getTime() : NaN;
  const atIso =
    !Number.isNaN(parsedAtMs) && parsedAtMs <= Date.now() + 30000
      ? new Date(parsedAtMs).toISOString()
      : new Date().toISOString();

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
    at: atIso,
    receivedAt: new Date().toISOString(),
    deliveredToVendor: false,
  };

  const upsertLatestUserPreviewInStore = (frameEntry) => {
    const list = ensureCameraStore();
    if (frameEntry.userId) {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const item = list[i];
        if (
          String(item.vendorId) === key &&
          String(item.userId) === String(frameEntry.userId) &&
          !item.eventCapture &&
          !item.eventRule
        ) {
          list.splice(i, 1);
        }
      }
    }
    list.unshift(frameEntry);
    if (list.length > MAX_CAMERA_FRAMES) list.length = MAX_CAMERA_FRAMES;
  };

  if (!aiOn) {
    upsertLatestUserPreviewInStore(entry);
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
    upsertLatestUserPreviewInStore(entry);
    setVendorLivePreview(key, entry);
    purgeExpiredLiveStreams({ mysql: false });
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

async function getVendorCameraLive(vendorId, { since = null, limit = 12, eventsOnly = false, markDelivered = false } = {}) {
  purgeExpiredLiveStreams();
  const key = normalizeSmartVendorId(vendorId);
  let rows = ensureCameraStore().filter((r) =>
    eventsOnly
      ? normalizeSmartVendorId(r.vendorId) === key && (r.eventCapture || r.eventRule)
      : normalizeSmartVendorId(r.vendorId) === key
  );
  if (since) {
    const t = new Date(since).getTime();
    if (!Number.isNaN(t) && t <= Date.now() + 60000) {
      rows = rows.filter(
        (r) => r.deliveredToVendor === false || new Date(r.at).getTime() > t
      );
    }
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
  const store = mem();
  const preview = getVendorLivePreview(key);
  const previewOk =
    preview && isAcceptableCameraPayload(preview.imageBase64) ? preview : null;
  const sinceMs = since ? new Date(since).getTime() : NaN;
  const previewMatchesSince =
    !since ||
    Number.isNaN(sinceMs) ||
    sinceMs > Date.now() + 60000 ||
    previewOk?.deliveredToVendor === false ||
    new Date(previewOk?.at || 0).getTime() > sinceMs;
  const previewPick = previewOk && previewMatchesSince ? previewOk : null;

  const usableMemory = memoryRows.filter((r) => isAcceptableCameraPayload(r.imageBase64));
  const latest = previewPick || usableMemory[0] || null;
  const out = [];
  if (latest) {
    out.push({ ...latest, imageBase64: normalizeCameraDataUri(latest.imageBase64) });
  }
  usableMemory.forEach((e) => {
    if (!out.some((x) => x.id === e.id)) {
      out.push({ ...e, imageBase64: normalizeCameraDataUri(e.imageBase64) });
    }
  });
  const sliced = out.slice(0, limit);
  if (markDelivered) {
    const nowIso = new Date().toISOString();
    sliced.forEach((frame) => {
      if (previewPick && frame.id === previewPick.id) {
        previewPick.deliveredToVendor = true;
        previewPick.deliveredAt = nowIso;
        if (store.smartCameraLivePreview?.[key]) {
          store.smartCameraLivePreview[key].deliveredToVendor = true;
          store.smartCameraLivePreview[key].deliveredAt = nowIso;
        }
      }
      const inList = ensureCameraStore().find((r) => r.id === frame.id);
      if (inList) {
        inList.deliveredToVendor = true;
        inList.deliveredAt = nowIso;
      }
    });
  }
  return sliced;
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

function isHeartbeatStatusVoiceLine(text) {
  const s = String(text || '').trim();
  return (
    /^Microphone ON/i.test(s) ||
    /^Customer microphone active\s*[—-]\s*listening for live speech$/i.test(s) ||
    /^Customer microphone live\s*[—-]\s*monitoring speech/i.test(s) ||
    /^Room audio active\s*[—-]\s*listening for speech/i.test(s)
  );
}

function appendVoiceTranscript({
  vendorId,
  userId,
  sessionId,
  text,
  final = false,
  capturedAt = null,
  forceRecord = false,
}) {
  const store = mem();
  const key = normalizeSmartVendorId(vendorId || 'unknown');
  const line = String(text || '').trim();
  if (!line) return null;
  const uid = userId ? String(userId) : null;
  if (uid && isVendorOrAdminSmartUser(uid)) return null;
  const sid = sessionId ? String(sessionId) : null;
  const streams = store.smartNearbyVoiceStreams || (store.smartNearbyVoiceStreams = []);
  const nowIso = new Date().toISOString();
  const parsedAtMs = capturedAt ? new Date(capturedAt).getTime() : NaN;
  const atIso =
    !Number.isNaN(parsedAtMs) && parsedAtMs <= Date.now() + 30000
      ? new Date(parsedAtMs).toISOString()
      : nowIso;
  const userLabel = voiceUserLabel(uid, sid);

  if (uid && key !== 'unknown') {
    recordUserOnlinePresence(uid, { vendorId: key, via: 'mic' });
  }

  const policy = key !== 'unknown' ? getVendorPolicy(key) : DEFAULT_POLICY;
  const mobileState = uid && key !== 'unknown' ? getUserMobileState(uid, key) : null;
  if (!forceRecord && policy.recordingEnabled === false) {
    return null;
  }
  if (uid && key !== 'unknown' && mobileState?.micEnabled === false) {
    updateUserMobileState(uid, key, { micEnabled: true, recordingEnabled: true });
  }

  if (uid && key !== 'unknown') {
    ensureGateSessionForStream({ userId: uid, vendorId: key, sessionId: sid, via: 'mic' });
  }

  if (/^Microphone (OFF|blocked)/i.test(line)) {
    return null;
  }

  const isSystem = isHeartbeatStatusVoiceLine(line);
  const isFinal = !!final || isSystem || line.startsWith('🎙️') || line.startsWith('🎤');

  if (isSystem && uid) {
    const dupIdx = streams.findIndex(
      (r) =>
        normalizeSmartVendorId(r.vendorId) === key &&
        r.userId === uid &&
        isHeartbeatStatusVoiceLine(r.text)
    );
    if (dupIdx >= 0) {
      const dup = streams[dupIdx];
      dup.vendorId = key;
      dup.text = line;
      dup.at = atIso;
      dup.receivedAt = nowIso;
      dup.userLabel = userLabel || dup.userLabel;
      dup.deliveredToVendor = false;
      if (dupIdx > 0) {
        streams.splice(dupIdx, 1);
        streams.unshift(dup);
      }
      if (smartCameraPersistMysql()) {
        smartCameraMysql.insertVoiceLine(dup).catch(() => {});
      }
      return dup;
    }
  }

  if (!isFinal && uid) {
    const idx = streams.findIndex(
      (r) => normalizeSmartVendorId(r.vendorId) === key && r.userId === uid && r.sessionId === sid && !r.final
    );
    if (idx >= 0) {
      const row = streams[idx];
      row.vendorId = key;
      row.text = line;
      row.at = atIso;
      row.receivedAt = nowIso;
      row.userLabel = userLabel || row.userLabel;
      row.deliveredToVendor = false;
      if (idx > 0) {
        streams.splice(idx, 1);
        streams.unshift(row);
      }
      if (smartCameraPersistMysql()) {
        smartCameraMysql.insertVoiceLine(row).catch(() => {});
      }
      return row;
    }
  }

  if (isFinal && uid) {
    for (let i = 0; i < streams.length; i += 1) {
      const r = streams[i];
      if (normalizeSmartVendorId(r.vendorId) === key && r.userId === uid && r.sessionId === sid && !r.final) {
        streams.splice(i, 1);
        break;
      }
    }
    const dupIdx = streams.findIndex(
      (r) =>
        normalizeSmartVendorId(r.vendorId) === key
        && r.userId === uid
        && r.final
        && r.text === line
        && Math.abs(new Date(atIso).getTime() - new Date(r.at || 0).getTime()) < 15000
    );
    if (dupIdx >= 0) {
      const dupFinal = streams[dupIdx];
      dupFinal.vendorId = key;
      dupFinal.at = atIso;
      dupFinal.receivedAt = nowIso;
      dupFinal.userLabel = userLabel || dupFinal.userLabel;
      dupFinal.deliveredToVendor = false;
      if (dupIdx > 0) {
        streams.splice(dupIdx, 1);
        streams.unshift(dupFinal);
      }
      if (smartCameraPersistMysql()) {
        smartCameraMysql.insertVoiceLine(dupFinal).catch(() => {});
      }
      return dupFinal;
    }
  }

  const entry = {
    id: isSystem && uid
      ? `svt_hb_${key}_${uid}`
      : `svt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    vendorId: key,
    userId: uid,
    sessionId: sid,
    userLabel,
    text: line,
    final: isFinal,
    at: atIso,
    receivedAt: nowIso,
    deliveredToVendor: false,
  };
  streams.unshift(entry);
  if (streams.length > MAX_VOICE_LINES) {
    streams.length = MAX_VOICE_LINES;
  }
  if (smartCameraPersistMysql()) {
    smartCameraMysql.insertVoiceLine(entry).catch(() => {});
  }
  purgeExpiredLiveStreams({ mysql: false });
  return entry;
}

async function getVendorVoiceStream(vendorId, { since = null, limit = 80, markDelivered = false } = {}) {
  purgeExpiredLiveStreams();
  const key = normalizeSmartVendorId(vendorId);
  const streams = mem().smartNearbyVoiceStreams || [];
  let rows = streams.filter(
    (r) => normalizeSmartVendorId(r.vendorId) === key && (!r.userId || !isVendorOrAdminSmartUser(r.userId))
  );
  if (since) {
    const t = new Date(since).getTime();
    if (!Number.isNaN(t) && t <= Date.now() + 60000) {
      // Always include undelivered voice lines (even if captured offline before `since`) plus any newer lines
      rows = rows.filter(
        (r) => r.deliveredToVendor === false || new Date(r.at).getTime() > t
      );
    }
  }
  let mergedRows = sortLatestFirst(rows, { dateFields: ['at'] }).slice(0, limit);
  if (smartCameraPersistMysql()) {
    const mysqlRows = await smartCameraMysql.listVendorVoiceLines(key, { since, limit });
    const byId = new Map();
    [...mysqlRows, ...mergedRows].forEach((r) => {
      if (r?.id && (!r.userId || !isVendorOrAdminSmartUser(r.userId))) byId.set(r.id, r);
    });
    mergedRows = sortLatestFirst([...byId.values()], { dateFields: ['at'] }).slice(0, limit);
  }
  const out = mergedRows;
  if (markDelivered) {
    const nowIso = new Date().toISOString();
    out.forEach((row) => {
      const hit = streams.find((s) => s.id === row.id);
      if (hit) {
        hit.deliveredToVendor = true;
        hit.deliveredAt = nowIso;
      }
    });
  }
  return out;
}

const MAX_GATE_SESSIONS = 200;
const MAX_UNDELIVERED_MESSAGES = 500;

function ensurePresenceStore() {
  const store = mem();
  if (!store.smartUserPresence || typeof store.smartUserPresence !== 'object') {
    store.smartUserPresence = {};
  }
  return store.smartUserPresence;
}

function recordUserOnlinePresence(userId, optsOrVendorId = {}) {
  const uid = String(userId || '').trim();
  if (!uid || isVendorOrAdminSmartUser(uid)) return null;
  const opts =
    typeof optsOrVendorId === 'string'
      ? { vendorId: optsOrVendorId, via: 'poll' }
      : optsOrVendorId && typeof optsOrVendorId === 'object'
        ? optsOrVendorId
        : {};
  const { vendorId = null, via = 'poll' } = opts;
  const presence = ensurePresenceStore();
  const nowIso = new Date().toISOString();
  const prev = presence[uid] || {};
  const next = {
    ...prev,
    userId: uid,
    lastSeenAt: nowIso,
    vendorId: vendorId ? String(vendorId) : prev.vendorId || null,
    via,
    online: true,
  };
  presence[uid] = next;
  return next;
}

function isUserOnline(userId, vendorId = null) {
  const uid = String(userId || '').trim();
  if (!uid) return false;
  const presence = ensurePresenceStore()[uid];
  const policySec = vendorId
    ? normalizeCameraStreamIntervalSec(getVendorPolicy(vendorId).cameraStreamIntervalSec)
    : DEFAULT_POLICY.cameraStreamIntervalSec;
  const windowMs = Math.max(45 * 1000, policySec * 2000);
  if (presence?.lastSeenAt) {
    const dt = Date.now() - new Date(presence.lastSeenAt).getTime();
    if (Number.isFinite(dt) && dt >= 0 && dt <= windowMs) {
      return true;
    }
  }
  const activeGate = (mem().smartNearbyGateSessions || []).find(
    (r) =>
      String(r.userId) === uid &&
      !r.disconnectedAt &&
      r.inRange &&
      !r.pendingOnlineDelivery &&
      r.lastHeartbeatAt &&
      Date.now() - new Date(r.lastHeartbeatAt).getTime() <= windowMs
  );
  return !!activeGate;
}

function getUserPresence(userId, vendorId = null) {
  const uid = String(userId || '').trim();
  if (!uid) return { userId: null, online: false, lastSeenAt: null };
  const row = ensurePresenceStore()[uid] || null;
  return {
    userId: uid,
    online: isUserOnline(uid, vendorId),
    lastSeenAt: row?.lastSeenAt || null,
    via: row?.via || null,
  };
}

function ensureUndeliveredStore() {
  const store = mem();
  if (!Array.isArray(store.smartNearbyUndeliveredMessages)) {
    store.smartNearbyUndeliveredMessages = [];
  }
  return store.smartNearbyUndeliveredMessages;
}

function isInternalSmartControlEnvelope(text) {
  const s = String(text || '').trim();
  return (
    s.startsWith('[SMART_CMD]') ||
    s.startsWith('[SMART_DIRECT_CONNECT]') ||
    s.startsWith('[SMART_MSG]')
  );
}

function queueUndeliveredUserMessage(
  vendorId,
  {
    targetUserId,
    type = 'vendor_message',
    title = null,
    message = '',
    sessionId = null,
    inviteId = null,
    dedupeKey = null,
  } = {}
) {
  const key = normalizeSmartVendorId(vendorId);
  const uid = String(targetUserId || '').trim();
  if (!key || !uid) return null;
  if (isInternalSmartControlEnvelope(message) || isInternalSmartControlEnvelope(title)) {
    return null;
  }

  const policy = getVendorPolicy(key);
  if (policy.storeOfflineUntilOnline === false && !isUserOnline(uid, key)) {
    return null;
  }

  const retentionDays = getVendorRetentionDays(key);
  const ttlMs = retentionDays * 24 * 60 * 60 * 1000;
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const vendorName = resolveVendorDisplayName(key) || key;
  const list = ensureUndeliveredStore();

  if (dedupeKey) {
    const existing = list.find(
      (m) =>
        m.vendorId === key &&
        m.targetUserId === uid &&
        !m.deliveredToUser &&
        m.dedupeKey === dedupeKey &&
        new Date(m.expiresAt).getTime() > Date.now()
    );
    if (existing) {
      existing.message = String(message || existing.message || '').slice(0, 500);
      existing.title = title || existing.title;
      existing.sessionId = sessionId || existing.sessionId;
      existing.inviteId = inviteId || existing.inviteId;
      existing.updatedAt = nowIso;
      existing.expiresAt = expiresAt;
      existing.streamPolicy = {
        cameraStreamIntervalSec: normalizeCameraStreamIntervalSec(policy.cameraStreamIntervalSec),
        dataRetentionDays: retentionDays,
        cameraAiEnabled: policy.cameraAiEnabled === true,
      };
      return existing;
    }
  }

  const entry = {
    id: `smsg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    vendorId: key,
    vendorName,
    targetUserId: uid,
    type,
    title: title || `${vendorName} · SMART update`,
    message:
      String(message || '').slice(0, 500) ||
      `${vendorName} sent a SMART connection update.`,
    sessionId: sessionId || null,
    inviteId: inviteId || null,
    dedupeKey: dedupeKey || null,
    streamPolicy: {
      cameraStreamIntervalSec: normalizeCameraStreamIntervalSec(policy.cameraStreamIntervalSec),
      dataRetentionDays: retentionDays,
      cameraAiEnabled: policy.cameraAiEnabled === true,
    },
    at: nowIso,
    createdAt: nowIso,
    expiresAt,
    deliveredToUser: false,
    deliveredAt: null,
  };

  list.unshift(entry);
  if (list.length > MAX_UNDELIVERED_MESSAGES) {
    list.length = MAX_UNDELIVERED_MESSAGES;
  }

  logSmartGate('undelivered_message_queued', {
    vendorId: key,
    userId: uid,
    messageId: entry.id,
    type: entry.type,
    retentionDays,
    intervalSec: entry.streamPolicy.cameraStreamIntervalSec,
  });

  return entry;
}

function listUndeliveredMessagesForUser(userId, { includeDelivered = false } = {}) {
  purgeExpiredLiveStreams({ mysql: false });
  const uid = String(userId || '').trim();
  if (!uid) return [];
  const now = Date.now();
  return sortLatestFirst(
    ensureUndeliveredStore().filter(
      (m) =>
        String(m.targetUserId) === uid &&
        !isInternalSmartControlEnvelope(m.message) &&
        !isInternalSmartControlEnvelope(m.title) &&
        (includeDelivered || !m.deliveredToUser) &&
        (!m.expiresAt || new Date(m.expiresAt).getTime() > now)
    ),
    { dateFields: ['createdAt', 'at'] }
  );
}

function listUndeliveredMessagesForVendor(vendorId, { userId = null, includeDelivered = false } = {}) {
  purgeExpiredLiveStreams({ mysql: false });
  const key = String(vendorId || '').trim();
  if (!key) return [];
  const now = Date.now();
  return sortLatestFirst(
    ensureUndeliveredStore().filter(
      (m) =>
        String(m.vendorId) === key &&
        (!userId || String(m.targetUserId) === String(userId)) &&
        (includeDelivered || !m.deliveredToUser) &&
        (!m.expiresAt || new Date(m.expiresAt).getTime() > now)
    ),
    { dateFields: ['createdAt', 'at'] }
  );
}

function deliverPendingMessagesForUser(userId, { markDelivered = true } = {}) {
  const uid = String(userId || '').trim();
  if (!uid) return [];
  recordUserOnlinePresence(uid, { via: 'online_delivery' });
  const pending = listUndeliveredMessagesForUser(uid, { includeDelivered: false });
  if (!pending.length) return [];

  if (markDelivered) {
    const nowIso = new Date().toISOString();
    const storeList = ensureUndeliveredStore();
    pending.forEach((msg) => {
      const hit = storeList.find((m) => m.id === msg.id);
      if (hit) {
        hit.deliveredToUser = true;
        hit.deliveredAt = nowIso;
      }
    });
    logSmartGate('undelivered_messages_delivered', {
      userId: uid,
      count: pending.length,
      ids: pending.map((m) => m.id).slice(0, 10),
    });
  }
  return pending;
}

function ackUndeliveredMessagesForUser(userId, messageIds = []) {
  const uid = String(userId || '').trim();
  if (!uid) return { acknowledged: 0, ackedCount: 0 };
  const idSet = Array.isArray(messageIds) && messageIds.length ? new Set(messageIds.map(String)) : null;
  const nowIso = new Date().toISOString();
  let acknowledged = 0;
  ensureUndeliveredStore().forEach((m) => {
    if (String(m.targetUserId) !== uid) return;
    if (idSet && !idSet.has(String(m.id))) return;
    if (!m.deliveredToUser || !m.ackedAt) {
      m.deliveredToUser = true;
      m.deliveredAt = m.deliveredAt || nowIso;
      m.ackedAt = nowIso;
      acknowledged += 1;
    }
  });
  return { acknowledged, ackedCount: acknowledged };
}

function sendVendorMessageToUser(vendorIdOrObj, payload = {}) {
  const opts =
    vendorIdOrObj && typeof vendorIdOrObj === 'object'
      ? vendorIdOrObj
      : { ...(payload || {}), vendorId: vendorIdOrObj };
  const key = String(opts.vendorId || '').trim();
  if (!key) throw new Error('vendorId is required');
  let target = findUserByTarget(opts);
  const uid = String(target?.id || opts.userId || '').trim();
  if (!uid) {
    throw new Error('User not found — provide userId, mobile, or email');
  }
  const text = String(opts.message || opts.text || '').trim();
  if (!text) {
    throw new Error('Message text is required');
  }
  const vendorName = resolveVendorDisplayName(key) || key;
  const entry = queueUndeliveredUserMessage(key, {
    targetUserId: uid,
    type: opts.type || 'vendor_message',
    title: opts.title || `Message from ${vendorName}`,
    message: text,
  });
  const onlineNow = isUserOnline(uid, key);
  return {
    item: entry,
    message: entry,
    userOnline: onlineNow,
    online: onlineNow,
  };
}

function recordGateConnection(payload = {}) {
  if (payload.userId && isVendorOrAdminSmartUser(payload.userId)) {
    return null;
  }
  const store = mem();
  if (!Array.isArray(store.smartNearbyGateSessions)) store.smartNearbyGateSessions = [];
  const nowIso = new Date().toISOString();
  const vKey = payload.vendorId ? String(payload.vendorId) : null;
  const uKey = payload.userId ? String(payload.userId) : null;

  if (vKey && uKey) {
    const existingIdx = store.smartNearbyGateSessions.findIndex(
      (r) => String(r.vendorId) === vKey && String(r.userId) === uKey && !r.disconnectedAt
    );
    if (existingIdx >= 0) {
      const existing = store.smartNearbyGateSessions[existingIdx];
      existing.userDisplayName =
        payload.userDisplayName || payload.userName || existing.userDisplayName || null;
      existing.vendorName =
        payload.vendorName || existing.vendorName || resolveVendorDisplayName(vKey) || null;
      existing.channel = payload.channel || existing.channel || 'wifi';
      existing.networkLabel = payload.networkLabel || existing.networkLabel || '';
      existing.userSide = payload.userSide
        ? { ...(existing.userSide || {}), ...payload.userSide }
        : existing.userSide || { role: 'user', status: 'connected' };
      existing.vendorSide = payload.vendorSide
        ? { ...(existing.vendorSide || {}), ...payload.vendorSide }
        : existing.vendorSide || { role: 'vendor', status: 'connected' };
      existing.inRange = true;
      existing.pendingOnlineDelivery = !!payload.pendingOnlineDelivery;
      existing.lastHeartbeatAt = nowIso;
      existing.disconnectedAt = null;
      existing.disconnectReason = null;
      if (existingIdx > 0) {
        store.smartNearbyGateSessions.splice(existingIdx, 1);
        store.smartNearbyGateSessions.unshift(existing);
      }
      return attachStreamPolicyToSession(existing);
    }
  }

  const entry = {
    id: `sgate_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId: uKey,
    userDisplayName: payload.userDisplayName || payload.userName || null,
    vendorId: vKey,
    vendorName: payload.vendorName || resolveVendorDisplayName(payload.vendorId) || null,
    channel: payload.channel || 'wifi',
    networkLabel: payload.networkLabel || '',
    userSide: payload.userSide || { role: 'user', status: 'connected' },
    vendorSide: payload.vendorSide || { role: 'vendor', status: 'connected' },
    inRange: true,
    pendingOnlineDelivery: !!payload.pendingOnlineDelivery,
    connectedAt: payload.connectedAt || nowIso,
    lastHeartbeatAt: nowIso,
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
  return attachStreamPolicyToSession(entry);
}

function updateGateHeartbeat(sessionId, { inRange = true, match = null, gateOpen, vendorListening } = {}) {
  const store = mem();
  const rows = store.smartNearbyGateSessions || [];
  const idx = rows.findIndex((r) => r.id === sessionId && !r.disconnectedAt);
  if (idx < 0) return null;
  const row = rows[idx];
  const nowIso = new Date().toISOString();
  row.lastHeartbeatAt = nowIso;
  row.inRange = !!inRange;
  row.pendingOnlineDelivery = false;
  if (row.userId) {
    recordUserOnlinePresence(row.userId, { vendorId: row.vendorId, via: 'heartbeat' });
  }
  if (row.userSide?.status === 'pending_online') {
    row.userSide = { ...row.userSide, status: 'connected' };
  }
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
      vendorListeningAt: vendorListening ? nowIso : row.vendorSide?.vendorListeningAt || null,
    };
  }
  if (!inRange) {
    row.disconnectedAt = nowIso;
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
  return attachStreamPolicyToSession(row);
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

function getUserActiveGate(userId, { markOnline = false } = {}) {
  const uid = String(userId || '').trim();
  if (!uid || isVendorOrAdminSmartUser(uid)) return null;
  if (markOnline) {
    recordUserOnlinePresence(uid, { via: 'gate_status' });
  }
  const row = (mem().smartNearbyGateSessions || []).find(
    (r) => String(r.userId) === uid && !r.disconnectedAt && r.inRange
  );
  if (!row) return null;
  if (markOnline && (row.pendingOnlineDelivery || row.userSide?.status === 'pending_online')) {
    const nowIso = new Date().toISOString();
    row.pendingOnlineDelivery = false;
    row.lastHeartbeatAt = nowIso;
    row.userSide = {
      ...row.userSide,
      status: 'connected',
      onlineDeliveredAt: nowIso,
    };
    logSmartGate('gate_session_online_delivered', {
      vendorId: row.vendorId,
      sessionId: row.id,
      userId: uid,
    });
  }
  return attachStreamPolicyToSession(row);
}

/** Vendor console — mark all active SGATE sessions and vendor policy as listen mode for connected/optional customers. */
function setVendorVoiceListen(vendorId, listening = false) {
  const key = String(vendorId || '');
  if (!key) return { updated: 0 };
  const nowIso = new Date().toISOString();
  const store = mem();
  if (!Array.isArray(store.smartNearbyPolicies)) store.smartNearbyPolicies = [];
  const prevPolicy = getVendorPolicy(key);
  const nextPolicy = {
    ...prevPolicy,
    vendorId: key,
    vendorListening: !!listening,
    vendorListeningAt: listening ? nowIso : prevPolicy.vendorListeningAt || null,
    updatedAt: nowIso,
  };
  const pIdx = store.smartNearbyPolicies.findIndex((p) => String(p.vendorId) === key);
  if (pIdx >= 0) store.smartNearbyPolicies[pIdx] = nextPolicy;
  else store.smartNearbyPolicies.push(nextPolicy);

  const rows = store.smartNearbyGateSessions || [];
  let updated = 0;
  const targetUserIds = new Set(mappedCustomerUserIdsForVendor(key));
  rows.forEach((r, i) => {
    if (String(r.vendorId) !== key) return;
    if (r.userId && !isVendorOrAdminSmartUser(r.userId)) targetUserIds.add(String(r.userId));
    if (r.disconnectedAt) return;
    rows[i] = {
      ...r,
      vendorSide: {
        ...r.vendorSide,
        vendorListening: !!listening,
        vendorListeningAt: listening ? nowIso : r.vendorSide?.vendorListeningAt || null,
      },
      lastHeartbeatAt: nowIso,
    };
    updated += 1;
  });

  targetUserIds.forEach((uid) => {
    if (!uid || isVendorOrAdminSmartUser(uid)) return;
    updateUserMobileState(uid, key, {
      micEnabled: !!listening,
    });
    try {
      sendVendorRemoteCommand({
        vendorId: key,
        userId: uid,
        command: 'toggle_mic',
        params: { enabled: !!listening },
      });
    } catch (_) {
      /* ignore */
    }
  });

  return { updated: Math.max(updated, targetUserIds.size), listening: !!listening };
}

/** Vendor console Refresh — enable listen mode and ping customers (with or without SGATE) to restart streams. */
function requestVendorLiveRefresh(vendorId) {
  const key = String(vendorId || '');
  if (!key) return { updated: 0, listening: false, refreshAt: null };
  const refreshAt = new Date().toISOString();
  const store = mem();
  if (!Array.isArray(store.smartNearbyPolicies)) store.smartNearbyPolicies = [];
  const prevPolicy = getVendorPolicy(key);
  const nextPolicy = {
    ...prevPolicy,
    vendorId: key,
    vendorListening: true,
    vendorListeningAt: refreshAt,
    vendorLiveRefreshAt: refreshAt,
    updatedAt: refreshAt,
  };
  const pIdx = store.smartNearbyPolicies.findIndex((p) => String(p.vendorId) === key);
  if (pIdx >= 0) store.smartNearbyPolicies[pIdx] = nextPolicy;
  else store.smartNearbyPolicies.push(nextPolicy);

  const rows = store.smartNearbyGateSessions || [];
  let updated = 0;
  const targetUserIds = new Set(mappedCustomerUserIdsForVendor(key));
  rows.forEach((r, i) => {
    if (String(r.vendorId) !== key) return;
    if (r.userId && !isVendorOrAdminSmartUser(r.userId)) targetUserIds.add(String(r.userId));
    const prevSeq = Number(r.vendorSide?.vendorLiveRefreshSeq) || 0;
    rows[i] = {
      ...r,
      vendorSide: {
        ...r.vendorSide,
        vendorListening: true,
        vendorListeningAt: refreshAt,
        vendorLiveRefreshAt: refreshAt,
        vendorLiveRefreshSeq: prevSeq + 1,
      },
      lastHeartbeatAt: r.disconnectedAt ? r.lastHeartbeatAt : refreshAt,
    };
    if (!r.disconnectedAt) updated += 1;
  });

  targetUserIds.forEach((uid) => {
    if (!uid || isVendorOrAdminSmartUser(uid)) return;
    updateUserMobileState(uid, key, {
      micEnabled: true,
    });
    try {
      sendVendorRemoteCommand({
        vendorId: key,
        userId: uid,
        command: 'toggle_mic',
        params: { enabled: true, refresh: true },
      });
    } catch (_) {
      /* ignore */
    }
  });

  return {
    updated: Math.max(updated, targetUserIds.size),
    listening: true,
    refreshAt,
    refreshSeq: Math.max(updated, 1),
  };
}

function getVendorGateSessions(vendorId, { activeOnly = false, limit = 40 } = {}) {
  const key = String(vendorId);
  let rows = (mem().smartNearbyGateSessions || []).filter(
    (r) => r.vendorId === key && (!r.userId || !isVendorOrAdminSmartUser(r.userId))
  );
  if (activeOnly) {
    rows = rows.filter((r) => !r.disconnectedAt && r.inRange);
    const sorted = sortLatestFirst(rows, { dateFields: ['lastHeartbeatAt', 'connectedAt'] });
    const seenUsers = new Set();
    const deduped = [];
    for (const r of sorted) {
      const uid = r.userId ? String(r.userId) : '';
      if (uid) {
        if (seenUsers.has(uid)) continue;
        seenUsers.add(uid);
      }
      deduped.push(r);
    }
    return deduped.slice(0, limit);
  }
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
      role: u.role || 'user',
    };
  }
  return {
    id: userId,
    name: `User ${String(userId).slice(-6)}`,
    email: '',
    mobile: '',
    location_name: '',
    role: 'user',
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
          role: u.role || 'user',
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
  const key = normalizeSmartVendorId(vendorId);
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

  const rawMsg = String(payload.message || '').trim();
  if (isInternalSmartControlEnvelope(rawMsg)) {
    if (rawMsg.startsWith('[SMART_CMD]')) {
      try {
        const parsed = JSON.parse(rawMsg.slice('[SMART_CMD]'.length));
        if (parsed?.command) {
          return sendVendorRemoteCommand(key, {
            userId: target.id,
            command: parsed.command,
            params: parsed.params || {},
          });
        }
      } catch (_) {
        /* ignore malformed envelope */
      }
    }
    return {
      id: `sginv_internal_${Date.now()}`,
      vendorId: key,
      targetUserId: target.id,
      status: 'delivered_internal',
      internal: true,
    };
  }

  const retentionDays = getVendorRetentionDays(key);
  const inviteTtlMs = retentionDays * 24 * 60 * 60 * 1000;
  const existing = store.smartNearbyConnectInvites.find(
    (i) =>
      i.vendorId === key
      && i.targetUserId === target.id
      && i.status === 'pending'
      && !isInternalSmartControlEnvelope(i.message)
      && new Date(i.expiresAt).getTime() > Date.now()
  );
  if (existing) {
    if (payload.message && !isInternalSmartControlEnvelope(payload.message)) {
      existing.message = String(payload.message).slice(0, 280);
    }
    existing.expiresAt = new Date(Date.now() + inviteTtlMs).toISOString();
    queueUndeliveredUserMessage(key, {
      targetUserId: target.id,
      type: 'connect_invite',
      inviteId: existing.id,
      dedupeKey: `invite:${key}:${target.id}`,
      title: `${existing.vendorName} — connect on SGATE`,
      message: existing.message || `${existing.vendorName} invited you to connect on SGATE.`,
    });
    return existing;
  }

  const vendors = getSmartVendors(100);
  const vendor = vendors.find((v) => String(v.id) === key);
  const vendorName = vendor?.shop_name || payload.vendorName || key;
  const entry = {
    id: `sginv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    vendorId: key,
    vendorName,
    targetUserId: target.id,
    targetUserName: target.name || target.email || target.id,
    channel: payload.channel || 'wifi',
    message: String(payload.message || '').slice(0, 280),
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + inviteTtlMs).toISOString(),
    sessionId: null,
  };
  store.smartNearbyConnectInvites.unshift(entry);
  if (store.smartNearbyConnectInvites.length > MAX_CONNECT_INVITES) {
    store.smartNearbyConnectInvites.length = MAX_CONNECT_INVITES;
  }
  queueUndeliveredUserMessage(key, {
    targetUserId: target.id,
    type: 'connect_invite',
    inviteId: entry.id,
    dedupeKey: `invite:${key}:${target.id}`,
    title: `${vendorName} — connect on SGATE`,
    message: entry.message || `${vendorName} invited you to connect on SGATE.`,
  });
  return entry;
}

function listPendingInvitesForUser(userId) {
  const uid = String(userId || '');
  if (uid) {
    recordUserOnlinePresence(uid, { via: 'pending_invites' });
  }
  const now = Date.now();
  return sortLatestFirst(
    (mem().smartNearbyConnectInvites || []).filter(
      (i) =>
        i.targetUserId === uid &&
        i.status === 'pending' &&
        !isInternalSmartControlEnvelope(i.message) &&
        new Date(i.expiresAt).getTime() > now
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
  recordUserOnlinePresence(uid, { via: 'accept_invite' });
  const idx = (store.smartNearbyConnectInvites || []).findIndex((i) => i.id === inviteId);
  if (idx < 0) throw new Error('Invite not found');
  const invite = store.smartNearbyConnectInvites[idx];
  if (invite.status !== 'pending') throw new Error('Invite is no longer pending');
  if (String(invite.targetUserId) !== uid) throw new Error('This invite is for another user');
  if (new Date(invite.expiresAt).getTime() < Date.now()) {
    invite.status = 'expired';
    throw new Error('Invite expired — ask vendor to send again');
  }

  const active = getUserActiveGate(uid, { markOnline: true });
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

function mappedCustomerUserIdsForVendor(vendorId) {
  const key = String(vendorId || '');
  const ids = new Set();
  if (!key) return ids;
  const knownUsers = new Set((db.inMemoryDb?.users || []).map((u) => String(u.id)));
  (db.inMemoryDb?.user_vendor_mappings || []).forEach((m) => {
    const uid = m?.user_id ? String(m.user_id) : '';
    if (
      uid &&
      String(m.vendor_id) === key &&
      !isVendorOrAdminSmartUser(uid) &&
      !isSyntheticSmartUserId(uid) &&
      (uid === 'usr_smart1' || (knownUsers.has(uid) && isUserOnline(uid, key)))
    ) {
      ids.add(uid);
    }
  });
  if (key === 'v_smart1' && !isSyntheticSmartUserId('usr_smart1')) {
    ids.add('usr_smart1');
  }
  return ids;
}

function listReachableUsersForVendor(vendorId) {
  const key = String(vendorId || '');
  const ids = liveCustomerUserIdsForVendor(key);
  mappedCustomerUserIdsForVendor(key).forEach((uid) => ids.add(uid));
  const store = mem();
  (store.smartNearbyGateSessions || []).forEach((g) => {
    if (
      String(g.vendorId) === key &&
      g.userId &&
      !isSyntheticSmartUserId(g.userId) &&
      !isVendorOrAdminSmartUser(g.userId) &&
      (g.userId === 'usr_smart1' || isUserOnline(g.userId, key))
    ) {
      ids.add(g.userId);
    }
  });
  return [...ids]
    .filter((id) => id && !isVendorOrAdminSmartUser(id) && !isSyntheticSmartUserId(id))
    .map((id) => resolveUserBrief(id))
    .filter(
      (u) =>
        u &&
        u.role !== 'vendor' &&
        u.role !== 'super_admin' &&
        u.role !== 'admin' &&
        (u.id === 'usr_smart1' || !String(u.name || '').startsWith('User '))
    );
}

function directConnectVendorUser({ vendorId, userId, mobile, email, userDisplayName, message } = {}) {
  const key = String(vendorId || '');
  if (!key) throw new Error('vendorId is required');

  let target = findUserByTarget({ userId, mobile, email });
  const uid = String(target?.id || userId || '');
  if (!uid) {
    throw new Error('User not found — provide user id, mobile or email');
  }

  const vendors = getSmartVendors(100);
  const vendor = vendors.find((v) => String(v.id) === key);
  const vendorName = vendor?.shop_name || resolveVendorDisplayName(key) || key;
  const onlineNow = isUserOnline(uid, key);
  const customMsg = String(message || '').trim().slice(0, 280);

  updateUserMobileState(uid, key, {
    operatingMode: 'vendor_controlled',
    recordingEnabled: true,
    micEnabled: true,
    cameraEnabled: true,
  });

  const existing = getUserActiveGate(uid);
  let session = null;
  if (existing && String(existing.vendorId) === key) {
    existing.lastHeartbeatAt = new Date().toISOString();
    existing.inRange = true;
    existing.disconnectedAt = null;
    existing.disconnectReason = null;
    existing.pendingOnlineDelivery = !onlineNow;
    existing.userSide = {
      ...existing.userSide,
      role: 'user',
      status: onlineNow ? 'connected' : 'pending_online',
      via: 'vendor_direct',
    };
    existing.vendorSide = {
      ...existing.vendorSide,
      status: 'connected',
      gateOpen: true,
      vendorListening: true,
      vendorListeningAt: new Date().toISOString(),
      via: 'vendor_direct',
    };
    logSmartGate('gate_session_direct_reconnected', {
      vendorId: key,
      userId: uid,
      sessionId: existing.id,
      userOnline: onlineNow,
    });
    session = attachStreamPolicyToSession(existing);
  } else {
    if (existing) {
      endGateConnection(existing.id, 'vendor_switch');
    }
    session = recordGateConnection({
      userId: uid,
      userDisplayName: userDisplayName || target?.name || target?.email || `Customer ${uid.slice(-6)}`,
      vendorId: key,
      vendorName,
      channel: 'direct',
      networkLabel: `${vendorName} · Direct connect`,
      pendingOnlineDelivery: !onlineNow,
      userSide: {
        role: 'user',
        status: onlineNow ? 'connected' : 'pending_online',
        via: 'vendor_direct',
      },
      vendorSide: {
        role: 'vendor',
        status: 'connected',
        gateOpen: true,
        vendorListening: true,
        vendorListeningAt: new Date().toISOString(),
        via: 'vendor_direct',
      },
    });
    logSmartGate('gate_session_direct_connected', {
      vendorId: key,
      userId: uid,
      sessionId: session.id,
      userOnline: onlineNow,
    });
  }

  queueUndeliveredUserMessage(key, {
    targetUserId: uid,
    type: 'direct_connect',
    sessionId: session.id,
    dedupeKey: customMsg ? null : `direct:${key}:${uid}`,
    title: `${vendorName} connected`,
    message:
      customMsg ||
      `${vendorName} connected directly — syncing mic & camera every ${
        session.streamPolicy?.cameraStreamIntervalSec ?? 30
      }s.`,
  });

  return session;
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

  recordUserOnlinePresence(uid, { vendorId: link.vendorId, via: 'connect_link' });

  const active = getUserActiveGate(uid, { markOnline: true });
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

const MAX_REMOTE_COMMANDS = 400;

function sendVendorRemoteCommand(vendorIdOrObj = {}, payload = {}) {
  const opts =
    vendorIdOrObj && typeof vendorIdOrObj === 'object'
      ? vendorIdOrObj
      : { ...(payload || {}), vendorId: vendorIdOrObj };
  const {
    vendorId,
    userId,
    mobile,
    email,
    command,
    params = {},
  } = opts;
  const key = String(vendorId || '');
  if (!key) throw new Error('vendorId is required');
  const cmdName = String(command || '').trim();
  if (!cmdName) throw new Error('command is required');

  let target = findUserByTarget({ userId, mobile, email });
  const uid = String(target?.id || userId || '');
  if (!uid) {
    throw new Error('Target customer not found — provide userId, mobile, or email');
  }

  const store = mem();
  if (!Array.isArray(store.smartNearbyRemoteCommands)) {
    store.smartNearbyRemoteCommands = [];
  }
  const nowIso = new Date().toISOString();
  const retentionDays = getVendorRetentionDays(key);
  const ttlMs = retentionDays * 24 * 60 * 60 * 1000;
  const vendorName = resolveVendorDisplayName(key) || key;
  const currentState = getUserMobileState(uid, key);

  let session = getUserActiveGate(uid);
  const ensureConnectedSession = (labelSuffix = 'Remote control') => {
    if (!session || String(session.vendorId) !== key) {
      session = directConnectVendorUser({
        vendorId: key,
        userId: uid,
        userDisplayName: target?.name || target?.email,
        message: `${vendorName} took remote control (${labelSuffix}).`,
      });
    } else {
      session.lastHeartbeatAt = nowIso;
      session.inRange = true;
      session.disconnectedAt = null;
      session.vendorSide = {
        ...(session.vendorSide || {}),
        status: 'connected',
        gateOpen: true,
        vendorListening: true,
        vendorListeningAt: nowIso,
        vendorRefreshRequestedAt: nowIso,
      };
    }
    return session;
  };

  const withWifiScan = params.withWifiScan === true || params.withScan === true;
  const requestedFacing =
    params.cameraFacing === 'front' || params.cameraFacing === 'back'
      ? params.cameraFacing
      : params.facing === 'front' || params.facing === 'back'
        ? params.facing
        : null;

  let statePatch = {
    lastCommand: cmdName,
    lastCommandAt: nowIso,
    withWifiScan,
  };
  let humanSummary = `${vendorName} executed ${cmdName}`;

  if (cmdName === 'wake_from_idle' || cmdName === 'wake_and_stream') {
    statePatch = {
      ...statePatch,
      operatingMode: 'vendor_controlled',
      recordingEnabled: true,
      micEnabled: true,
      cameraEnabled: true,
      ...(requestedFacing ? { cameraFacing: requestedFacing } : {}),
    };
    ensureConnectedSession(withWifiScan ? 'Wake from idle + WiFi scan' : 'Wake from idle');
    requestVendorLiveRefresh(key);
    humanSummary = `${vendorName} woke mobile from idle mode & started live mic + camera${
      withWifiScan ? ' + WiFi scan' : ''
    }`;
  } else if (cmdName === 'start_recording') {
    const nextSec = params.intervalSec
      ? normalizeCameraStreamIntervalSec(params.intervalSec)
      : currentState.streamIntervalSec;
    if (params.applyToShop !== false) {
      setVendorPolicy(key, {
        recordingEnabled: true,
        ...(params.intervalSec ? { cameraStreamIntervalSec: nextSec } : {}),
      });
    }
    statePatch = {
      ...statePatch,
      operatingMode: 'vendor_controlled',
      recordingEnabled: true,
      micEnabled: true,
      cameraEnabled: true,
      streamIntervalSec: nextSec,
      cameraStreamIntervalSec: nextSec,
      ...(requestedFacing ? { cameraFacing: requestedFacing } : {}),
    };
    ensureConnectedSession(`Auto-record every ${nextSec}s`);
    requestVendorLiveRefresh(key);
    humanSummary = `${vendorName} started mic & camera recording every ${nextSec}s`;
  } else if (cmdName === 'stop_recording' || cmdName === 'set_idle') {
    if (params.applyToShop === true) {
      setVendorPolicy(key, { recordingEnabled: false });
    }
    statePatch = {
      ...statePatch,
      operatingMode: 'idle',
      recordingEnabled: false,
      micEnabled: false,
      cameraEnabled: false,
    };
    humanSummary = `${vendorName} paused mic & camera recording (mobile set to idle)`;
  } else if (cmdName === 'capture_snapshot') {
    statePatch = {
      ...statePatch,
      operatingMode: 'vendor_controlled',
      ...(requestedFacing ? { cameraFacing: requestedFacing } : {}),
    };
    ensureConnectedSession(withWifiScan ? 'Instant snapshot + WiFi scan' : 'Instant snapshot');
    requestVendorLiveRefresh(key);
    humanSummary = `${vendorName} requested an instant camera snapshot${
      withWifiScan ? ' + WiFi scan' : ' (no WiFi scan)'
    }`;
  } else if (cmdName === 'switch_camera') {
    const nextFacing =
      requestedFacing || (currentState.cameraFacing === 'front' ? 'back' : 'front');
    statePatch = {
      ...statePatch,
      operatingMode: 'vendor_controlled',
      cameraEnabled: true,
      cameraFacing: nextFacing,
    };
    ensureConnectedSession(
      `Switch camera to ${nextFacing}${withWifiScan ? ' + WiFi scan' : ''}`
    );
    requestVendorLiveRefresh(key);
    humanSummary = `${vendorName} switched mobile camera to ${nextFacing.toUpperCase()}${
      withWifiScan ? ' + WiFi scan' : ' (no WiFi scan)'
    }`;
  } else if (cmdName === 'toggle_mic') {
    const nextMic =
      params.enabled != null ? !!params.enabled : !currentState.micEnabled;
    statePatch = {
      ...statePatch,
      operatingMode: 'vendor_controlled',
      micEnabled: nextMic,
    };
    if (nextMic) ensureConnectedSession('Mic ON');
    humanSummary = `${vendorName} turned customer microphone ${nextMic ? 'ON' : 'OFF'}`;
  } else if (cmdName === 'toggle_camera') {
    const nextCam =
      params.enabled != null ? !!params.enabled : !currentState.cameraEnabled;
    statePatch = {
      ...statePatch,
      operatingMode: 'vendor_controlled',
      cameraEnabled: nextCam,
    };
    if (nextCam) {
      ensureConnectedSession('Camera ON');
      requestVendorLiveRefresh(key);
    }
    humanSummary = `${vendorName} turned customer camera ${nextCam ? 'ON' : 'OFF'}`;
  } else if (cmdName === 'set_stream_interval') {
    const nextSec = normalizeCameraStreamIntervalSec(params.intervalSec || params.cameraStreamIntervalSec || 30);
    if (params.applyToShop !== false) {
      setVendorPolicy(key, { cameraStreamIntervalSec: nextSec });
    }
    statePatch = {
      ...statePatch,
      streamIntervalSec: nextSec,
      cameraStreamIntervalSec: nextSec,
    };
    humanSummary = `${vendorName} set mobile recording interval to ${nextSec}s`;
  } else if (cmdName === 'run_smart_scan') {
    statePatch = {
      ...statePatch,
      operatingMode: 'vendor_controlled',
      withWifiScan: true,
    };
    ensureConnectedSession('Remote WiFi/BLE scan');
    humanSummary = `${vendorName} triggered a remote WiFi & Bluetooth scan on mobile`;
  } else if (cmdName === 'operate_device') {
    const devEntry = recordDeviceControl({
      userId: uid,
      vendorId: key,
      deviceId: params.deviceId || 'remote_mobile_device',
      action: params.action || 'toggle_power',
      deviceName: params.deviceName || 'Smart Device',
      deviceType: params.deviceType || 'smart',
      powered: params.powered != null ? !!params.powered : true,
      payload: { ...params, initiatedByVendor: true },
    });
    statePatch = {
      ...statePatch,
      operatingMode: 'vendor_controlled',
      lastDeviceControlId: devEntry.id,
    };
    humanSummary = `${vendorName} operated device ${params.deviceName || params.deviceId || 'Smart Device'} (${params.action || 'control'})`;
  } else if (cmdName === 'navigate_screen') {
    const screen = String(params.screen || 'SmartGate').trim();
    statePatch = {
      ...statePatch,
      operatingMode: 'vendor_controlled',
      activeScreen: screen,
    };
    humanSummary = `${vendorName} opened ${screen} on customer mobile`;
  } else if (cmdName === 'voice_prompt' || cmdName === 'screen_alert') {
    const alertMsg = String(params.message || params.text || 'Vendor requested your attention on SMART').slice(0, 320);
    queueUndeliveredUserMessage(key, {
      targetUserId: uid,
      type: cmdName,
      title: params.title || `${vendorName} · Mobile Alert`,
      message: alertMsg,
      payload: { command: cmdName, ...params },
    });
    humanSummary = `${vendorName} sent mobile prompt: "${alertMsg.slice(0, 60)}"`;
  }

  const updatedMobileState = updateUserMobileState(uid, key, statePatch);
  if (session) {
    session = attachStreamPolicyToSession(session);
  }

  const cmdEntry = {
    id: `srcmd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    vendorId: key,
    vendorName,
    targetUserId: uid,
    command: cmdName,
    params: {
      ...params,
      withWifiScan,
      ...(requestedFacing ? { cameraFacing: requestedFacing, facing: requestedFacing } : {}),
      mobileState: updatedMobileState,
    },
    summary: humanSummary,
    status: 'pending',
    deliveredToUser: false,
    deliveredAt: null,
    ackedAt: null,
    at: nowIso,
    createdAt: nowIso,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  };

  store.smartNearbyRemoteCommands.unshift(cmdEntry);
  if (store.smartNearbyRemoteCommands.length > MAX_REMOTE_COMMANDS) {
    store.smartNearbyRemoteCommands.length = MAX_REMOTE_COMMANDS;
  }

  const onlineNow = isUserOnline(uid, key);
  logSmartGate('vendor_remote_mobile_command', {
    vendorId: key,
    targetUserId: uid,
    command: cmdName,
    commandId: cmdEntry.id,
    withWifiScan,
    userOnline: onlineNow,
  });

  return {
    command: cmdEntry,
    mobileState: updatedMobileState,
    session,
    withWifiScan,
    userOnline: onlineNow,
    online: onlineNow,
  };
}

function listRemoteCommandsForUser(userId, { vendorId = null, pendingOnly = true } = {}) {
  const uid = String(userId || '');
  if (!uid) return [];
  purgeExpiredLiveStreamsMemory();
  const now = Date.now();
  const rows = (mem().smartNearbyRemoteCommands || []).filter((c) => {
    if (String(c.targetUserId) !== uid) return false;
    if (vendorId && String(c.vendorId) !== String(vendorId)) return false;
    if (pendingOnly && (c.status === 'acked' || c.deliveredToUser === true)) return false;
    const exp = c.expiresAt ? new Date(c.expiresAt).getTime() : 0;
    if (exp && exp < now) return false;
    return true;
  });
  return sortLatestFirst(rows, { dateFields: ['createdAt', 'at'] });
}

function listRemoteCommandsForVendor(vendorId, { pendingOnly = false, limit = 50 } = {}) {
  const key = String(vendorId || '');
  if (!key) return [];
  purgeExpiredLiveStreamsMemory();
  const now = Date.now();
  const rows = (mem().smartNearbyRemoteCommands || []).filter((c) => {
    if (String(c.vendorId) !== key) return false;
    if (pendingOnly && (c.status === 'acked' || c.deliveredToUser === true)) return false;
    const exp = c.expiresAt ? new Date(c.expiresAt).getTime() : 0;
    if (exp && exp < now) return false;
    return true;
  });
  return sortLatestFirst(rows, { dateFields: ['createdAt', 'at'] }).slice(0, limit);
}

function deliverPendingRemoteCommandsForUser(userId, { vendorId = null, markDelivered = true } = {}) {
  const uid = String(userId || '');
  if (!uid) return [];
  recordUserOnlinePresence(uid, { vendorId, via: 'remote_command_poll' });
  const pending = listRemoteCommandsForUser(uid, { vendorId, pendingOnly: true });
  if (markDelivered && pending.length > 0) {
    const nowIso = new Date().toISOString();
    pending.forEach((c) => {
      c.deliveredToUser = true;
      c.deliveredAt = nowIso;
      c.status = 'delivered';
    });
  }
  return pending.map((c) => ({ ...c }));
}

function ackUserRemoteCommands(userId, commandIds = [], mobileStatePatch = null) {
  const uid = String(userId || '');
  if (!uid) return { ackedCount: 0, mobileState: null };
  recordUserOnlinePresence(uid, { via: 'remote_command_ack' });
  const idSet = new Set(
    (Array.isArray(commandIds) ? commandIds : [commandIds]).map((x) => String(x || '')).filter(Boolean)
  );
  const nowIso = new Date().toISOString();
  let ackedCount = 0;
  let vendorId = null;
  (mem().smartNearbyRemoteCommands || []).forEach((c) => {
    if (String(c.targetUserId) !== uid) return;
    if (idSet.size === 0 || idSet.has(String(c.id))) {
      c.deliveredToUser = true;
      c.deliveredAt = c.deliveredAt || nowIso;
      c.ackedAt = nowIso;
      c.status = 'acked';
      vendorId = vendorId || c.vendorId;
      ackedCount += 1;
    }
  });
  const mobileState = updateUserMobileState(uid, vendorId, {
    ...(mobileStatePatch && typeof mobileStatePatch === 'object' ? mobileStatePatch : {}),
    lastAckAt: nowIso,
  });
  return { ackedCount, mobileState };
}

async function buildVendorDashboard(vendorId) {
  purgeExpiredLiveStreams();
  const key = String(vendorId);
  const policy = getVendorPolicy(key);
  const retentionDays = getVendorRetentionDays(key);
  const streamIntervalSec = normalizeCameraStreamIntervalSec(policy.cameraStreamIntervalSec);
  const recordingEnabled = policy.recordingEnabled !== false;
  const activeGates = getVendorGateSessions(key, { activeOnly: true, limit: 100 });
  const recentGates = getVendorGateSessions(key, { limit: 60 });
  const scans = getVendorSessions(key, 80);
  const voiceLines = await getVendorVoiceStream(key, { limit: 200 });
  const deviceControls = getVendorDeviceControls(key, { limit: 80 });
  const connectInvites = listInvitesForVendor(key, { limit: 50 });
  const undeliveredForShop = listUndeliveredMessagesForVendor(key, { includeDelivered: false });
  const remoteCommandsForShop = listRemoteCommandsForVendor(key, { pendingOnly: false, limit: 80 });

  const userMap = new Map();
  const shouldIncludeCustomer = (userId) => {
    const id = String(userId || '').trim();
    if (!id || id === 'unknown') return false;
    if (isSyntheticSmartUserId(id) || isVendorOrAdminSmartUser(id)) return false;
    if (id === 'usr_smart2' && !isUserOnline('usr_smart2', key)) return false;
    return true;
  };
  const touch = (userId) => {
    const id = String(userId || 'unknown').trim();
    if (!shouldIncludeCustomer(id)) return null;
    if (!userMap.has(id)) {
      userMap.set(id, {
        userId: id,
        user: resolveUserBrief(id),
        activeGate: null,
        gateHistory: [],
        scans: [],
        voiceLines: [],
        deviceControls: [],
        undeliveredMessages: [],
        remoteCommands: [],
      });
    }
    return userMap.get(id);
  };

  mappedCustomerUserIdsForVendor(key).forEach((uid) => {
    touch(uid);
  });

  activeGates.forEach((g) => {
    const row = touch(g.userId);
    if (row) row.activeGate = g;
  });

  recentGates.forEach((g) => {
    const row = touch(g.userId);
    if (!row) return;
    row.gateHistory.push(g);
    if (!g.disconnectedAt && g.inRange) row.activeGate = g;
  });
  scans.forEach((s) => {
    const row = touch(s.userId);
    if (row) row.scans.push(s);
  });
  voiceLines.forEach((v) => {
    const row = touch(v.userId);
    if (row) row.voiceLines.push(v);
  });
  deviceControls.forEach((c) => {
    const row = touch(c.userId);
    if (row) row.deviceControls.push(c);
  });
  connectInvites.forEach((inv) => {
    touch(inv.targetUserId);
  });
  undeliveredForShop.forEach((m) => {
    const row = touch(m.targetUserId);
    if (row) row.undeliveredMessages.push(m);
  });
  remoteCommandsForShop.forEach((cmd) => {
    const row = touch(cmd.targetUserId);
    if (row) row.remoteCommands.push(cmd);
  });

  const cameraFrames = await getVendorCameraLive(key, { limit: 80 });
  const cameraByUser = new Map();
  cameraFrames.forEach((f) => {
    if (!shouldIncludeCustomer(f.userId)) return;
    if (!cameraByUser.has(f.userId)) cameraByUser.set(f.userId, f);
    touch(f.userId);
  });

  const RECENT_MS = 5 * 60 * 1000;
  const isRecent = (iso) => iso && Date.now() - new Date(iso).getTime() < RECENT_MS;

  const rawUsers = [...userMap.values()].filter((u) => shouldIncludeCustomer(u.userId));

  await Promise.all(
    rawUsers.map(async (u) => {
      u.user = await resolveUserBriefAsync(u.userId);
    })
  );

  const users = rawUsers.filter((u) => {
    const role = String(u.user?.role || '').toLowerCase();
    return role !== 'vendor' && role !== 'super_admin' && role !== 'admin' && !isVendorOrAdminSmartUser(u.userId);
  });

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
    const presence = getUserPresence(u.userId, key);
    const mobileState = getUserMobileState(u.userId, key);
    u.mobileState = mobileState;
    u.micRecent = isRecent(lastVoice);
    u.cameraRecent = isRecent(cam?.at);
    u.lastCameraFrame = cam || null;
    u.online = !!(
      presence.online ||
      u.micRecent ||
      u.cameraRecent ||
      (u.activeGate && !u.activeGate.pendingOnlineDelivery && isRecent(u.activeGate.lastHeartbeatAt))
    );
    u.lastSeenAt =
      presence.lastSeenAt ||
      u.activeGate?.lastHeartbeatAt ||
      cam?.at ||
      lastVoice ||
      u.gateHistory[0]?.connectedAt ||
      null;
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
    else if (u.activeGate && !u.activeGate.streamOnly && !u.activeGate.pendingOnlineDelivery) u.pipelineStatus = 'sgate_live';
    else if (u.activeGate?.pendingOnlineDelivery || u.undeliveredMessages.length > 0) u.pipelineStatus = 'queued_offline';
    else u.pipelineStatus = 'idle';

    u.gateHistory = sortLatestFirst(u.gateHistory, { dateFields: ['connectedAt', 'lastHeartbeatAt'] });
    u.scans = sortLatestFirst(u.scans, { dateFields: ['createdAt'] });
    u.voiceLines = sortLatestFirst(u.voiceLines, { dateFields: ['at'] });
    u.deviceControls = sortLatestFirst(u.deviceControls, { dateFields: ['createdAt'] });
    u.undeliveredMessages = sortLatestFirst(u.undeliveredMessages, { dateFields: ['createdAt', 'at'] });
    u.remoteCommands = sortLatestFirst(u.remoteCommands, { dateFields: ['createdAt', 'at'] });
    u.pendingRemoteCommandsCount = u.remoteCommands.filter((c) => !c.deliveredToUser).length;
    u.undeliveredCount = u.undeliveredMessages.length;
    u.undeliveredToUserCount = u.undeliveredMessages.length + u.pendingRemoteCommandsCount;
    u.undeliveredFromUserCount =
      u.voiceLines.filter((v) => v.deliveredToVendor === false).length +
      (cam && cam.deliveredToVendor === false ? 1 : 0);
    u.retentionDays = retentionDays;
    u.streamIntervalSec = mobileState.streamIntervalSec || streamIntervalSec;
    u.recordingEnabled = recordingEnabled && (mobileState.micEnabled || mobileState.cameraEnabled);
  });

  users.sort((a, b) => {
    const aLive = a.online || a.activeGate ? 1 : 0;
    const bLive = b.online || b.activeGate ? 1 : 0;
    if (bLive !== aLive) return bLive - aLive;
    if ((b.undeliveredToUserCount || 0) !== (a.undeliveredToUserCount || 0)) {
      return (b.undeliveredToUserCount || 0) - (a.undeliveredToUserCount || 0);
    }
    const aT = a.lastSeenAt || '';
    const bT = b.lastSeenAt || '';
    return String(bT).localeCompare(String(aT));
  });

  const realActiveGates = activeGates.filter(
    (g) => g.userId && !isSyntheticSmartUserId(g.userId) && !g.disconnectedAt && g.inRange && !g.pendingOnlineDelivery
  );

  const liveCustomers = users.filter(
    (u) =>
      !isSyntheticSmartUserId(u.userId)
      && (
        (u.activeGate && !u.activeGate.disconnectedAt && u.activeGate.inRange && !u.activeGate.pendingOnlineDelivery)
        || u.micRecent
        || u.cameraRecent
        || u.online
      )
  );

  const streamLiveUserIds = liveCustomerUserIdsForVendor(key);
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

  const scanDeltaService = require('./smartScanDeltaService');
  let scanTotals = await scanDeltaService.getVendorScanTotalsAsync(key);
  if (!(scanTotals.wifiCount || scanTotals.deviceCount)) {
    const fromSessions = scanDeltaService.deriveTotalsFromSharedScans(scans);
    if (fromSessions.wifiCount || fromSessions.deviceCount) {
      scanTotals = fromSessions;
    }
  }
  const scanAlerts = await scanDeltaService.getVendorScanAlertsAsync(key, 24);
  const lastScanAlert = scanAlerts[0] || null;
  const scanDeltaStore = require('./smartScanDeltaMysqlService').mysqlScanDeltaEnabled()
    ? 'mysql'
    : 'memory_only';

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
    policy: {
      recordingEnabled,
      cameraStreamIntervalSec: streamIntervalSec,
      dataRetentionDays: retentionDays,
      cameraAiEnabled: policy.cameraAiEnabled === true,
      customerCameraPreviewHidden: policy.customerCameraPreviewHidden !== false,
      storeOfflineUntilOnline: policy.storeOfflineUntilOnline !== false,
    },
    connectLink: {
      linkCode: connectLink.linkCode,
      code: connectLink.linkCode,
      vendorName: connectLink.vendorName,
      expiresAt: connectLink.expiresAt,
      message: connectLink.message,
    },
    stats: {
      connectedNow: Math.max(liveCustomers.length, realActiveGates.length, streamLiveUserIds.size),
      sgateSessions: realActiveGates.length,
      totalUsers: Math.max(users.length, liveCustomers.length, realActiveGates.length, streamLiveUserIds.size),
      sharedScans: scans.filter((s) => s.sharedWithVendor).length,
      voiceLines: voiceLines.length,
      cameraFrames: cameraFrames.length,
      pendingInvites: pendingOutbound.length,
      undeliveredMessages: undeliveredForShop.length,
      recordingEnabled,
      streamIntervalSec,
      nearbyWifiCount: scanTotals.wifiCount,
      nearbyDeviceCount: scanTotals.deviceCount,
      scanNetWifi: lastScanAlert?.netWifi ?? 0,
      scanNetDevices: lastScanAlert?.netDevices ?? 0,
    },
    scanAlerts,
    activeGates,
    users,
    recentGates,
    scans,
    voiceLines,
    cameraLive: (await getVendorCameraLive(key, { limit: 1 }))[0] || null,
    deviceControls,
    connectInvites,
    undeliveredMessages: undeliveredForShop,
    remoteCommands: remoteCommandsForShop,
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
      streamLiveUserIds: [...streamLiveUserIds],
      renderNote:
        streamLiveUserIds.size > 0 && realActiveGates.length === 0
          ? 'Mic/camera live but no SGATE session on this server — Render may have multiple instances; use local API or redeploy backend.'
          : null,
      scanDeltaStore,
      sharedScanSessions: scans.filter((s) => s.sharedWithVendor).length,
      recentTrace: getSmartGateTrace(25),
    },
  };
}

module.exports = {
  getSmartVendors,
  listNearbyVendors,
  getVendorPolicy,
  setVendorPolicy,
  getVendorRetentionDays,
  getUserMobileState,
  updateUserMobileState,
  sendVendorRemoteCommand,
  listRemoteCommandsForUser,
  listRemoteCommandsForVendor,
  deliverPendingRemoteCommandsForUser,
  ackUserRemoteCommands,
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
  requestVendorLiveRefresh,
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
  directConnectVendorUser,
  listReachableUsersForVendor,
  findUserByTarget,
  getOrCreateVendorConnectLink,
  joinVendorConnectLink,
  purgeExpiredLiveStreams,
  purgeExpiredLiveStreamsMemory,
  purgeExpiredLiveStreamsMysql,
  clearVendorLiveMedia,
  smartCameraPersistMysql,
  recordUserOnlinePresence,
  isUserOnline,
  getUserPresence,
  queueUndeliveredUserMessage,
  listUndeliveredMessagesForUser,
  getUndeliveredMessagesForUser: listUndeliveredMessagesForUser,
  listUndeliveredMessagesForVendor,
  deliverPendingMessagesForUser,
  ackUndeliveredMessagesForUser,
  sendVendorMessageToUser,
};

