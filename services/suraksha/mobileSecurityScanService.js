/**
 * Mobile Security Scan Service
 * Handles virus, malware, and security scanning for mobile devices
 */
const db = require('../../database');
const LOG = require('../../utils/logger');
const axios = require('axios');

function parseJson(value, fallback = null) {
    if (value == null || value === '') return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

function getMemoryScans() {
    if (!db.mobileSecurityScans) {
        const mem = db.inMemoryDb || db;
        if (!Array.isArray(mem.mobileSecurityScans)) mem.mobileSecurityScans = [];
        db.mobileSecurityScans = mem.mobileSecurityScans;
    }
    return db.mobileSecurityScans;
}

function hydrateSeedScans() {
    const scans = getMemoryScans();
    if (scans.length) return scans;
    try {
        const data = require('../../database/data');
        if (Array.isArray(data.mobileSecurityScans) && data.mobileSecurityScans.length) {
            data.mobileSecurityScans.forEach((s) => scans.push({ ...s }));
        }
    } catch (err) {
        LOG.warning('[Mobile Security Scan] Seed hydrate skipped:', err.message);
    }
    return scans;
}

function mapRowToScan(row) {
    if (!row) return null;
    return {
        scanId: row.scan_id,
        userId: row.user_id,
        scanType: row.scan_type || 'full',
        status: row.status || 'completed',
        startTime: row.start_time,
        endTime: row.end_time,
        duration: row.duration_ms,
        summary: parseJson(row.summary_json, {}),
        results: parseJson(row.results_json, { threats: [], safe: [] }),
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

async function getPool() {
    try {
        if (db.getType?.() === 'mysql' && db.getPool) {
            const pool = db.getPool();
            if (pool) return pool;
        }
    } catch (_) {
        /* ignore */
    }
    try {
        const fcm = require('../../database/featureConnectionManager');
        return fcm.getCachedPool('cyber') || fcm.getCachedPool('core') || null;
    } catch (_) {
        return null;
    }
}

async function ensureScanSchema(pool) {
    if (!pool) return;
    const { ensureFeatureSchema } = require('../../database/schema/featureTables');
    await ensureFeatureSchema('cyber', db);
}

async function upsertScanMysql(pool, scan) {
    if (!pool || !scan?.scanId) return;
    await pool.query(
        `INSERT INTO mobile_security_scans
         (scan_id, user_id, scan_type, status, start_time, end_time, duration_ms, summary_json, results_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           status=VALUES(status),
           end_time=VALUES(end_time),
           duration_ms=VALUES(duration_ms),
           summary_json=VALUES(summary_json),
           results_json=VALUES(results_json),
           updated_at=VALUES(updated_at)`,
        [
            scan.scanId,
            scan.userId,
            scan.scanType || 'full',
            scan.status || 'completed',
            scan.startTime ? new Date(scan.startTime) : new Date(),
            scan.endTime ? new Date(scan.endTime) : null,
            scan.duration || 0,
            JSON.stringify(scan.summary || {}),
            JSON.stringify(scan.results || {}),
            scan.created_at ? new Date(scan.created_at) : new Date(),
            new Date(),
        ]
    );
}

async function fetchScansMysql(userId, filters = {}) {
    const pool = await getPool();
    if (!pool) return null;
    await ensureScanSchema(pool);
    let query = 'SELECT * FROM mobile_security_scans WHERE user_id = ?';
    const params = [userId];
    if (filters.status) {
        query += ' AND status = ?';
        params.push(filters.status);
    }
    query += ' ORDER BY start_time DESC';
    if (filters.limit) {
        query += ' LIMIT ?';
        params.push(parseInt(filters.limit, 10));
    }
    const [rows] = await pool.query(query, params);
    return (rows || []).map(mapRowToScan);
}

function getDemoTemplates() {
    hydrateSeedScans();
    const templates = (getMemoryScans().filter((s) => s.userId === 'usr_cyber1') || []).slice(0, 4);
    if (templates.length) return templates;
    return [
        {
            scanId: 'demo_scan_1',
            scanType: 'full',
            status: 'completed',
            summary: {
                totalScanned: 42,
                safe: 38,
                threatsFound: 4,
                byType: { virus: 1, malware: 2, adware: 1, spyware: 0, phishing: 0, other: 0 },
            },
            results: {
                threats: [
                    { threatType: 'malware', name: 'Trojan.FakeInstaller', packageName: 'com.fake.installer', severity: 'critical', path: '/Download/fake.apk', description: 'Known trojan signature' },
                    { threatType: 'adware', name: 'Adware.Popup', packageName: 'com.popup.ads', severity: 'medium', path: '/data/app/popup', description: 'Aggressive ad overlay' },
                ],
                safe: [{ type: 'app', name: 'WhatsApp', packageName: 'com.whatsapp', status: 'safe' }],
            },
        },
    ];
}

async function ensureDemoScansForUser(userId) {
    if (!userId) return [];
    const pool = await getPool();
    const templates = getDemoTemplates();
    const now = Date.now();
    const seeded = templates.map((tpl, idx) => {
        const start = new Date(now - (idx + 1) * 24 * 60 * 60 * 1000);
        return {
            ...tpl,
            scanId: `${userId}_demo_${idx + 1}`,
            userId,
            startTime: start.toISOString(),
            endTime: new Date(start.getTime() + 45000).toISOString(),
            created_at: start.toISOString(),
        };
    });

    const mem = getMemoryScans();
    for (const scan of seeded) {
        if (!mem.find((s) => s.scanId === scan.scanId)) {
            mem.push(scan);
        }
        if (pool) {
            try {
                await upsertScanMysql(pool, scan);
            } catch (err) {
                LOG.warning('[Mobile Security Scan] Demo seed MySQL:', err.message);
            }
        }
    }
    return seeded;
}

class MobileSecurityScanService {
    constructor() {
        // Known malware signatures and patterns
        this.malwarePatterns = [
            // Suspicious file extensions
            { pattern: /\.(exe|bat|cmd|scr|vbs|js|jar|apk)$/i, type: 'executable', severity: 'high' },
            // Suspicious file names
            { pattern: /(trojan|virus|malware|spyware|adware|keylog|backdoor)/i, type: 'suspicious_name', severity: 'medium' },
            // Suspicious permissions in APK
            { pattern: /(android\.permission\.(SEND_SMS|RECEIVE_SMS|READ_PHONE_STATE|ACCESS_FINE_LOCATION|RECORD_AUDIO|CAMERA))/i, type: 'suspicious_permission', severity: 'high' },
            // Known malicious domains/IPs (simplified - in production, use threat intelligence feeds)
            { pattern: /(malicious-domain|phishing-site|malware-host)/i, type: 'known_threat', severity: 'critical' }
        ];

        // Known safe apps (whitelist)
        this.whitelistApps = [
            'com.android.chrome',
            'com.google.android.gms',
            'com.whatsapp',
            'com.facebook.katana',
            'com.instagram.android'
        ];
    }

    /**
     * Perform full device scan
     * @param {string} userId - User ID
     * @param {Object} options - Scan options
     * @returns {Promise<Object>} Scan results
     */
    async performFullScan(userId, options = {}) {
        try {
            LOG.info(`[Mobile Security Scan] Starting full scan for user: ${userId}`);
            
            const scanId = `scan_${Date.now()}_${Math.random().toString(36).substring(7)}`;
            const startTime = new Date();
            
            // Simulate scanning different areas
            const scanResults = {
                scanId,
                userId,
                scanType: 'full',
                startTime: startTime.toISOString(),
                status: 'running',
                results: {
                    files: [],
                    apps: [],
                    network: [],
                    system: [],
                    threats: []
                },
                summary: {
                    totalScanned: 0,
                    threatsFound: 0,
                    safe: 0,
                    suspicious: 0,
                    byType: {
                        virus: 0,
                        malware: 0,
                        adware: 0,
                        spyware: 0,
                        phishing: 0,
                        other: 0
                    }
                }
            };

            // Scan files (simulated - in production, use file system APIs)
            const fileScanResults = await this._scanFiles(userId);
            scanResults.results.files = fileScanResults;
            scanResults.summary.totalScanned += fileScanResults.length;

            // Scan installed apps
            const appScanResults = await this._scanApps(userId);
            scanResults.results.apps = appScanResults;
            scanResults.summary.totalScanned += appScanResults.length;

            // Scan network connections
            const networkScanResults = await this._scanNetwork(userId);
            scanResults.results.network = networkScanResults;
            scanResults.summary.totalScanned += networkScanResults.length;

            // Scan system settings
            const systemScanResults = await this._scanSystem(userId);
            scanResults.results.system = systemScanResults;
            scanResults.summary.totalScanned += systemScanResults.length;

            // Aggregate threats
            const allThreats = [
                ...fileScanResults.filter(f => f.isThreat),
                ...appScanResults.filter(a => a.isThreat),
                ...networkScanResults.filter(n => n.isThreat),
                ...systemScanResults.filter(s => s.isThreat)
            ];

            scanResults.results.threats = allThreats;
            scanResults.summary.threatsFound = allThreats.length;
            scanResults.summary.safe = scanResults.summary.totalScanned - allThreats.length;
            scanResults.summary.suspicious = allThreats.filter(t => t.severity === 'medium').length;

            // Count by type
            allThreats.forEach(threat => {
                const type = threat.threatType || 'other';
                if (scanResults.summary.byType[type] !== undefined) {
                    scanResults.summary.byType[type]++;
                } else {
                    scanResults.summary.byType.other++;
                }
            });

            scanResults.status = 'completed';
            scanResults.endTime = new Date().toISOString();
            scanResults.duration = new Date() - startTime;

            // Save scan result to database
            await this._saveScanResult(scanResults);

            LOG.info(`[Mobile Security Scan] Scan completed: ${scanResults.summary.threatsFound} threats found`);

            return scanResults;
        } catch (error) {
            LOG.error('[Mobile Security Scan] Error performing scan:', error);
            throw error;
        }
    }

    /**
     * Scan files (simulated)
     * @private
     */
    async _scanFiles(userId) {
        // In production, this would scan actual files
        // For now, return simulated results
        const files = [
            { id: 'file_1', name: 'document.pdf', path: '/storage/emulated/0/Download/document.pdf', size: 1024000, isThreat: false, threatType: null, severity: null },
            { id: 'file_2', name: 'suspicious.exe', path: '/storage/emulated/0/Download/suspicious.exe', size: 2048000, isThreat: true, threatType: 'malware', severity: 'high', description: 'Executable file detected' },
            { id: 'file_3', name: 'photo.jpg', path: '/storage/emulated/0/Pictures/photo.jpg', size: 512000, isThreat: false, threatType: null, severity: null }
        ];

        return files;
    }

    /**
     * Scan installed apps
     * @private
     */
    async _scanApps(userId) {
        // In production, this would scan installed apps
        const apps = [
            { id: 'app_1', packageName: 'com.example.safeapp', name: 'Safe App', version: '1.0.0', isThreat: false, threatType: null, severity: null },
            { id: 'app_2', packageName: 'com.suspicious.app', name: 'Suspicious App', version: '2.0.0', isThreat: true, threatType: 'adware', severity: 'medium', description: 'Excessive permissions requested' },
            { id: 'app_3', packageName: 'com.malware.app', name: 'Malware App', version: '1.5.0', isThreat: true, threatType: 'malware', severity: 'critical', description: 'Known malware signature detected' }
        ];

        return apps;
    }

    /**
     * Scan network connections
     * @private
     */
    async _scanNetwork(userId) {
        // In production, this would scan network connections
        const connections = [
            { id: 'net_1', host: 'api.example.com', port: 443, protocol: 'HTTPS', isThreat: false, threatType: null, severity: null },
            { id: 'net_2', host: 'malicious-domain.com', port: 80, protocol: 'HTTP', isThreat: true, threatType: 'phishing', severity: 'high', description: 'Known malicious domain' }
        ];

        return connections;
    }

    /**
     * Scan system settings
     * @private
     */
    async _scanSystem(userId) {
        // In production, this would scan system settings
        const system = [
            { id: 'sys_1', setting: 'Unknown Sources', value: 'enabled', isThreat: true, threatType: 'other', severity: 'medium', description: 'Unknown sources enabled - security risk' },
            { id: 'sys_2', setting: 'Developer Options', value: 'enabled', isThreat: false, threatType: null, severity: null }
        ];

        return system;
    }

    /**
     * Save scan result to database
     * @private
     */
    async _saveScanResult(scanResult) {
        const mem = getMemoryScans();
        mem.push(scanResult);

        if (scanResult.userId) {
            const userScans = mem.filter((s) => s.userId === scanResult.userId);
            if (userScans.length > 100) {
                const toRemove = userScans.slice(0, userScans.length - 100);
                toRemove.forEach((scan) => {
                    const index = mem.findIndex((s) => s.scanId === scan.scanId);
                    if (index > -1) mem.splice(index, 1);
                });
            }
        }

        const pool = await getPool();
        if (pool) {
            try {
                await upsertScanMysql(pool, scanResult);
            } catch (err) {
                LOG.warning('[Mobile Security Scan] MySQL save failed:', err.message);
            }
        }
    }

    /**
     * Get scan results for user
     * @param {string} userId - User ID
     * @param {Object} filters - Filter options
     * @returns {Promise<Array>} Scan results
     */
    async getScanResults(userId, filters = {}) {
        try {
            hydrateSeedScans();
            let scans = await fetchScansMysql(userId, filters);

            if (!scans) {
                let memScans = getMemoryScans().filter((s) => s.userId === userId);
                if (filters.status) {
                    memScans = memScans.filter((s) => s.status === filters.status);
                }
                memScans.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
                if (filters.limit) {
                    memScans = memScans.slice(0, parseInt(filters.limit, 10));
                }
                scans = memScans;
            }

            if (!scans.length) {
                scans = await ensureDemoScansForUser(userId);
                if (filters.limit) {
                    scans = scans.slice(0, parseInt(filters.limit, 10));
                }
            }

            return scans;
        } catch (error) {
            LOG.error('[Mobile Security Scan] Error getting scan results:', error);
            throw error;
        }
    }

    /**
     * Get scan statistics
     * @param {string} userId - User ID
     * @returns {Promise<Object>} Statistics
     */
    async getScanStatistics(userId) {
        try {
            const scans = await this.getScanResults(userId, { limit: 200 });
            const stats = {
                totalScans: scans.length,
                completedScans: scans.filter((s) => s.status === 'completed').length,
                totalThreatsFound: scans.reduce((sum, s) => sum + (s.summary?.threatsFound || 0), 0),
                totalItemsScanned: scans.reduce((sum, s) => sum + (s.summary?.totalScanned || 0), 0),
                lastScanDate: scans.length > 0 ? scans[0].startTime : null,
                threatsByType: {
                    virus: 0,
                    malware: 0,
                    adware: 0,
                    spyware: 0,
                    phishing: 0,
                    other: 0,
                },
            };

            scans.forEach((scan) => {
                if (scan.summary?.byType) {
                    Object.keys(stats.threatsByType).forEach((type) => {
                        stats.threatsByType[type] += scan.summary.byType[type] || 0;
                    });
                }
            });

            return stats;
        } catch (error) {
            LOG.error('[Mobile Security Scan] Error getting statistics:', error);
            throw error;
        }
    }

    /**
     * Delete scan results
     * @param {string} userId - User ID
     * @param {Array} scanIds - Scan IDs to delete
     * @returns {Promise<Object>} Deletion result
     */
    async deleteScanResults(userId, scanIds) {
        try {
            if (!Array.isArray(scanIds) || scanIds.length === 0) {
                return { success: false, error: 'No scan IDs provided' };
            }

            let deleted = 0;
            const mem = getMemoryScans();
            scanIds.forEach((scanId) => {
                const index = mem.findIndex((s) => s.scanId === scanId && s.userId === userId);
                if (index > -1) {
                    mem.splice(index, 1);
                    deleted += 1;
                }
            });

            const pool = await getPool();
            if (pool) {
                for (const scanId of scanIds) {
                    try {
                        const [result] = await pool.query(
                            'DELETE FROM mobile_security_scans WHERE scan_id = ? AND user_id = ?',
                            [scanId, userId]
                        );
                        if (result?.affectedRows) deleted = Math.max(deleted, deleted);
                    } catch (err) {
                        LOG.warning('[Mobile Security Scan] MySQL delete:', err.message);
                    }
                }
            }

            LOG.info(`[Mobile Security Scan] Deleted ${deleted} scan results for user: ${userId}`);

            return { success: true, deleted };
        } catch (error) {
            LOG.error('[Mobile Security Scan] Error deleting scan results:', error);
            throw error;
        }
    }

    /**
     * Get storage usage
     * @param {string} userId - User ID
     * @returns {Promise<Object>} Storage information
     */
    async getStorageUsage(userId) {
        try {
            const userScans = await this.getScanResults(userId, { limit: 500 });
            const storageUsed = userScans.length * 1024;

            return {
                totalScans: userScans.length,
                storageUsed,
                storageUsedMB: (storageUsed / 1024 / 1024).toFixed(2),
                canCleanup: userScans.length > 50,
            };
        } catch (error) {
            LOG.error('[Mobile Security Scan] Error getting storage usage:', error);
            throw error;
        }
    }
}

module.exports = new MobileSecurityScanService();

