const fs = require('fs');
const path = require('path');

const routesFile = path.join(__dirname, '..', 'utils', 'dashboardRoutes.js');
let routes = fs.readFileSync(routesFile, 'utf8');
if (!routes.includes("name.startsWith('RDetector')")) {
  routes = routes.replace(
    "  if (name.endsWith('Dashboard')) return true;",
    "  if (name.startsWith('RDetector')) return true;\n  if (name.endsWith('Dashboard')) return true;"
  );
  fs.writeFileSync(routesFile, routes);
  console.log('dashboardRoutes fixed');
}

const scanFile = path.join(__dirname, '..', 'screens', 'rdetector', 'RDetectorScanView.js');
let scan = fs.readFileSync(scanFile, 'utf8');

scan = scan.replace(/<\/LinearGradient>\s*\n\s*\n\s*<Card style={styles\.logCard}>/, '</View>\n\n\n\n        <Card style={styles.logCard}>');
scan = scan.replace(/<\/LinearGradient>\s*\n\s*<\/ScrollView>/, '</View>\n\n      </ScrollView>');

if (!scan.includes("speedCard: {\n    marginBottom: 14,\n    borderRadius: 16,\n    padding: 16,\n    backgroundColor: '#fce7f3'")) {
  scan = scan.replace(
    /speedCard:\s*\{\s*marginBottom:\s*14,\s*borderRadius:\s*16,\s*padding:\s*16,\s*\},/,
    `speedCard: {
    marginBottom: 14,
    borderRadius: 16,
    padding: 16,
    backgroundColor: '#fce7f3',
    borderWidth: 1,
    borderColor: '#fbcfe8',
  },`
  );
}

if (!scan.includes("infoCard:[\s\S]*backgroundColor: '#fdf2f8'")) {
  scan = scan.replace(
    /infoCard:\s*\{\s*borderRadius:\s*16,\s*padding:\s*16,\s*marginBottom:\s*8,\s*\},/,
    `infoCard: {
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

fs.writeFileSync(scanFile, scan);
console.log('scan view fixed');
