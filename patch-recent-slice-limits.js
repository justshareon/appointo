/**
 * Apply today-first + capped limits across slow slice APIs.
 * Run: node backend/patch-recent-slice-limits.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function patch(file, replacements) {
  const fp = path.join(root, file);
  let s = fs.readFileSync(fp, 'utf8');
  let n = 0;
  for (const [from, to] of replacements) {
    if (!s.includes(from)) {
      console.warn(`[skip] not found in ${file}:`, from.slice(0, 60));
      continue;
    }
    s = s.replace(from, to);
    n++;
  }
  fs.writeFileSync(fp, s);
  console.log(`Patched ${file} (${n} replacements)`);
}

// marketplaceSliceService
patch('backend/services/marketplaceSliceService.js', [
  [
    "const sliceMem = new Map();",
    "const { clampLimit, sortTodayRecentFirst, withinRecentDays } = require('../utils/recentSlice');\n\nconst sliceMem = new Map();",
  ],
  [
    `    const rows = await dealsService.getDealsFromDB({ limit: Math.max(limit, 40) });`,
    `    const rows = await dealsService.getDealsFromDB({ limit: Math.min(Math.max(limit, 20), 40) });`,
  ],
  [
    `    const rows = await db.getVendors(true, 1, 1000, 'newest', '', true, 'offer');`,
    `    const rows = await db.getVendors(true, 1, 40, 'newest', '', true, 'offer');`,
  ],
  [
    `    return list.filter((p) => p.offer && !/^no offer$/i.test(String(p.offer))).slice(0, Math.max(limit, 60));`,
    `    return list.filter((p) => p.offer && !/^no offer$/i.test(String(p.offer))).slice(0, Math.min(Math.max(limit, 20), 40));`,
  ],
  [
    `  const {
    scope = 'All',
    category = 'all',
    type = 'all',
    sources = 'deals',
    limit = 20,
    city = '',
    locality = '',
  } = opts;`,
    `  const safeLimit = clampLimit(opts.limit, { def: 20, max: 30 });
  const {
    scope = 'All',
    category = 'all',
    type = 'all',
    sources = 'deals',
    city = '',
    locality = '',
  } = opts;`,
  ],
  [
    `    result.deals = filterRows(await fetchDeals(limit * 2), { category, type, scope, ctx }).slice(0, limit);`,
    `    result.deals = sortTodayRecentFirst(
      filterRows(await fetchDeals(safeLimit * 2), { category, type, scope, ctx }),
      safeLimit,
      ['updated_at', 'created_at', 'date']
    );`,
  ],
  [
    `    result.vendors = filterRows(await fetchVendors(), { category, type, scope, ctx }).slice(0, limit);`,
    `    result.vendors = filterRows(await fetchVendors(), { category, type, scope, ctx }).slice(0, safeLimit);`,
  ],
  [
    `    result.products = filterRows(await fetchProducts(limit * 3), { category, type, scope, ctx }).slice(0, limit);`,
    `    result.products = filterRows(await fetchProducts(safeLimit * 2), { category, type, scope, ctx }).slice(0, safeLimit);`,
  ],
]);

// fleetService hazards
patch('backend/services/fleetService.js', [
  [
    `    async getHazards({ latitude, longitude, radiusMiles = 25, limit = 50 } = {}) {`,
    `    async getHazards({ latitude, longitude, radiusMiles = 25, limit = 20 } = {}) {`,
  ],
  [
    `            const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);`,
    `            const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 30);`,
  ],
  [
    `                    WHERE h.reported_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)`,
    `                    WHERE h.reported_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
  ],
  [
    `                WHERE h.reported_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)`,
    `                WHERE h.reported_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
  ],
]);

patch('backend/routes/fleetRoutes.js', [
  [`        const limit = parseInt(req.query.limit, 10) || 50;`, `        const limit = Math.min(parseInt(req.query.limit, 10) || 20, 30);`],
]);

patch('backend/routes/marketplaceRoutes.js', [
  [`      limit: parseInt(req.query.limit, 10) || 20,`, `      limit: Math.min(parseInt(req.query.limit, 10) || 20, 30),`],
]);

// Suraksha controllers
patch('backend/controllers/suraksha/reportController.js', [
  [`            const limit = parseInt(req.query.limit) || 50;`, `            const limit = Math.min(parseInt(req.query.limit, 10) || 24, 40);`],
]);

patch('backend/controllers/suraksha/validationController.js', [
  [`            const limit = parseInt(req.query.limit) || 50;`, `            const limit = Math.min(parseInt(req.query.limit, 10) || 24, 40);`],
]);

patch('backend/controllers/suraksha/cyberThreatController.js', [
  [`                limit: parseInt(req.query.limit) || 50`, `                limit: Math.min(parseInt(req.query.limit, 10) || 24, 40)`],
]);

// Suraksha services - today first
patch('backend/services/suraksha/cyberThreatService.js', [
  [
    `const db = require('../../database');`,
    `const db = require('../../database');\nconst { sortTodayRecentFirst, withinRecentDays } = require('../../utils/recentSlice');`,
  ],
  [
    `            return threats.slice(0, filters.limit || 50);`,
    `            const capped = Math.min(parseInt(filters.limit, 10) || 24, 40);
            const recent = withinRecentDays(threats, 14, ['created_at', 'updated_at', 'last_reported']);
            return sortTodayRecentFirst(recent, capped, ['created_at', 'updated_at', 'last_reported']);`,
  ],
]);

patch('backend/services/suraksha/validationService.js', [
  [
    `const db = require('../../database');`,
    `const db = require('../../database');\nconst { sortTodayRecentFirst, withinRecentDays } = require('../../utils/recentSlice');`,
  ],
  [
    `    async getValidationHistory(userId, limit = 50) {
        if (db.surakshaValidations) {
            return db.surakshaValidations
                .filter(v => v.user_id === userId)
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                .slice(0, limit);
        }
        return [];
    }`,
    `    async getValidationHistory(userId, limit = 24) {
        const capped = Math.min(parseInt(limit, 10) || 24, 40);
        if (db.surakshaValidations) {
            const rows = withinRecentDays(
                db.surakshaValidations.filter((v) => v.user_id === userId),
                30,
                ['created_at', 'updated_at']
            );
            return sortTodayRecentFirst(rows, capped, ['created_at', 'updated_at']);
        }
        return [];
    }`,
  ],
]);

// Frontend defaults
patch('services/modules/suraksha.service.js', [
  [`    getHistory: async (limit = 50) => {`, `    getHistory: async (limit = 24) => {`],
  [`    getReports: async (limit = 50) => {`, `    getReports: async (limit = 24) => {`],
]);

patch('services/modules/fleet.service.js', [
  [`    getHazards: async (latitude, longitude, radius = 25, limit = 50) => {`, `    getHazards: async (latitude, longitude, radius = 25, limit = 20) => {`],
]);

patch('screens/fleet/FleetDashboardView.js', [
  [`        fleetService.getHazards(lat, lng, 25, 30).catch(() => []),`, `        fleetService.getHazards(lat, lng, 25, 20).catch(() => []),`],
]);

console.log('Done — restart backend and hard-refresh app.');
