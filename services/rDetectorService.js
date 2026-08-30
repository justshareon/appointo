const db = require('../database');
const LOG = require('../utils/logger');
const { resolveCityFromCoords, normalizeCityName } = require('../utils/resolveCity');
const { normalizeIncidentKey, labelFor, dbHazardType, R_DETECTOR_INCIDENT_TYPES } = require('../utils/rDetectorIncidentTypes');
const fleetService = require('./fleetService');

let cityColumnReady = false;
let categoryColumnReady = false;

async function ensureCityColumns(pool) {
  if (cityColumnReady) return;
  try {
    await pool.query(`
      ALTER TABLE fleet_hazards
      ADD COLUMN IF NOT EXISTS city VARCHAR(120) NULL,
      ADD COLUMN IF NOT EXISTS region VARCHAR(120) NULL
    `);
    cityColumnReady = true;
  } catch (e) {
    LOG.warning('[R-Detector] city column migration', e.message);
    cityColumnReady = true;
  }
}

async function ensureReportCategoryColumn(pool) {
  if (categoryColumnReady) return;
  try {
    await pool.query(`
      ALTER TABLE fleet_hazards
      ADD COLUMN IF NOT EXISTS report_category VARCHAR(64) NULL
    `);
    categoryColumnReady = true;
  } catch (e) {
    LOG.warning('[R-Detector] report_category migration', e.message);
    categoryColumnReady = true;
  }
}

async function getPool() {
  if (db.getType() !== 'mysql') return null;
  const pool = db.getPool();
  if (pool) {
    await ensureCityColumns(pool);
    await ensureReportCategoryColumn(pool);
  }
  return pool;
}

function resolveReportCategory(row) {
  if (row?.report_category) return normalizeIncidentKey(row.report_category);
  return normalizeIncidentKey(row?.hazard_type || 'other');
}

function mapIncident(row) {
  if (!row) return null;
  const city = normalizeCityName(row.city || resolveCityFromCoords(row.latitude, row.longitude).city);
  const reportCategory = resolveReportCategory(row);
  return {
    id: row.id,
    hazard_type: row.hazard_type,
    report_category: reportCategory,
    type_label: labelFor(reportCategory),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    description: row.description || '',
    image_url: row.image_url || '',
    status: row.status || 'reported',
    points_awarded: row.points_awarded || 0,
    reported_at: row.reported_at,
    driver_id: row.driver_id,
    driver_name: row.driver_name || 'Reporter',
    city,
    region: row.region || '',
    distance_miles: row.distance_miles != null ? Number(row.distance_miles) : undefined,
  };
}

function groupIncidents(incidents) {
  const bucket = new Map();
  for (const inc of incidents) {
    const type = inc.report_category || 'other';
    const city = inc.city || 'Other';
    const key = `${type}::${city}`;
    if (!bucket.has(key)) {
      bucket.set(key, {
        type,
        type_label: labelFor(type),
        city,
        count: 0,
        incidents: [],
      });
    }
    const g = bucket.get(key);
    g.incidents.push(inc);
    g.count = g.incidents.length;
  }
  return [...bucket.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (a.type_label !== b.type_label) return a.type_label.localeCompare(b.type_label);
    return a.city.localeCompare(b.city);
  });
}

