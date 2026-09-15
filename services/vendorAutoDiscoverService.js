/**
 * Discover nearby shops/vendors via OpenStreetMap (Overpass) for super-admin Vendor Auto.
 */
const db = require('../database');
const adminService = require('./adminService');
const { pushVendorAutoLog } = require('../utils/vendorAutoLog');

const SHOP_CATEGORY = {
  supermarket: 'Grocery',
  grocery: 'Grocery',
  convenience: 'Grocery',
  bakery: 'Food',
  clothes: 'Shopping',
  electronics: 'Electronics',
  hardware: 'Hardware',
  pharmacy: 'Pharmacy',
  hairdresser: 'Salon',
  beauty: 'Salon',
  mobile_phone: 'Electronics',
  car_repair: 'Automotive',
  restaurant: 'Food',
  cafe: 'Food',
  fast_food: 'Food',
  marketplace: 'Market',
  mall: 'Shopping',
  hospital: 'Healthcare',
  clinic: 'Healthcare',
  bank: 'Services',
};

function mapCategory(tags = {}) {
  const shop = tags.shop || tags.amenity || tags.office || '';
  const key = String(shop).toLowerCase();
  if (SHOP_CATEGORY[key]) return SHOP_CATEGORY[key];
  if (tags.amenity === 'restaurant' || tags.amenity === 'cafe') return 'Food';
  return 'General';
}

function inferProducts(tags = {}, category = 'General') {
  const products = [];
  const name = tags.name || tags.brand || '';
  if (tags.cuisine) {
    products.push({
      name: `${tags.cuisine} special`.slice(0, 80),
      price: 199,
      description: `Cuisine: ${tags.cuisine}`,
      category: 'Food',
    });
  }
  if (tags.shop || tags.amenity) {
    products.push({
      name: `${category} — standard listing`.slice(0, 80),
      price: 99,
      description: tags.opening_hours ? `Hours: ${tags.opening_hours}` : 'Auto-imported from map data',
      category,
    });
  }
  if (tags.brand && name) {
    products.push({
      name: `${tags.brand} product line`.slice(0, 80),
      price: 149,
      description: `Brand: ${tags.brand}`,
      category,
    });
  }
  if (!products.length) {
    products.push({
      name: 'General catalog item',
      price: 99,
      description: 'Placeholder — edit in vendor dashboard',
      category,
    });
  }
  return products.slice(0, 5);
}

function osmRef(element) {
  return `osm:${element.type || 'node'}:${element.id}`;
}

function syntheticMobile(osmId) {
  const digits = String(osmId || '').replace(/\D/g, '').slice(-7).padStart(7, '0');
  return `880${digits}`;
}

function normName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s&'-]/g, '');
}

function normLocation(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/,/g, ' ');
}

