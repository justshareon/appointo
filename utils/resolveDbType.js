/**
 * Single source of truth for DB_TYPE.
 * - Explicit DB_TYPE env wins (mysql | inmemory)
 * - When MySQL credentials exist but DB_TYPE unset → mysql (online deploy default)
 * - Otherwise → inmemory (fast local dev)
 */
function resolveDbType(env = process.env) {
    const explicit = String(env.DB_TYPE || '').trim().toLowerCase();
    if (explicit === 'mysql' || explicit === 'inmemory') return explicit;
    if (env.DB_HOST || env.DB_NAME) return 'mysql';
    return 'inmemory';
}

function isMysqlMode(env = process.env) {
    return resolveDbType(env) === 'mysql';
}

function isMysqlConfigured(env = process.env) {
    return Boolean(env.DB_HOST || env.DB_NAME);
}

module.exports = {
    resolveDbType,
    isMysqlMode,
    isMysqlConfigured,
};
