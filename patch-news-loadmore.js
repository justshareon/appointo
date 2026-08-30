const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'screens', 'trading', 'NewsScreenGeo.js');
let s = fs.readFileSync(file, 'utf8');
if (!s.includes('hasMore={newsSlice.hasMore}')) {
  s = s.replace(
    '<LoadMoreButton\n                label=',
    '<LoadMoreButton\n                hasMore={newsSlice.hasMore}\n                label='
  );
  fs.writeFileSync(file, s);
  console.log('added hasMore to LoadMoreButton');
} else {
  console.log('hasMore already set');
}
