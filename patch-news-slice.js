const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, 'services', 'newsCacheService.js');
const extra = `
    /** Category counts from MySQL / in-memory — no RSS fetch. */
    async getMeta(settingsOverride = null) {
        const settings = settingsOverride || await settingsService.getSettings();
        const items = await db.getNewsItems(600);
        const counts = {};
        (items || []).forEach((item) => {
            const cat = item.category || 'general';
            counts[cat] = (counts[cat] || 0) + 1;
        });
        const categories = Object.entries(counts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);
        return { categories, total: (items || []).length, settings };
    }

    _filterScope(items, scope, locationCtx = {}) {
        if (!scope || scope === 'All') return items;
        const city = norm(locationCtx.city);
        const locality = norm(locationCtx.locality || locationCtx.town);
        const intlCats = new Set(['global_news', 'world', 'international']);
        return (items || []).filter((item) => {
            const cat = norm(item.category);
            const blob = norm(\`\${item.text || ''} \${item.city || ''} \${item.locality || ''}\`);
            if (scope === 'international') {
                return intlCats.has(cat) || blob.includes('global') || blob.includes('world');
            }
            if (scope === 'national') {
                return norm(item.country || 'in') === 'in' || !item.country;
            }
            if (scope === 'local' || scope === 'town') {
                if (item.is_local || item.source_type === 'local_vendor' || item.source_type === 'r_detector') return true;
                if (locality && blob.includes(locality)) return true;
                if (city && blob.includes(city)) return true;
                return item.is_local === true;
            }
            if (scope === 'city' && city) return blob.includes(city);
            if (scope === 'state' && locationCtx.state) return blob.includes(norm(locationCtx.state));
            return true;
        });
    }

  async getSlice({
        category = 'All',
        scope = 'All',
        limit = 15,
        locationCtx = {},
        settingsOverride = null,
        refresh = false,
    } = {}) {
        const settings = settingsOverride || await settingsService.getSettings();
        const memKey = \`\${scope}|\${category}|\${limit}|\${locationCtx.city || ''}|\${locationCtx.locality || ''}\`;
        if (!refresh) {
            const hit = sliceMem.get(memKey);
            if (hit && Date.now() - hit.ts < SLICE_TTL_MS) return hit.data;
        }

        let items = await db.getNewsItems(Math.max(limit * 6, 60));
        const hasLocation = !!(locationCtx.city || locationCtx.locality);
        const localScope = ['local', 'town', 'city', 'All'].includes(scope);

        if (hasLocation && localScope && !refresh) {
            try {
                const localItems = await locationNewsService.fetchLocationNews(
                    settings,
                    locationCtx,
                    Math.min(limit, 24)
                );
                items = [...(localItems || []), ...(items || [])];
            } catch (_) {}
        }

        const seen = new Set();
        items = (items || []).filter((item) => {
            const key = item.unique_key || item.id || item.link || item.text;
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        if (category && category !== 'All') {
            items = items.filter(
                (item) => norm(item.category) === norm(category) || norm(item._cat) === norm(category)
            );
        }

        items = this._filterScope(items, scope, locationCtx);
        const { sortNewsItems } = require('./newsLocalPriority');
        items = sortNewsItems(items, settings).slice(0, limit);
        const grouped = newsAggregatorService.groupItems(items, settings);
        const payload = {
            categories: grouped.categories?.length
                ? grouped.categories
                : [{ name: category === 'All' ? 'News' : category, items }],
            slice: true,
            scope,
            category,
        };
        sliceMem.set(memKey, { data: payload, ts: Date.now() });
        return payload;
    }
`;

let src = fs.readFileSync(target, 'utf8');
if (src.includes('getSlice(')) {
  console.log('newsCacheService already has getSlice');
  process.exit(0);
}
src = src.replace(
  '    }\n}\n\nmodule.exports = new NewsCacheService();',
  `    }${extra}\n}\n\nmodule.exports = new NewsCacheService();`
);
fs.writeFileSync(target, src);
console.log('newsCacheService patched with getSlice/getMeta');
