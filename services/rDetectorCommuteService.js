/**
 * R-Detector commute learning — daily route patterns + pre-departure hazard briefs.
 * Stores user activity in DB; alerts only in 10-min window before learned departure.
 */
const db = require('../database');
const LOG = require('../utils/logger');
const rDetectorService = require('./rDetectorService');

const ALERT_LEAD_MINUTES = 10;
const ALERT_GRACE_MINUTES = 5;
const MIN_TRIPS_FOR_SCHEDULE = 3;
const TIME_CLUSTER_MINUTES = 25;
const ORIGIN_RADIUS_M = 600;

function getPool() {
  if (db.getType() !== 'mysql') return null;
  return db.getPool() || null;
}

function mem() {
  if (!db.inMemoryDb) db.inMemoryDb = {};
  if (!db.inMemoryDb.r_detector_activity_pings) db.inMemoryDb.r_detector_activity_pings = [];
  if (!db.inMemoryDb.r_detector_commute_trips) db.inMemoryDb.r_detector_commute_trips = [];
  if (!db.inMemoryDb.r_detector_commute_routes) db.inMemoryDb.r_detector_commute_routes = [];
  if (!db.inMemoryDb.r_detector_commute_schedules) db.inMemoryDb.r_detector_commute_schedules = [];
  return db.inMemoryDb;
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function roundCell(lat, lng, precision = 3) {
  const f = 10 ** precision;
  return {
    lat: Math.round(Number(lat) * f) / f,
    lng: Math.round(Number(lng) * f) / f,
  };
}

function minutesOfDay(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

function formatTime(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function median(nums) {
  const arr = [...nums].sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
}

async function ensureCommuteTables() {
  let pool = getPool();
  if (!pool) {
    try {
      const featureConnectionManager = require('../database/featureConnectionManager');
      pool = await featureConnectionManager.acquireForSync('core');
    } catch {
      pool = null;
    }
  }
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS r_detector_activity_pings (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      latitude DECIMAL(10,7) NOT NULL,
      longitude DECIMAL(10,7) NOT NULL,
      speed_kmh DECIMAL(6,2) DEFAULT 0,
      day_of_week TINYINT NOT NULL,
      recorded_at DATETIME NOT NULL,
      INDEX idx_user_day (user_id, day_of_week, recorded_at)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS r_detector_commute_trips (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      day_of_week TINYINT NOT NULL,
      departure_minutes SMALLINT NOT NULL,
      origin_lat DECIMAL(10,7) NOT NULL,
      origin_lng DECIMAL(10,7) NOT NULL,
      dest_lat DECIMAL(10,7) NULL,
      dest_lng DECIMAL(10,7) NULL,
      direction ENUM('outbound','inbound','unknown') DEFAULT 'unknown',
      recorded_at DATETIME NOT NULL,
      INDEX idx_user_trip (user_id, day_of_week, departure_minutes)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS r_detector_commute_routes (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      label VARCHAR(120) DEFAULT 'Daily route',
      origin_lat DECIMAL(10,7) NOT NULL,
      origin_lng DECIMAL(10,7) NOT NULL,
      dest_lat DECIMAL(10,7) NOT NULL,
      dest_lng DECIMAL(10,7) NOT NULL,
      direction ENUM('outbound','inbound') NOT NULL,
      sample_count INT DEFAULT 0,
      confidence DECIMAL(4,2) DEFAULT 0.5,
      active TINYINT DEFAULT 1,
      last_seen_at DATETIME NULL,
      UNIQUE KEY uniq_route (user_id, direction, origin_lat, origin_lng, dest_lat, dest_lng)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS r_detector_commute_schedules (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      route_id BIGINT NULL,
      day_of_week TINYINT NOT NULL,
      departure_minutes SMALLINT NOT NULL,
      alert_lead_minutes TINYINT DEFAULT 10,
      direction ENUM('outbound','inbound') NOT NULL,
      origin_lat DECIMAL(10,7) NOT NULL,
      origin_lng DECIMAL(10,7) NOT NULL,
      dest_lat DECIMAL(10,7) NOT NULL,
      dest_lng DECIMAL(10,7) NOT NULL,
      confidence DECIMAL(4,2) DEFAULT 0.5,
      source ENUM('inferred','manual') DEFAULT 'inferred',
      active TINYINT DEFAULT 1,
      last_alert_at DATETIME NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_schedule (user_id, day_of_week, direction, departure_minutes)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS r_detector_commute_preferences (
      user_id VARCHAR(64) PRIMARY KEY,
      morning_departure_minutes SMALLINT DEFAULT 510,
      evening_departure_minutes SMALLINT DEFAULT 1170,
      morning_enabled TINYINT DEFAULT 1,
      evening_enabled TINYINT DEFAULT 1,
      alert_lead_minutes TINYINT DEFAULT 10,
      auto_scan_enabled TINYINT DEFAULT 1,
      home_lat DECIMAL(10,7) NULL,
      home_lng DECIMAL(10,7) NULL,
      work_lat DECIMAL(10,7) NULL,
      work_lng DECIMAL(10,7) NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

function defaultPreferences(userId) {
  return {
    user_id: String(userId),
    morning_departure_minutes: 510,
    evening_departure_minutes: 1170,
    morning_enabled: 1,
    evening_enabled: 1,
    alert_lead_minutes: ALERT_LEAD_MINUTES,
    auto_scan_enabled: 1,
    home_lat: null,
    home_lng: null,
    work_lat: null,
    work_lng: null,
  };
}

function parsePrefsRow(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    morningDepartureMinutes: Number(row.morning_departure_minutes ?? 510),
    eveningDepartureMinutes: Number(row.evening_departure_minutes ?? 1170),
    morningEnabled: row.morning_enabled !== 0,
    eveningEnabled: row.evening_enabled !== 0,
    alertLeadMinutes: Number(row.alert_lead_minutes ?? ALERT_LEAD_MINUTES),
    autoScanEnabled: row.auto_scan_enabled !== 0,
    home: row.home_lat != null ? { latitude: Number(row.home_lat), longitude: Number(row.home_lng) } : null,
    work: row.work_lat != null ? { latitude: Number(row.work_lat), longitude: Number(row.work_lng) } : null,
    morningLabel: formatTime(Number(row.morning_departure_minutes ?? 510)),
    eveningLabel: formatTime(Number(row.evening_departure_minutes ?? 1170)),
  };
}

function buildManualSchedules(userId, prefs, inferred = []) {
  const p = prefs || defaultPreferences(userId);
  const outbound = inferred.find((s) => s.direction === 'outbound');
  const inbound = inferred.find((s) => s.direction === 'inbound');
  const home = p.home || outbound?.origin || { latitude: 18.52, longitude: 73.85 };
  const work = p.work || outbound?.destination || inbound?.origin || { latitude: 18.56, longitude: 73.92 };
  const schedules = [];
  for (let day = 0; day <= 6; day += 1) {
    if (p.morningEnabled !== false) {
      schedules.push({
        id: `manual_am_${day}`,
        dayOfWeek: day,
        departureMinutes: p.morningDepartureMinutes ?? 510,
        departureLabel: formatTime(p.morningDepartureMinutes ?? 510),
        alertLeadMinutes: p.alertLeadMinutes ?? ALERT_LEAD_MINUTES,
        direction: 'outbound',
        origin: home,
        destination: work,
        confidence: 0.85,
        source: 'manual',
      });
    }
    if (p.eveningEnabled !== false) {
      schedules.push({
        id: `manual_pm_${day}`,
        dayOfWeek: day,
        departureMinutes: p.eveningDepartureMinutes ?? 1170,
        departureLabel: formatTime(p.eveningDepartureMinutes ?? 1170),
        alertLeadMinutes: p.alertLeadMinutes ?? ALERT_LEAD_MINUTES,
        direction: 'inbound',
        origin: work,
        destination: home,
        confidence: 0.85,
        source: 'manual',
      });
    }
  }
  return schedules;
}

function incidentsAlongRoute(origin, dest, incidents, corridorM = 350) {
  const patches = [];
  (incidents || []).forEach((inc) => {
    const lat = Number(inc.latitude ?? inc.lat);
    const lng = Number(inc.longitude ?? inc.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const dOrigin = haversineM(origin.lat, origin.lng, lat, lng);
    const dDest = haversineM(dest.lat, dest.lng, lat, lng);
    const routeLen = haversineM(origin.lat, origin.lng, dest.lat, dest.lng) || 1;
    const approxAlong = Math.min(dOrigin, dDest);
    if (approxAlong <= corridorM * 3 || dOrigin + dDest <= routeLen + corridorM * 2) {
      patches.push({
        ...inc,
        distance_m: Math.round(Math.min(dOrigin, dDest)),
      });
    }
  });
  return patches.sort((a, b) => (a.distance_m || 0) - (b.distance_m || 0)).slice(0, 12);
}

const commuteService = {
  ensureCommuteTables,

  async recordActivity(userId, payload = {}) {
    await ensureCommuteTables();
    const lat = Number(payload.latitude);
    const lng = Number(payload.longitude);
    if (!userId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { ok: false, error: 'invalid_coords' };
    }

    const recordedAt = payload.recorded_at ? new Date(payload.recorded_at) : new Date();
    const dayOfWeek = recordedAt.getDay();
    const speed = Number(payload.speed_kmh) || 0;
    const activity = payload.activity || 'ping';

    const pool = getPool();
    const pingRow = {
      user_id: String(userId),
      latitude: lat,
      longitude: lng,
      speed_kmh: speed,
      day_of_week: dayOfWeek,
      recorded_at: recordedAt.toISOString(),
    };

    if (pool) {
      await pool.query(
        `INSERT INTO r_detector_activity_pings (user_id, latitude, longitude, speed_kmh, day_of_week, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [pingRow.user_id, lat, lng, speed, dayOfWeek, recordedAt]
      );
    } else {
      mem().r_detector_activity_pings.push({ id: Date.now(), ...pingRow });
      if (mem().r_detector_activity_pings.length > 5000) {
        mem().r_detector_activity_pings = mem().r_detector_activity_pings.slice(-4000);
      }
    }

    let tripRecorded = false;
    if (activity === 'trip_start' || (activity === 'ping' && speed >= 18)) {
      tripRecorded = await this._maybeRecordTripStart(userId, {
        lat,
        lng,
        speed,
        dayOfWeek,
        recordedAt,
        destLat: payload.dest_latitude,
        destLng: payload.dest_longitude,
        direction: payload.direction,
      });
    }

    if (activity === 'trip_end' && Number.isFinite(Number(payload.dest_latitude))) {
      await this._recordTripEnd(userId, {
        lat: Number(payload.dest_latitude),
        lng: Number(payload.dest_longitude),
        dayOfWeek,
        recordedAt,
      });
    }

    await this.inferSchedules(userId);

    return { ok: true, tripRecorded };
  },

  async _maybeRecordTripStart(userId, { lat, lng, speed, dayOfWeek, recordedAt, destLat, destLng, direction }) {
    const pool = getPool();
    const departureMinutes = minutesOfDay(recordedAt);
    const origin = roundCell(lat, lng);
    let directionGuess = direction || 'unknown';

    if (directionGuess === 'unknown') {
      if (departureMinutes >= 300 && departureMinutes <= 660) directionGuess = 'outbound';
      else if (departureMinutes >= 900 && departureMinutes <= 1260) directionGuess = 'inbound';
    }

    const trip = {
      user_id: String(userId),
      day_of_week: dayOfWeek,
      departure_minutes: departureMinutes,
      origin_lat: origin.lat,
      origin_lng: origin.lng,
      dest_lat: Number.isFinite(destLat) ? destLat : null,
      dest_lng: Number.isFinite(destLng) ? destLng : null,
      direction: directionGuess,
      recorded_at: recordedAt.toISOString(),
    };

    const recentTrips = pool
      ? (await pool.query(
          `SELECT * FROM r_detector_commute_trips WHERE user_id = ? AND recorded_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR) ORDER BY id DESC LIMIT 5`,
          [String(userId)]
        ))[0]
      : mem().r_detector_commute_trips.filter((t) => t.user_id === String(userId)).slice(-5);

    const dup = (recentTrips || []).some((t) => {
      const tMin = Number(t.departure_minutes);
      return (
        Number(t.day_of_week) === dayOfWeek &&
        Math.abs(tMin - departureMinutes) < 8 &&
        haversineM(origin.lat, origin.lng, Number(t.origin_lat), Number(t.origin_lng)) < 200
      );
    });
    if (dup) return false;

    if (pool) {
      await pool.query(
        `INSERT INTO r_detector_commute_trips
         (user_id, day_of_week, departure_minutes, origin_lat, origin_lng, dest_lat, dest_lng, direction, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [trip.user_id, dayOfWeek, departureMinutes, origin.lat, origin.lng, trip.dest_lat, trip.dest_lng, directionGuess, recordedAt]
      );
    } else {
      mem().r_detector_commute_trips.push({ id: Date.now(), ...trip });
    }
    return true;
  },

  async _recordTripEnd(userId, { lat, lng, dayOfWeek, recordedAt }) {
    const pool = getPool();
    if (pool) {
      await pool.query(
        `UPDATE r_detector_commute_trips SET dest_lat = ?, dest_lng = ?
         WHERE user_id = ? AND day_of_week = ? AND dest_lat IS NULL
         ORDER BY id DESC LIMIT 1`,
        [lat, lng, String(userId), dayOfWeek]
      );
    } else {
      const trips = mem().r_detector_commute_trips.filter((t) => t.user_id === String(userId) && t.day_of_week === dayOfWeek);
      const last = trips[trips.length - 1];
      if (last && last.dest_lat == null) {
        last.dest_lat = lat;
        last.dest_lng = lng;
      }
    }
  },

  async inferSchedules(userId) {
    await ensureCommuteTables();
    const pool = getPool();
    const since = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);

    const trips = pool
      ? (await pool.query(
          `SELECT * FROM r_detector_commute_trips WHERE user_id = ? AND recorded_at >= ? ORDER BY recorded_at DESC`,
          [String(userId), since]
        ))[0]
      : mem().r_detector_commute_trips.filter((t) => t.user_id === String(userId));

    if (!trips?.length) return { schedules: 0 };

    const clusters = new Map();
    trips.forEach((t) => {
      const dir = t.direction === 'inbound' ? 'inbound' : 'outbound';
      const bucketMin = Math.round(Number(t.departure_minutes) / 15) * 15;
      const key = `${t.day_of_week}:${dir}:${bucketMin}:${t.origin_lat},${t.origin_lng}`;
      if (!clusters.has(key)) {
        clusters.set(key, { trips: [], day: t.day_of_week, dir, bucketMin, origin_lat: t.origin_lat, origin_lng: t.origin_lng });
      }
      clusters.get(key).trips.push(t);
    });

    let created = 0;
    for (const cluster of clusters.values()) {
      if (cluster.trips.length < MIN_TRIPS_FOR_SCHEDULE) continue;

      const depMinutes = median(cluster.trips.map((t) => Number(t.departure_minutes)));
      const withDest = cluster.trips.filter((t) => t.dest_lat != null && t.dest_lng != null);
      const destLat = withDest.length
        ? median(withDest.map((t) => Number(t.dest_lat)))
        : cluster.origin_lat + 0.02;
      const destLng = withDest.length
        ? median(withDest.map((t) => Number(t.dest_lng)))
        : cluster.origin_lng + 0.02;

      const confidence = Math.min(0.95, 0.4 + cluster.trips.length * 0.12);
      const schedule = {
        user_id: String(userId),
        day_of_week: cluster.day,
        departure_minutes: depMinutes,
        alert_lead_minutes: ALERT_LEAD_MINUTES,
        direction: cluster.dir,
        origin_lat: cluster.origin_lat,
        origin_lng: cluster.origin_lng,
        dest_lat: destLat,
        dest_lng: destLng,
        confidence,
        source: 'inferred',
        active: 1,
      };

      if (pool) {
        await pool.query(
          `INSERT INTO r_detector_commute_schedules
           (user_id, day_of_week, departure_minutes, alert_lead_minutes, direction, origin_lat, origin_lng, dest_lat, dest_lng, confidence, source, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             departure_minutes = VALUES(departure_minutes),
             origin_lat = VALUES(origin_lat),
             origin_lng = VALUES(origin_lng),
             dest_lat = VALUES(dest_lat),
             dest_lng = VALUES(dest_lng),
             confidence = VALUES(confidence),
             active = 1`,
          [
            schedule.user_id,
            schedule.day_of_week,
            schedule.departure_minutes,
            schedule.alert_lead_minutes,
            schedule.direction,
            schedule.origin_lat,
            schedule.origin_lng,
            schedule.dest_lat,
            schedule.dest_lng,
            schedule.confidence,
            schedule.source,
            schedule.active,
          ]
        );
      } else {
        const existing = mem().r_detector_commute_schedules.find(
          (s) =>
            s.user_id === schedule.user_id &&
            s.day_of_week === schedule.day_of_week &&
            s.direction === schedule.direction &&
            Math.abs(s.departure_minutes - schedule.departure_minutes) < TIME_CLUSTER_MINUTES
        );
        if (existing) Object.assign(existing, schedule);
        else mem().r_detector_commute_schedules.push({ id: Date.now() + created, ...schedule });
      }
      created += 1;
    }
    return { schedules: created };
  },

  async getSchedules(userId) {
    await ensureCommuteTables();
    const pool = getPool();
    const rows = pool
      ? (await pool.query(
          `SELECT * FROM r_detector_commute_schedules WHERE user_id = ? AND active = 1 ORDER BY day_of_week, departure_minutes`,
          [String(userId)]
        ))[0]
      : mem().r_detector_commute_schedules.filter((s) => s.user_id === String(userId) && s.active !== 0);

    const inferred = (rows || []).map((s) => ({
      id: s.id,
      dayOfWeek: Number(s.day_of_week),
      departureMinutes: Number(s.departure_minutes),
      departureLabel: formatTime(Number(s.departure_minutes)),
      alertLeadMinutes: Number(s.alert_lead_minutes || ALERT_LEAD_MINUTES),
      direction: s.direction,
      origin: { latitude: Number(s.origin_lat), longitude: Number(s.origin_lng) },
      destination: { latitude: Number(s.dest_lat), longitude: Number(s.dest_lng) },
      confidence: Number(s.confidence || 0.5),
      source: s.source || 'inferred',
    }));

    const prefs = await this.getPreferences(userId);
    const manual = buildManualSchedules(userId, prefs, inferred);
    const merged = [...manual];
    inferred.forEach((s) => {
      if (s.confidence >= 0.55 && !merged.some(
        (m) => m.dayOfWeek === s.dayOfWeek && m.direction === s.direction
          && Math.abs(m.departureMinutes - s.departureMinutes) < TIME_CLUSTER_MINUTES
      )) {
        merged.push(s);
      }
    });
    return merged.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.departureMinutes - b.departureMinutes);
  },

  async getPreferences(userId) {
    await ensureCommuteTables();
    const pool = getPool();
    let row = null;
    if (pool) {
      const [rows] = await pool.query(
        'SELECT * FROM r_detector_commute_preferences WHERE user_id = ? LIMIT 1',
        [String(userId)]
      );
      row = rows?.[0] || null;
      if (!row) {
        const def = defaultPreferences(userId);
        await pool.query(
          `INSERT INTO r_detector_commute_preferences
           (user_id, morning_departure_minutes, evening_departure_minutes, morning_enabled, evening_enabled, alert_lead_minutes, auto_scan_enabled)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [def.user_id, def.morning_departure_minutes, def.evening_departure_minutes, def.morning_enabled, def.evening_enabled, def.alert_lead_minutes, def.auto_scan_enabled]
        );
        row = def;
      }
    } else {
      if (!mem().r_detector_commute_preferences) mem().r_detector_commute_preferences = [];
      row = mem().r_detector_commute_preferences.find((p) => p.user_id === String(userId));
      if (!row) {
        row = defaultPreferences(userId);
        mem().r_detector_commute_preferences.push(row);
      }
    }
    return parsePrefsRow(row);
  },

  async savePreferences(userId, payload = {}) {
    await ensureCommuteTables();
    const pool = getPool();
    const current = await this.getPreferences(userId);
    const next = {
      morning_departure_minutes: payload.morningDepartureMinutes ?? current.morningDepartureMinutes ?? 510,
      evening_departure_minutes: payload.eveningDepartureMinutes ?? current.eveningDepartureMinutes ?? 1170,
      morning_enabled: payload.morningEnabled === false ? 0 : 1,
      evening_enabled: payload.eveningEnabled === false ? 0 : 1,
      alert_lead_minutes: payload.alertLeadMinutes ?? current.alertLeadMinutes ?? ALERT_LEAD_MINUTES,
      auto_scan_enabled: payload.autoScanEnabled === false ? 0 : 1,
      home_lat: payload.home?.latitude ?? payload.home_lat ?? current.home?.latitude ?? null,
      home_lng: payload.home?.longitude ?? payload.home_lng ?? current.home?.longitude ?? null,
      work_lat: payload.work?.latitude ?? payload.work_lat ?? current.work?.latitude ?? null,
      work_lng: payload.work?.longitude ?? payload.work_lng ?? current.work?.longitude ?? null,
    };
    if (pool) {
      await pool.query(
        `INSERT INTO r_detector_commute_preferences
         (user_id, morning_departure_minutes, evening_departure_minutes, morning_enabled, evening_enabled, alert_lead_minutes, auto_scan_enabled, home_lat, home_lng, work_lat, work_lng)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           morning_departure_minutes=VALUES(morning_departure_minutes),
           evening_departure_minutes=VALUES(evening_departure_minutes),
           morning_enabled=VALUES(morning_enabled),
           evening_enabled=VALUES(evening_enabled),
           alert_lead_minutes=VALUES(alert_lead_minutes),
           auto_scan_enabled=VALUES(auto_scan_enabled),
           home_lat=VALUES(home_lat),
           home_lng=VALUES(home_lng),
           work_lat=VALUES(work_lat),
           work_lng=VALUES(work_lng)`,
        [String(userId), next.morning_departure_minutes, next.evening_departure_minutes, next.morning_enabled, next.evening_enabled, next.alert_lead_minutes, next.auto_scan_enabled, next.home_lat, next.home_lng, next.work_lat, next.work_lng]
      );
    } else {
      const list = mem().r_detector_commute_preferences || [];
      const idx = list.findIndex((p) => p.user_id === String(userId));
      const row = { user_id: String(userId), ...next };
      if (idx >= 0) list[idx] = row;
      else list.push(row);
      mem().r_detector_commute_preferences = list;
    }
    return this.getPreferences(userId);
  },

  async getAllUserPreferences(limit = 100) {
    await ensureCommuteTables();
    const pool = getPool();
    if (pool) {
      const [rows] = await pool.query(
        `SELECT p.*, u.name AS user_name, u.email AS user_email
         FROM r_detector_commute_preferences p
         LEFT JOIN users u ON u.id = p.user_id
         ORDER BY p.updated_at DESC LIMIT ?`,
        [Number(limit) || 100]
      );
      return (rows || []).map((r) => ({
        ...parsePrefsRow(r),
        userName: r.user_name || r.user_id,
        userEmail: r.user_email || null,
        updatedAt: r.updated_at,
      }));
    }
    return (mem().r_detector_commute_preferences || []).map((r) => parsePrefsRow(r));
  },

  async _maybeNotifyCommuteAlert(userId, match, hazards, brief) {
    try {
      const alertKey = `${userId}_${match.direction}_${new Date().toISOString().slice(0, 10)}_${match.departureMinutes}`;
      if (!mem().r_detector_commute_alert_keys) mem().r_detector_commute_alert_keys = new Set();
      if (mem().r_detector_commute_alert_keys.has(alertKey)) return;
      mem().r_detector_commute_alert_keys.add(alertKey);

      const title = hazards.length > 0
        ? `Road issues on your ${brief.directionLabel || 'commute'}`
        : `Commute scan — ${brief.directionLabel || 'route'} clear`;
      const message = brief.message || `${hazards.length} issue(s) detected before your usual departure.`;
      await db.addNotification({
        user_id: String(userId),
        title,
        message,
        type: 'r_detector_commute',
        data: {
          module: 'r_detector',
          feature: 'commute',
          hazardCount: hazards.length,
          departureLabel: match.departureLabel,
          direction: match.direction,
          route: 'RDetectorScan',
        },
      });
    } catch (err) {
      LOG.warning('[Commute] notify failed:', err.message);
    }
  },

  async getPreDepartureBrief(userId, opts = {}) {
    await ensureCommuteTables();
    const now = opts.now ? new Date(opts.now) : new Date();
    const day = now.getDay();
    const nowMin = minutesOfDay(now);
    const schedules = await this.getSchedules(userId);
    const today = schedules.filter((s) => s.dayOfWeek === day);

    const match = today.find((s) => {
      const lead = s.alertLeadMinutes || ALERT_LEAD_MINUTES;
      const start = s.departureMinutes - lead;
      const end = s.departureMinutes + ALERT_GRACE_MINUTES;
      return nowMin >= start && nowMin <= end;
    });

    if (!match) {
      return {
        active: false,
        reason: 'outside_window',
        schedules: today,
        nextHint: today.length
          ? `Learned ${today.length} commute pattern(s) for today — alerts show ${ALERT_LEAD_MINUTES} min before your usual departure.`
          : 'Keep using R-Detector scans on your daily route — we learn your schedule from activity.',
      };
    }

    const minutesUntil = match.departureMinutes - nowMin;
    const origin = { lat: match.origin.latitude, lng: match.origin.longitude };
    const dest = { lat: match.destination.latitude, lng: match.destination.longitude };

    let incidents = [];
    try {
      incidents = await rDetectorService.getIncidents({ limit: 200 });
    } catch (_) {
      incidents = [];
    }

    const hazards = incidentsAlongRoute(origin, dest, incidents);
    const dirLabel = match.direction === 'inbound' ? 'return home' : 'morning commute';

    const brief = {
      active: true,
      schedule: match,
      directionLabel: dirLabel,
      departureLabel: match.departureLabel,
      minutesUntilLeave: Math.max(0, minutesUntil),
      alertWindowMinutes: match.alertLeadMinutes || ALERT_LEAD_MINUTES,
      hazardCount: hazards.length,
      hazards: hazards.map((h) => ({
        id: h.id,
        type: h.report_category || h.hazard_type,
        typeLabel: h.type_label || h.report_category,
        description: h.description,
        latitude: h.latitude,
        longitude: h.longitude,
        distanceM: h.distance_m,
        reportedAt: h.reported_at,
      })),
      message:
        hazards.length > 0
          ? `${hazards.length} issue${hazards.length > 1 ? 's' : ''} on your ${dirLabel} route — usual departure ${match.departureLabel}.`
          : `Your ${dirLabel} route looks clear — usual departure around ${match.departureLabel}.`,
    };

    const prefs = await this.getPreferences(userId);
    if (prefs?.autoScanEnabled !== false) {
      await this._maybeNotifyCommuteAlert(userId, match, hazards, brief);
    }

    return brief;
  },
};

module.exports = commuteService;
