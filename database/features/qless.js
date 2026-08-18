const fcm = require('../featureConnectionManager');

module.exports = function createQlessFeature() {
    return {
        feature: 'qless',
        getPool: () => fcm.getCachedPool('qless') || fcm.getPool(),
        acquire: () => fcm.acquire('qless'),
        release: () => fcm.release('qless'),
    };
};
