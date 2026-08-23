/**
 * Lazy feature DB middleware — attach to feature routes only.
 * Generated from database/featureRegistry so a new feature is one catalog entry.
 */
const db = require('../database');
const featureConnectionManager = require('../database/featureConnectionManager');
const { FEATURE_IDS } = require('../database/featureRegistry');

let coreDataSynced = false;
let coreDataSyncPromise = null;

async function syncCoreDataOnce() {
    if (coreDataSynced || db.getType() !== 'mysql') return;
    if (coreDataSyncPromise) return coreDataSyncPromise;
    coreDataSyncPromise = (async () => {
        try {
            if (db.ensureAllUsersAndVendors) await db.ensureAllUsersAndVendors();
            coreDataSynced = true;
        } catch (err) {
            coreDataSyncPromise = null;
            console.warn('[FeatureDB] Core data sync skipped:', err.message);
        }
    })();
    return coreDataSyncPromise;
}

function withFeatureTables(featureKey) {
    return async (req, res, next) => {
        try {
            const featureMemory = require('../database/featureMemoryManager');
            await featureMemory.ensureFeature(featureKey, { mode: 'basic' });
        } catch (err) {
            // non-fatal — in-memory fallback still works
        }
        next();
    };
}

function featureDb(...keys) {
    const list = keys.filter(Boolean);
    if (!list.length) list.push('core');
    const unique = [...new Set(list[0] === 'core' ? list : ['core', ...list])];
    const target = unique[unique.length - 1];
    const chain = [featureConnectionManager.middleware(...unique)];
    if (target === 'core') {
        chain.push(async (req, res, next) => {
            await syncCoreDataOnce();
            next();
        });
        chain.push(withFeatureTables('core'));
    }
    return chain;
}

const coreDb = featureDb('core');
const generated = {};
for (const id of FEATURE_IDS) {
    if (id === 'core') continue;
    const camel = id.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    generated[`${camel}Db`] = featureDb(id);
}

module.exports = {
    featureDb,
    withFeatureTables,
    coreDb,
    tradeDb: generated.tradeDb,
    fleetDb: generated.fleetDb,
    cyberDb: generated.cyberDb,
    trustScoreDb: generated.trustScoreDb,
    matchmakingDb: generated.matchmakingDb,
    queueDb: generated.queueDb,
    appointmentsDb: generated.appointmentsDb,
    offerDb: generated.offerDb,
    qlessDb: generated.qlessDb,
    realestateDb: generated.realestateDb,
    shoppingDb: generated.shoppingDb,
    chatDb: generated.chatDb,
    newsDb: generated.newsDb,
    healthDb: generated.healthDb,
};
