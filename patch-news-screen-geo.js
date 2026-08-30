const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'screens', 'trading', 'NewsScreen.js');
const out = path.join(__dirname, '..', 'screens', 'trading', 'NewsScreenGeo.js');
let s = fs.readFileSync(src, 'utf8');

if (!s.includes('NewsLocalPulseBanner')) {
  s = s.replace(
    'import { useLocalWeatherAQI } from "../../hooks/useLocalWeatherAQI";',
    'import { useLocalWeatherAQI } from "../../hooks/useLocalWeatherAQI";\n' +
    'import NewsLocalPulseBanner from "../../components/NewsLocalPulseBanner";\n' +
    'import NewsScopeFilter from "../../components/NewsScopeFilter";'
  );
}

if (!s.includes('scopeGroups')) {
  s = s.replace(
    '  const allItems = useMemo(\n' +
    '    () => categories.flatMap(c => cleanNewsItems(c.items || []).map(i => ({ ...i, _cat: c.name }))),\n' +
    '    [categories, cleanNewsItems]\n' +
    '  );',
    '  const allItems = useMemo(\n' +
    '    () => categories.flatMap(c => cleanNewsItems(c.items || []).map(i => ({ ...i, _cat: c.name }))),\n' +
    '    [categories, cleanNewsItems]\n' +
    '  );\n\n' +
    '  const scopeGroups = useMemo(\n' +
    '    () => groupNewsByScope(allItems, locationContext || {}),\n' +
    '    [allItems, locationContext]\n' +
    '  );\n\n' +
    '  const scopeCounts = useMemo(() => {\n' +
    '    const counts = { [ALL_SCOPE]: allItems.length };\n' +
    '    NEWS_SCOPE_ORDER.forEach(({ key }) => {\n' +
    '      counts[key] = (scopeGroups[key] || []).length;\n' +
    '    });\n' +
    '    return counts;\n' +
    '  }, [allItems.length, scopeGroups]);'
  );
}

if (!s.includes('activeScope === ALL_SCOPE')) {
  s = s.replace(
    '    return pool.filter(\n' +
    '      (item) =>\n' +
    '        (!timeHours || withinHours(item.date, timeHours)) &&\n' +
    "        (!searchQuery || String(item.text || '').toLowerCase().includes(searchQuery.toLowerCase()))\n" +
    '    );\n' +
    '  }, [activeCategory, allItems, categories, timeHours, searchQuery, withinHours, cleanNewsItems]);',
    '    return pool.filter(\n' +
    '      (item) =>\n' +
    '        (activeScope === ALL_SCOPE || item._scope === activeScope) &&\n' +
    '        (!timeHours || withinHours(item.date, timeHours)) &&\n' +
    "        (!searchQuery || String(item.text || '').toLowerCase().includes(searchQuery.toLowerCase()))\n" +
    '    );\n' +
    '  }, [activeCategory, activeScope, allItems, categories, timeHours, searchQuery, withinHours, cleanNewsItems]);'
  );
}

if (!s.includes('activeScope, searchQuery')) {
  s = s.replace(
    '  }, [activeCategory, searchQuery, timeFilter]);',
    '  }, [activeCategory, activeScope, searchQuery, timeFilter]);'
  );
}

if (!s.includes('<NewsLocalPulseBanner')) {
  s = s.replace(
    '            <SearchBar />\n            <TimeFilter />\n            <CategoryTabs />',
    '            <NewsLocalPulseBanner\n' +
    '              locationLabel={locationContext?.placeLabel || coords?.placeName}\n' +
    '              ambient={ambient}\n' +
    '              weatherLoading={weatherLoading}\n' +
    '            />\n' +
    '            <NewsScopeFilter\n' +
    '              activeScope={activeScope}\n' +
    '              onChangeScope={setActiveScope}\n' +
    '              scopeCounts={scopeCounts}\n' +
    '              locationLabel={locationContext?.placeLabel || coords?.placeName}\n' +
    '              languageLabel={resolveNewsLanguage(features).toUpperCase()}\n' +
    '            />\n' +
    '            <SearchBar />\n' +
    '            <TimeFilter />\n' +
    '            <CategoryTabs />'
  );
}

fs.writeFileSync(out, s);
console.log('Wrote', out);
