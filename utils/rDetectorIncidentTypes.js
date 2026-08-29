/** R-DETECTOR incident categories (UI key → DB hazard_type). */
const TYPES = [
  { key: 'broken_light', label: 'Broken street light', icon: '💡', dbType: 'other' },
  { key: 'traffic_signal', label: 'Traffic signal fault', icon: '🚦', dbType: 'other' },
  { key: 'accident', label: 'Accident / collision', icon: '🚨', dbType: 'accident' },
  { key: 'stalled_vehicle', label: 'Stalled / broken vehicle', icon: '🚗', dbType: 'other' },
  { key: 'traffic_jam', label: 'Heavy traffic / jam', icon: '🐌', dbType: 'other' },
  { key: 'weather', label: 'Weather hazard', icon: '🌧️', dbType: 'wet_road' },
  { key: 'flooding', label: 'Flooding / waterlogging', icon: '🌊', dbType: 'wet_road' },
  { key: 'fog', label: 'Low visibility / fog', icon: '🌫️', dbType: 'wet_road' },
  { key: 'wet_road', label: 'Slippery / wet road', icon: '💧', dbType: 'wet_road' },
  { key: 'pothole', label: 'Pothole / bad road', icon: '🕳️', dbType: 'pothole' },
  { key: 'speed_bump', label: 'Unmarked speed bump', icon: '〰️', dbType: 'pothole' },
  { key: 'lane_closure', label: 'Lane closure', icon: '🚧', dbType: 'lane_closure' },
  { key: 'construction', label: 'Construction zone', icon: '🏗️', dbType: 'construction' },
  { key: 'bridge_damage', label: 'Bridge / flyover issue', icon: '🌉', dbType: 'construction' },
  { key: 'landslide', label: 'Landslide / rockfall', icon: '⛰️', dbType: 'other' },
  { key: 'fallen_tree', label: 'Fallen tree / branch', icon: '🌳', dbType: 'other' },
  { key: 'debris', label: 'Debris on road', icon: '🪨', dbType: 'other' },
  { key: 'oil_spill', label: 'Oil / chemical spill', icon: '🛢️', dbType: 'other' },
  { key: 'fire', label: 'Fire on road', icon: '🔥', dbType: 'other' },
  { key: 'animal', label: 'Animal on road', icon: '🐄', dbType: 'other' },
  { key: 'wrong_way', label: 'Wrong-way / rash driving', icon: '↩️', dbType: 'other' },
  { key: 'police_checkpoint', label: 'Police / checkpoint', icon: '👮', dbType: 'other' },
  { key: 'icy_road', label: 'Icy / black ice', icon: '🧊', dbType: 'wet_road' },
  { key: 'dust_storm', label: 'Dust storm / low visibility', icon: '🌪️', dbType: 'wet_road' },
  { key: 'manhole_open', label: 'Open manhole / drain', icon: '🕳️', dbType: 'pothole' },
  { key: 'missing_sign', label: 'Missing / damaged sign', icon: '🪧', dbType: 'other' },
  { key: 'pedestrian_crossing', label: 'Pedestrian crossing hazard', icon: '🚶', dbType: 'other' },
  { key: 'railway_crossing', label: 'Railway crossing issue', icon: '🚂', dbType: 'other' },
  { key: 'parking_blocked', label: 'Illegal parking / blockage', icon: '🅿️', dbType: 'other' },
  { key: 'cyclist_hazard', label: 'Cyclist / two-wheeler hazard', icon: '🚲', dbType: 'other' },
  { key: 'detour', label: 'Detour / diversion', icon: '↪️', dbType: 'lane_closure' },
  { key: 'road_block', label: 'Road block / protest', icon: '🚫', dbType: 'lane_closure' },
  { key: 'other', label: 'Other', icon: '⚠️', dbType: 'other' },
];

const BY_KEY = Object.fromEntries(TYPES.map((t) => [t.key, t]));

const HAZARD_TYPE_FALLBACK = {
  pothole: 'pothole',
  lane_closure: 'lane_closure',
  wet_road: 'wet_road',
  accident: 'accident',
  construction: 'construction',
  other: 'other',
  bad_road: 'pothole',
};

function normalizeIncidentKey(raw) {
  const key = String(raw || 'other').toLowerCase().trim();
  if (BY_KEY[key]) return key;
  const aliases = {
    light_broken: 'broken_light',
    broken_street_light: 'broken_light',
    street_light: 'broken_light',
    signal: 'traffic_signal',
    traffic_light: 'traffic_signal',
    bad_road: 'pothole',
    rough_road: 'pothole',
    flood: 'flooding',
    waterlogging: 'flooding',
    rain: 'weather',
    storm: 'weather',
    congestion: 'traffic_jam',
    jam: 'traffic_jam',
    breakdown: 'stalled_vehicle',
    tree: 'fallen_tree',
    spill: 'oil_spill',
    checkpoint: 'police_checkpoint',
    rash_driving: 'wrong_way',
    ice: 'icy_road',
    black_ice: 'icy_road',
    dust: 'dust_storm',
    manhole: 'manhole_open',
    drain: 'manhole_open',
    sign: 'missing_sign',
    crosswalk: 'pedestrian_crossing',
    zebra_crossing: 'pedestrian_crossing',
    railway: 'railway_crossing',
    train: 'railway_crossing',
    parking: 'parking_blocked',
    cyclist: 'cyclist_hazard',
    bike: 'cyclist_hazard',
    diversion: 'detour',
    protest: 'road_block',
    blockade: 'road_block',
  };
  if (aliases[key]) return aliases[key];
  if (HAZARD_TYPE_FALLBACK[key]) return HAZARD_TYPE_FALLBACK[key];
  return 'other';
}

function labelFor(key) {
  return BY_KEY[normalizeIncidentKey(key)]?.label || 'Other';
}

function dbHazardType(key) {
  return BY_KEY[normalizeIncidentKey(key)]?.dbType || 'other';
}

module.exports = {
  R_DETECTOR_INCIDENT_TYPES: TYPES,
  normalizeIncidentKey,
  labelFor,
  dbHazardType,
};
