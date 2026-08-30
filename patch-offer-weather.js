const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'screens', 'OfferScreen.js');
const dst = path.join(__dirname, '..', 'screens', 'OfferScreenGeo.js');
const lazy = path.join(__dirname, '..', 'navigation', 'lazyScreens.js');

let s = fs.readFileSync(src, 'utf8');
const banner = `        <NewsLocalPulseBanner
          locationLabel={locationLabel}
          ambient={ambient}
          weatherLoading={weatherLoading}
          locationSource={coords?.source}
          onRefreshLocation={() => refreshWeather(true)}
        />

`;

if (!s.includes('<NewsLocalPulseBanner')) {
  s = s.replace(
    '        </View>\n\n        <View style={styles.searchWrap}>',
    `        </View>\n\n${banner}        <View style={styles.searchWrap}>`
  );
}
fs.writeFileSync(dst, s);
console.log('Wrote OfferScreenGeo.js');

let lazySrc = fs.readFileSync(lazy, 'utf8');
lazySrc = lazySrc.replace(
  /OfferScreen: \(\) => require\('\.\.\/screens\/OfferScreen'\)/g,
  "OfferScreen: () => require('../screens/OfferScreenGeo')"
);
lazySrc = lazySrc.replace(
  /OfferScreen: \(\) => import\('\.\.\/screens\/OfferScreen'\)/g,
  "OfferScreen: () => import('../screens/OfferScreenGeo')"
);
fs.writeFileSync(lazy, lazySrc);
console.log('Updated lazyScreens OfferScreen path');
