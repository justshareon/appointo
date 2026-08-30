const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'screens', 'trading', 'NewsScreen.js');
let s = fs.readFileSync(file, 'utf8');

if (!s.includes('newsGeoScope')) {
  s = s.replace(
    'import { buildNewsSharePayload, runSocialShare } from "../../utils/socialShare";',
    'import { buildNewsSharePayload, runSocialShare } from "../../utils/socialShare";\n' +
    'import { useLocalWeatherAQI } from "../../hooks/useLocalWeatherAQI";\n' +
    'import {\n' +
    '  ALL_SCOPE,\n' +
    '  NEWS_SCOPE_ORDER,\n' +
    '  groupNewsByScope,\n' +
    '  resolveNewsLanguage,\n' +
    '} from "../../utils/newsGeoScope";'
  );
}

if (!s.includes('locationContext')) {
  s = s.replace(
    'const { categories, loading, refresh, loadMore } = useNews();',
    'const { categories, loading, refresh, loadMore, locationContext } = useNews();\n' +
    '  const { ambient, coords, loading: weatherLoading } = useLocalWeatherAQI();'
  );
  s = s.replace(
    'const [activeCategory, setActiveCategory] = useState(ALL_CATEGORY);',
    'const [activeCategory, setActiveCategory] = useState(ALL_CATEGORY);\n' +
    '  const [activeScope, setActiveScope] = useState(ALL_SCOPE);'
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

if (!s.includes('ScopeTabs')) {
  const scopeTabsComponent = [
    '',
    '  const ScopeTabs = useCallback(() => (',
    '    <View style={styles.scopeContainer}>',
    '      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scopeScroll}>',
    '        {[ALL_SCOPE, ...NEWS_SCOPE_ORDER.map((s) => s.key)].map((scopeKey) => {',
    '          const active = activeScope === scopeKey;',
    '          const label = scopeKey === ALL_SCOPE ? \'All areas\' : (NEWS_SCOPE_ORDER.find((s) => s.key === scopeKey)?.label || scopeKey);',
    '          const count = scopeCounts[scopeKey] || 0;',
    '          return (',
    '            <TouchableOpacity',
    '              key={scopeKey}',
    '              style={[styles.scopeChip, active && styles.scopeChipActive]}',
    '              onPress={() => setActiveScope(scopeKey)}',
    '            >',
    '              <Text style={[styles.scopeChipText, active && styles.scopeChipTextActive]}>',
    '                {label}{count ? ` (${count})` : \'\'}',
    '              </Text>',
    '            </TouchableOpacity>',
    '          );',
    '        })}',
    '      </ScrollView>',
    '      <Text style={styles.scopeHint}>',
    '        {locationContext?.placeLabel || coords?.placeName || \'Your area\'} · {resolveNewsLanguage(features).toUpperCase()} feed',
    '      </Text>',
    '    </View>',
    '  ), [activeScope, scopeCounts, locationContext, coords, features]);',
    '',
    '  const LocalPulseBanner = useCallback(() => (',
    '    <View style={styles.pulseBanner}>',
    '      <View style={styles.pulseRow}>',
    '        <MaterialCommunityIcons name="map-marker-radius" size={18} color={fb.blue} />',
    '        <Text style={styles.pulseTitle}>{locationContext?.placeLabel || coords?.placeName || \'Detecting location…\'}</Text>',
    '      </View>',
    '      <View style={styles.pulseStats}>',
    '        <Text style={styles.pulseStat}>{ambient?.emoji || \'🌡️\'} {ambient?.temperature != null ? `${Math.round(ambient.temperature)}°C` : \'—\'}</Text>',
    '        <Text style={styles.pulseStat}>AQI {ambient?.aqi ?? \'—\'}</Text>',
    '        <Text style={styles.pulseStat}>💨 {ambient?.windSpeed != null ? `${Math.round(ambient.windSpeed)} km/h` : \'—\'}</Text>',
    '        <Text style={styles.pulseStat}>🛣️ R-Detector local</Text>',
    '      </View>',
    '      {weatherLoading ? <Text style={styles.pulseMeta}>Syncing weather & local alerts…</Text> : null}',
    '    </View>',
    '  ), [ambient, coords, locationContext, weatherLoading]);',
    '',
  ].join('\n');

  s = s.replace('  // Render animated category tabs', scopeTabsComponent + '  // Render animated category tabs');
}

if (!s.includes('<LocalPulseBanner />')) {
  s = s.replace(
    '            <SearchBar />\n            <TimeFilter />\n            <CategoryTabs />',
    '            <LocalPulseBanner />\n            <ScopeTabs />\n            <SearchBar />\n            <TimeFilter />\n            <CategoryTabs />'
  );
}

if (!s.includes('scopeContainer:')) {
  s = s.replace(
    'const styles = StyleSheet.create({',
    'const styles = StyleSheet.create({\n' +
    '  pulseBanner: {\n' +
    '    backgroundColor: \'#e7f3ff\',\n' +
    '    borderRadius: 12,\n' +
    '    padding: 12,\n' +
    '    marginBottom: 10,\n' +
    '    borderWidth: 1,\n' +
    '    borderColor: \'#bfdbfe\',\n' +
    '  },\n' +
    '  pulseRow: { flexDirection: \'row\', alignItems: \'center\', gap: 6, marginBottom: 8 },\n' +
    '  pulseTitle: { fontSize: 14, fontWeight: \'800\', color: \'#1e3a8a\', flex: 1 },\n' +
    '  pulseStats: { flexDirection: \'row\', flexWrap: \'wrap\', gap: 10 },\n' +
    '  pulseStat: { fontSize: 12, fontWeight: \'700\', color: \'#1d4ed8\' },\n' +
    '  pulseMeta: { marginTop: 6, fontSize: 11, color: \'#64748b\' },\n' +
    '  scopeContainer: { marginBottom: 8 },\n' +
    '  scopeScroll: { paddingVertical: 4, gap: 8 },\n' +
    '  scopeChip: {\n' +
    '    paddingHorizontal: 12,\n' +
    '    paddingVertical: 7,\n' +
    '    borderRadius: 999,\n' +
    '    backgroundColor: \'#fff\',\n' +
    '    borderWidth: 1,\n' +
    '    borderColor: \'#e5e7eb\',\n' +
    '    marginRight: 8,\n' +
    '  },\n' +
    '  scopeChipActive: { backgroundColor: \'#dbeafe\', borderColor: \'#3b82f6\' },\n' +
    '  scopeChipText: { fontSize: 12, fontWeight: \'600\', color: \'#374151\' },\n' +
    '  scopeChipTextActive: { color: \'#1d4ed8\', fontWeight: \'800\' },\n' +
    '  scopeHint: { fontSize: 11, color: \'#64748b\', marginTop: 4, paddingHorizontal: 2 },'
  );
}

fs.writeFileSync(file, s);
console.log('NewsScreen patched');
