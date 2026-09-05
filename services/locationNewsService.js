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

async function fetchLocationNews(settings = {}, ctx = {}, limit = 36) {
  const queries = buildQueries(ctx);
  const perQuery = Math.max(3, Math.ceil(limit / Math.min(queries.length, 8)));
  const items = [];
  const hl = resolveGoogleHl(ctx);

  for (const spec of queries.slice(0, 8)) {
    try {
      const url = googleNewsSearchUrl(spec.q, hl);
      const result = await rssNewsService.fetchNews(
        {
          url,
          name: spec.q,
          city: spec.city || '',
          locality: spec.locality || '',
          category: spec.category || 'general',
          country: spec.scope === 'international' ? 'US' : 'IN',
        },
        settings,
        perQuery
      );
      (result.items || []).forEach((item) => {
        items.push({
          ...item,
          scope: spec.scope,
          city: spec.city || item.city,
          locality: spec.locality || item.locality,
          category: spec.category || item.category,
          is_local: spec.scope === 'local',
        });
      });
    } catch (_) {
      // skip failed query
    }
  }

  const merged = dedupeItems(items);
  if (merged.length < 6) {
    return dedupeItems([...merged, ...curatedFallback(ctx)]);
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
  googleNewsSearchUrl,
  curatedFallback,
};
