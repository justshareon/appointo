/**
 * Persistent sync progress — one row per module in sync_module_state.
 * version = last synced record index (resume checkpoint).
 * queries_synced = SQL queries executed in last run for that module.
 */
const featureConnectionManager = require('../database/featureConnectionManager');

const SYNC_MODULES = [
    { key: 'core_schema', label: 'Core DB schema', order: 1 },
    { key: 'feature_seed', label: 'Feature seed (qless / appointments / queue)', order: 2 },
    { key: 'users', label: 'Users', order: 3 },
    { key: 'vendor_categories', label: 'Vendor categories', order: 4 },
    { key: 'vendors', label: 'Vendors', order: 5 },
    { key: 'user_vendor_mappings', label: 'User–vendor mappings', order: 6 },
    { key: 'products', label: 'Products', order: 7 },
    { key: 'orders', label: 'Orders', order: 8 },
    { key: 'queues', label: 'Queues', order: 9 },
    { key: 'appointments', label: 'Appointments', order: 10 },
    { key: 'activities', label: 'Activities', order: 11 },
    { key: 'otps', label: 'OTPs', order: 12 },
    { key: 'cyber_threats', label: 'Cyber threats', order: 13 },
    { key: 'suraksha_data', label: 'Suraksha validations & reports', order: 14 },
    { key: 'news_cache', label: 'News cache (lazy slices)', order: 15 },
    { key: 'r_detector_data', label: 'R-Detector commute & scans', order: 16 },
    { key: 'trading_data', label: 'Trading data', order: 17 },
    { key: 'fleet_data', label: 'Fleet data', order: 18 },
];

let tablesReady = false;

function getBuildVersion() {
    return process.env.BUILD_VERSION
        || process.env.RENDER_GIT_COMMIT?.slice(0, 8)
        || process.env.GIT_COMMIT?.slice(0, 8)
        || 'local';
}

async function getPool() {
    try {
        const db = require('../database');
        if (typeof db.getPool === 'function') {
            const p = db.getPool();
            if (p) return p;
        }
    } catch {
        /* database may not be loaded yet */
    }
    if (!process.env.DB_HOST && !process.env.DB_NAME) return null;
    return featureConnectionManager.acquireForSync('core');
}

async function addColumnIfMissing(pool, table, column, definition) {
    try {
        const [rows] = await pool.query(
            `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
            [table, column]
        );
        if (rows[0]?.cnt === 0) {
            await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        }
    } catch {
        /* non-fatal */
    }
}

async function ensureTables(pool) {
    if (!pool) return false;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sync_module_state (
            module_key VARCHAR(64) PRIMARY KEY,
            module_label VARCHAR(128) NOT NULL,
            sort_order INT NOT NULL DEFAULT 0,
            status ENUM('PENDING','IN_PROGRESS','SUCCESS','FAILED','SKIPPED') DEFAULT 'PENDING',
            version INT DEFAULT 0,
            total_items INT DEFAULT 0,
            queries_synced INT DEFAULT 0,
            items_synced INT DEFAULT 0,
            last_run_id INT NULL,
            last_started_at DATETIME NULL,
            last_completed_at DATETIME NULL,
            last_duration_ms INT NULL,
            last_error TEXT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sync_runs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            trigger_source VARCHAR(32) DEFAULT 'manual',
            build_version VARCHAR(64) NULL,
            status ENUM('IN_PROGRESS','SUCCESS','FAILED') DEFAULT 'IN_PROGRESS',
            resume_mode TINYINT(1) DEFAULT 0,
            total_modules INT DEFAULT 0,
            completed_modules INT DEFAULT 0,
            failed_modules INT DEFAULT 0,
            items_synced INT DEFAULT 0,
            queries_synced INT DEFAULT 0,
            error_message TEXT NULL,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME NULL,
            INDEX idx_sync_runs_started (started_at)
        )
    `);
    for (const col of [
        ['sync_module_state', 'version', 'INT DEFAULT 0'],
        ['sync_module_state', 'total_items', 'INT DEFAULT 0'],
        ['sync_module_state', 'queries_synced', 'INT DEFAULT 0'],
        ['sync_runs', 'build_version', 'VARCHAR(64) NULL'],
        ['sync_runs', 'resume_mode', 'TINYINT(1) DEFAULT 0'],
        ['sync_runs', 'queries_synced', 'INT DEFAULT 0'],
    ]) {
        await addColumnIfMissing(pool, col[0], col[1], col[2]);
    }
    for (const mod of SYNC_MODULES) {
        await pool.query(
            `INSERT IGNORE INTO sync_module_state (module_key, module_label, sort_order, status, version)
             VALUES (?, ?, ?, 'PENDING', 0)`,
            [mod.key, mod.label, mod.order]
        );
    }
    tablesReady = true;
    return true;
}

async function init() {
    if (tablesReady) return true;
    const pool = await getPool();
    if (!pool) return false;
    await ensureTables(pool);
    return true;
}

async function hasCheckpointData(pool) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM sync_module_state
         WHERE status = 'SUCCESS' OR status = 'FAILED' OR status = 'IN_PROGRESS' OR version > 0`
    );
    return (rows[0]?.cnt || 0) > 0;
}

/** True when every module row exists and status = SUCCESS. */
async function isSyncComplete() {
    const pool = await getPool();
    if (!pool) return true;
    await init();
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS done
         FROM sync_module_state`
    );
    const total = Number(rows[0]?.total) || 0;
    const done = Number(rows[0]?.done) || 0;
    return total >= SYNC_MODULES.length && done >= SYNC_MODULES.length;
}

