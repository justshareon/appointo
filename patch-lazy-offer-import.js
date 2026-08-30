const fs = require('fs');
const path = require('path');

const lazy = path.join(__dirname, '..', 'navigation', 'lazyScreens.js');
let s = fs.readFileSync(lazy, 'utf8');
const before = s;
s = s.replace(
  "OfferScreen: () => import('../screens/OfferScreen')",
  "OfferScreen: () => import('../screens/OfferScreenGeo')"
);
if (s === before) {
  console.log('No change needed or pattern not found');
} else {
  fs.writeFileSync(lazy, s);
  console.log('Updated lazyScreens OfferScreen import');
}
