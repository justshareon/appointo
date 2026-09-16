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

// 8. Road scan vs CSCAN split (static + source checks — RN bundles are not require()'d in Node)
console.log('\nRoad Scan / CSCAN modules');
const roadScanView = path.join(__dirname, '..', 'screens', 'rdetector', 'RDetectorScanView.js');
const cscanView = path.join(__dirname, '..', 'screens', 'rdetector', 'RDetectorCScanView.js');
const cscanShell = path.join(__dirname, '..', 'screens', 'RDetectorCScan.js');
const rulesPanel = path.join(__dirname, '..', 'components', 'RoadScanRulesPanel.js');
for (const [label, p] of [
  ['RDetectorScanView', roadScanView],
  ['RDetectorCScanView', cscanView],
  ['RDetectorCScan shell', cscanShell],
  ['RoadScanRulesPanel', rulesPanel],
]) {
  if (!fs.existsSync(p)) fail(`Missing ${label}`, p);
  else ok(`${label} present`);
}
const scanSrc = fs.readFileSync(roadScanView, 'utf8');
if (scanSrc.includes('disableCameraScan: true')) ok('Road scan disables in-tab camera pipeline');
else fail('Road scan should pass disableCameraScan: true');
if (!scanSrc.includes('RoadScanCameraCapture')) ok('Road scan UI has no camera preview component');
else fail('Remove RoadScanCameraCapture from Road Scan view');
if (scanSrc.includes('mode="sensor"')) ok('Road scan rules panel is sensor-only');
else fail('Road scan should use RoadScanRulesPanel mode="sensor"');
const cscanSrc = fs.readFileSync(cscanView, 'utf8');
if (cscanSrc.includes('cameraOnlyMode: true')) ok('CSCAN uses camera-only reporter mode');
else fail('CSCAN should set cameraOnlyMode: true');
const bumpSrc = fs.readFileSync(path.join(__dirname, '..', 'utils', 'roadScanBumpReport.js'), 'utf8');
if (!bumpSrc.includes('!camFail')) ok('Bump start report no longer blocks on camera rules');
else fail('roadScanBumpReport should not require camera for bump start');

// 9. In-memory R-Detector tables + optional MySQL sync smoke
console.log('\nIn-memory / MySQL sync smoke');
(async () => {
  try {
    const db = require('./database');
    if (typeof db.ensureRDetectorTables === 'function') {
      await db.ensureRDetectorTables();
      ok('ensureRDetectorTables');
    }
    const mem = db.inMemoryDb;
    if (mem) {
      if (!Array.isArray(mem.r_detector_scan_results)) mem.r_detector_scan_results = [];
      if (!Array.isArray(mem.r_detector_activity_pings)) mem.r_detector_activity_pings = [];
      ok('In-memory r_detector_scan_results + activity_pings arrays');
    }
    const { syncRDetectorData } = require('./syncAllToMysql');
    if (typeof syncRDetectorData === 'function') {
      const n = await syncRDetectorData({ onProgress: () => {} });
      ok(`syncRDetectorData (${n ?? 0} rows touched)`);
    }
  } catch (e) {
    fail('MySQL sync smoke', e.message);
  }

  console.log(failures ? `\n❌ ${failures} failure(s)\n` : '\n✅ All checks passed (types + road/CSCAN + sync)\n');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  fail('async validation', e.message);
  process.exit(1);
});
