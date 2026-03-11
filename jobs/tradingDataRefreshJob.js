/**
 * Trading Data Refresh Job
 * Handles periodic refresh, BOD, and EOD snapshots
 */
const tradingDataService = require('../services/tradingDataService');
const LOG = require('../utils/logger');

class TradingDataRefreshJob {
    constructor() {
        this.bodInterval = null;
        this.eodInterval = null;
        this.isRunning = false;
    }

    /**
     * Schedule BOD job (runs at 9:15 AM daily)
     */
    scheduleBOD() {
        const scheduleBODJob = () => {
            const now = new Date();
            const targetTime = new Date();
            targetTime.setHours(9, 15, 0, 0); // 9:15 AM

            // If already past 9:15 today, schedule for tomorrow
            if (now > targetTime) {
                targetTime.setDate(targetTime.getDate() + 1);
            }

            const msUntilTarget = targetTime.getTime() - now.getTime();
            
            setTimeout(async () => {
                await tradingDataService.saveBODSnapshot();
                // Schedule next BOD
                this.scheduleBOD();
            }, msUntilTarget);

            LOG.info(`[Trading Refresh Job] BOD scheduled for ${targetTime.toLocaleString()}`);
        };

        scheduleBODJob();
    }

    /**
     * Schedule EOD job (runs at 3:30 PM daily)
     */
    scheduleEOD() {
        const scheduleEODJob = () => {
            const now = new Date();
            const targetTime = new Date();
            targetTime.setHours(15, 30, 0, 0); // 3:30 PM

            // If already past 3:30 today, schedule for tomorrow
            if (now > targetTime) {
                targetTime.setDate(targetTime.getDate() + 1);
            }

            const msUntilTarget = targetTime.getTime() - now.getTime();
            
            setTimeout(async () => {
                await tradingDataService.saveEODSnapshot();
                // Schedule next EOD
                this.scheduleEOD();
            }, msUntilTarget);

            LOG.info(`[Trading Refresh Job] EOD scheduled for ${targetTime.toLocaleString()}`);
        };

        scheduleEODJob();
    }

    /**
     * Start all scheduled jobs
     */
    start() {
        if (this.isRunning) {
            LOG.warning('[Trading Refresh Job] Already running');
            return;
        }

        this.isRunning = true;

        // Initialize tables
        tradingDataService.initializeTables().then(() => {
            // Start periodic refresh (every 10 minutes)
            tradingDataService.startPeriodicRefresh();

            // Schedule BOD and EOD
            this.scheduleBOD();
            this.scheduleEOD();

            LOG.success('[Trading Refresh Job] All jobs started');
        }).catch(error => {
            LOG.error('[Trading Refresh Job] Failed to initialize:', error.message);
        });
    }

    /**
     * Stop all scheduled jobs
     */
    stop() {
        this.isRunning = false;
        tradingDataService.stopPeriodicRefresh();
        if (this.bodInterval) clearTimeout(this.bodInterval);
        if (this.eodInterval) clearTimeout(this.eodInterval);
        LOG.info('[Trading Refresh Job] All jobs stopped');
    }
}

module.exports = TradingDataRefreshJob;

