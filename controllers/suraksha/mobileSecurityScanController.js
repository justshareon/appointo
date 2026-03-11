/**
 * Mobile Security Scan Controller
 * Handles mobile security scanning requests
 */
const mobileSecurityScanService = require('../../services/suraksha/mobileSecurityScanService');
const LOG = require('../../utils/logger');

class MobileSecurityScanController {
    /**
     * Perform full device scan
     * POST /api/suraksha/security-scan/start
     */
    async startScan(req, res) {
        try {
            const userId = req.user?.id;
            const { scanType = 'full', options = {} } = req.body;

            if (!userId) {
                return res.status(401).json({ error: 'User authentication required' });
            }

            const scanResult = await mobileSecurityScanService.performFullScan(userId, { ...options, scanType });

            // Emit real-time update via WebSocket if available
            if (req.io && req.userRoom) {
                req.io.to(req.userRoom).emit('security_scan_completed', {
                    scanId: scanResult.scanId,
                    threatsFound: scanResult.summary.threatsFound,
                    status: scanResult.status
                });
            }

            res.json({
                success: true,
                scan: scanResult
            });
        } catch (error) {
            LOG.error('[Mobile Security Scan Controller] Error starting scan:', error);
            res.status(500).json({
                error: 'Failed to start scan',
                message: error.message
            });
        }
    }

    /**
     * Get scan results
     * GET /api/suraksha/security-scan/results
     */
    async getScanResults(req, res) {
        try {
            const userId = req.user?.id;
            const { status, startDate, endDate, limit } = req.query;

            if (!userId) {
                return res.status(401).json({ error: 'User authentication required' });
            }

            const scans = await mobileSecurityScanService.getScanResults(userId, {
                status,
                startDate,
                endDate,
                limit: limit ? parseInt(limit) : undefined
            });

            res.json({
                success: true,
                count: scans.length,
                scans
            });
        } catch (error) {
            LOG.error('[Mobile Security Scan Controller] Error getting scan results:', error);
            res.status(500).json({
                error: 'Failed to get scan results',
                message: error.message
            });
        }
    }

    /**
     * Get scan statistics
     * GET /api/suraksha/security-scan/statistics
     */
    async getStatistics(req, res) {
        try {
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({ error: 'User authentication required' });
            }

            const stats = await mobileSecurityScanService.getScanStatistics(userId);

            res.json({
                success: true,
                statistics: stats
            });
        } catch (error) {
            LOG.error('[Mobile Security Scan Controller] Error getting statistics:', error);
            res.status(500).json({
                error: 'Failed to get statistics',
                message: error.message
            });
        }
    }

    /**
     * Delete scan results (bulk)
     * DELETE /api/suraksha/security-scan/results
     */
    async deleteScanResults(req, res) {
        try {
            const userId = req.user?.id;
            const { scanIds } = req.body;

            if (!userId) {
                return res.status(401).json({ error: 'User authentication required' });
            }

            if (!scanIds || !Array.isArray(scanIds) || scanIds.length === 0) {
                return res.status(400).json({ error: 'Scan IDs array is required' });
            }

            const result = await mobileSecurityScanService.deleteScanResults(userId, scanIds);

            res.json({
                success: result.success,
                deleted: result.deleted,
                message: `Deleted ${result.deleted} scan result(s)`
            });
        } catch (error) {
            LOG.error('[Mobile Security Scan Controller] Error deleting scan results:', error);
            res.status(500).json({
                error: 'Failed to delete scan results',
                message: error.message
            });
        }
    }

    /**
     * Get storage usage
     * GET /api/suraksha/security-scan/storage
     */
    async getStorageUsage(req, res) {
        try {
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({ error: 'User authentication required' });
            }

            const storage = await mobileSecurityScanService.getStorageUsage(userId);

            res.json({
                success: true,
                storage
            });
        } catch (error) {
            LOG.error('[Mobile Security Scan Controller] Error getting storage usage:', error);
            res.status(500).json({
                error: 'Failed to get storage usage',
                message: error.message
            });
        }
    }
}

module.exports = new MobileSecurityScanController();

