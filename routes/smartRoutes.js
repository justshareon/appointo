/**
 * Cyber Nearby API — WiFi/BLE/infra scans, vendor opt-in sharing.
 */
const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');
const nearby = require('../services/smartService');
const nearbyMem = require('../services/smartMemoryStore');
const LOG = require('../utils/logger');

router.use(async (req, res, next) => {
  try {
    if (typeof db.ensureSmartUsersAndVendor === 'function') {
      await db.ensureSmartUsersAndVendor();
    }
  } catch (err) {
    LOG.warning('[Smart] ensureSmartUsersAndVendor:', err.message);
  }
  next();
});

router.use(nearbyMem.middleware());

router.get('/vendors', authenticateToken, async (req, res) => {
  try {
    const vendors = await nearby.listNearbyVendors({
      city: req.query.city || '',
      lat: req.query.lat ? parseFloat(req.query.lat) : null,
      lng: req.query.lng ? parseFloat(req.query.lng) : null,
    });
    res.json({ success: true, vendors, count: vendors.length });
  } catch (err) {
    LOG.error('[Smart] vendors error:', err.message);
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
    const policy = nearby.setVendorPolicy(req.params.vendorId, req.body || {});
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
    res.json({ success: true, sessionId: session.id });
  } catch (err) {
    LOG.error('[Smart] scan post error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/vendor/:vendorId/sessions', authenticateToken, async (req, res) => {
  try {
    const sessions = nearby.getVendorSessions(req.params.vendorId, parseInt(req.query.limit, 10) || 30);
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
    const { deviceId, action, deviceName, deviceType, powered } = req.body || {};
    if (!deviceId || !action) {
      return res.status(400).json({ success: false, error: 'deviceId and action required' });
    }
    const entry = nearby.recordDeviceControl({
      userId: req.user?.id || req.userId,
      deviceId,
      action,
      deviceName,
      deviceType,
      powered,
    });
    res.json({ success: true, entry });
  } catch (err) {
    LOG.error('[Smart] device control error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/session/end', authenticateToken, async (req, res) => {
  try {
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

router.get('/vendor/:vendorId/voice-stream', authenticateToken, async (req, res) => {
  try {
    const lines = nearby.getVendorVoiceStream(req.params.vendorId, {
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
      return res.status(409).json({ success: false, error: 'Already connected on SGATE', session: existing });
    }
    const session = nearby.recordGateConnection({
      userId,
      vendorId,
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
    const { sessionId, inRange, match } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'sessionId required' });
    }
    const session = nearby.updateGateHeartbeat(sessionId, { inRange, match });
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
    res.json({ success: true, session, connected: !!session });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/vendor/:vendorId/gate-sessions', authenticateToken, async (req, res) => {
  try {
    const activeOnly = req.query.active === '1' || req.query.active === 'true';
    const sessions = nearby.getVendorGateSessions(req.params.vendorId, {
      activeOnly,
      limit: parseInt(req.query.limit, 10) || 40,
    });
    res.json({ success: true, sessions, count: sessions.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
