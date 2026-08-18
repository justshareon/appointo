/**
 * Lazy feature DB middleware — attach to feature routes only.
 */
const db = require('../database');
const featureConnectionManager = require('../database/featureConnectionManager');

let coreDataSynced = false;

async function syncCoreDataOnce() {
    if (coreDataSynced || db.getType() !== 'mysql') return;
    coreDataSynced = true;
    try {
        if (db.ensureAllUsersAndVendors) await db.ensureAllUsersAndVendors();
    } catch (err) {
        console.warn('[FeatureDB] Core data sync skipped:', err.message);
    }
}

function withFeatureTables(featureKey) {
    return async (req, res, next) => {
        try {
            const featureMemory = require('../database/featureMemoryManager');
            await featureMemory.ensureFeature(featureKey, { mode: 'basic' });
            const featureDb = require(`../database/features/${featureKey}`);
            const mod = typeof featureDb === 'function' ? null : featureDb;
            if (mod && mod.ensureTables) {
                await mod.ensureTables(db);
            }
        } catch (err) {
            // non-fatal — in-memory fallback still works
        }
        next();
    };
}

const coreDb = [
    featureConnectionManager.middleware('core'),
    async (req, res, next) => {
        await syncCoreDataOnce();
        next();
    },
];

module.exports = {
    coreDb,
    tradeDb: [featureConnectionManager.middleware('core', 'trade'), withFeatureTables('trade')],
    fleetDb: [featureConnectionManager.middleware('core', 'fleet'), withFeatureTables('fleet')],
    cyberDb: [featureConnectionManager.middleware('core', 'cyber'), withFeatureTables('cyber')],
    trustScoreDb: [featureConnectionManager.middleware('core', 'trust_score')],
    matchmakingDb: [featureConnectionManager.middleware('core', 'matchmaking')],
    queueDb: [featureConnectionManager.middleware('core', 'queue')],
    appointmentsDb: [featureConnectionManager.middleware('core', 'appointments')],
    offerDb: [featureConnectionManager.middleware('core', 'offer')],
    qlessDb: [featureConnectionManager.middleware('core', 'qless')],
    realestateDb: [featureConnectionManager.middleware('core', 'realestate'), withFeatureTables('realestate')],
};
