const fcm = require('../featureConnectionManager');

module.exports = function createRealestateFeature() {
    return {
        feature: 'realestate',
        getPool: () => fcm.getCachedPool('realestate') || fcm.getPool(),
        acquire: () => fcm.acquire('realestate'),
        release: () => fcm.release('realestate'),
    };
};
