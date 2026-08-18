/**
 * Compact timing logs so we can see which API is slow
 * and whether it hit in-memory or MySQL.
 */
const stamp = () => new Date().toLocaleTimeString();

const slowTag = (ms, threshold) => (ms >= threshold ? ' SLOW' : '');

function logApiStart(method, url, dbMode) {
    console.log(`[API START] ${stamp()} | ${method} ${url} | db=${dbMode}`);
}

function logApiDone(method, url, ms, dbMode, mysqlCount = 0, mysqlMs = 0) {
    console.log(
        `[API DONE]${slowTag(ms, 500)} ${stamp()} | ${method} ${url} | ${ms}ms | db=${dbMode} | mysqlQueries=${mysqlCount} (${mysqlMs}ms)`
    );
}

function logDbAccess(source, name, ms) {
    if (source === 'INMEMORY' && ms < 50) return;
    console.log(`[DB ${source}]${slowTag(ms, 200)} ${stamp()} | ${name}() | ${ms}ms`);
}

function logMysqlQuery(feature, sql, ms) {
    const preview = String(sql || 'query').replace(/\s+/g, ' ').trim().slice(0, 140);
    console.log(`[MYSQL QUERY]${slowTag(ms, 200)} ${stamp()} | ${ms}ms | feature=${feature} | ${preview}`);
}

function logMysqlPool(feature, action, ms, extra = '') {
    console.log(
        `[MYSQL POOL]${slowTag(ms, 500)} ${stamp()} | ${action} feature=${feature} | ${ms}ms${extra ? ` | ${extra}` : ''}`
    );
}

module.exports = {
    logApiStart,
    logApiDone,
    logDbAccess,
    logMysqlQuery,
    logMysqlPool,
};