function locationLabel(row) {
  return normLocation(row.location_name || [row.town, row.city].filter(Boolean).join(', '));
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Same shop name at same place (location text or within ~350 m). */
function vendorMatchesCandidate(candidate, vendor) {
  const n1 = normName(candidate.shop_name);
  const n2 = normName(vendor.shop_name);
  if (!n1 || n1 !== n2) return false;

  const locC = locationLabel(candidate);
  const locV = normLocation(vendor.location_name);
  if (locC && locV) {
    if (locC === locV) return true;
    if (locC.includes(locV) || locV.includes(locC)) return true;
    const cityC = normLocation(candidate.city);
    const cityV = normLocation(vendor.city || vendor.location_name);
    if (cityC && cityV && cityC === cityV && locC.split(' ')[0] === locV.split(' ')[0]) return true;
  }

  const lat = Number(vendor.latitude);
  const lng = Number(vendor.longitude);
  const clat = Number(candidate.latitude);
  const clng = Number(candidate.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(clat) && Number.isFinite(clng)) {
    return haversineMeters(clat, clng, lat, lng) <= 350;
  }

  return !!(locC && locV && locC === locV);
}

function findDuplicate(existingList, candidate) {
  if (!Array.isArray(existingList)) return null;
  return existingList.find((v) => vendorMatchesCandidate(candidate, v)) || null;
}

function displayNameFromTags(tags = {}, element = {}) {
  const direct = (tags.name || tags.brand || tags.operator || '').trim();
  if (direct) return direct.slice(0, 120);
  const kind = tags.shop || tags.amenity || tags.office || tags.craft || '';
  if (!kind) return null;
  const addr = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
  const suffix = addr ? ` · ${addr}` : '';
  return `${String(kind).replace(/_/g, ' ')}${suffix}`.slice(0, 120);
}

function mapElement(element, index, geo) {
  const tags = element.tags || {};
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  const shopName = displayNameFromTags(tags, element);
  if (!shopName) return null;

  const category = mapCategory(tags);
  const town = geo.town || tags['addr:suburb'] || tags['addr:neighbourhood'] || '';
  const city = geo.city || tags['addr:city'] || tags['addr:town'] || '';
  const locationName = [town, city].filter(Boolean).join(', ') || geo.locationName || city || 'Nearby';

  return {
    externalId: osmRef(element),
    shop_name: shopName.slice(0, 120),
    category,
    latitude: lat != null ? Number(lat) : geo.latitude,
    longitude: lng != null ? Number(lng) : geo.longitude,
    location_name: locationName,
    town,
    city,
    state: geo.state || tags['addr:state'] || '',
    products: inferProducts(tags, category),
    osmTags: {
      shop: tags.shop,
      amenity: tags.amenity,
      phone: tags.phone || tags['contact:phone'] || null,
    },
  };
}

const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

const OVERPASS_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  Accept: 'application/json',
  'User-Agent': 'QRQueueVendorAuto/1.0 (+https://github.com; super-admin OSM shop scan)',
};

function buildOverpassQuery(latitude, longitude, radiusM, { includeWays = false, limit = 80 } = {}) {
  const r = Math.min(Math.max(Number(radiusM) || 2500, 400), 8000);
  const wayBlock = includeWays
    ? `
      way["shop"](around:${r},${latitude},${longitude});
      way["amenity"~"restaurant|cafe|fast_food|pharmacy|marketplace|clinic|bank|hospital|convenience"](around:${r},${latitude},${longitude});
    `
    : '';
  return `
[out:json][timeout:25];
(
  node["shop"](around:${r},${latitude},${longitude});
  node["amenity"~"restaurant|cafe|fast_food|pharmacy|marketplace|clinic|bank|hospital|convenience"](around:${r},${latitude},${longitude});
  node["craft"](around:${r},${latitude},${longitude});
  ${wayBlock}
);
out center ${Math.min(limit, 120)};
`;
}

