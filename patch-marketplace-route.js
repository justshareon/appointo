const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, 'server.js');
let src = fs.readFileSync(target, 'utf8');

if (src.includes('marketplaceRoutes')) {
  console.log('server.js already has marketplaceRoutes');
  process.exit(0);
}

src = src.replace(
  "app.use('/api', ...offerDb, lazyRouter(() => require('./routes/dealsRoutes')));",
  "app.use('/api', ...offerDb, lazyRouter(() => require('./routes/dealsRoutes')));\napp.use('/api', ...offerDb, lazyRouter(() => require('./routes/marketplaceRoutes')));"
);

fs.writeFileSync(target, src);
console.log('server.js patched with marketplaceRoutes');
