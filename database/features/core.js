/**
 * Core feature DB — users, vendors, auth, settings, mappings.
 * Uses in-memory data from main database.js; MySQL via featureConnectionManager ('core').
 */
const fcm = require('../featureConnectionManager');

module.exports = {
    feature: 'core',
    getPool: () => fcm.getPool() || fcm.getCachedPool('core'),
    acquire: () => fcm.acquire('core'),
    release: () => fcm.release('core'),
};