async function fetchOverpassOnce(url, query, timeoutMs = 22000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: OVERPASS_HEADERS,
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Overpass HTTP ${res.status}${text?.slice(0, 80) ? `: ${text.slice(0, 80)}` : ''}`);
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch (_) {
      throw new Error('Overpass returned non-JSON (server busy — retry)');
    }
    if (json.remark && !json.elements?.length) {
      throw new Error(String(json.remark).slice(0, 120));
    }
    return Array.isArray(json?.elements) ? json.elements : [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOverpassShops(latitude, longitude, radiusM = 6000) {
  const tiers = [
    { radiusM: Math.min(radiusM, 2500), includeWays: false, limit: 100 },
    { radiusM: Math.min(radiusM, 4500), includeWays: true, limit: 80 },
  ];
  const errors = [];
  for (const tier of tiers) {
    const query = buildOverpassQuery(latitude, longitude, tier.radiusM, tier);
    for (const url of OVERPASS_ENDPOINTS) {
      try {
        const elements = await fetchOverpassOnce(url, query);
        if (elements.length) {
          pushVendorAutoLog('info', `OSM Overpass OK — ${elements.length} element(s)`, {
            endpoint: url.replace('https://', ''),
            radiusM: tier.radiusM,
          });
          return elements;
        }
      } catch (err) {
        errors.push(`${url.split('/')[2]}: ${err.message}`);
      }
    }
  }
  throw new Error(errors[0] || 'OpenStreetMap scan returned no shops — try refresh or another area');
}

async function loadExistingVendorsNear(geo) {
  const queries = [...new Set([geo.city, geo.town, geo.locationName, ''].filter((q) => q != null))];
  const byId = new Map();
  for (const q of queries) {
    try {
      const result = await db.getVendors(false, 1, 1000, 'newest', String(q || ''), true);
      const list = result?.vendors || result?.data || result || [];
      if (Array.isArray(list)) {
        list.forEach((v) => {
          if (v?.id) byId.set(v.id, v);
        });
      }
    } catch (_) {
      /* ignore single query failure */
    }
  }
  return [...byId.values()];
}

function markExisting(candidates, existing) {
  return candidates.map((c) => {
    const hit = findDuplicate(existing, c);
    return {
      ...c,
      alreadyInDb: !!hit,
      existingVendorId: hit?.id || null,
      duplicateReason: hit ? 'name_and_location' : null,
    };
  });
}

async function scanNearbyVendors(geo = {}) {
  const latitude = Number(geo.latitude);
  const longitude = Number(geo.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    pushVendorAutoLog('error', 'Scan failed — latitude/longitude required', { geo });
    throw new Error('latitude and longitude are required for Vendor Auto scan');
  }

  pushVendorAutoLog('info', 'Scan started', {
    town: geo.town,
    city: geo.city,
    latitude,
    longitude,
  });

  let elements = [];
  try {
    elements = await fetchOverpassShops(latitude, longitude, geo.radiusM || 6000);
  } catch (err) {
    pushVendorAutoLog('error', `Overpass failed: ${err.message}`);
    throw err;
  }

  const mapped = [];
  const seen = new Set();
  elements.forEach((el, i) => {
    const row = mapElement(el, i, geo);
    if (!row || seen.has(row.externalId)) return;
    seen.add(row.externalId);
    mapped.push(row);
  });

  const existing = await loadExistingVendorsNear(geo);
  const candidates = markExisting(mapped, existing);

  pushVendorAutoLog('info', `Scan complete — ${candidates.length} candidate(s)`, {
    newCount: candidates.filter((c) => !c.alreadyInDb).length,
    existingCount: candidates.filter((c) => c.alreadyInDb).length,
  });

  return {
    candidates: candidates.map(publicCandidateRow),
    meta: {
      town: geo.town || '',
      city: geo.city || '',
      locationName: geo.locationName || '',
      scannedAt: new Date().toISOString(),
      total: candidates.length,
      osmElements: mapped.length,
      radiusM: geo.radiusM || 6000,
      source: 'openstreetmap_overpass',
    },
  };
}

/** API/client row — shop data only (no product placeholders or OSM tag config). */
function publicCandidateRow(c) {
  return {
    externalId: c.externalId,
    shop_name: c.shop_name,
    category: c.category,
    latitude: c.latitude,
    longitude: c.longitude,
    location_name: c.location_name,
    town: c.town,
    city: c.city,
    state: c.state,
    alreadyInDb: !!c.alreadyInDb,
    existingVendorId: c.existingVendorId || null,
    duplicateReason: c.duplicateReason || null,
    saved: !!c.saved,
  };
}

/** Distinct locations from MySQL vendors for super-admin area picker. */
async function listSystemAreas() {
  let vendors = [];
  try {
    const result = await adminService.getVendors({ page: 1, limit: 5000, sortBy: 'newest', search: '' });
    vendors = result?.vendors || (Array.isArray(result) ? result : []);
  } catch (_) {
    vendors = [];
  }

  const byKey = new Map();
  vendors.forEach((v) => {
    const label = String(v.location_name || v.city || '').trim();
    if (!label) return;
    const key = normLocation(label);
    if (!byKey.has(key)) {
      byKey.set(key, {
        id: key,
        label,
        city: v.city || '',
        town: v.town || '',
        locationName: label,
        latitude: Number(v.latitude) || null,
        longitude: Number(v.longitude) || null,
        vendorCount: 0,
      });
    }
    const row = byKey.get(key);
    row.vendorCount += 1;
    if (!Number.isFinite(row.latitude) && Number.isFinite(Number(v.latitude))) {
      row.latitude = Number(v.latitude);
      row.longitude = Number(v.longitude);
    }
  });

  return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label));
}

async function saveProductsForVendor(vendorId, products = []) {
  let saved = 0;
  for (const p of products) {
    try {
      await db.addProduct({
        vendor_id: vendorId,
        name: String(p.name).slice(0, 120),
        price: Number(p.price) || 99,
        offer: '',
        offer_amount: 0,
        description: p.description || '',
        category: p.category || 'General',
        stock: 50,
        image_urls: [],
      });
      saved += 1;
      pushVendorAutoLog('info', `Product saved: ${p.name}`, { vendorId });
    } catch (err) {
      pushVendorAutoLog('warn', `Product skip: ${p.name} — ${err.message}`, { vendorId });
    }
  }
  return saved;
}

async function saveCandidates(candidates = [], { actorId = null, auto = false } = {}) {
  const existingPool = await loadExistingVendorsNear({
    city: candidates[0]?.city,
    town: candidates[0]?.town,
    locationName: candidates[0]?.location_name,
  });
  const results = [];
  for (const c of candidates) {
    const dup =
      (c.alreadyInDb && c.existingVendorId ? existingPool.find((v) => v.id === c.existingVendorId) : null)
      || findDuplicate(existingPool, c);

    if (dup) {
      results.push({
        shop_name: c.shop_name,
        vendorId: dup.id,
        status: 'skipped',
        reason: 'duplicate_name_location',
      });
      pushVendorAutoLog('info', `Skip duplicate (name + location): ${c.shop_name}`, {
        vendorId: dup.id,
        location: c.location_name,
        auto,
        actorId,
      });
      continue;
    }

    const mobile = c.osmTags?.phone?.replace(/\D/g, '').slice(-10)
      || syntheticMobile(c.externalId);

    try {
      const created = await adminService.addVendor({
        shop_name: c.shop_name,
        category: c.category || 'General',
        owner_mobile: mobile.length >= 10 ? mobile : syntheticMobile(c.externalId),
        owner_name: `${c.shop_name} Owner`.slice(0, 60),
        owner_email: '',
        location_name: c.location_name,
        latitude: c.latitude,
        longitude: c.longitude,
      });

      const vendorId = created?.vendor?.id || created?.id;
      const productsSaved = vendorId
        ? await saveProductsForVendor(vendorId, c.products || [])
        : 0;

      results.push({
        shop_name: c.shop_name,
        vendorId,
        status: 'created',
        productsSaved,
      });
      pushVendorAutoLog('info', `Vendor created from auto scan`, {
        vendorId,
        shop_name: c.shop_name,
        productsSaved,
        auto,
        actorId,
      });
      if (vendorId && created?.vendor) {
        existingPool.push(created.vendor);
      }
    } catch (err) {
      results.push({
        shop_name: c.shop_name,
        status: 'error',
        error: err.message,
      });
      pushVendorAutoLog('error', `Save failed: ${c.shop_name} — ${err.message}`, { auto, actorId });
    }
  }

  pushVendorAutoLog('info', `Save batch done — ${results.length} row(s)`, {
    created: results.filter((r) => r.status === 'created').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    auto,
  });

  return { results, savedAt: new Date().toISOString() };
}

module.exports = {
  scanNearbyVendors,
  saveCandidates,
  listSystemAreas,
  publicCandidateRow,
};
