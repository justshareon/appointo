/**
 * Forward-only MySQL upgrades. Never DROP / TRUNCATE / DELETE rows.
 * Safe to call on every first-open of a feature.
 */
const onceFlags = new Set();

async function runOnce(key, fn) {
    if (onceFlags.has(key)) return;
    await fn();
    onceFlags.add(key);
}

async function exec(pool, sql, params) {
    if (!pool) return;
    await pool.query(sql, params);
}

async function columnExists(pool, table, column) {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
        [table, column]
    );
    return !!(rows && rows.length);
}

/**
 * CREATE TABLE IF NOT EXISTS … (pass the full statement).
 */
async function ensureTable(pool, createSql) {
    if (!pool) return;
    await exec(pool, createSql);
}

/**
 * ADD COLUMN when missing. `definition` is the type + extras, e.g. `TINYINT(1) DEFAULT 0`.
 */
async function addColumn(pool, table, column, definition) {
    if (!pool) return;
    try {
        if (await columnExists(pool, table, column)) return;
        await exec(pool, `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    } catch (err) {
        if (/duplicate column/i.test(String(err.message || ''))) return;
        throw err;
    }
}

async function addColumns(pool, table, columns) {
    for (const [column, definition] of Object.entries(columns || {})) {
        await addColumn(pool, table, column, definition);
    }
}

async function indexExists(pool, table, indexName) {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
        [table, indexName]
    );
    return !!(rows && rows.length);
}

async function addIndex(pool, table, indexName, columnsSql) {
    if (!pool) return;
    try {
        if (await indexExists(pool, table, indexName)) return;
        await exec(pool, `ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` (${columnsSql})`);
    } catch (err) {
        if (/duplicate key name|already exists/i.test(String(err.message || ''))) return;
        throw err;
    }
}

module.exports = {
    runOnce,
    exec,
    ensureTable,
    addColumn,
    addColumns,
    addIndex,
    columnExists,
};
