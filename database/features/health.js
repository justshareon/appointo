const fcm = require('../featureConnectionManager');

module.exports = {
    feature: 'health',
    getPool: () => fcm.getCachedPool('health') || fcm.getPool(),
    acquire: () => fcm.acquire('health'),
    release: () => fcm.release('health'),
    ensureTables: async (mainDb) => {
        if (mainDb?.ensureFeatureSchema) await mainDb.ensureFeatureSchema('health');
    },
};
