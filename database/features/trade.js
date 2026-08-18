const fcm = require('../featureConnectionManager');

module.exports = {
    feature: 'trade',
    getPool: () => fcm.getCachedPool('trade') || fcm.getPool(),
    acquire: () => fcm.acquire('trade'),
    release: () => fcm.release('trade'),
    ensureTables: async (mainDb) => {
        if (mainDb.ensureVendorFeatureColumns) await mainDb.ensureVendorFeatureColumns();
    },
};
