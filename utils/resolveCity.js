/** Approximate city lookup for Maharashtra / common seed coordinates. */
const CITY_ZONES = [
  { city: 'Mumbai', region: 'Maharashtra', latMin: 18.89, latMax: 19.27, lngMin: 72.77, lngMax: 72.98 },
  { city: 'Pune', region: 'Maharashtra', latMin: 18.44, latMax: 18.64, lngMin: 73.75, lngMax: 73.95 },
  { city: 'Panvel', region: 'Maharashtra', latMin: 18.95, latMax: 19.05, lngMin: 73.08, lngMax: 73.14 },
  { city: 'Bhiwandi', region: 'Maharashtra', latMin: 19.24, latMax: 19.32, lngMin: 73.0, lngMax: 73.1 },
  { city: 'Lonavala', region: 'Maharashtra', latMin: 18.72, latMax: 18.78, lngMin: 73.38, lngMax: 73.44 },
  { city: 'Hinjewadi', region: 'Maharashtra', latMin: 18.57, latMax: 18.62, lngMin: 73.72, lngMax: 73.76 },
  { city: 'Talegaon', region: 'Maharashtra', latMin: 18.7, latMax: 18.78, lngMin: 73.65, lngMax: 73.72 },
];

function zoneMatch(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  for (const z of CITY_ZONES) {
    if (la >= z.latMin && la <= z.latMax && ln >= z.lngMin && ln <= z.lngMax) {
      return { city: z.city, region: z.region };
    }
  }
  return null;
}

/**
 * Resolve city + region from coordinates (local zones first).
 */
function resolveCityFromCoords(latitude, longitude) {
  const hit = zoneMatch(latitude, longitude);
  if (hit) return hit;
  return { city: 'Other', region: '' };
}

function normalizeCityName(city) {
  const c = String(city || '').trim();
  return c || 'Other';
}

module.exports = { resolveCityFromCoords, normalizeCityName, CITY_ZONES };
