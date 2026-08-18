require('../loadEnv');

function getFeatureIdleMs() {
    if (process.env.FEATURE_IDLE_MS) {
        return parseInt(process.env.FEATURE_IDLE_MS, 10);
    }
    if (process.env.FEATURE_MEM_IDLE_MS) {
        return parseInt(process.env.FEATURE_MEM_IDLE_MS, 10);
    }
    if (process.env.FEATURE_DB_IDLE_MS) {
        return parseInt(process.env.FEATURE_DB_IDLE_MS, 10);
    }
    const minutes = parseInt(process.env.FEATURE_IDLE_MINUTES || '10', 10);
    return Math.max(1, minutes) * 60 * 1000;
}

module.exports = { getFeatureIdleMs };
