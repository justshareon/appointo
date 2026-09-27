/**
 * Cyber Nearby API — WiFi/BLE/infra scans, vendor opt-in sharing.
 */
const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken, optionalAuthenticateToken } = require('../middleware/auth');
const nearby = require('../services/smartService');
const nearbyMem = require('../services/smartMemoryStore');
const LOG = require('../utils/logger');
const { logSmartGate } = require('../utils/smartGateLog');
const { recordBackendFeatureScan } = require('../services/featureScanLogService');

router.use(async (req, res, next) => {
  try {
    if (typeof db.ensureSmartUsersAndVendor === 'function') {
      await db.ensureSmartUsersAndVendor();
    }
    const mem = db.inMemoryDb;
    if (mem && (!mem.smartNearbyVendors || mem.smartNearbyVendors.length === 0)) {
      const pool = typeof db.getPool === 'function' ? db.getPool() : null;
      if (pool) {
        const [rows] = await pool.query(
          `SELECT * FROM vendors WHERE features_smart = 1 OR features_smart = TRUE LIMIT 50`
        );
        if (rows?.length) {
          mem.smartNearbyVendors = rows.map((v) => ({ ...v, features_smart: true }));
        }
      }
    }
    if (mem && (!mem.smartNearbyVendors || mem.smartNearbyVendors.length === 0)) {
      nearbyMem.acquire();
    }
  } catch (err) {
    LOG.warning('[Smart] ensureSmartUsersAndVendor:', err.message);
  }
  next();
});

router.use(nearbyMem.middleware());

function denyUnlessVendor(req, res, vendorId) {
  if (!nearby.vendorAccessAllowed(req, vendorId)) {
    res.status(403).json({ success: false, error: 'Not allowed for this vendor' });
    return false;
  }
  return true;
}

function smartVendorOwnerUserId(vendorId) {
  const row = (nearby.getSmartVendors?.(100) || []).find((v) => String(v.id) === String(vendorId));
  return row?.owner_id || row?.ownerId || null;
}

