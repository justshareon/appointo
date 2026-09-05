/**
 * Location-aware Google News RSS + curated fallbacks for Panvel/Mumbai/India/World.
 */
const rssNewsService = require('./rssNewsService');

const norm = (v) => String(v || '').trim().toLowerCase();

function googleNewsSearchUrl(query, hl = 'en-IN', gl = 'IN') {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${gl}:${hl.startsWith('hi') ? 'hi' : 'en'}`;
}

function resolveGoogleHl(ctx = {}) {
  const lang = norm(ctx.language);
  if (lang === 'hi') return 'hi-IN';
  if (lang === 'en') return 'en-IN';
  return 'en-IN';
}

function dedupeItems(items) {
  const seen = new Set();
  const out = [];
  (items || []).forEach((i) => {
    const key = i.link || i.id || i.text;
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(i);
  });
  return out;
}

function titleCase(s) {
  return String(s || '')
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function buildTierQueries(ctx = {}, pass = 0) {
  const locality = norm(ctx.locality || '');
  const town = norm(ctx.town || ctx.locality || '');
  const city = titleCase(ctx.city || '');
  const state = titleCase(ctx.state || 'Maharashtra');
  const queries = [];

  if (locality && locality.length > 2) {
    queries.push({
      q: pass === 0 ? `${titleCase(locality)} ${state} news` : `${titleCase(locality)} neighbourhood update`,
      scope: 'local',
      locality: titleCase(locality),
      city,
      state,
      category: 'local_news',
    });
  }

  if (town && town.length > 2) {
    queries.push({
      q: pass === 0 ? `${titleCase(town)} news today` : `${titleCase(town)} ${city || state} local news`,
      scope: 'town',
      locality: titleCase(town),
      town: titleCase(town),
      city,
      state,
      category: 'local_news',
    });
  }

  if (city) {
    queries.push({
      q: pass === 0 ? `${city} news today` : `${city} ${state} headlines`,
      scope: 'city',
      city,
      state,
      category: 'city_news',
    });
  }

  if (state) {
    queries.push({
      q: pass === 0 ? `${state} news` : `${state} politics business`,
      scope: 'state',
      state,
      category: 'politics',
    });
  }

  return queries;
}

function buildQueries(ctx = {}) {
  const locality = norm(ctx.locality || ctx.town || '');
  const city = titleCase(ctx.city || 'Mumbai');
  const state = titleCase(ctx.state || 'Maharashtra');
  const panvel = locality.includes('panvel') || norm(ctx.city).includes('panvel') || norm(ctx.placeLabel).includes('panvel');
  const mumbai = norm(city).includes('mumbai') || panvel || norm(ctx.district).includes('mumbai');

  const queries = [];

  if (locality && locality.length > 2) {
    queries.push({ q: `${locality} ${state} news`, scope: 'local', locality: titleCase(locality), city, category: 'local_news' });
  }
  if (panvel) {
    queries.push({ q: 'Panvel Wadhwa Wise City Godrej', scope: 'local', locality: 'Panvel', city: 'Navi Mumbai', category: 'local_news' });
    queries.push({ q: 'Panvel Navi Mumbai incident traffic', scope: 'local', locality: 'Panvel', city: 'Navi Mumbai', category: 'local_news' });
  }
  if (mumbai) {
    queries.push({ q: 'Mumbai local train metro news', scope: 'city', city: 'Mumbai', category: 'local_news' });
    queries.push({ q: `${city} news today`, scope: 'city', city, category: 'city_news' });
  }
  queries.push(
    { q: 'India politics Modi government parliament', scope: 'national', category: 'politics' },
    { q: 'CJI Supreme Court Delhi protest news', scope: 'national', category: 'politics' },
    { q: 'India business startup deals funding', scope: 'national', category: 'business' },
    { q: 'Bollywood entertainment India', scope: 'national', category: 'entertainment' },
    { q: 'Donald Trump world news', scope: 'international', category: 'global_news' },
    { q: 'global economy business deals', scope: 'international', category: 'global_news' }
  );
  return queries;
}

function curatedFallback(ctx = {}) {
  const locality = titleCase(ctx.locality || ctx.town || 'Panvel');
  const city = titleCase(ctx.city || 'Mumbai');
  const now = new Date().toISOString();
  return [
    {
      id: 'cur_local_1',
      text: `${locality}: civic updates and neighbourhood alerts in your area`,
      description: `Hyper-local coverage for ${locality} residents including housing projects and road updates.`,
      scope: 'local',
      locality,
      city,
      category: 'local_news',
      source: 'Local Pulse',
      date: now,
      is_local: true,
    },
    {
      id: 'cur_city_1',
      text: `${city} local train & metro: commuters watch schedule changes`,
      description: 'Western, Central and Harbour line updates for Mumbai metropolitan commuters.',
      scope: 'city',
      city,
      category: 'local_news',
      source: 'Mumbai Rail',
      date: now,
    },
    {
      id: 'cur_nat_1',
      text: 'Parliament session: political debate on governance reforms',
      description: 'National political coverage including government policy and opposition response.',
      scope: 'national',
      category: 'politics',
      country: 'IN',
      source: 'India Politics',
      date: now,
    },
    {
      id: 'cur_nat_2',
      text: 'Business deals this week: startups and large-cap partnerships',
      description: 'Corporate tie-ups, funding rounds and sector deals from the past 7 days.',
      scope: 'national',
      category: 'business',
      country: 'IN',
      source: 'Business Desk',
      date: now,
    },
    {
      id: 'cur_int_1',
      text: 'Global headlines: US politics and international markets',
      description: 'World news including US leadership updates and cross-border business.',
      scope: 'international',
      category: 'global_news',
      source: 'World Wire',
      date: now,
    },
  ];
}

async function fetchQueryBatch(spec, settings, perQuery, hl) {
  const url = googleNewsSearchUrl(spec.q, hl);
  const result = await rssNewsService.fetchNews(
    {
      url,
      name: spec.q,
      city: spec.city || '',
      locality: spec.locality || spec.town || '',
      state: spec.state || '',
      category: spec.category || 'general',
      country: spec.scope === 'international' ? 'US' : 'IN',
    },
    settings,
    perQuery
  );
  return (result.items || []).map((item) => ({
    ...item,
    scope: spec.scope,
    city: spec.city || item.city,
    locality: spec.locality || spec.town || item.locality,
    state: spec.state || item.state,
    category: spec.category || item.category,
    is_local: spec.scope === 'local' || spec.scope === 'town',
  }));
}

const GEO_SCOPE_RANK = { local: 0, town: 1, city: 2, district: 3, state: 4, national: 5, international: 6 };

function orderItemsByGeoScope(items, ctx = {}) {
  const locality = norm(ctx.locality);
  const town = norm(ctx.town || ctx.locality);
  const city = norm(ctx.city);
  const state = norm(ctx.state);

  const rank = (item) => {
    const scope = norm(item.scope);
    if (GEO_SCOPE_RANK[scope] != null) return GEO_SCOPE_RANK[scope];
    const blob = norm(`${item.text || ''} ${item.locality || ''} ${item.city || ''}`);
    if (locality && blob.includes(locality)) return 0;
    if (town && blob.includes(town)) return 1;
    if (city && blob.includes(city)) return 2;
    if (state && blob.includes(state)) return 4;
    return 5;
  };

  return [...(items || [])].sort((a, b) => {
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    return new Date(b.date || b.published_at || 0) - new Date(a.date || a.published_at || 0);
  });
}

async function fetchTieredPasses(settings, ctx, limit, language) {
  const langCtx = { ...ctx, language: language || ctx.language || 'hi' };
  const hl = resolveGoogleHl(langCtx);
  const perQuery = Math.max(3, Math.ceil(limit / 6));
  const items = [];

  for (let pass = 0; pass < 2; pass += 1) {
    const tierQueries = buildTierQueries(langCtx, pass);
    for (const spec of tierQueries) {
      try {
        const batch = await fetchQueryBatch(spec, settings, perQuery, hl);
        items.push(...batch.map((item) => ({ ...item, language: langCtx.language })));
      } catch (_) {
        /* skip failed query */
      }
    }
  }

  return items;
}

async function fetchLocationNews(settings = {}, ctx = {}, limit = 36) {
  const primaryLang = norm(ctx.language) || 'hi';
  let items = await fetchTieredPasses(settings, ctx, limit, primaryLang);

  // Hindi selected but thin results → also fetch English RSS for same town/city/state
  if ((primaryLang === 'hi' || primaryLang === 'all') && dedupeItems(items).length < 6) {
    const enItems = await fetchTieredPasses(settings, ctx, limit, 'en');
    items = [...items, ...enItems];
  }

  // Broader national/international fill (once)
  const hl = resolveGoogleHl(ctx);
  const perQuery = Math.max(3, Math.ceil(limit / 6));
  const broad = buildQueries(ctx).filter((q) => ['national', 'international'].includes(q.scope));
  for (const spec of broad.slice(0, 4)) {
    try {
      const batch = await fetchQueryBatch(spec, settings, perQuery, hl);
      items.push(...batch);
    } catch (_) {
      /* skip */
    }
  }

  const merged = orderItemsByGeoScope(dedupeItems(items), ctx);
  if (merged.length < 6) {
    return orderItemsByGeoScope(dedupeItems([...merged, ...curatedFallback(ctx)]), ctx);
  }
  return merged.slice(0, limit);
}

function groupLocationNewsItems(items) {
  const buckets = {};
  (items || []).forEach((item) => {
    const cat = item.category || 'local_news';
    if (!buckets[cat]) buckets[cat] = [];
    buckets[cat].push(item);
  });
  return Object.keys(buckets).map((name) => ({ name, items: buckets[name] }));
}

module.exports = {
  fetchLocationNews,
  groupLocationNewsItems,
  buildQueries,
  buildTierQueries,
  orderItemsByGeoScope,
  googleNewsSearchUrl,
  curatedFallback,
};
