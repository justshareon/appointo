const fcm = require('../featureConnectionManager');

module.exports = {
    feature: 'cyber',
    getPool: () => fcm.getCachedPool('cyber') || fcm.getPool(),
    acquire: () => fcm.acquire('cyber'),
    release: () => fcm.release('cyber'),
    ensureTables: async (mainDb) => {
        if (mainDb.ensureCyberThreatTables) await mainDb.ensureCyberThreatTables();
    },
};