/** True when table empty, missing rows, or any module not SUCCESS. */
async function needsSync() {
    const pool = await getPool();
    if (!pool) return false;
    await init();
    return !(await isSyncComplete());
}

async function startRun(triggerSource = 'manual', { forceFull = false } = {}) {
    const pool = await getPool();
    if (!pool) return { runId: null, resume: false };
    await init();

    const [countRows] = await pool.query(`SELECT COUNT(*) AS cnt FROM sync_module_state`);
    const tableEmpty = (countRows[0]?.cnt || 0) === 0;
    const allComplete = !tableEmpty && (await isSyncComplete());
    const canResume = !forceFull && !tableEmpty && !allComplete && (await hasCheckpointData(pool));

    const buildVersion = getBuildVersion();
    const [result] = await pool.query(
        `INSERT INTO sync_runs (trigger_source, build_version, status, total_modules, resume_mode)
         VALUES (?, ?, 'IN_PROGRESS', ?, ?)`,
        [triggerSource, buildVersion, SYNC_MODULES.length, canResume ? 1 : 0]
    );
    const runId = result.insertId;

    if (canResume) {
        await pool.query(
            `UPDATE sync_module_state
             SET last_run_id = ?, last_error = NULL
             WHERE status = 'SUCCESS'`,
            [runId]
        );
        await pool.query(
            `UPDATE sync_module_state
             SET status = 'PENDING', last_run_id = ?, last_error = NULL
             WHERE status IN ('FAILED', 'IN_PROGRESS')`,
            [runId]
        );
        await pool.query(
            `UPDATE sync_module_state SET last_run_id = ? WHERE status = 'PENDING' AND version = 0`,
            [runId]
        );
    } else {
        await pool.query(
            `UPDATE sync_module_state
             SET status = 'PENDING', version = 0, total_items = 0, queries_synced = 0,
                 items_synced = 0, last_run_id = ?, last_started_at = NULL,
                 last_completed_at = NULL, last_duration_ms = NULL, last_error = NULL`,
            [runId]
        );
    }

    return { runId, resume: canResume, buildVersion };
}

async function getModuleCheckpoint(moduleKey) {
    const pool = await getPool();
    if (!pool) return { status: 'PENDING', version: 0, queriesSynced: 0, itemsSynced: 0, totalItems: 0 };
    await init();
    const [rows] = await pool.query(
        `SELECT status, version, queries_synced, items_synced, total_items
         FROM sync_module_state WHERE module_key = ?`,
        [moduleKey]
    );
    const r = rows[0] || {};
    return {
        status: r.status || 'PENDING',
        version: r.version || 0,
        queriesSynced: r.queries_synced || 0,
        itemsSynced: r.items_synced || 0,
        totalItems: r.total_items || 0,
    };
}

async function markInProgress(moduleKey, runId) {
    const pool = await getPool();
    if (!pool) return;
    await pool.query(
        `UPDATE sync_module_state
         SET status = 'IN_PROGRESS', last_run_id = ?, last_started_at = NOW(), last_error = NULL
         WHERE module_key = ?`,
        [runId, moduleKey]
    );
}

