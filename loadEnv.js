const path = require('path');
const dotenv = require('dotenv');
const { resolveDbType, isMysqlConfigured } = require('./utils/resolveDbType');

const envPath = path.join(__dirname, '.env');
const result = dotenv.config({ path: envPath });

if (!process.env.__QR_ENV_LOGGED) {
    process.env.__QR_ENV_LOGGED = '1';
    if (result.error) {
        console.warn(`[ENV] Failed to load backend/.env: ${result.error.message}`);
    } else {
        const parsed = result.parsed || {};
        const resolvedType = resolveDbType();
        console.log(
            `[ENV] Loaded backend/.env | dbType=${resolvedType} (env=${process.env.DB_TYPE || parsed.DB_TYPE || 'unset'}) | mysql=${isMysqlConfigured() ? 'yes' : 'no'} | sheetsId=${parsed.GOOGLE_SHEETS_ID ? 'yes' : 'no'}`
        );
    }
}

module.exports = envPath;