const rDetectorService = {
  async backfillCityForRow(pool, row) {
    if (!row?.id || row.city) return row;
    const { city, region } = resolveCityFromCoords(row.latitude, row.longitude);
    try {
      await pool.query('UPDATE fleet_hazards SET city = ?, region = ? WHERE id = ? AND (city IS NULL OR city = \'\')', [
        city,
        region,
        row.id,
      ]);
    } catch (_) {}
    return { ...row, city, region };
  },

  /**
   * Cities with incident counts (last 90 days).
   */
  async getCities() {
    try {
      const pool = await getPool();
      if (!pool) {
        const rows = (db.inMemoryDb?.fleet_hazards || []).map(mapIncident);
        const counts = {};
        rows.forEach((r) => {
          counts[r.city] = (counts[r.city] || 0) + 1;
        });
        return Object.entries(counts)
          .map(([city, count]) => ({ city, count }))
          .sort((a, b) => b.count - a.count);
      }

      const [rows] = await pool.query(`
        SELECT id, latitude, longitude, city, region
        FROM fleet_hazards
        WHERE reported_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      `);

      const counts = {};
      for (const row of rows) {
        const filled = row.city ? row : await this.backfillCityForRow(pool, row);
        const city = normalizeCityName(filled.city || resolveCityFromCoords(filled.latitude, filled.longitude).city);
        counts[city] = (counts[city] || 0) + 1;
      }

      return Object.entries(counts)
        .map(([city, count]) => ({ city, count }))
        .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
    } catch (e) {
      LOG.error('[R-Detector] getCities failed', e.message);
      return [];
    }
  },

  /**
   * Incidents for a city and/or type (or all if omitted).
   */
  async getIncidents({ city, type, limit = 100 } = {}) {
    try {
      const pool = await getPool();
      const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 200);
      const cityFilter = city && city !== 'All' ? normalizeCityName(city) : null;
      const typeFilter = type && type !== 'All' ? normalizeIncidentKey(type) : null;

      if (!pool) {
        let rows = (db.inMemoryDb?.fleet_hazards || []).map(mapIncident);
        if (cityFilter) rows = rows.filter((r) => r.city === cityFilter);
        if (typeFilter) rows = rows.filter((r) => r.report_category === typeFilter);
        return rows.slice(0, safeLimit);
      }

      const [rows] = await pool.query(`
        SELECT h.*, u.name AS driver_name
        FROM fleet_hazards h
        LEFT JOIN users u ON CAST(h.driver_id AS CHAR) = CAST(u.id AS CHAR)
        WHERE h.reported_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
        ORDER BY h.reported_at DESC
        LIMIT ?
      `, [safeLimit * 4]);

      const mapped = [];
      for (const row of rows) {
        const filled = row.city ? row : await this.backfillCityForRow(pool, row);
        const incident = mapIncident(filled);
        if (cityFilter && incident.city !== cityFilter) continue;
        if (typeFilter && incident.report_category !== typeFilter) continue;
        mapped.push(incident);
        if (mapped.length >= safeLimit) break;
      }
      return mapped;
    } catch (e) {
      LOG.error('[R-Detector] getIncidents failed', e.message);
      return [];
    }
  },

  async getGroupedIncidents({ city, type, limit = 100 } = {}) {
    const incidents = await this.getIncidents({ city, type, limit });
    return {
      total: incidents.length,
      groups: groupIncidents(incidents),
    };
  },

  async getTypeCounts({ city } = {}) {
    const incidents = await this.getIncidents({ city: city && city !== 'All' ? city : null, limit: 200 });
    const counts = {};
    for (const inc of incidents) {
      const key = inc.report_category || 'other';
      counts[key] = (counts[key] || 0) + 1;
    }
    return R_DETECTOR_INCIDENT_TYPES.map((t) => ({
      type: t.key,
      label: t.label,
      icon: t.icon,
      count: counts[t.key] || 0,
    }));
  },

  /**
   * User-reported road incident (lights, accident, weather, etc.)
   */
  async reportIncident(userId, payload) {
    const latitude = Number(payload.latitude);
    const longitude = Number(payload.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error('Valid latitude and longitude are required');
    }

    const category = normalizeIncidentKey(payload.incident_type || payload.type);
    const geo = resolveCityFromCoords(latitude, longitude);
    const city = normalizeCityName(payload.city || geo.city);
    const region = payload.region || geo.region;
    const description = String(payload.description || '').trim()
      || `${labelFor(category)} reported via R-Detector`;

    const result = await fleetService.reportHazard(userId, {
      hazard_type: dbHazardType(category),
      latitude,
      longitude,
      description,
      image_url: payload.image_url || '',
      city,
      region,
    });

    const pool = await getPool();
    if (pool && result?.hazard_id) {
      try {
        await pool.query(
          'UPDATE fleet_hazards SET report_category = ?, city = COALESCE(city, ?), region = COALESCE(region, ?) WHERE id = ?',
          [category, city, region, result.hazard_id]
        );
      } catch (e) {
        LOG.warning('[R-Detector] report_category update', e.message);
      }
    } else if (db.inMemoryDb?.fleet_hazards?.length) {
      const row = db.inMemoryDb.fleet_hazards.find((h) => String(h.id) === String(result.hazard_id));
      if (row) {
        row.report_category = category;
        row.city = city;
        row.region = region;
      }
    }

    return {
      ...result,
      report_category: category,
      type_label: labelFor(category),
      city,
    };
  },

  incidentTypes: () => R_DETECTOR_INCIDENT_TYPES,

  /**
   * Single incident with related probe reporters at same cell.
   */
  async getIncidentDetail(incidentId) {
    try {
      const pool = await getPool();
      if (!pool) {
        const row = (db.inMemoryDb?.fleet_hazards || []).find((h) => String(h.id) === String(incidentId));
        return row ? { incident: mapIncident(row), reporters: [], probes: [] } : null;
      }

      const [hazards] = await pool.query(`
        SELECT h.*, u.name AS driver_name, u.email AS driver_email
        FROM fleet_hazards h
        LEFT JOIN users u ON CAST(h.driver_id AS CHAR) = CAST(u.id AS CHAR)
        WHERE h.id = ?
        LIMIT 1
      `, [incidentId]);

      if (!hazards.length) return null;

      const filled = hazards[0].city
        ? hazards[0]
        : await this.backfillCityForRow(pool, hazards[0]);
      const incident = mapIncident(filled);
      const roundedLat = Math.round(incident.latitude * 100) / 100;
      const roundedLng = Math.round(incident.longitude * 100) / 100;

      await fleetService._ensureBadRoadProbesTable(pool);

      const [probes] = await pool.query(`
        SELECT p.*, u.name AS driver_name
        FROM fleet_bad_road_probes p
        LEFT JOIN users u ON CAST(p.driver_id AS CHAR) = CAST(u.id AS CHAR)
        WHERE p.rounded_lat = ? AND p.rounded_lng = ?
          AND p.confirmed = 1
        ORDER BY p.created_at DESC
        LIMIT 50
      `, [roundedLat, roundedLng]);

      const reporters = probes.map((p) => ({
        driver_id: p.driver_id,
        driver_name: p.driver_name || `Driver ${p.driver_id}`,
        reported_at: p.created_at,
        speed_kmh: p.speed_kmh,
        auto_detected: !!p.auto_detected,
      }));

      return {
        incident,
        reporters,
        map: {
          latitude: incident.latitude,
          longitude: incident.longitude,
          openstreetmap_url: `https://www.openstreetmap.org/?mlat=${incident.latitude}&mlon=${incident.longitude}&zoom=16`,
          embed_url: `https://www.openstreetmap.org/export/embed.html?bbox=${incident.longitude - 0.01}%2C${incident.latitude - 0.01}%2C${incident.longitude + 0.01}%2C${incident.latitude + 0.01}&layer=mapnik&marker=${incident.latitude}%2C${incident.longitude}`,
        },
      };
    } catch (e) {
      LOG.error('[R-Detector] getIncidentDetail failed', e.message);
      return null;
    }
  },

  getBadRoadNearby: (lat, lng, driverId) => fleetService.getBadRoadNearby(lat, lng, driverId),

  async reportBadRoadProbe(driverId, data) {
    const result = await fleetService.reportBadRoadProbe(driverId, data);
    if (result?.hazard_id) {
      const pool = await getPool();
      if (pool) {
        try {
          const geo = resolveCityFromCoords(data.latitude, data.longitude);
          await pool.query(
            `UPDATE fleet_hazards SET report_category = 'pothole', city = COALESCE(city, ?), region = COALESCE(region, ?) WHERE id = ?`,
            [geo.city, geo.region, result.hazard_id]
          );
        } catch (e) {
          LOG.warning('[R-Detector] probe category backfill', e.message);
        }
      } else if (db.inMemoryDb?.fleet_hazards) {
        const row = db.inMemoryDb.fleet_hazards.find((h) => String(h.id) === String(result.hazard_id));
        if (row) row.report_category = 'pothole';
      }
    }
    return result;
  },

  resolveCityForHazard: resolveCityFromCoords,
  ensureCityColumns,

  async ensureScanResultsTable(pool) {
    if (!pool) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS r_detector_scan_results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        latitude DECIMAL(10, 6) NOT NULL,
        longitude DECIMAL(11, 6) NOT NULL,
        speed_kmh DECIMAL(6, 2) NULL,
        confidence DECIMAL(4, 3) NULL,
        issue_type VARCHAR(32) DEFAULT 'bad_road',
        hazard_id INT NULL,
        scan_date DATE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_scan_date (user_id, scan_date),
        INDEX idx_created (created_at)
      )
    `);
  },

  async saveScanResult(userId, payload) {
    const latitude = Number(payload.latitude);
    const longitude = Number(payload.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error('Valid latitude and longitude are required');
    }

    const scanDate = payload.scan_date || new Date().toISOString().slice(0, 10);
    const row = {
      user_id: String(userId),
      latitude,
      longitude,
      speed_kmh: payload.speed_kmh != null ? Number(payload.speed_kmh) : null,
      confidence: payload.confidence != null ? Number(payload.confidence) : null,
      issue_type: payload.issue_type || 'bad_road',
      hazard_id: payload.hazard_id != null ? Number(payload.hazard_id) : null,
      scan_date: scanDate,
      created_at: new Date().toISOString(),
    };

    const pool = await getPool();
    if (!pool) {
      if (!db.inMemoryDb.r_detector_scan_results) db.inMemoryDb.r_detector_scan_results = [];
      const id = db.inMemoryDb.r_detector_scan_results.length + 1;
      const saved = { id, ...row };
      db.inMemoryDb.r_detector_scan_results.unshift(saved);
      return saved;
    }

    await this.ensureScanResultsTable(pool);
    const [result] = await pool.query(
      `INSERT INTO r_detector_scan_results
        (user_id, latitude, longitude, speed_kmh, confidence, issue_type, hazard_id, scan_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.user_id,
        row.latitude,
        row.longitude,
        row.speed_kmh,
        row.confidence,
        row.issue_type,
        row.hazard_id,
        row.scan_date,
      ]
    );

    return { id: result.insertId, ...row };
  },

  async getTodayScanResults(userId) {
    const scanDate = new Date().toISOString().slice(0, 10);
    const pool = await getPool();

    if (!pool) {
      const rows = db.inMemoryDb?.r_detector_scan_results || [];
      return rows
        .filter((r) => String(r.user_id) === String(userId) && String(r.scan_date) === scanDate)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    await this.ensureScanResultsTable(pool);
    const [rows] = await pool.query(
      `SELECT * FROM r_detector_scan_results
       WHERE user_id = ? AND scan_date = ?
       ORDER BY created_at DESC
       LIMIT 200`,
      [String(userId), scanDate]
    );
    return rows;
  },

  /** Crowd trust votes — still bad / fixed / upvote */
  async voteIncident(incidentId, userId, vote) {
    const pool = await getPool();
    const key = String(incidentId);
    if (!db.inMemoryDb) db.inMemoryDb = {};
    if (!db.inMemoryDb.r_detector_votes) db.inMemoryDb.r_detector_votes = {};
    if (!db.inMemoryDb.r_detector_votes[key]) {
      db.inMemoryDb.r_detector_votes[key] = { still_bad: 0, fixed: 0, upvote: 0, voters: {} };
    }
    const bucket = db.inMemoryDb.r_detector_votes[key];
    const voterKey = String(userId || 'anon');
    if (bucket.voters[voterKey] === vote) {
      return { incident_id: key, ...bucket, duplicate: true };
    }
    const prev = bucket.voters[voterKey];
    if (prev && bucket[prev] > 0) bucket[prev] -= 1;
    bucket.voters[voterKey] = vote;
    if (bucket[vote] != null) bucket[vote] += 1;

    if (pool) {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS r_detector_incident_votes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            incident_id VARCHAR(64) NOT NULL,
            user_id VARCHAR(64) NOT NULL,
            vote VARCHAR(16) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_vote (incident_id, user_id)
          )
        `);
        await pool.query(
          `INSERT INTO r_detector_incident_votes (incident_id, user_id, vote)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE vote = VALUES(vote)`,
          [key, voterKey, vote]
        );
      } catch (e) {
        LOG.warning('[R-Detector] voteIncident mysql', e.message);
      }
    }
    return { incident_id: key, still_bad: bucket.still_bad, fixed: bucket.fixed, upvote: bucket.upvote };
  },

  async getIncidentVotes(incidentId) {
    const key = String(incidentId);
    const bucket = db.inMemoryDb?.r_detector_votes?.[key] || { still_bad: 0, fixed: 0, upvote: 0 };
    return { incident_id: key, ...bucket };
  },

  async getHeatIncidents({ lat, lng, radiusKm = 5, limit = 80 } = {}) {
    const latitude = Number(lat);
    const longitude = Number(lng);
    const incidents = await this.getIncidents({ limit: 200 });
    const rows = (incidents || []).map((inc) => {
      const ilat = Number(inc.latitude);
      const ilng = Number(inc.longitude);
      if (!Number.isFinite(ilat) || !Number.isFinite(ilng)) return null;
      const d = haversineKm(latitude, longitude, ilat, ilng);
      if (d > radiusKm) return null;
      const votes = db.inMemoryDb?.r_detector_votes?.[String(inc.id)] || {};
      return {
        ...inc,
        distance_km: d,
        reports: votes.still_bad || inc.reporter_count || 1,
        vote_still_bad: votes.still_bad || 0,
        vote_fixed: votes.fixed || 0,
      };
    }).filter(Boolean).sort((a, b) => a.distance_km - b.distance_km).slice(0, limit);
    return rows;
  },

  async getReporterStats(userId) {
    const pool = await getPool();
    let scans = 0;
    if (pool) {
      try {
        const [rows] = await pool.query(
          'SELECT COUNT(*) AS c FROM r_detector_scan_results WHERE user_id = ?',
          [String(userId)]
        );
        scans = rows[0]?.c || 0;
      } catch (_) {}
    }
    const trust = Math.min(100, 40 + scans * 4);
    return { user_id: userId, scans, trust_score: trust, level: trust >= 80 ? 'Road Scout' : 'Contributor' };
  },
};

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = rDetectorService;
