/**
 * JSON-line diagnostic log store: merge disk + memory, 1-hour TTL, newest-first reads.
 */
const fs = require('fs');
const { sortLatestFirst } = require('./sortLatest');

const DEFAULT_TTL_MS = 60 * 60 * 1000;

function createDiagnosticLogStore({
  logFile,
  maxEntries = 300,
  ttlMs = DEFAULT_TTL_MS,
  dateFields = ['at'],
} = {}) {
  const memory = [];

  function entryTime(entry) {
    if (!entry || typeof entry !== 'object') return 0;
    for (const f of dateFields) {
      const t = new Date(entry[f]).getTime();
      if (Number.isFinite(t)) return t;
    }
    return 0;
  }

  function entryKey(entry) {
    if (entry.id) return String(entry.id);
    return `${entryTime(entry)}_${String(entry.message || entry.stage || '').slice(0, 64)}`;
  }

  function readDiskEntries() {
    try {
      if (!fs.existsSync(logFile)) return [];
      const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean);
      const entries = [];
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line));
        } catch (_) {
          /* skip bad line */
        }
      }
      return entries;
    } catch (_) {
      return [];
    }
  }

  function mergeEntries(...lists) {
    const byKey = new Map();
    for (const list of lists) {
      for (const entry of list) {
        if (!entry || typeof entry !== 'object') continue;
        byKey.set(entryKey(entry), entry);
      }
    }
    return [...byKey.values()];
  }

  function purgeAndCap(entries, now = Date.now()) {
    const cutoff = now - ttlMs;
    const fresh = entries.filter((entry) => entryTime(entry) >= cutoff);
    return sortLatestFirst(fresh, { dateFields }).slice(0, maxEntries);
  }

  function rewriteDisk(entries) {
    try {
      const content = entries.map((entry) => JSON.stringify(entry)).join('\n');
      fs.writeFileSync(logFile, content ? `${content}\n` : '');
    } catch (_) {
      /* ignore disk failures */
    }
  }

  function syncFromDisk(force = false) {
    const now = Date.now();
    const diskEntries = readDiskEntries();
    const merged = purgeAndCap(mergeEntries(memory, diskEntries), now);
    const changed = force
      || merged.length !== memory.length
      || diskEntries.length !== merged.length;
    memory.length = 0;
    memory.push(...merged);
    if (changed) rewriteDisk(merged);
    return merged;
  }

  function append(entry) {
    syncFromDisk(true);
    memory.unshift(entry);
    const trimmed = purgeAndCap(memory);
    memory.length = 0;
    memory.push(...trimmed);
    rewriteDisk(trimmed);
    return entry;
  }

  function getEntries(limit = 50) {
    const entries = syncFromDisk(true);
    return entries.slice(0, Math.min(limit, maxEntries));
  }

  function purgeExpired() {
    syncFromDisk(true);
    return memory.length;
  }

  return { append, getEntries, purgeExpired };
}

module.exports = {
  createDiagnosticLogStore,
  DEFAULT_TTL_MS,
};