async function updateProgress(moduleKey, { version = 0, queriesSynced = 0, itemsSynced = 0, totalItems = 0 } = {}) {
    const pool = await getPool();
    if (!pool) return;
    await pool.query(
        `UPDATE sync_module_state
         SET version = ?, queries_synced = ?, items_synced = ?,
             total_items = CASE WHEN ? > 0 THEN ? ELSE total_items END
         WHERE module_key = ?`,
        [version, queriesSynced, itemsSynced, totalItems, totalItems, moduleKey]
    );
}

async function markSuccess(moduleKey, {
    itemsSynced = 0, version = 0, queriesSynced = 0, totalItems = 0,
    durationMs = 0, runId,
} = {}) {
    const pool = await getPool();
    if (!pool) return;
    await pool.query(
        `UPDATE sync_module_state
         SET status = 'SUCCESS', items_synced = ?, version = ?, queries_synced = ?,
             total_items = CASE WHEN ? > 0 THEN ? ELSE total_items END,
             last_completed_at = NOW(), last_duration_ms = ?, last_error = NULL, last_run_id = ?
         WHERE module_key = ?`,
        [itemsSynced, version, queriesSynced, totalItems, totalItems, durationMs, runId, moduleKey]
    );
    if (runId) {
        await pool.query(
            `UPDATE sync_runs
             SET completed_modules = completed_modules + 1,
                 items_synced = items_synced + ?,
                 queries_synced = queries_synced + ?
             WHERE id = ?`,
            [itemsSynced, queriesSynced, runId]
        );
    }
}

async function markSkipped(moduleKey, runId) {
    const pool = await getPool();
    if (!pool) return;
    await pool.query(
        `UPDATE sync_module_state SET status = 'SKIPPED', last_run_id = ? WHERE module_key = ?`,
        [runId, moduleKey]
    );
    if (runId) {
        await pool.query(
            `UPDATE sync_runs SET completed_modules = completed_modules + 1 WHERE id = ?`,
            [runId]
        );
    }
}

async function markFailed(moduleKey, { error = '', durationMs = 0, version = 0, queriesSynced = 0, runId } = {}) {
    const pool = await getPool();
    if (!pool) return;
    await pool.query(
        `UPDATE sync_module_state
         SET status = 'FAILED', last_completed_at = NOW(), last_duration_ms = ?,
             last_error = ?, last_run_id = ?,
             version = CASE WHEN ? > 0 THEN ? ELSE version END,
             queries_synced = CASE WHEN ? > 0 THEN ? ELSE queries_synced END
         WHERE module_key = ?`,
        [durationMs, String(error).slice(0, 2000), runId, version, version, queriesSynced, queriesSynced, moduleKey]
    );
    if (runId) {
        await pool.query(`UPDATE sync_runs SET failed_modules = failed_modules + 1 WHERE id = ?`, [runId]);
    }
}

async function completeRun(runId, { success = true, totalSynced = 0, queriesSynced = 0, error = null } = {}) {
    const pool = await getPool();
    if (!pool || !runId) return;
    await pool.query(
        `UPDATE sync_runs
         SET status = ?, items_synced = ?, queries_synced = ?, error_message = ?, completed_at = NOW()
         WHERE id = ?`,
        [success ? 'SUCCESS' : 'FAILED', totalSynced, queriesSynced, error, runId]
    );
}

function normalizeResult(result) {
    if (result && typeof result === 'object') {
        return {
            itemsSynced: Number(result.itemsSynced) || 0,
            version: Number(result.version) || 0,
            queriesSynced: Number(result.queriesSynced) || 0,
            totalItems: Number(result.totalItems) || 0,
        };
    }
    const n = Number(result) || 0;
    return { itemsSynced: n, version: n, queriesSynced: 0, totalItems: n };
}

