/**
 * Database module index — lazy-loads per-feature modules on first use.
 */
const originalDb = require('../database');
const featureConnectionManager = require('./featureConnectionManager');
const { FEATURE_IDS } = require('./featureRegistry');

function asFeature(mod, name) {
    if (typeof mod === 'function') {
        return { feature: name, create: mod };
    }
    return mod;
}

const FEATURE_LOADERS = {
    core: () => require('./features/core'),
    trade: () => require('./features/trade'),
    fleet: () => require('./features/fleet'),
    cyber: () => require('./features/cyber'),
    trust_score: () => require('./features/trust_score'),
    offer: () => require('./features/offer'),
    qless: () => require('./features/qless'),
    realestate: () => require('./features/realestate'),
    matchmaking: () => require('./features/matchmaking'),
    queue: () => require('./features/queue'),
    appointments: () => require('./features/appointments'),
    shopping: () => require('./features/shopping'),
    chat: () => require('./features/chat'),
    news: () => require('./features/news'),
    health: () => require('./features/health'),
};

const cache = Object.create(null);

function getFeature(name) {
    if (!FEATURE_LOADERS[name]) return null;
    if (!cache[name]) {
        cache[name] = asFeature(FEATURE_LOADERS[name](), name);
    }
    return cache[name];
}

const features = new Proxy(
    {},
    {
        get(_t, prop) {
            if (typeof prop !== 'string') return undefined;
            return getFeature(prop);
        },
        ownKeys() {
            return FEATURE_IDS.filter((id) => FEATURE_LOADERS[id]);
        },
        getOwnPropertyDescriptor(_t, prop) {
            if (!FEATURE_LOADERS[prop]) return undefined;
            return { configurable: true, enumerable: true, value: getFeature(prop) };
        },
    }
);

module.exports = {
    ...originalDb,
    featureConnectionManager,
    getFeature,
    features,
};
