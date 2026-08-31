const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const syncPath = path.join(root, 'utils', 'syncHelpers.js');
let sync = fs.readFileSync(syncPath, 'utf8');
if (!sync.includes("AsyncStorage")) {
  sync = sync.replace(
    "import api from '../services/modules/api';",
    "import api from '../services/modules/api';\nimport AsyncStorage from '@react-native-async-storage/async-storage';"
  );
}
if (!sync.includes('ENSURE_TIMEOUT_MS')) {
  sync = sync.replace(
    'const ENSURE_DEBOUNCE_MS = 8000;',
    'const ENSURE_DEBOUNCE_MS = 8000;\nconst ENSURE_TIMEOUT_MS = 12000;'
  );
}
fs.writeFileSync(syncPath, sync);

const homePath = path.join(root, 'screens', 'UserHome.js');
let home = fs.readFileSync(homePath, 'utf8');
home = home.replace(
  'const mappedResult = await adminService.getMappedVendorsForUser();',
  `const mappedResult = currentUser
        ? await adminService.getMappedVendorsForUser()
        : { vendors: [], hasMappings: false };`
);
fs.writeFileSync(homePath, home);

console.log('[patch-home-timeout] OK');