async function runStep(moduleKey, fn, runId, { forceFull = false, resume = false } = {}) {
    const checkpoint = await getModuleCheckpoint(moduleKey);
    if (resume && !forceFull && checkpoint.status === 'SUCCESS') {
        return checkpoint.itemsSynced;
    }

    await markInProgress(moduleKey, runId);
    const t0 = Date.now();
    const startOffset = resume && !forceFull ? checkpoint.version : 0;

    try {
        const result = await fn({
            startOffset,
            onProgress: (p) => updateProgress(moduleKey, p),
        });
        const out = normalizeResult(result);
        await markSuccess(moduleKey, {
            ...out,
            durationMs: Date.now() - t0,
            runId,
        });
        return out.itemsSynced;
    } catch (err) {
        const cp = await getModuleCheckpoint(moduleKey);
        await markFailed(moduleKey, {
            error: err.message,
            durationMs: Date.now() - t0,
            version: cp.version,
            queriesSynced: cp.queriesSynced,
            runId,
        });
        throw err;
    }
}

async function getModuleState() {
    const pool = await getPool();
    if (!pool) {
        return {
            available: false,
            modules: SYNC_MODULES.map((m) => ({ ...m, status: 'UNKNOWN', version: 0 })),
            summary: { total: SYNC_MODULES.length, done: 0, pending: SYNC_MODULES.length, failed: 0, inProgress: 0 },
        };
    }
    await init();
    const [rows] = await pool.query(
        `SELECT module_key, module_label, sort_order, status, version, total_items,
                queries_synced, items_synced, last_run_id, last_started_at,
                last_completed_at, last_duration_ms, last_error, updated_at
         FROM sync_module_state ORDER BY sort_order ASC`
    );
    const modules = rows.map((r) => ({
        key: r.module_key,
        label: r.module_label,
        order: r.sort_order,
        status: r.status,
        version: r.version,
        totalItems: r.total_items,
        queriesSynced: r.queries_synced,
        itemsSynced: r.items_synced,
        lastRunId: r.last_run_id,
        lastStartedAt: r.last_started_at,
        lastCompletedAt: r.last_completed_at,
        lastDurationMs: r.last_duration_ms,
        lastError: r.last_error,
        updatedAt: r.updated_at,
    }));
    const summary = {
        total: modules.length,
        done: modules.filter((m) => m.status === 'SUCCESS' || m.status === 'SKIPPED').length,
        pending: modules.filter((m) => m.status === 'PENDING').length,
        failed: modules.filter((m) => m.status === 'FAILED').length,
        inProgress: modules.filter((m) => m.status === 'IN_PROGRESS').length,
        totalQueriesSynced: modules.reduce((s, m) => s + (m.queriesSynced || 0), 0),
    };
    return { available: true, modules, summary };
}

async function getLatestRun() {
    const pool = await getPool();
    if (!pool) return null;
    await init();
    const [rows] = await pool.query(`SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1`);
    return rows[0] || null;
}

function printSummary(modules, summary) {
    console.log('');
    console.log('── Sync module map ─────────────────────────────────────');
    console.log(`Done: ${summary.done}/${summary.total} | Pending: ${summary.pending} | Failed: ${summary.failed} | Running: ${summary.inProgress}`);
    if (summary.totalQueriesSynced) {
        console.log(`Total queries synced (last run): ${summary.totalQueriesSynced}`);
    }
    for (const m of modules) {
        const icon =
            m.status === 'SUCCESS' || m.status === 'SKIPPED' ? '✓' :
            m.status === 'FAILED' ? '✗' :
            m.status === 'IN_PROGRESS' ? '…' : '○';
        const progress = m.totalItems > 0
            ? ` version ${m.version}/${m.totalItems}`
            : m.version > 0
                ? ` version ${m.version}`
                : '';
        const queries = m.queriesSynced > 0 ? `, ${m.queriesSynced} queries` : '';
        const extra = m.status === 'SUCCESS' || m.status === 'SKIPPED'
            ? ` (${m.itemsSynced} items${progress}${queries})`
            : m.status === 'IN_PROGRESS'
                ? ` (${progress}${queries})`
                : m.status === 'FAILED'
                    ? ` — ${m.lastError || 'error'}${progress}`
                    : progress;
        console.log(`  ${icon} [${m.order}] ${m.label}${extra}`);
    }
    console.log('────────────────────────────────────────────────────────');
    console.log('');
}

module.exports = {
    SYNC_MODULES,
    getBuildVersion,
    ensureTables,
    init,
    startRun,
    runStep,
    getModuleCheckpoint,
    updateProgress,
    markInProgress,
    markSuccess,
    markFailed,
    markSkipped,
    completeRun,
    getModuleState,
    getLatestRun,
    isSyncComplete,
    needsSync,
    printSummary,
};
