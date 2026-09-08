/**
 * Layered data read: MySQL when populated (authoritative), in-memory as bootstrap/fallback.
 * Results are sorted latest-first (id DESC) unless sortLatest: false.
 */
const { sortLatestFirst } = require('./sortLatest');

/**
 * @param {() => Promise<Array>} readMysql
 * @param {() => Array|Promise<Array>} readMemory
 * @param {{ sortLatest?: boolean }} opts
 * @returns {Promise<Array>}
 */
async function preferMysqlElseMemory(readMysql, readMemory, opts = {}) {
  const sortLatest = opts.sortLatest !== false;
  try {
    const mysqlRows = await readMysql();
    if (Array.isArray(mysqlRows) && mysqlRows.length > 0) {
      return sortLatest ? sortLatestFirst(mysqlRows) : mysqlRows;
    }
  } catch (_) {
    // fall through to in-memory
  }
  const mem = await readMemory();
  const rows = Array.isArray(mem) ? mem : [];
  return sortLatest ? sortLatestFirst(rows) : rows;
}

module.exports = { preferMysqlElseMemory };
