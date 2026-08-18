/**
 * Shared context so feature DB modules connect to main database.js
 * without circular requires. database.js fills these before loading features.
 */
const ctx = {
    getPool: () => null,
    inMemoryDb: null,
    LOG: null,
    DB_TYPE: 'inmemory',
    toMysqlDateTime: null,
    normalizeProductRow: null,
    matchmaking: {},
    ensureMatchmakingTables: async () => {},
    db: null,
};

module.exports = ctx;
