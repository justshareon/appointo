const fcm = require('../featureConnectionManager');

module.exports = {
    feature: 'trust_score',
    getPool: () => fcm.getCachedPool('trust_score') || fcm.getPool(),
    acquire: () => fcm.acquire('trust_score'),
    release: () => fcm.release('trust_score'),
};
