/**
 * Super-admin: view/update backend/.env only (never repo-root .env) + MySQL settings.
 */
const fs = require('fs');
const LOG = require('../utils/logger');
const settingsService = require('./settingsService');
const {
  refreshSmartLiveSettings,
  applySmartLiveSettingsPatch,
  parseRetentionDays,
} = require('./smartLiveSettingsService');
const {
  BACKEND_ENV_FILE,
  BACKEND_MANAGED_ENV_KEYS,
  isBackendManagedEnvKey,
} = require('../utils/envPolicy');

const ENV_PATH = BACKEND_ENV_FILE;
const MANAGED_ENV_KEYS = BACKEND_MANAGED_ENV_KEYS;

const SECRET_KEY = /password|secret|token|private_key|api_key/i;

function isRenderHost() {
  return (
    process.env.RENDER === 'true'
    || !!process.env.RENDER_SERVICE_ID
    || !!process.env.RENDER_EXTERNAL_URL
  );
}

function maskValue(key, value) {
  const v = value == null ? '' : String(value);
  if (!v) return '';
  if (SECRET_KEY.test(key)) {
    return v.length > 4 ? `${'*'.repeat(Math.min(8, v.length))}…${v.slice(-2)}` : '****';
  }
  return v;
}

function envFileMeta() {
  const exists = fs.existsSync(ENV_PATH);
  let writable = false;
  if (exists) {
    try {
      fs.accessSync(ENV_PATH, fs.constants.W_OK);
      writable = true;
    } catch (_) {
      writable = false;
    }
  } else {
    try {
      fs.accessSync(path.dirname(ENV_PATH), fs.constants.W_OK);
      writable = true;
    } catch (_) {
      writable = false;
    }
  }
  return {
    envScope: 'backend',
    envFileLabel: 'backend/.env',
    envFilePath: ENV_PATH,
    envFileExists: exists,
    envFileWritable: writable,
    isRender: isRenderHost(),
    renderHint: isRenderHost()
      ? 'Render: set Environment in the Render Dashboard (backend/.env is not used on deploy). Changes here apply to this running instance + MySQL settings.'
      : 'Local: updates write backend/.env when writable and apply immediately to this process.',
  };
}

function parseEnvFile(content) {
  const map = new Map();
  String(content || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) return;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      map.set(key, val);
    });
  return map;
}

function readEnvFileLines() {
  const meta = envFileMeta();
  if (!meta.envFileExists) {
    return { ...meta, lines: [], fromFile: false };
  }
  const content = fs.readFileSync(ENV_PATH, 'utf8');
  const map = parseEnvFile(content);
  const lines = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({
      key,
      value: maskValue(key, value),
      editable: isBackendManagedEnvKey(key),
      masked: SECRET_KEY.test(key),
    }));
  return { ...meta, lines, fromFile: true };
}

function upsertEnvFile(updates) {
  const meta = envFileMeta();
  if (!meta.envFileWritable) {
    return { written: false, reason: meta.isRender ? 'render_no_local_env' : 'env_not_writable' };
  }
  let content = meta.envFileExists ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  if (content && !content.endsWith('\n')) content += '\n';
  Object.entries(updates).forEach(([key, value]) => {
    const safe = String(value ?? '').replace(/\r?\n/g, '');
    const line = `${key}=${safe}`;
    const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=.*$`, 'm');
    if (re.test(content)) {
      content = content.replace(re, line);
    } else {
      content += `${line}\n`;
    }
  });
  fs.writeFileSync(ENV_PATH, content, 'utf8');
  return { written: true, path: ENV_PATH };
}

function applyProcessEnv(updates) {
  const applied = [];
  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (!isBackendManagedEnvKey(key)) return;
    process.env[key] = String(value);
    applied.push(key);
  });
  return applied;
}

async function getSmartSgateAdminConfig() {
  const meta = envFileMeta();
  const settings = await settingsService.getSettings();
  const retentionDays = parseRetentionDays(settings.smart_live_retention_days);
  const envSnapshot = {};
  MANAGED_ENV_KEYS.forEach((k) => {
    if (process.env[k] != null) envSnapshot[k] = process.env[k];
  });
  return {
    ...meta,
    retentionDays,
    settings: {
      smart_live_retention_days: String(settings.smart_live_retention_days ?? retentionDays),
    },
    processEnv: envSnapshot,
    dbType: typeof require('../database').getType === 'function' ? require('../database').getType() : null,
  };
}

/**
 * @param {{ smart_live_retention_days?: string|number, env?: Record<string, string> }} patch
 */
async function applySmartSgateAdminConfig(patch = {}) {
  const envUpdates = { ...(patch.env || {}) };
  const settingsPatch = {};

  if (patch.smart_live_retention_days != null && patch.smart_live_retention_days !== '') {
    const days = parseRetentionDays(patch.smart_live_retention_days);
    settingsPatch.smart_live_retention_days = String(days);
    envUpdates.SMART_LIVE_RETENTION_DAYS = String(days);
  }

  if (envUpdates.SMART_LIVE_RETENTION_DAYS != null) {
    settingsPatch.smart_live_retention_days = String(
      parseRetentionDays(envUpdates.SMART_LIVE_RETENTION_DAYS)
    );
  }

  const appliedEnv = applyProcessEnv(envUpdates);
  let envWrite = { written: false };
  if (Object.keys(envUpdates).length) {
    envWrite = upsertEnvFile(envUpdates);
  }

  if (Object.keys(settingsPatch).length) {
    await settingsService.updateSettings(settingsPatch);
    applySmartLiveSettingsPatch(settingsPatch);
  } else {
    await refreshSmartLiveSettings();
  }

  LOG.info(`[SmartSgateAdmin] Applied config env=[${appliedEnv.join(',')}] settings=${JSON.stringify(settingsPatch)} file=${envWrite.written}`);

  return {
    appliedEnv,
    settingsPatch,
    envWrite,
    config: await getSmartSgateAdminConfig(),
  };
}

async function syncSmartSettingsFromEnvAndValidate() {
  const days = process.env.SMART_LIVE_RETENTION_DAYS;
  if (days != null && days !== '') {
    await applySmartSgateAdminConfig({
      smart_live_retention_days: days,
      env: { SMART_LIVE_RETENTION_DAYS: String(days) },
    });
  } else {
    await refreshSmartLiveSettings();
  }
  const { runSmartSgateValidation } = require('./smartSgateValidateService');
  return runSmartSgateValidation({ cleanup: true });
}

module.exports = {
  getSmartSgateAdminConfig,
  applySmartSgateAdminConfig,
  readEnvFileLines,
  syncSmartSettingsFromEnvAndValidate,
  envFileMeta,
  MANAGED_ENV_KEYS,
};
