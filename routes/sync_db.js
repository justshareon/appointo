/**
 * CLI/route copy of MySQL first-connect sync.
 * Same behavior as backend/sync_db.js:
 *   - CREATE TABLE IF NOT EXISTS
 *   - INSERT IGNORE when the row already exists
 */
const { sync } = require('../sync_db');

if (require.main === module) {
    sync();
}

module.exports = { sync };
