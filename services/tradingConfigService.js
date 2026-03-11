/**
 * Trading Config Service
 * Manages trading data source configuration (Yahoo Finance toggle)
 * Allows super users to enable/disable Yahoo Finance via API
 */
const fs = require('fs');
const path = require('path');
const LOG = require('../utils/logger');

class TradingConfigService {
    constructor() {
        this.configPath = path.join(__dirname, '../config/tradingConfig.js');
        this.envPath = path.join(__dirname, '../.env');
    }

    /**
     * Get current configuration
     */
    getConfig() {
        const config = require('../config/tradingConfig');
        return {
            useYahooFinance: config.dataSources.useYahooFinance,
            excelFile: {
                filePath: config.excelFile.filePath,
                sheetName: config.excelFile.sheetName,
            },
            schedule: {
                cronExpression: config.schedule.cronExpression,
                enabled: config.schedule.enabled,
            }
        };
    }

    /**
     * Update USE_YAHOO_FINANCE setting
     * @param {boolean} enabled - Whether to enable Yahoo Finance
     * @param {string} updatedBy - User who made the change
     */
    async updateYahooFinanceSetting(enabled, updatedBy = 'admin') {
        try {
            // Read current .env file
            let envContent = '';
            if (fs.existsSync(this.envPath)) {
                envContent = fs.readFileSync(this.envPath, 'utf8');
            }

            // Update or add USE_YAHOO_FINANCE
            const useYahooFinanceLine = `USE_YAHOO_FINANCE=${enabled}`;
            
            if (envContent.includes('USE_YAHOO_FINANCE=')) {
                // Replace existing line
                envContent = envContent.replace(
                    /USE_YAHOO_FINANCE=.*/,
                    useYahooFinanceLine
                );
            } else {
                // Add new line
                envContent += `\n${useYahooFinanceLine}\n`;
            }

            // Write back to .env
            fs.writeFileSync(this.envPath, envContent, 'utf8');

            LOG.success(`[Trading Config] USE_YAHOO_FINANCE set to ${enabled} by ${updatedBy}`);

            return {
                success: true,
                message: `Yahoo Finance ${enabled ? 'enabled' : 'disabled'}`,
                useYahooFinance: enabled,
                note: 'Server restart required for changes to take effect'
            };
        } catch (error) {
            LOG.error('[Trading Config] Error updating setting:', error.message);
            throw error;
        }
    }

    /**
     * Reload configuration (for testing, actual reload requires server restart)
     */
    reloadConfig() {
        // Clear require cache
        delete require.cache[require.resolve('../config/tradingConfig')];
        return require('../config/tradingConfig');
    }
}

module.exports = new TradingConfigService();

