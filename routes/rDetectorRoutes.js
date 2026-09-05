const express = require('express');
const router = express.Router();
const rDetectorService = require('../services/rDetectorService');
const commuteService = require('../services/rDetectorCommuteService');
const { authenticateToken } = require('../middleware/auth');
const LOG = require('../utils/logger');

let io = null;
const setIO = (ioInstance) => {
  io = ioInstance;
};

/**
 * GET /api/r-detector/cities
 */
router.get('/cities', authenticateToken, async (req, res) => {
  try {
    const cities = await rDetectorService.getCities();
    res.json(cities);
  } catch (err) {
    LOG.error('[R-Detector] cities', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/r-detector/incident-types
 */
router.get('/incident-types', authenticateToken, async (req, res) => {
  try {
    res.json(rDetectorService.incidentTypes());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/r-detector/types?city=
 */
router.get('/types', authenticateToken, async (req, res) => {
  try {
    const types = await rDetectorService.getTypeCounts({ city: req.query.city || null });
    res.json(types);
  } catch (err) {
    LOG.error('[R-Detector] types', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/r-detector/incidents/grouped?city=&type=
 */
router.get('/incidents/grouped', authenticateToken, async (req, res) => {
  try {
    const city = req.query.city || null;
    const type = req.query.type || null;
    const limit = parseInt(req.query.limit, 10) || 100;
    const grouped = await rDetectorService.getGroupedIncidents({ city, type, limit });
    res.json(grouped);
  } catch (err) {
    LOG.error('[R-Detector] grouped incidents', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/r-detector/incidents?city=&type=&limit=
 */
router.get('/incidents', authenticateToken, async (req, res) => {
  try {
    const city = req.query.city || null;
    const type = req.query.type || null;
    const limit = parseInt(req.query.limit, 10) || 100;
    const incidents = await rDetectorService.getIncidents({ city, type, limit });
    res.json(incidents);
  } catch (err) {
    LOG.error('[R-Detector] incidents', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/r-detector/incidents/report
 */
router.post('/incidents/report', authenticateToken, async (req, res) => {
  try {
    const lat = parseFloat(req.body.latitude);
    const lng = parseFloat(req.body.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'latitude and longitude are required' });
    }
    const result = await rDetectorService.reportIncident(req.user.id, {
      incident_type: req.body.incident_type || req.body.type,
      latitude: lat,
      longitude: lng,
      description: req.body.description,
      city: req.body.city,
      image_url: req.body.image_url,
    });
    if (io) {
      io.emit('rdetector_incident_created', {
        driver_id: req.user.id,
        hazard_id: result.hazard_id,
        report_category: result.report_category,
        location: { latitude: lat, longitude: lng },
      });
    }
    res.json(result);
  } catch (err) {
    LOG.error('[R-Detector] report incident', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/r-detector/commute/activity — record GPS ping / trip start for route learning
 */
router.post('/commute/activity', authenticateToken, async (req, res) => {
  try {
    const result = await commuteService.recordActivity(req.user.id, req.body);
    res.json(result);
  } catch (err) {
    LOG.error('[R-Detector] commute activity', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/r-detector/commute/schedules — learned weekday departure patterns
 */
router.get('/commute/schedules', authenticateToken, async (req, res) => {
  try {
    const schedules = await commuteService.getSchedules(req.user.id);
    res.json({ schedules });
  } catch (err) {
    LOG.error('[R-Detector] commute schedules', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/r-detector/commute/pre-departure — hazards on route 10 min before learned departure
 */
router.get('/commute/pre-departure', authenticateToken, async (req, res) => {
  try {
    const brief = await commuteService.getPreDepartureBrief(req.user.id);
    res.json(brief);
  } catch (err) {
    LOG.error('[R-Detector] pre-departure', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/r-detector/commute/preferences — user commute times (default 8:30 AM / 7:30 PM)
 */
router.get('/commute/preferences', authenticateToken, async (req, res) => {
  try {
    const preferences = await commuteService.getPreferences(req.user.id);
    res.json({ success: true, preferences });
  } catch (err) {
    LOG.error('[R-Detector] commute preferences get', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/r-detector/commute/preferences
 */
router.post('/commute/preferences', authenticateToken, async (req, res) => {
  try {
    const preferences = await commuteService.savePreferences(req.user.id, req.body || {});
    res.json({ success: true, preferences });
  } catch (err) {
    LOG.error('[R-Detector] commute preferences save', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/r-detector/incidents/:id
 */
router.get('/incidents/:id', authenticateToken, async (req, res) => {
  try {
    const detail = await rDetectorService.getIncidentDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Incident not found' });
    res.json(detail);
  } catch (err) {
    LOG.error('[R-Detector] incident detail', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/r-detector/bad-road/nearby
 */
router.get('/bad-road/nearby', authenticateToken, async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'lat and lng required' });
    }
    const info = await rDetectorService.getBadRoadNearby(lat, lng, req.user?.id);
    res.json(info);
  } catch (err) {
    LOG.error('[R-Detector] bad-road nearby', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/r-detector/bad-road/probe
 */
router.post('/bad-road/probe', authenticateToken, async (req, res) => {
  try {
    const lat = parseFloat(req.body.latitude);
    const lng = parseFloat(req.body.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'latitude and longitude required' });
    }
    const result = await rDetectorService.reportBadRoadProbe(req.user.id, {
      latitude: lat,
      longitude: lng,
      speed_kmh: req.body.speed_kmh,
      confidence: req.body.confidence,
      confirmed: req.body.confirmed !== false,
      auto_detected: req.body.auto_detected,
      issue_type: req.body.issue_type || 'pothole',
      severity: req.body.severity || 'medium',
    });
    if (io && result.confirmed) {
      io.emit('rdetector_bad_road_probe', {
        driver_id: req.user.id,
        hazard_id: result.hazard_id,
        reporter_count: result.reporter_count,
        threshold: result.threshold,
        incident_created: result.incident_created,
        issue_type: result.issue_type || req.body.issue_type || 'pothole',
        severity: result.severity || req.body.severity || 'medium',
        location: { latitude: lat, longitude: lng },
        rounded_lat: result.rounded_lat,
        rounded_lng: result.rounded_lng,
      });
    }
    if (io && result.incident_created) {
      io.emit('rdetector_incident_created', {
        driver_id: req.user.id,
        hazard_id: result.hazard_id,
        location: { latitude: lat, longitude: lng },
      });
    }
    res.json(result);
  } catch (err) {
    LOG.error('[R-Detector] bad-road probe', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/r-detector/scan-results — save confirmed scan (user tapped Yes)
 */
router.post('/scan-results', authenticateToken, async (req, res) => {
  try {
    const lat = parseFloat(req.body.latitude);
    const lng = parseFloat(req.body.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'latitude and longitude required' });
    }
    const result = await rDetectorService.saveScanResult(req.user.id, {
      latitude: lat,
      longitude: lng,
      speed_kmh: req.body.speed_kmh,
      confidence: req.body.confidence,
      issue_type: req.body.issue_type || 'bad_road',
      hazard_id: req.body.hazard_id,
      scan_date: req.body.scan_date,
    });
    res.json(result);
  } catch (err) {
    LOG.error('[R-Detector] save scan result', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/r-detector/scan-results/today
 */
router.get('/scan-results/today', authenticateToken, async (req, res) => {
  try {
    const rows = await rDetectorService.getTodayScanResults(req.user.id);
    res.json(rows);
  } catch (err) {
    LOG.error('[R-Detector] today scan results', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/incidents/:id/vote', authenticateToken, async (req, res) => {
  try {
    const vote = req.body.vote || 'upvote';
    const result = await rDetectorService.voteIncident(req.params.id, req.user.id, vote);
    res.json(result);
  } catch (err) {
    LOG.error('[R-Detector] vote', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/incidents/:id/votes', authenticateToken, async (req, res) => {
  try {
    const result = await rDetectorService.getIncidentVotes(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/heat', authenticateToken, async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'lat and lng required' });
    }
    const rows = await rDetectorService.getHeatIncidents({
      lat,
      lng,
      radiusKm: parseFloat(req.query.radiusKm) || 5,
    });
    res.json(rows);
  } catch (err) {
    LOG.error('[R-Detector] heat', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/reporter-stats', authenticateToken, async (req, res) => {
  try {
    const stats = await rDetectorService.getReporterStats(req.user.id);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, setIO };
