const fs = require('fs');
const path = require('path');

const p = path.join(__dirname, '..', 'screens', 'TrustScoreDashboard.js');
let s = fs.readFileSync(p, 'utf8');
const dup =
  "import DashboardHeaderRight from '../components/DashboardHeaderRight';\n" +
  "import { HeaderIconButton } from '../components/HeaderIconButton';\n" +
  "import DashboardHeaderRight from '../components/DashboardHeaderRight';\n" +
  "import { HeaderIconButton } from '../components/HeaderIconButton';\n";
const single =
  "import DashboardHeaderRight from '../components/DashboardHeaderRight';\n" +
  "import { HeaderIconButton } from '../components/HeaderIconButton';\n";
if (s.includes(dup)) {
  s = s.replace(dup, single);
  fs.writeFileSync(p, s);
  console.log('removed duplicate imports');
} else {
  console.log('duplicate block not found');
}
