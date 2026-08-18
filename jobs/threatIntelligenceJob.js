/**
 * Threat Intelligence Job
 * Runs periodically to scan for cyber threats (configurable interval)
 */
const threatIntelligenceService = require('../services/suraksha/threatIntelligenceService');
const settingsService = require('../services/settingsService');
const LOG = require('../utils/logger');

class ThreatIntelligenceJob {
    constructor(io) {
        this.io = io;
        this.isRunning = false;
        this.lastRun = null;
        this.intervalId = null;
        this.currentInterval = 5; // Default 5 hours
    }

    /**
     * Run daily scan
     */
    async run() {
        if (this.isRunning) {
            LOG.warning('[Threat Intelligence Job] Scan already running, skipping...');
            return;
        }

        try {
            this.isRunning = true;
            LOG.info('[Threat Intelligence Job] Starting daily threat scan...');

            // Scan threats (force = false to respect 4-hour cooldown)
            const threats = await threatIntelligenceService.scanThreats(false);
            
            // Save threats
            const result = await threatIntelligenceService.saveThreats(threats);

            this.lastRun = new Date().toISOString();

            // Emit alerts for critical/high severity threats
            if (result.alerts.length > 0 && this.io) {
                this.io.emit('threat_intelligence_alert', {
                    count: result.alerts.length,
                    threats: result.alerts,
                    message: `${result.alerts.length} new critical/high severity threats detected`
                });
                LOG.info(`[Threat Intelligence Job] Sent alerts for ${result.alerts.length} threats`);
            }

            LOG.success(`[Threat Intelligence Job] Scan complete: ${result.saved} threats saved`);
        } catch (error) {
            LOG.error('[Threat Intelligence Job] Error running scan:', error.message);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Get scan interval from settings (in hours)
     * @returns {Promise<number>} Interval in hours
     */
    async getScanInterval() {
        try {
            const settings = await settingsService.getSettings();
            const interval = settings?.threat_scan_interval || 5; // Default 5 hours
            return Math.max(1, Math.min(24, parseInt(interval))); // Clamp between 1-24 hours
        } catch (error) {
            LOG.error('[Threat Intelligence Job] Error getting scan interval:', error);
            return 5; // Default fallback
        }
    }

    /**
     * Schedule runs with configurable interval
     */
    async schedule() {
        this.currentInterval = await this.getScanInterval();
        await this._scheduleWithInterval(this.currentInterval);

        if (this.io && !this._settingsBound) {
            this._settingsBound = true;
            this.io.on('settings_updated', async (newSettings) => {
                if (newSettings.threat_scan_interval !== undefined) {
                    const newInterval = Math.max(1, Math.min(24, parseInt(newSettings.threat_scan_interval)));
                    if (newInterval !== this.currentInterval) {
                        LOG.info(`[Threat Intelligence Job] Rescheduling with new interval: ${newInterval} hours`);
                        this.currentInterval = newInterval;
                        this._reschedule();
                    }
                }
            });
        }
    }

    /**
     * Schedule with specific interval
     * @private
     */
    async _scheduleWithInterval(intervalHours) {
        // Clear existing interval if any
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }

        const interval = intervalHours * 60 * 60 * 1000; // Convert hours to milliseconds
        const nextRun = new Date(Date.now() + interval);
        
        // Schedule first run
        setTimeout(() => {
            this.run();
            // Then run at configured interval
            this.intervalId = setInterval(() => this.run(), interval);
        }, interval);

        LOG.info(`[Threat Intelligence Job] Scheduled scan every ${intervalHours} hours. Next run: ${nextRun.toLocaleString()}`);
    }

    /**
     * Reschedule with current interval
     * @private
     */
    async _reschedule() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
        await this._scheduleWithInterval(this.currentInterval);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
    }
}

module.exports = ThreatIntelligenceJob;

