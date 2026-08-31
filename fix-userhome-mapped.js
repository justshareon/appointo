const fs = require('fs');
const p = require('path').join(__dirname, '..', 'screens', 'UserHome.js');
let s = fs.readFileSync(p, 'utf8');
s = s.replace(
  /const mappedResult = currentUser\\n\s*\? await adminService\.getMappedVendorsForUser\(\)\\n\s*: \{ vendors: \[\], hasMappings: false \};/,
  `const mappedResult = currentUser
        ? await adminService.getMappedVendorsForUser()
        : { vendors: [], hasMappings: false };`
);
fs.writeFileSync(p, s);
console.log('fixed UserHome mappedResult line');
