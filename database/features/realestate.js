const fcm = require('../featureConnectionManager');
const listing = require('../../services/realestateListingService');

module.exports = {
    feature: 'realestate',
    getPool: () => fcm.getCachedPool('realestate') || fcm.getPool(),
    acquire: () => fcm.acquire('realestate'),
    release: () => fcm.release('realestate'),
    ensureTables: async (mainDb) => {
        if (mainDb?.ensureFeatureSchema) await mainDb.ensureFeatureSchema('realestate');
        try {
            await listing.ensureAndSeed();
        } catch (err) {
            console.warn('[RE-DASH] ensureTables seed skipped:', err.message);
        }
    },
};
