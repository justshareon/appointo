/**
 * R-DETECTOR validation — run: node backend/validateRDetector.js
 */
const path = require('path');

const backendTypes = require('./utils/rDetectorIncidentTypes');
const frontendPath = path.join(__dirname, '..', 'utils', 'rDetectorIncidentTypes.js');
const fs = require('fs');

let failures = 0;
function ok(label) {
  console.log(`  ✓ ${label}`);
}
function fail(label, detail) {
  failures += 1;
  console.error(`  ✗ ${label}${detail ? `: ${detail}` : ''}`);
}

console.log('\n[R-DETECTOR] Validation\n');

// 1. Type catalog
const backendKeys = backendTypes.R_DETECTOR_INCIDENT_TYPES.map((t) => t.key);
console.log(`Incident types: ${backendKeys.length}`);
if (backendKeys.length < 30) fail('Expected at least 30 incident types', `got ${backendKeys.length}`);
else ok(`Catalog has ${backendKeys.length} types`);

const unique = new Set(backendKeys);
if (unique.size !== backendKeys.length) fail('Duplicate type keys in backend catalog');
else ok('No duplicate backend keys');

// 2. Frontend sync (parse keys from file)
const feSrc = fs.readFileSync(frontendPath, 'utf8');
const feKeys = [...feSrc.matchAll(/key:\s*'([^']+)'/g)].map((m) => m[1]);
const feSet = new Set(feKeys);
for (const key of backendKeys) {
  if (!feSet.has(key)) fail(`Frontend missing type: ${key}`);
}
for (const key of feKeys) {
  if (!unique.has(key)) fail(`Frontend extra type not in backend: ${key}`);
}
if (failures === 0) ok('Frontend/backend type keys match');

// 3. Normalization aliases
const aliasTests = [
  ['light_broken', 'broken_light'],
  ['flood', 'flooding'],
  ['bad_road', 'pothole'],
  ['ice', 'icy_road'],
  ['manhole', 'manhole_open'],
  ['protest', 'road_block'],
  ['unknown_xyz', 'other'],
];
for (const [input, expected] of aliasTests) {
  const got = backendTypes.normalizeIncidentKey(input);
  if (got !== expected) fail(`normalizeIncidentKey('${input}')`, `expected ${expected}, got ${got}`);
}
if (failures === 0) ok('Normalization aliases');

// 4. dbHazardType mapping
for (const t of backendTypes.R_DETECTOR_INCIDENT_TYPES) {
  const db = backendTypes.dbHazardType(t.key);
  if (!['pothole', 'lane_closure', 'wet_road', 'accident', 'construction', 'other'].includes(db)) {
    fail(`Invalid dbHazardType for ${t.key}`, db);
  }
}
if (failures === 0) ok('dbHazardType values valid');

// 5. Grouping logic smoke test
const { normalizeIncidentKey, labelFor } = backendTypes;
function groupIncidents(incidents) {
  const bucket = new Map();
  for (const inc of incidents) {
    const type = inc.report_category || 'other';
    const city = inc.city || 'Other';
    const key = `${type}::${city}`;
    if (!bucket.has(key)) bucket.set(key, { type, city, count: 0, incidents: [] });
    const g = bucket.get(key);
    g.incidents.push(inc);
    g.count = g.incidents.length;
  }
  return [...bucket.values()];
}

const sample = [
  { report_category: 'pothole', city: 'Mumbai' },
  { report_category: 'pothole', city: 'Mumbai' },
  { report_category: 'accident', city: 'Pune' },
];
const groups = groupIncidents(sample);
if (groups.length !== 2) fail('groupIncidents', `expected 2 groups, got ${groups.length}`);
else ok('Group by type+city');

const potholeGroup = groups.find((g) => g.type === 'pothole');
if (!potholeGroup || potholeGroup.count !== 2) fail('Pothole group count');
else ok('Group counts correct');

// 6. Route module loads
try {
  require('./routes/rDetectorRoutes');
  ok('rDetectorRoutes loads');
} catch (e) {
  fail('rDetectorRoutes load', e.message);
}

try {
  require('./services/rDetectorService');
  ok('rDetectorService loads');
} catch (e) {
  fail('rDetectorService load', e.message);
}

// 7. Labels
if (labelFor('icy_road') !== 'Icy / black ice') fail('labelFor icy_road');
else ok('labelFor works');

console.log(failures ? `\n❌ ${failures} failure(s)\n` : '\n✅ All checks passed\n');
process.exit(failures ? 1 : 0);
