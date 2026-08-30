const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'components', 'ScreenFrame.js');
let src = fs.readFileSync(file, 'utf8');

if (!src.includes('DashboardRoadScene')) {
  src = src.replace(
    "import DashboardAmbientBar from './DashboardAmbientBar';",
    "import DashboardAmbientBar from './DashboardAmbientBar';\nimport DashboardRoadScene from './DashboardRoadScene';"
  );
  src = src.replace(
    '{showAmbient ? <DashboardAmbientBar /> : null}',
    `{showAmbient ? (
        <>
          <DashboardAmbientBar />
          <DashboardRoadScene />
        </>
      ) : null}`
  );
  fs.writeFileSync(file, src, 'utf8');
  console.log('ScreenFrame patched with DashboardRoadScene');
} else {
  console.log('ScreenFrame already has DashboardRoadScene');
}
