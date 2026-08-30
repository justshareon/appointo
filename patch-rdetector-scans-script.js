const fs = require('fs');
const path = require('path');
const pkgPath = path.join(__dirname, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (!pkg.scripts['sync:rdetector-scans']) {
  pkg.scripts['sync:rdetector-scans'] = 'node ensureRDetectorScanResults.js';
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  console.log('Added sync:rdetector-scans script');
} else {
  console.log('sync:rdetector-scans already exists');
}
