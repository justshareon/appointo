/**
 * Shared helpers — today-first ordering + safe limits for lazy slices.
 */

function startOfTodayMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function itemTimestamp(item, fields = ['date', 'created_at', 'reported_at', 'updated_at', 'published_at']) {
  if (!item) return 0;
  for (const f of fields) {
    const v = item[f];
    if (!v) continue;
    const t = new Date(v).getTime();
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

function isTodayItem(item, fields) {
  return itemTimestamp(item, fields) >= startOfTodayMs();
}

function clampLimit(raw, { def = 20, max = 40 } = {}) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

/** Today items first, then newest — cap to limit. */
function sortTodayRecentFirst(items, limit, fields) {
  const list = Array.isArray(items) ? [...items] : [];
  list.sort((a, b) => itemTimestamp(b, fields) - itemTimestamp(a, fields));
  const today = [];
  const older = [];
  list.forEach((item) => {
    if (isTodayItem(item, fields)) today.push(item);
    else older.push(item);
  });
  return [...today, ...older].slice(0, limit);
}

/** Drop items older than maxAgeDays (keep undated). */
function withinRecentDays(items, maxAgeDays = 14, fields) {
  if (!maxAgeDays || maxAgeDays <= 0) return items;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  return (items || []).filter((item) => {
    const ts = itemTimestamp(item, fields);
    return !ts || ts >= cutoff;
  });
}

module.exports = {
  clampLimit,
  sortTodayRecentFirst,
  withinRecentDays,
  isTodayItem,
  itemTimestamp,
};
