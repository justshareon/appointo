const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, 'server.js');
let src = fs.readFileSync(target, 'utf8');

if (!src.includes('newsSliceRoutes')) {
  src = src.replace(
    "app.use('/api/trading', ...tradeDb, lazyRouter(() => require('./routes/tradingRoutes')));",
    "app.use('/api/trading', ...tradeDb, lazyRouter(() => require('./routes/tradingRoutes')));\napp.use('/api/trading', ...tradeDb, lazyRouter(() => require('./routes/newsSliceRoutes')));"
  );
}

if (!src.includes('marketplaceRoutes')) {
  src = src.replace(
    "app.use('/api', ...offerDb, lazyRouter(() => require('./routes/dealsRoutes')));",
    "app.use('/api', ...offerDb, lazyRouter(() => require('./routes/dealsRoutes')));\napp.use('/api', ...offerDb, lazyRouter(() => require('./routes/marketplaceRoutes')));"
  );
}

fs.writeFileSync(target, src);
console.log('server.js patched (newsSlice + marketplace)');
