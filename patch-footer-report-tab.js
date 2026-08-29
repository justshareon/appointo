const fs = require('fs');
const path = require('path');

const p = path.join(__dirname, '..', 'components', 'AppBottomFooter.js');
let s = fs.readFileSync(p, 'utf8');

const reportLine =
  "        { id: 'RDetectorReportIncident', label: 'Report', icon: 'plus-circle-outline', route: 'RDetectorReportIncident' },\n";

if (s.includes("id: 'RDetectorReportIncident'")) {
  console.log('Report tab already present');
  process.exit(0);
}

const vendorNeedle =
  "        { id: 'RDetectorVendorDashboard', label: 'Cases', icon: 'map-marker-radius', route: 'RDetectorVendorDashboard', params: primaryParams },\n        { id: 'RDetectorScan'";
const vendorReplace =
  "        { id: 'RDetectorVendorDashboard', label: 'Cases', icon: 'map-marker-radius', route: 'RDetectorVendorDashboard', params: primaryParams },\n" +
  reportLine +
  "        { id: 'RDetectorScan'";

const driverNeedle =
  "        { id: 'RDetectorDashboard', label: 'Home', icon: 'home', route: 'RDetectorDashboard', params: primaryParams },\n        { id: 'RDetectorScan'";
const driverReplace =
  "        { id: 'RDetectorDashboard', label: 'Home', icon: 'home', route: 'RDetectorDashboard', params: primaryParams },\n" +
  reportLine +
  "        { id: 'RDetectorScan'";

if (!s.includes(vendorNeedle)) {
  console.error('Vendor block needle not found');
  process.exit(1);
}
if (!s.includes(driverNeedle)) {
  console.error('Driver block needle not found');
  process.exit(1);
}

s = s.replace(vendorNeedle, vendorReplace).replace(driverNeedle, driverReplace);
fs.writeFileSync(p, s);
console.log('AppBottomFooter patched with Report tab');
