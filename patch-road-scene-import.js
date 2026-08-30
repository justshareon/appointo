const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'components', 'ScreenFrame.js');
let src = fs.readFileSync(file, 'utf8');
if (!src.includes("import DashboardRoadScene")) {
  src = src.replace(
    "import DashboardAmbientBar from './DashboardAmbientBar';",
    "import DashboardAmbientBar from './DashboardAmbientBar';\nimport DashboardRoadScene from './DashboardRoadScene';"
  );
  fs.writeFileSync(file, src, 'utf8');
  console.log('Added DashboardRoadScene import');
} else {
  console.log('Import already present');
}
