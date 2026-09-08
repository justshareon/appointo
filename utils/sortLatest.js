/**
 * Latest-first ordering: numeric id DESC, then created/date fields DESC.
 * Use for list endpoints so newest records appear on top (R-Detector pattern).
 */

const DEFAULT_ID_FIELDS = ['id', '_id', 'insertId'];
const DEFAULT_DATE_FIELDS = [
  'created_at',
  'updated_at',
  'reported_at',
  'published_at',
  'date',
  'timestamp',
  'joined_at',
  'start_time',
  'startTime',
  'createdAt',
  'at',
];

function numericId(item, fields = DEFAULT_ID_FIELDS) {
  if (!item) return null;
  for (const f of fields) {
    const v = item[f];
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
    const m = String(v).match(/(\d+)\s*$/);
    if (m) return Number(m[1]);
  }
  return null;
}

function dateMs(item, fields = DEFAULT_DATE_FIELDS) {
  if (!item) return 0;
  for (const f of fields) {
    const v = item[f];
    if (!v) continue;
    const t = new Date(v).getTime();
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

function compareLatestFirst(a, b, opts = {}) {
  const idFields = opts.idFields || DEFAULT_ID_FIELDS;
  const dateFields = opts.dateFields || DEFAULT_DATE_FIELDS;
  const ai = numericId(a, idFields);
  const bi = numericId(b, idFields);
  if (ai != null && bi != null && ai !== bi) return bi - ai;
  if (ai != null && bi == null) return -1;
  if (ai == null && bi != null) return 1;
  const ad = dateMs(a, dateFields);
  const bd = dateMs(b, dateFields);
  if (ad !== bd) return bd - ad;
  return 0;
}

function sortLatestFirst(items, opts) {
  return [...(items || [])].sort((a, b) => compareLatestFirst(a, b, opts));
}

/** SQL fragment: ORDER BY id DESC, created_at DESC */
function sqlOrderLatest(prefix = '', dateCol = 'created_at') {
  const p = prefix ? `${prefix}.` : '';
  return `ORDER BY ${p}id DESC, ${p}${dateCol} DESC`;
}

module.exports = {
  compareLatestFirst,
  sortLatestFirst,
  sqlOrderLatest,
  numericId,
  dateMs,
  DEFAULT_ID_FIELDS,
  DEFAULT_DATE_FIELDS,
};
