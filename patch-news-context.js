const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'contexts', 'NewsContext.js');
let s = fs.readFileSync(target, 'utf8');
const bad = `    useEffect(() => {
        if (!categories.length) return;
        let cancelled = false;
        processCategories(categories).then((sorted) => {
          if (!cancelled && sorted?.length) setCategories(sorted);
        });
        return () => { cancelled = true; };
    }, [coords?.placeName, coords?.city, coords?.state]);

`;
if (s.includes('coords?.placeName, coords?.city')) {
  s = s.replace(bad, '');
  fs.writeFileSync(target, s);
  console.log('NewsContext patched');
} else {
  console.log('NewsContext already patched');
}
