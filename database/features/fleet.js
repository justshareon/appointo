const fcm = require('../featureConnectionManager');

module.exports = {
    feature: 'fleet',
    getPool: () => fcm.getCachedPool('fleet') || fcm.getPool(),
    acquire: () => fcm.acquire('fleet'),
    release: () => fcm.release('fleet'),
    ensureTables: async (mainDb) => {
        if (mainDb.ensureFleetTables) await mainDb.ensureFleetTables();
    },
};