router.get('/vendor/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id || req.userId;
    const vendorIds = nearby.resolveVendorIdsForUser(userId);
    const vendors = nearby.getSmartVendors?.(100) || [];
    const primaryVendorId = vendorIds[0] || req.user?.vendor_id || null;
    res.json({
      success: true,
      vendorIds,
      primaryVendorId,
      vendors: vendors.filter((v) => vendorIds.includes(String(v.id))),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/vendors', authenticateToken, async (req, res) => {
  try {
    const vendors = await nearby.listNearbyVendors({
      city: req.query.city || '',
      lat: req.query.lat ? parseFloat(req.query.lat) : null,
      lng: req.query.lng ? parseFloat(req.query.lng) : null,
    });
    recordBackendFeatureScan('smart_scan', 'vendors_api', `Listed ${vendors.length} SMART vendor(s)`, {
      city: req.query.city || null,
    });
    res.json({ success: true, vendors, count: vendors.length });
  } catch (err) {
    LOG.error('[Smart] vendors error:', err.message);
    recordBackendFeatureScan('smart_scan', 'scan_error', err.message, { route: 'smart/vendors' });
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/vendor/:vendorId/policy', authenticateToken, async (req, res) => {
  try {
    res.json({ success: true, policy: nearby.getVendorPolicy(req.params.vendorId) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/vendor/:vendorId/policy', authenticateToken, async (req, res) => {
  try {
    const { vendorId } = req.params;
    if (!denyUnlessVendor(req, res, vendorId)) return;
    const policy = nearby.setVendorPolicy(vendorId, req.body || {});
    res.json({ success: true, policy });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/scan', authenticateToken, async (req, res) => {
  try {
    const { scan, vendorId, sharedWithVendor, consent, location } = req.body || {};
    if (!scan || typeof scan !== 'object') {
      return res.status(400).json({ success: false, error: 'scan payload required' });
    }
    if (sharedWithVendor && !consent?.userOptIn) {
      return res.status(400).json({
        success: false,
        error: 'User opt-in required before sharing scan with vendor',
      });
    }
    const userId = req.user?.id || req.userId;
    const session = await nearby.recordScanSession({
      userId,
      userDisplayName: req.user?.name || req.user?.email || null,
      vendorId,
      sharedWithVendor,
      consent,
      scan,
      location,
    });
    recordBackendFeatureScan('smart_scan', 'scan_saved', 'SMART scan session recorded', {
      userId,
      vendorId,
      sharedWithVendor: !!sharedWithVendor,
    });
    const delta = session.scanDelta;
    if (
      sharedWithVendor
      && vendorId
      && delta?.changed
      && (delta.addedWifi?.length || delta.addedDevices?.length || delta.removedWifi?.length || delta.removedDevices?.length)
    ) {
      const notificationService = require('../services/notificationService');
      const parts = [];
      if (delta.addedWifi?.length) parts.push(`+${delta.addedWifi.length} WiFi`);
      if (delta.removedWifi?.length) parts.push(`-${delta.removedWifi.length} WiFi`);
      if (delta.addedDevices?.length) parts.push(`+${delta.addedDevices.length} device(s)`);
      if (delta.removedDevices?.length) parts.push(`-${delta.removedDevices.length} device(s)`);
      await notificationService.notify('smart_scan_delta', {
        vendorId: String(vendorId),
        targetUserId: smartVendorOwnerUserId(vendorId),
        customerUserId: userId,
        customerName: req.user?.name || req.user?.email || userId,
        delta,
        title: `SMART scan update · ${parts.join(', ')}`,
        message: [
          delta.addedWifi?.length ? `New WiFi: ${delta.addedWifi.slice(0, 3).join(', ')}` : null,
          delta.addedDevices?.length ? `New devices: ${delta.addedDevices.slice(0, 3).join(', ')}` : null,
          `Totals: ${delta.wifiCount} WiFi · ${delta.deviceCount} devices`,
        ]
          .filter(Boolean)
          .join(' · '),
      }).catch(() => {});
    }
    res.json({ success: true, sessionId: session.id, scanDelta: session.scanDelta || null });
  } catch (err) {
    LOG.error('[Smart] scan post error:', err.message);
    recordBackendFeatureScan('smart_scan', 'scan_error', err.message, { route: 'smart/scan' });
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/vendor/:vendorId/dashboard', authenticateToken, async (req, res) => {
  try {
    const { vendorId } = req.params;
    if (!denyUnlessVendor(req, res, vendorId)) return;
    const dashboard = await nearby.buildVendorDashboard(vendorId);
    res.json({ success: true, dashboard });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/vendor/:vendorId/sessions', authenticateToken, async (req, res) => {
  try {
    const { vendorId } = req.params;
    if (!denyUnlessVendor(req, res, vendorId)) return;
    const sessions = nearby.getVendorSessions(vendorId, parseInt(req.query.limit, 10) || 30);
    res.json({ success: true, sessions, count: sessions.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/my-sessions', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id || req.userId;
    const sessions = nearby.getUserSessions(userId, parseInt(req.query.limit, 10) || 20);
    res.json({ success: true, sessions, count: sessions.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/device/control', authenticateToken, async (req, res) => {
  try {
    const { deviceId, action, deviceName, deviceType, powered, payload } = req.body || {};
    if (!deviceId || !action) {
      return res.status(400).json({ success: false, error: 'deviceId and action required' });
    }
    const entry = nearby.recordDeviceControl({
      userId: req.user?.id || req.userId,
      vendorId: req.body?.vendorId || null,
      deviceId,
      action,
      deviceName,
      deviceType,
      powered,
      payload,
    });
    res.json({ success: true, entry });
  } catch (err) {
    LOG.error('[Smart] device control error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/session/end', optionalAuthenticateToken, async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.json({ success: true, disposed: false, skipped: 'no_auth' });
    }
    const result = nearby.endSession();
    res.json({ success: true, ...result });
  } catch (err) {
    LOG.error('[Smart] session end error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/session/status', authenticateToken, async (req, res) => {
  try {
    res.json({ success: true, ...nearby.getStoreStatus() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/voice/stream', authenticateToken, async (req, res) => {
  try {
    const { vendorId, sessionId, text, final, capturedAt, at, forceRecord } = req.body || {};
    if (!vendorId || !text) {
      return res.status(400).json({ success: false, error: 'vendorId and text required' });
    }
    const userId = req.user?.id || req.userId;
    nearby.recordUserOnlinePresence(userId, vendorId);
    const entry = nearby.appendVoiceTranscript({
      vendorId,
      sessionId,
      text,
      final,
      capturedAt: capturedAt || at || null,
      forceRecord: forceRecord === true || forceRecord === 'true',
      userId,
    });
    const policy = nearby.getVendorPolicy(vendorId);
    res.json({
      success: true,
      entry,
      recordingEnabled: policy.recordingEnabled !== false,
      skipped: !entry && policy.recordingEnabled === false,
    });
  } catch (err) {
    LOG.error('[Smart] voice stream error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/camera/frame', authenticateToken, async (req, res) => {
  try {
    const {
      vendorId,
      sessionId,
      imageBase64,
      width,
      height,
      savedLocally,
      eventCapture,
      liveOnly,
      eventRule,
      eventLabel,
      capturedAt,
      at,
      forceRecord,
    } = req.body || {};
    if (!vendorId || !imageBase64) {
      return res.status(400).json({ success: false, error: 'vendorId and imageBase64 required' });
    }
    const userId = req.user?.id || req.userId;
    nearby.recordUserOnlinePresence(userId, vendorId);
    const entry = await nearby.appendCameraLiveFrame({
      vendorId,
      sessionId,
      imageBase64,
      width,
      height,
      savedLocally,
      eventCapture: eventCapture === true || eventCapture === 'true',
      liveOnly: liveOnly === true || liveOnly === 'true',
      eventRule: eventRule || null,
      eventLabel: eventLabel || null,
      capturedAt: capturedAt || at || null,
      forceRecord: forceRecord === true || forceRecord === 'true',
      userId,
    });
    const policy = nearby.getVendorPolicy(vendorId);
    res.json({
      success: true,
      entry: entry
        ? { id: entry.id, at: entry.at, mysqlPersisted: entry.mysqlPersisted === true }
        : null,
      recordingEnabled: policy.recordingEnabled !== false,
      skipped: !entry && policy.recordingEnabled === false,
    });
  } catch (err) {
    LOG.error('[Smart] camera frame error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/vendor/:vendorId/camera-live', authenticateToken, async (req, res) => {
  try {
    const { vendorId } = req.params;
    if (!denyUnlessVendor(req, res, vendorId)) return;
    const eventsOnly = req.query.eventsOnly === '1' || req.query.eventsOnly === 'true';
    const frames = await nearby.getVendorCameraLive(vendorId, {
      since: req.query.since || null,
      limit: parseInt(req.query.limit, 10) || 12,
      eventsOnly,
      markDelivered: true,
    });
    const policy = nearby.getVendorPolicy(vendorId);
    res.json({
      success: true,
      frames,
      latest: frames[0] || null,
      policy: {
        recordingEnabled: policy.recordingEnabled !== false,
        cameraAiEnabled: policy.cameraAiEnabled === true,
        cameraStreamIntervalSec: policy.cameraStreamIntervalSec ?? 30,
        customerCameraPreviewHidden: policy.customerCameraPreviewHidden !== false,
      },
      bufferMs: (policy.cameraStreamIntervalSec ?? 30) * 1000,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/vendor/:vendorId/voice-stream', authenticateToken, async (req, res) => {
  try {
    const { vendorId } = req.params;
    if (!denyUnlessVendor(req, res, vendorId)) return;
    const lines = nearby.getVendorVoiceStream(vendorId, {
      since: req.query.since || null,
      limit: parseInt(req.query.limit, 10) || 80,
      markDelivered: true,
    });
    const policy = nearby.getVendorPolicy(vendorId);
    res.json({
      success: true,
      lines,
      count: lines.length,
      recordingEnabled: policy.recordingEnabled !== false,
      bufferMs: (policy.cameraStreamIntervalSec ?? 30) * 1000,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** SGATE — proximity WiFi / IR / NFC vendor gate connections */
router.post('/gate/connect', authenticateToken, async (req, res) => {
  try {
    const { vendorId, channel, networkLabel, userSide, vendorSide, connectedAt } = req.body || {};
    if (!vendorId || !channel) {
      return res.status(400).json({ success: false, error: 'vendorId and channel required' });
    }
    const userId = req.user?.id || req.userId;
    nearby.recordUserOnlinePresence(userId, vendorId);
    const existing = nearby.getUserActiveGate(userId, { markOnline: true });
    if (existing) {
      if (!existing.vendorName && existing.vendorId) {
        existing.vendorName = nearby.resolveVendorDisplayName(existing.vendorId);
      }
      const undeliveredMessages = nearby.deliverPendingMessagesForUser(userId, { markDelivered: true });
      const remoteCommands = nearby.deliverPendingRemoteCommandsForUser(userId, { markDelivered: true });
      return res.status(409).json({
        success: false,
        error: 'Already connected on SGATE',
        session: existing,
        undeliveredMessages,
        remoteCommands,
      });
    }
    const session = nearby.recordGateConnection({
      userId,
      userDisplayName: req.body?.userDisplayName || req.user?.name || null,
      vendorId,
      vendorName: req.body?.vendorName || null,
      channel,
      networkLabel,
      userSide,
      vendorSide,
      connectedAt,
    });
    const undeliveredMessages = nearby.deliverPendingMessagesForUser(userId, {
      vendorId,
      markDelivered: true,
    });
    const remoteCommands = nearby.deliverPendingRemoteCommandsForUser(userId, {
      vendorId,
      markDelivered: true,
    });
    res.json({ success: true, session, undeliveredMessages, remoteCommands });
  } catch (err) {
    LOG.error('[Smart] gate connect error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/gate/heartbeat', authenticateToken, async (req, res) => {
  try {
    const { sessionId, inRange, match, gateOpen, vendorListening } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'sessionId required' });
    }
    const userId = req.user?.id || req.userId;
    const session = nearby.updateGateHeartbeat(sessionId, { inRange, match, gateOpen, vendorListening });
    if (!session) {
      nearby.recordUserOnlinePresence(userId);
      return res.status(404).json({ success: false, error: 'Gate session not found' });
    }
    nearby.recordUserOnlinePresence(userId, session.vendorId);
    const undeliveredMessages = nearby.deliverPendingMessagesForUser(userId, {
      vendorId: session.vendorId,
      markDelivered: true,
    });
    const remoteCommands = nearby.deliverPendingRemoteCommandsForUser(userId, {
      vendorId: session.vendorId,
      markDelivered: true,
    });
    res.json({ success: true, session, undeliveredMessages, remoteCommands });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/gate/disconnect', authenticateToken, async (req, res) => {
  try {
    const { sessionId, reason } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'sessionId required' });
    }
    const session = nearby.endGateConnection(sessionId, reason || 'manual');
    if (!session) {
      return res.status(404).json({ success: false, error: 'Gate session not found' });
    }
    res.json({ success: true, session });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/gate/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id || req.userId;
    const session = nearby.getUserActiveGate(userId, { markOnline: true });
    if (session && !session.vendorName && session.vendorId) {
      session.vendorName = nearby.resolveVendorDisplayName(session.vendorId);
    }
    const undeliveredMessages = nearby.deliverPendingMessagesForUser(userId, { markDelivered: true });
    const remoteCommands = nearby.deliverPendingRemoteCommandsForUser(userId, { markDelivered: true });
    const pendingInvites = nearby.listPendingInvitesForUser(userId);
    const mobileState = nearby.getUserMobileState(userId, session?.vendorId || null);
    const vendorPolicy = nearby.getVendorPolicy(session?.vendorId || mobileState?.vendorId || 'v_smart1');
    res.json({
      success: true,
      session,
      connected: !!session,
      undeliveredMessages,
      remoteCommands,
      pendingInvites,
      mobileState,
      vendorPolicy: {
        vendorId: vendorPolicy.vendorId,
        recordingEnabled: vendorPolicy.recordingEnabled !== false,
        cameraStreamIntervalSec: vendorPolicy.cameraStreamIntervalSec ?? 30,
        dataRetentionDays: vendorPolicy.dataRetentionDays ?? 1,
        storeOfflineUntilOnline: vendorPolicy.storeOfflineUntilOnline !== false,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/vendor/:vendorId/voice-listen', authenticateToken, async (req, res) => {
  try {
    const { vendorId } = req.params;
    if (!denyUnlessVendor(req, res, vendorId)) return;
    const listening =
      req.body?.listening != null
        ? !!req.body.listening
        : req.body?.active != null
          ? !!req.body.active
          : true;
    const result = nearby.setVendorVoiceListen(vendorId, listening);
    recordBackendFeatureScan('smart_scan', 'voice_listen', `Vendor listen=${listening} sessions=${result.updated}`, {
      vendorId,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/vendor/:vendorId/live-refresh', authenticateToken, async (req, res) => {
  try {
    const { vendorId } = req.params;
    if (!denyUnlessVendor(req, res, vendorId)) return;
    const result = nearby.requestVendorLiveRefresh(vendorId);
    recordBackendFeatureScan(
      'smart_scan',
      'vendor_live_refresh',
      `Vendor live refresh sessions=${result.updated}`,
      { vendorId }
    );
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/vendor/:vendorId/clear-live-media', authenticateToken, async (req, res) => {
  try {
    const { vendorId } = req.params;
    if (!denyUnlessVendor(req, res, vendorId)) return;
    const result = await nearby.clearVendorLiveMedia(vendorId);
    recordBackendFeatureScan('smart_scan', 'vendor_clear_live_media', 'Vendor cleared mic + camera buffers', {
      vendorId,
      voiceRemoved: result.voiceRemoved,
      cameraRemoved: result.cameraRemoved,
      mysqlCamera: result.mysql?.camera,
      mysqlVoice: result.mysql?.voice,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    LOG.error('[Smart] clear-live-media error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Vendor → user SGATE connect invite (alert on user app + accept = auto link) */
router.post('/vendor/:vendorId/connect-invite', authenticateToken, async (req, res) => {
  try {
    const { vendorId } = req.params;
    if (!denyUnlessVendor(req, res, vendorId)) return;
    const body = req.body || {};
    let target = nearby.findUserByTarget(body);
    if (!target?.id && (body.mobile || body.email)) {
      try {
        const pool = typeof db.getPool === 'function' ? db.getPool() : null;
        if (pool) {
          const phone = String(body.mobile || '').replace(/\D/g, '').slice(-10);
          const em = String(body.email || '').trim().toLowerCase();
          let rows = [];
          if (phone) {
            [rows] = await pool.query(
              'SELECT id, name, email, mobile FROM users WHERE REPLACE(mobile, " ", "") LIKE ? LIMIT 1',
              [`%${phone}`]
            );
          } else if (em) {
            [rows] = await pool.query(
              'SELECT id, name, email, mobile FROM users WHERE LOWER(email) = ? LIMIT 1',
              [em]
            );
          }
          if (rows?.[0]) target = rows[0];
        }
      } catch (lookupErr) {
        LOG.warning('[Smart] connect-invite user lookup:', lookupErr.message);
      }
    }
    if (!target?.id) {
      return res.status(404).json({ success: false, error: 'User not found for that mobile/email' });
    }
    const invite = nearby.createConnectInvite(vendorId, {
      ...body,
      userId: target.id,
      targetUserName: target.name || target.email,
      email: target.email,
      mobile: target.mobile,
    });
    const notificationService = require('../services/notificationService');
    await notificationService.notify('smart_connect_request', {
      targetUserId: target.id,
      userId: target.id,
      vendorId,
      vendorName: invite.vendorName,
      inviteId: invite.id,
      message: invite.message,
      title: `${invite.vendorName} — connect on SGATE`,
    });
    res.json({ success: true, invite, userOnline: nearby.isUserOnline(target.id, vendorId) });
  } catch (err) {
    LOG.error('[Smart] connect-invite error:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

/** Vendor → user direct connect (bypasses proximity gate; auto-links if user is logged in, queues for online delivery if offline) */
router.post('/vendor/:vendorId/direct-connect', authenticateToken, async (req, res) => {
  try {
    const { vendorId } = req.params;
    if (!denyUnlessVendor(req, res, vendorId)) return;
    const body = req.body || {};
    let target = nearby.findUserByTarget(body);
    if (!target?.id && (body.mobile || body.email)) {
      try {
        const pool = typeof db.getPool === 'function' ? db.getPool() : null;
        if (pool) {
          const phone = String(body.mobile || '').replace(/\D/g, '').slice(-10);
          const em = String(body.email || '').trim().toLowerCase();
          let rows = [];
          if (phone) {
            [rows] = await pool.query(
              'SELECT id, name, email, mobile FROM users WHERE REPLACE(mobile, " ", "") LIKE ? LIMIT 1',
              [`%${phone}`]
            );
          } else if (em) {
            [rows] = await pool.query(
              'SELECT id, name, email, mobile FROM users WHERE LOWER(email) = ? LIMIT 1',
              [em]
            );
          }
          if (rows?.[0]) target = rows[0];
        }
      } catch (lookupErr) {
        LOG.warning('[Smart] direct-connect user lookup:', lookupErr.message);
      }
    }
    const userId = target?.id || body.userId;
    if (!userId) {
      return res.status(404).json({ success: false, error: 'User not found — enter valid customer mobile, email or user id' });
    }
    const userOnline = nearby.isUserOnline(userId, vendorId);
    const session = nearby.directConnectVendorUser({
      vendorId,
      userId,
      mobile: body.mobile || target?.mobile,
      email: body.email || target?.email,
      userDisplayName: target?.name || body.userDisplayName,
      message: body.message,
    });
    try {
      const notificationService = require('../services/notificationService');
      await notificationService.notify('smart_connect_request', {
        targetUserId: userId,
        userId,
        vendorId,
        vendorName: session.vendorName,
        sessionId: session.id,
        message:
          body.message ||
          `${session.vendorName || 'Vendor'} connected directly for live mic & camera.`,
        title: `${session.vendorName || 'Vendor'} connected`,
      });
    } catch (_) {}
    res.json({
      success: true,
      session,
      userOnline,
      queuedForOnlineDelivery: !userOnline,
    });
  } catch (err) {
    LOG.error('[Smart] direct-connect error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Vendor → user message stored per vendor retention policy until user is online */
router.post('/vendor/:vendorId/message', authenticateToken, async (req, res) => {
  try {
    const { vendorId } = req.params;
    if (!denyUnlessVendor(req, res, vendorId)) return;
    const body = req.body || {};
    let target = nearby.findUserByTarget(body);
    if (!target?.id && (body.mobile || body.email)) {
      try {
        const pool = typeof db.getPool === 'function' ? db.getPool() : null;
        if (pool) {
          const phone = String(body.mobile || '').replace(/\D/g, '').slice(-10);
          const em = String(body.email || '').trim().toLowerCase();
          let rows = [];
          if (phone) {
            [rows] = await pool.query(
              'SELECT id, name, email, mobile FROM users WHERE REPLACE(mobile, " ", "") LIKE ? LIMIT 1',
              [`%${phone}`]
            );
          } else if (em) {
            [rows] = await pool.query(
              'SELECT id, name, email, mobile FROM users WHERE LOWER(email) = ? LIMIT 1',
              [em]
            );
          }
          if (rows?.[0]) target = rows[0];
        }
      } catch (lookupErr) {
        LOG.warning('[Smart] vendor message user lookup:', lookupErr.message);
      }
    }
    const userId = target?.id || body.userId;
    if (!userId) {
      return res.status(404).json({ success: false, error: 'Target customer not found' });
    }
    if (!body.message || !String(body.message).trim()) {
      return res.status(400).json({ success: false, error: 'message is required' });
    }
    const result = nearby.sendVendorMessageToUser({
      vendorId,
      userId,
      title: body.title,
      message: body.message,
      payload: body.payload,
    });
    const entry = result?.item || result?.message || result;
    const userOnline = result?.userOnline ?? nearby.isUserOnline(userId, vendorId);
    try {
      const notificationService = require('../services/notificationService');
      await notificationService.notify('smart_vendor_message', {
        targetUserId: userId,
        userId,
        vendorId,
        vendorName: entry?.vendorName,
        messageId: entry?.id,
        message: entry?.message,
        title: entry?.title,
      });
    } catch (_) {}
    res.json({
      success: true,
      item: entry,
      message: entry,
      userOnline,
      online: userOnline,
    });
  } catch (err) {
    LOG.error('[Smart] vendor message error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/messages/undelivered', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id || req.userId;
    const markDelivered = req.query.ack !== '0' && req.query.ack !== 'false';
    const messages = nearby.deliverPendingMessagesForUser(userId, {
      vendorId: req.query.vendorId || null,
      markDelivered,
    });
    res.json({ success: true, messages, count: messages.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/messages/ack', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id || req.userId;
    const { messageIds } = req.body || {};
    const result = nearby.ackUndeliveredMessagesForUser(userId, messageIds || []);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Vendor → user remote mobile control (wakes & operates user mobile from idle mode based on requirement) */
router.post('/vendor/:vendorId/mobile-control', authenticateToken, async (req, res) => {
  try {
    const { vendorId } = req.params;
    if (!denyUnlessVendor(req, res, vendorId)) return;
    const body = req.body || {};
    let target = nearby.findUserByTarget(body);
    if (!target?.id && (body.mobile || body.email)) {
      try {
        const pool = typeof db.getPool === 'function' ? db.getPool() : null;
        if (pool) {
          const phone = String(body.mobile || '').replace(/\D/g, '').slice(-10);
          const em = String(body.email || '').trim().toLowerCase();
          let rows = [];
          if (phone) {
            [rows] = await pool.query(
              'SELECT id, name, email, mobile FROM users WHERE REPLACE(mobile, " ", "") LIKE ? LIMIT 1',
              [`%${phone}`]
            );
          } else if (em) {
            [rows] = await pool.query(
              'SELECT id, name, email, mobile FROM users WHERE LOWER(email) = ? LIMIT 1',
              [em]
            );
          }
          if (rows?.[0]) target = rows[0];
        }
      } catch (lookupErr) {
        LOG.warning('[Smart] mobile-control user lookup:', lookupErr.message);
      }
    }
    const userId = target?.id || body.userId;
    if (!userId) {
      return res.status(404).json({ success: false, error: 'Target customer not found' });
    }
    const result = nearby.sendVendorRemoteCommand({
      vendorId,
      userId,
      mobile: body.mobile || target?.mobile,
      email: body.email || target?.email,
      command: body.command || body.action,
      params: body.params || body.payload || {},
    });
    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    LOG.error('[Smart] mobile-control error:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/mobile-control/pending', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id || req.userId;
    const markDelivered = req.query.ack !== '0' && req.query.ack !== 'false';
    const commands = nearby.deliverPendingRemoteCommandsForUser(userId, {
      vendorId: req.query.vendorId || null,
      markDelivered,
    });
    const mobileState = nearby.getUserMobileState(userId, req.query.vendorId || null);
    res.json({
      success: true,
      commands,
      count: commands.length,
      mobileState,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/mobile-control/ack', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id || req.userId;
    const { commandIds, mobileState } = req.body || {};
    const result = nearby.ackUserRemoteCommands(userId, commandIds || [], mobileState || null);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/vendor/:vendorId/connect-link', authenticateToken, async (req, res) => {
  try {
    const { vendorId } = req.params;
    if (!denyUnlessVendor(req, res, vendorId)) return;
    const forceNew = req.query.renew === '1' || req.query.renew === 'true';
    const link = nearby.getOrCreateVendorConnectLink(vendorId, {
      message: req.query.message,
      forceNew,
    });
    res.json({ success: true, link });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/connect/join', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id || req.userId;
    const body = req.body || {};
    const result = nearby.joinVendorConnectLink(body.code || body.linkCode, userId, {
      userDisplayName: body.userDisplayName || req.user?.name || null,
      vendorId: body.vendorId || null,
    });
    const undeliveredMessages = nearby.deliverPendingMessagesForUser(userId, {
      vendorId: result?.session?.vendorId || body.vendorId || null,
      markDelivered: true,
    });
    res.json({ success: true, ...result, undeliveredMessages });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/connect-invites/pending', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id || req.userId;
    nearby.recordUserOnlinePresence(userId);
    const invites = nearby.listPendingInvitesForUser(userId);
    const undeliveredMessages = nearby.deliverPendingMessagesForUser(userId, { markDelivered: true });
    res.json({
      success: true,
      invites,
      count: invites.length,
      undeliveredMessages,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/connect-invites/:inviteId/accept', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id || req.userId;
    const result = nearby.acceptConnectInvite(req.params.inviteId, userId, {
      userDisplayName: req.body?.userDisplayName || req.user?.name || null,
    });
    const undeliveredMessages = nearby.deliverPendingMessagesForUser(userId, {
      vendorId: result?.session?.vendorId || null,
      markDelivered: true,
    });
    res.json({ success: true, ...result, undeliveredMessages });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/connect-invites/:inviteId/decline', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id || req.userId;
    const invite = nearby.declineConnectInvite(req.params.inviteId, userId);
    res.json({ success: true, invite });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/vendor/:vendorId/gate-sessions', authenticateToken, async (req, res) => {
  try {
    const { vendorId } = req.params;
    if (!denyUnlessVendor(req, res, vendorId)) return;
    const activeOnly = req.query.active === '1' || req.query.active === 'true';
    const sessions = nearby.getVendorGateSessions(vendorId, {
      activeOnly,
      limit: parseInt(req.query.limit, 10) || 40,
    });
    res.json({ success: true, sessions, count: sessions.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
