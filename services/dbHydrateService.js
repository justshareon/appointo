/**
 * Pull MySQL data into in-memory on startup so online deploys stay consistent
 * after process restarts (Render, etc.).
 */
const LOG = require('../utils/logger');
const { isMysqlConfigured } = require('../utils/resolveDbType');

let hydratePromise = null;

async function hydrateOnStartup() {
    if (!isMysqlConfigured()) return { skipped: true, reason: 'mysql_not_configured' };
    if (hydratePromise) return hydratePromise;

    hydratePromise = (async () => {
        const db = require('../database');
        const featureConnectionManager = require('../database/featureConnectionManager');

        try {
            await featureConnectionManager.acquireForSync('core');
        } catch (err) {
            LOG.warning(`[Hydrate] Could not open sync pool: ${err.message}`);
            return { ok: false, error: err.message };
        }

        let usersAdded = 0;
        let vendorsAdded = 0;

        if (typeof db.ensureAllUsersAndVendors === 'function') {
            await db.ensureAllUsersAndVendors();
        }

        const mem = db.inMemoryDb;
        const pool = typeof db.getPool === 'function' ? db.getPool() : null;
        if (pool && mem) {
            try {
                const beforeUsers = mem.users?.length || 0;
                const beforeVendors = mem.vendors?.length || 0;

                const [mysqlUsers] = await pool.query(
                    'SELECT id, name, email, mobile, role, location_name, created_at FROM users'
                );
                const userIds = new Set((mem.users || []).map((u) => String(u.id)));
                (mysqlUsers || []).forEach((u) => {
                    if (!userIds.has(String(u.id))) {
                        mem.users.push(u);
                        userIds.add(String(u.id));
                    }
                });

                const [mysqlVendors] = await pool.query('SELECT * FROM vendors');
                const vendorIds = new Set((mem.vendors || []).map((v) => String(v.id)));
                (mysqlVendors || []).forEach((v) => {
                    if (!vendorIds.has(String(v.id))) {
                        mem.vendors.push(v);
                        vendorIds.add(String(v.id));
                    }
                });

                usersAdded = (mem.users?.length || 0) - beforeUsers;
                vendorsAdded = (mem.vendors?.length || 0) - beforeVendors;

                const [mysqlMappings] = await pool.query('SELECT * FROM user_vendor_mappings');
                const mapKey = (m) => `${m.user_id}|${m.vendor_id}`;
                const haveMaps = new Set((mem.user_vendor_mappings || []).map(mapKey));
                (mysqlMappings || []).forEach((m) => {
                    if (!haveMaps.has(mapKey(m))) {
                        mem.user_vendor_mappings.push(m);
                        haveMaps.add(mapKey(m));
                    }
                });
            } catch (err) {
                LOG.warning(`[Hydrate] Core pull failed: ${err.message}`);
            }
        }

        let recentHydrated = 0;
        try {
            const { syncLast3Hours } = require('../syncLast3Hours');
            const counts = await syncLast3Hours({ exit: false, hydrateOnly: true });
            recentHydrated = counts?.hydrated || 0;
        } catch (err) {
            LOG.warning(`[Hydrate] Recent activity pull skipped: ${err.message}`);
        }

        let stockRows = 0;
        try {
            const stockDataService = require('./stockDataService');
            stockRows = await stockDataService.hydrateMemoryFromMysql();
        } catch (err) {
            LOG.warning(`[Hydrate] Stock data pull skipped: ${err.message}`);
        }

        let newsRows = 0;
        try {
            if ((mem.news_cache || []).length === 0 && pool) {
                const [rows] = await pool.query(
                    'SELECT * FROM news_cache ORDER BY updated_at DESC LIMIT 500'
                );
                if (rows?.length) {
                    mem.news_cache = rows;
                    newsRows = rows.length;
                }
            }
        } catch (err) {
            LOG.warning(`[Hydrate] News cache pull skipped: ${err.message}`);
        }

        let trustRows = 0;
        try {
            const { hydrateMemoryFromMysql } = require('./trustScore/trustScoreHydrateService');
            const trust = await hydrateMemoryFromMysql();
            trustRows = trust?.hydrated || 0;
        } catch (err) {
            LOG.warning(`[Hydrate] Trust score pull skipped: ${err.message}`);
        }

        LOG.info(
            `[Hydrate] Startup complete — users +${usersAdded}, vendors +${vendorsAdded}, recent +${recentHydrated}, stocks +${stockRows}, news +${newsRows}, trust +${trustRows}`
        );
        return { ok: true, usersAdded, vendorsAdded, recentHydrated, stockRows, newsRows, trustRows };
    })().catch((err) => {
        hydratePromise = null;
        LOG.error('[Hydrate] Startup failed:', err.message);
        return { ok: false, error: err.message };
    });

    return hydratePromise;
}

module.exports = { hydrateOnStartup };
