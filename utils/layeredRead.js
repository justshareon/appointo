/**
 * Layered data read: MySQL when populated (authoritative), in-memory as bootstrap/fallback.
 * Write path: API fetch → save to in-memory + MySQL (see saveNewsItems / sync services).
 */

/**
 * @param {() => Promise<Array>} readMysql
 * @param {() => Array|Promise<Array>} readMemory
 * @returns {Promise<Array>}
 */
async function preferMysqlElseMemory(readMysql, readMemory) {
  try {
    const mysqlRows = await readMysql();
    if (Array.isArray(mysqlRows) && mysqlRows.length > 0) {
      return mysqlRows;
    }
  } catch (_) {
    // fall through to in-memory
  }
  const mem = await readMemory();
  return Array.isArray(mem) ? mem : [];
}

module.exports = { preferMysqlElseMemory };
