/**
 * Database module index — connects main database.js with per-feature lazy pools.
 */
const originalDb = require('../database');
const featureConnectionManager = require('./featureConnectionManager');

function asFeature(mod, name) {
    if (typeof mod === 'function') {
        return { feature: name, create: mod };
    }
    return mod;
}

const features = {
    core: require('./features/core'),
    trade: require('./features/trade'),
    fleet: require('./features/fleet'),
    cyber: require('./features/cyber'),
    trust_score: require('./features/trust_score'),
    offer: require('./features/offer'),
    qless: asFeature(require('./features/qless'), 'qless'),
    realestate: asFeature(require('./features/realestate'), 'realestate'),
    matchmaking: asFeature(require('./features/matchmaking'), 'matchmaking'),
    queue: asFeature(require('./features/queue'), 'queue'),
    appointments: asFeature(require('./features/appointments'), 'appointments'),
    shopping: asFeature(require('./features/shopping'), 'shopping'),
};

module.exports = {
    ...originalDb,
    featureConnectionManager,
    features,
};
