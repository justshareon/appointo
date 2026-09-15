/**
 * APS runtime database mode — overrides env DB_TYPE without restart.
 * Persisted in system_settings as aps_runtime_db_type.
 */
const { resolveDbType } = require('./resolveDbType');

const SETTINGS_KEY = 'aps_runtime_db_type';

/** @type {'mysql'|'inmemory'|null} */
let runtimeOverride = null;

function getRuntimeDbType() {
    if (runtimeOverride === 'mysql' || runtimeOverride === 'inmemory') {
        return runtimeOverride;
    }
    return resolveDbType();
}

function setRuntimeDbType(type) {
    const t = String(type || '').trim().toLowerCase();
    if (t !== 'mysql' && t !== 'inmemory') {
        throw new Error('runtime db type must be mysql or inmemory');
    }
    runtimeOverride = t;
    try {
        const dbContext = require('../database/dbContext');
        if (dbContext && typeof dbContext === 'object') {
            dbContext._runtimeDbType = t;
        }
    } catch (_) {
        /* dbContext not ready */
    }
}

function clearRuntimeDbTypeOverride() {
    runtimeOverride = null;
}

function getRuntimeOverride() {
    return runtimeOverride;
}

/** Wire dbContext.DB_TYPE getter once database modules load. */
function attachDbContextGetter() {
    try {
        const dbContext = require('../database/dbContext');
        if (dbContext.__runtimeDbGetterAttached) return;
        try {
            delete dbContext.DB_TYPE;
        } catch (_) {
            /* ignore */
        }
        Object.defineProperty(dbContext, 'DB_TYPE', {
            configurable: true,
            enumerable: true,
            get() {
                return getRuntimeDbType();
            },
        });
        dbContext.__runtimeDbGetterAttached = true;
    } catch (_) {
        /* ignore */
    }
}

attachDbContextGetter();

module.exports = {
    SETTINGS_KEY,
    getRuntimeDbType,
    setRuntimeDbType,
    clearRuntimeDbTypeOverride,
    getRuntimeOverride,
    attachDbContextGetter,
};
