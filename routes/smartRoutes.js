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
    const session = nearby.recordScanSession({
      userId: req.user?.id || req.userId,
      vendorId,
      sharedWithVendor,
      consent,
      scan,
      location,
    });
    recordBackendFeatureScan('smart_scan', 'scan_saved', 'SMART scan session recorded', {
      userId: req.user?.id || req.userId,
      vendorId,
      sharedWithVendor: !!sharedWithVendor,
    });
    res.json({ success: true, sessionId: session.id });
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
    const { vendorId, sessionId, text, final } = req.body || {};
    if (!vendorId || !text) {
      return res.status(400).json({ success: false, error: 'vendorId and text required' });
    }
    const entry = nearby.appendVoiceTranscript({
      vendorId,
      sessionId,
      text,
      final,
      userId: req.user?.id || req.userId,
    });
    res.json({ success: true, entry });
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
    } = req.body || {};
    if (!vendorId || !imageBase64) {
      return res.status(400).json({ success: false, error: 'vendorId and imageBase64 required' });
    }
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
      userId: req.user?.id || req.userId,
    });
    res.json({
      success: true,
      entry: entry
        ? { id: entry.id, at: entry.at, mysqlPersisted: entry.mysqlPersisted === true }
        : null,
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
    });
    const policy = nearby.getVendorPolicy(vendorId);
    res.json({
      success: true,
      frames,
      latest: frames[0] || null,
      policy: { cameraAiEnabled: policy.cameraAiEnabled === true },
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
    });
    res.json({ success: true, lines, count: lines.length });
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
    const existing = nearby.getUserActiveGate(userId);
    if (existing) {
      if (!existing.vendorName && existing.vendorId) {
        existing.vendorName = nearby.resolveVendorDisplayName(existing.vendorId);
      }
      return res.status(409).json({ success: false, error: 'Already connected on SGATE', session: existing });
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
    res.json({ success: true, session });
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
    const session = nearby.updateGateHeartbeat(sessionId, { inRange, match, gateOpen, vendorListening });
    if (!session) {
      return res.status(404).json({ success: false, error: 'Gate session not found' });
    }
    res.json({ success: true, session });
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
    const session = nearby.getUserActiveGate(userId);
    if (session && !session.vendorName && session.vendorId) {
      session.vendorName = nearby.resolveVendorDisplayName(session.vendorId);
    }
    res.json({ success: true, session, connected: !!session });
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
    res.json({ success: true, invite });
  } catch (err) {
    LOG.error('[Smart] connect-invite error:', err.message);
    res.status(400).json({ success: false, error: err.message });
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
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/connect-invites/pending', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id || req.userId;
    const invites = nearby.listPendingInvitesForUser(userId);
    res.json({ success: true, invites, count: invites.length });
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
    res.json({ success: true, ...result });
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
