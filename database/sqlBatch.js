/**
 * Batched INSERT helper. Never DROP / TRUNCATE.
 */
async function insertMany(pool, table, columns, rows, options = {}) {
    if (!pool || !Array.isArray(rows) || rows.length === 0 || !columns?.length) return 0;
    const chunkSize = Math.max(1, Number(options.chunkSize) || 50);
    const ignore = options.ignore === true;
    const update = String(options.update || '').trim();
    let written = 0;
    const colSql = columns.map((c) => `\`${c}\``).join(', ');
    const rowPh = `(${columns.map(() => '?').join(', ')})`;

    for (let i = 0; i < rows.length; i += chunkSize) {
        const part = rows.slice(i, i + chunkSize);
        const placeholders = part.map(() => rowPh).join(', ');
        const values = [];
        for (const row of part) {
            for (const col of columns) values.push(row[col]);
        }
        const verb = ignore ? 'INSERT IGNORE INTO' : 'INSERT INTO';
        let sql = `${verb} \`${table}\` (${colSql}) VALUES ${placeholders}`;
        if (update) sql += ` ON DUPLICATE KEY UPDATE ${update}`;
        await pool.query(sql, values);
        written += part.length;
    }
    return written;
}

function inPlaceholders(count) {
    return Array.from({ length: Math.max(0, count) }, () => '?').join(', ');
}

module.exports = {
    insertMany,
    inPlaceholders,
};
