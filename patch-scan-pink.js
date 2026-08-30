const fs = require('fs');
const path = require('path');

// 1) R-Detector routes get light dashboard shell + ambient bar
const routesFile = path.join(__dirname, '..', 'utils', 'dashboardRoutes.js');
let routes = fs.readFileSync(routesFile, 'utf8');
if (!routes.includes("name.startsWith('RDetector')")) {
  routes = routes.replace(
    `export function isDashboardRoute(routeName) {
  if (!routeName) return false;
  const name = String(routeName);
  if (name.endsWith('Dashboard')) return true;`,
    `export function isDashboardRoute(routeName) {
  if (!routeName) return false;
  const name = String(routeName);
  if (name.startsWith('RDetector')) return true;
  if (name.endsWith('Dashboard')) return true;`
  );
  fs.writeFileSync(routesFile, routes);
  console.log('dashboardRoutes patched');
}

// 2) Road scan — solid light pink cards (no purple gradient)
const scanFile = path.join(__dirname, '..', 'screens', 'rdetector', 'RDetectorScanView.js');
let scan = fs.readFileSync(scanFile, 'utf8');

scan = scan.replace(
  "<LinearGradient colors={['#fce7f3', '#fbcfe8', '#f9a8d4']} style={styles.speedCard}>",
  '<View style={styles.speedCard}>'
);
scan = scan.replace(
  '</LinearGradient>\n\n\n\n        <Card style={styles.logCard}>',
  '</View>\n\n\n\n        <Card style={styles.logCard}>'
);

scan = scan.replace(
  "<LinearGradient colors={['#fdf2f8', '#fce7f3']} style={styles.infoCard}>",
  '<View style={styles.infoCard}>'
);
// close info card - find last LinearGradient close before ScrollView end
if (scan.includes('</LinearGradient>\n\n      </ScrollView>')) {
  scan = scan.replace('</LinearGradient>\n\n      </ScrollView>', '</View>\n\n      </ScrollView>');
}

if (!scan.includes("backgroundColor: '#fce7f3'")) {
  scan = scan.replace(
    `  speedCard: {

    marginBottom: 14,

    borderRadius: 16,

    padding: 16,

  },`,
    `  speedCard: {
    marginBottom: 14,
    borderRadius: 16,
    padding: 16,
    backgroundColor: '#fce7f3',
    borderWidth: 1,
    borderColor: '#fbcfe8',
  },`
  );
}

if (!scan.includes('infoCard:') || !scan.match(/infoCard:[\s\S]*backgroundColor/)) {
  scan = scan.replace(
    `  infoCard: {

    borderRadius: 16,

    padding: 16,

    marginBottom: 8,

  },`,
    `  infoCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
    backgroundColor: '#fdf2f8',
    borderWidth: 1,
    borderColor: '#fbcfe8',
  },`
  );
}

scan = scan.replace(
  '  scroll: { padding: 16, paddingBottom: 28 },',
  "  scroll: { padding: 16, paddingBottom: 28, backgroundColor: '#f0f2f5' },"
);

scan = scan.replace(
  'buttonColor={THEME.accent2}',
  'buttonColor={THEME.accent}'
);

fs.writeFileSync(scanFile, scan);
console.log('RDetectorScanView patched — light pink');
