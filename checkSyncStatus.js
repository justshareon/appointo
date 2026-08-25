#!/usr/bin/env node
/** Quick view of sync_module_state — run: npm run sync:status */
require('./loadEnv');
const syncStatus = require('./services/syncStatusService');

(async () => {
    try {
        const state = await syncStatus.getModuleState();
        const latestRun = await syncStatus.getLatestRun();
        syncStatus.printSummary(state.modules, state.summary);
        if (latestRun) {
            console.log('Latest run:', {
                id: latestRun.id,
                trigger: latestRun.trigger_source,
                buildVersion: latestRun.build_version,
                resumeMode: !!latestRun.resume_mode,
                status: latestRun.status,
                completed: latestRun.completed_modules,
                failed: latestRun.failed_modules,
                totalModules: latestRun.total_modules,
                itemsSynced: latestRun.items_synced,
                queriesSynced: latestRun.queries_synced,
                startedAt: latestRun.started_at,
                completedAt: latestRun.completed_at,
            });
        }
        if (!state.available) {
            console.log('MySQL not configured — set DB_HOST / DB_NAME in .env');
            process.exit(1);
        }
        process.exit(state.summary.failed > 0 ? 1 : 0);
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
})();
