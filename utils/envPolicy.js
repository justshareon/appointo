/**
 * Project env layout (do not add module-specific .env files):
 *   - qr-queue-expo-production/.env     → Expo / client (EXPO_PUBLIC_*)
 *   - qr-queue-expo-production/backend/.env → Node backend (DB, SMART_*, sync, etc.)
 */
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const BACKEND_ROOT = path.join(__dirname, '..');
const BACKEND_ENV_FILE = path.join(BACKEND_ROOT, '.env');
const CLIENT_ENV_FILE = path.join(REPO_ROOT, '.env');

/** Keys super-admin may patch in backend/.env (server-only; never written to client .env). */
const BACKEND_MANAGED_ENV_KEYS = [
  'DB_TYPE',
  'SMART_LIVE_RETENTION_DAYS',
  'SMART_CAMERA_MEMORY_ONLY',
  'SMART_LIVE_PERSIST_MYSQL',
  'SMART_IDLE_MS',
  'FEATURE_IDLE_MS',
];

function isBackendManagedEnvKey(key) {
  const k = String(key || '');
  return BACKEND_MANAGED_ENV_KEYS.includes(k) || k.startsWith('SMART_');
}

module.exports = {
  REPO_ROOT,
  BACKEND_ROOT,
  BACKEND_ENV_FILE,
  CLIENT_ENV_FILE,
  BACKEND_MANAGED_ENV_KEYS,
  isBackendManagedEnvKey,
};
