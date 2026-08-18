const fcm = require('../featureConnectionManager');

module.exports = {
    feature: 'offer',
    getPool: () => fcm.getCachedPool('offer') || fcm.getPool(),
    acquire: () => fcm.acquire('offer'),
    release: () => fcm.release('offer'),
};
