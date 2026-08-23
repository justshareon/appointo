const fcm = require('../featureConnectionManager');

module.exports = {
    feature: 'news',
    getPool: () => fcm.getCachedPool('news') || fcm.getPool(),
    acquire: () => fcm.acquire('news'),
    release: () => fcm.release('news'),
    ensureTables: async (mainDb) => {
        if (mainDb?.ensureFeatureSchema) await mainDb.ensureFeatureSchema('news');
    },
};
