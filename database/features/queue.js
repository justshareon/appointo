/**
 * Queue feature DB — in-memory first, MySQL when DB_TYPE=mysql.
 * Connected from backend/database.js via dbContext.
 */
module.exports = function createQueueFeature(ctx) {
    const getPool = () => ctx.getPool();
    const LOG = ctx.LOG;
    const mem = () => ctx.inMemoryDb;
    const toMysqlDateTime = (...args) => ctx.toMysqlDateTime(...args);
    const sameId = (a, b) => String(a) === String(b);

    const hydrateQueues = (rows) => {
        const inMemoryDb = mem();
        if (!Array.isArray(inMemoryDb.queues)) inMemoryDb.queues = [];
        const seen = new Set(inMemoryDb.queues.map((q) => String(q.id)));
        for (const row of rows || []) {
            if (row?.id == null || seen.has(String(row.id))) continue;
            inMemoryDb.queues.push({ ...row });
            seen.add(String(row.id));
        }
    };

    const persistQueue = async (item) => {
        const pool = getPool();
        if (!pool || !item) return;
        const joined = item.joined_at || new Date();
        if (item.id != null) {
            await pool.query(
                `INSERT INTO queues (id, vendor_id, user_id, status, position, joined_at)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE status = VALUES(status), vendor_id = VALUES(vendor_id), user_id = VALUES(user_id)`,
                [item.id, item.vendor_id, item.user_id, item.status || 'waiting', item.position || 0, joined]
            );
            return;
        }
        await pool.query(
            `INSERT INTO queues (vendor_id, user_id, status, position, joined_at)
             VALUES (?, ?, ?, ?, ?)`,
            [item.vendor_id, item.user_id, item.status || 'waiting', item.position || 0, joined]
        );
    };

    const rememberQueue = (item) => {
        const inMemoryDb = mem();
        if (!Array.isArray(inMemoryDb.queues)) inMemoryDb.queues = [];
        const exists = inMemoryDb.queues.some((q) =>
            (item.id != null && sameId(q.id, item.id)) ||
            (sameId(q.user_id, item.user_id) && sameId(q.vendor_id, item.vendor_id) && q.status === (item.status || 'waiting'))
        );
        if (!exists) inMemoryDb.queues.push({ ...item, id: item.id || Date.now() });
    };

    const persistMissingQueues = async (localRows, mysqlRows) => {
        const pool = getPool();
        if (!pool) return;
        const seen = new Set((mysqlRows || []).map((r) => String(r.id)));
        const missing = (localRows || []).filter((row) => row && (row.id == null || !seen.has(String(row.id))));
        if (!missing.length) return;
        const { insertMany } = require('../sqlBatch');
        try {
            const toRow = (item) => ({
                id: item.id,
                vendor_id: item.vendor_id,
                user_id: item.user_id,
                status: item.status || 'waiting',
                position: item.position || 0,
                joined_at: item.joined_at || new Date(),
            });
            await insertMany(
                pool,
                'queues',
                ['id', 'vendor_id', 'user_id', 'status', 'position', 'joined_at'],
                missing.filter((r) => r.id != null).map(toRow),
                { update: 'status = VALUES(status), vendor_id = VALUES(vendor_id), user_id = VALUES(user_id)' }
            );
            await insertMany(
                pool,
                'queues',
                ['vendor_id', 'user_id', 'status', 'position', 'joined_at'],
                missing.filter((r) => r.id == null).map(toRow)
            );
        } catch (e) {
            for (const row of missing) {
                try { await persistQueue(row); } catch (err) { /* keep serving */ }
            }
        }
    };

    return {
        feature: 'queue',
        ensureTables: async (mainDb) => {
            if (mainDb?.ensureFeatureSchema) await mainDb.ensureFeatureSchema('queue');
        },
        autoCompleteQueues: async () => {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const todayStr = toMysqlDateTime(today).split(' ')[0];
            const affectedVendorIds = new Set();
            const inMemoryDb = mem();

            try {
                if (getPool()) {
                    const [rows] = await getPool().query(
                        `SELECT id, vendor_id, joined_at FROM queues WHERE status = 'waiting' AND joined_at < ?`,
                        [`${todayStr} 00:00:00`]
                    );
                    if (rows.length > 0) {
                        const ids = rows.map(r => r.id);
                        await getPool().query(
                            `UPDATE queues SET status = 'done' WHERE id IN (${ids.map(() => '?').join(',')})`,
                            ids
                        );
                        for (const queue of rows) {
                            affectedVendorIds.add(queue.vendor_id);
                            LOG.info(`[AUTO-COMPLETE] Queue ${queue.id} from ${queue.joined_at} marked as done`);
                        }
                    }
                }
            } catch (err) {
                LOG.error("MySQL autoCompleteQueues failed, falling back to local", err.message);
                try {
                    const { isMysqlConfigured } = require('../../utils/resolveDbType');
                    if (isMysqlConfigured()) {
                        const { scheduleJobRetry } = require('../../services/failedRetryService');
                        scheduleJobRetry('mysql:autoCompleteQueues', 'MySQL auto-complete queues', async () => {
                            const pool = getPool();
                            if (!pool) throw new Error('MySQL pool unavailable');
                            const now = new Date();
                            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                            const todayStr = toMysqlDateTime(today).split(' ')[0];
                            const [rows] = await pool.query(
                                `SELECT id, vendor_id, joined_at FROM queues WHERE status = 'waiting' AND joined_at < ?`,
                                [`${todayStr} 00:00:00`]
                            );
                            if (!rows.length) return;
                            const ids = rows.map((r) => r.id);
                            await pool.query(
                                `UPDATE queues SET status = 'done' WHERE id IN (${ids.map(() => '?').join(',')})`,
                                ids
                            );
                        });
                    }
                } catch {
                    /* ignore retry queue errors */
                }
            }

            inMemoryDb.queues.forEach(queue => {
                if (queue.status === 'waiting') {
                    const queueDate = new Date(queue.joined_at);
                    const queueDateStr = new Date(queueDate.getFullYear(), queueDate.getMonth(), queueDate.getDate());
                    if (queueDateStr < today) {
                        queue.status = 'done';
                        affectedVendorIds.add(queue.vendor_id);
                        LOG.info(`[AUTO-COMPLETE] Queue ${queue.id} from ${queue.joined_at} marked as done`);
                    }
                }
            });
            return Array.from(affectedVendorIds);
        },

        getQueueByVendor: async (vendorId) => {
            const inMemoryDb = mem();
            const fromMemory = () => {
                if (!inMemoryDb.queues || !Array.isArray(inMemoryDb.queues)) return [];
                return inMemoryDb.queues
                    .filter(q => sameId(q.vendor_id, vendorId) && q.status === "waiting")
                    .map(q => {
                        const u = (inMemoryDb.users || []).find(u => sameId(u.id, q.user_id));
                        return { ...q, userName: u ? u.name : 'Unknown', userMobile: u ? u.mobile : '' };
                    })
                    .sort((a, b) => new Date(a.joined_at || 0) - new Date(b.joined_at || 0));
            };
            let mysqlRows = [];
            try {
                if (getPool()) {
                    const [rows] = await getPool().query(
                        'SELECT q.*, u.name as userName, u.mobile as userMobile FROM queues q LEFT JOIN users u ON q.user_id = u.id WHERE q.vendor_id = ? AND q.status = "waiting" ORDER BY q.joined_at ASC',
                        [vendorId]
                    );
                    mysqlRows = rows || [];
                    hydrateQueues(mysqlRows);
                    await persistMissingQueues(fromMemory(), mysqlRows);
                }
            } catch (err) {
                LOG.error(`MySQL getQueueByVendor failed for ${vendorId}, falling back to local`, err.message);
            }
            const local = fromMemory();
            const seen = new Set(mysqlRows.map((r) => String(r.id)));
            return [...mysqlRows, ...local.filter((r) => !seen.has(String(r.id)))];
        },

        addQueueItem: async (item) => {
            const row = {
                vendor_id: item.vendor_id,
                user_id: item.user_id,
                status: item.status || 'waiting',
                position: item.position || 0,
                joined_at: item.joined_at || new Date(),
            };
            let mysqlId = null;
            try {
                if (getPool()) {
                    const [result] = await getPool().query(
                        `INSERT INTO queues (vendor_id, user_id, status, position, joined_at) VALUES (?, ?, ?, ?, ?)`,
                        [row.vendor_id, row.user_id, row.status, row.position, row.joined_at]
                    );
                    mysqlId = result?.insertId || null;
                }
            } catch (err) {
                LOG.error("MySQL addQueueItem failed, falling back to local", err.message);
            }
            const saved = { ...row, id: mysqlId || item.id || Date.now() };
            rememberQueue(saved);
            if (!mysqlId) {
                try {
                    const { mirrorQuery } = require('../mysqlMirror');
                    await mirrorQuery(
                        `INSERT INTO queues (vendor_id, user_id, status, position, joined_at) VALUES (?, ?, ?, ?, ?)`,
                        [row.vendor_id, row.user_id, row.status, row.position, row.joined_at]
                    );
                } catch (e) { /* mirror is best-effort */ }
            }
            return true;
        },

        removeQueueItem: async (userId, vendorId) => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    const [result] = await getPool().query(
                        'DELETE FROM queues WHERE user_id = ? AND vendor_id = ? AND status = "waiting"',
                        [userId, vendorId]
                    );
                    return result.affectedRows > 0;
                }
            } catch (err) {
                LOG.error("MySQL removeQueueItem failed, falling back to local", err.message);
            }
            const initialLength = inMemoryDb.queues.length;
            inMemoryDb.queues = inMemoryDb.queues.filter(q => !(q.user_id === userId && q.vendor_id === vendorId && q.status === "waiting"));
            return inMemoryDb.queues.length < initialLength;
        },

        deleteQueueItemById: async (queueId) => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    const [rows] = await getPool().query('SELECT vendor_id, user_id FROM queues WHERE id = ?', [queueId]);
                    const [result] = await getPool().query('DELETE FROM queues WHERE id = ?', [queueId]);
                    if (result.affectedRows > 0 && rows[0]) {
                        const { vendor_id, user_id } = rows[0];
                        await getPool().query(
                            'DELETE FROM appointments WHERE user_id = ? AND vendor_id = ? AND status IN ("pending", "confirmed")',
                            [user_id, vendor_id]
                        );
                        LOG.info(`[SYNC] Queue Delete -> Appointment Delete for user ${user_id}`);
                    }
                    return result.affectedRows > 0;
                }
            } catch (err) {
                LOG.error("MySQL deleteQueueItemById failed, falling back to local", err.message);
            }

            const item = inMemoryDb.queues.find(q => q.id === parseInt(queueId));
            if (item) {
                const initialApptLen = inMemoryDb.appointments.length;
                inMemoryDb.appointments = inMemoryDb.appointments.filter(a =>
                    !(a.user_id === item.user_id && a.vendor_id === item.vendor_id && (a.status === 'pending' || a.status === 'confirmed'))
                );
                if (inMemoryDb.appointments.length < initialApptLen) {
                    LOG.info(`[SYNC] Queue Delete -> Appointment Delete for user ${item.user_id}`);
                }
            }
            const initialLength = inMemoryDb.queues.length;
            inMemoryDb.queues = inMemoryDb.queues.filter(q => q.id !== parseInt(queueId));
            return inMemoryDb.queues.length < initialLength;
        },

        updateQueueStatus: async (queueId, status) => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    await getPool().query('UPDATE queues SET status = ? WHERE id = ?', [status, queueId]);
                    const [rows] = await getPool().query('SELECT vendor_id, user_id FROM queues WHERE id = ?', [queueId]);
                    if (rows[0]) {
                        const { vendor_id: vendorId, user_id: userId } = rows[0];
                        if (userId && (status === 'done' || status === 'cancelled')) {
                            const apptStatus = status === 'done' ? 'completed' : 'cancelled';
                            await getPool().query(
                                'UPDATE appointments SET status = ? WHERE user_id = ? AND vendor_id = ? AND status IN ("pending", "confirmed")',
                                [apptStatus, userId, vendorId]
                            );
                            LOG.info(`[SYNC] Queue ${status} -> Appointment ${apptStatus} for user ${userId}`);
                        }
                        return vendorId;
                    }
                    return null;
                }
            } catch (err) {
                LOG.error(`MySQL updateQueueStatus failed for ${queueId}, falling back to local`, err.message);
            }

            const item = inMemoryDb.queues.find(q => q.id === parseInt(queueId));
            if (item) {
                item.status = status;
                if (status === 'done' || status === 'cancelled') {
                    const targetApptStatus = status === 'done' ? 'completed' : 'cancelled';
                    const relatedAppt = inMemoryDb.appointments.find(a =>
                        a.user_id === item.user_id &&
                        a.vendor_id === item.vendor_id &&
                        (a.status === 'pending' || a.status === 'confirmed')
                    );
                    if (relatedAppt) {
                        relatedAppt.status = targetApptStatus;
                        LOG.info(`[SYNC] Queue ${status} -> Appointment ${targetApptStatus} for user ${item.user_id}`);
                    }
                }
                return item.vendor_id;
            }
            return null;
        },

        getUserHistory: async (userId) => {
            const inMemoryDb = mem();
            const fromMemory = () => {
                if (!userId || !inMemoryDb.queues || !Array.isArray(inMemoryDb.queues)) return [];
                return inMemoryDb.queues.filter(q => sameId(q.user_id, userId))
                    .map(q => {
                        const v = (inMemoryDb.vendors || []).find(v => sameId(v.id, q.vendor_id));
                        const sameVendorWaiting = inMemoryDb.queues.filter(x => sameId(x.vendor_id, q.vendor_id) && x.status === 'waiting');
                        return {
                            ...q,
                            shop_name: q.shop_name || (v ? v.shop_name : 'Unknown Shop'),
                            total_waiting: sameVendorWaiting.length,
                            queue_position: sameVendorWaiting.filter(x => x.joined_at < q.joined_at).length + 1
                        };
                    });
            };
            let mysqlRows = [];
            try {
                if (getPool()) {
                    const [rows] = await getPool().query(`
                    SELECT q.*, v.shop_name
                    FROM queues q
                    LEFT JOIN vendors v ON q.vendor_id = v.id
                    WHERE q.user_id = ?
                    ORDER BY q.joined_at DESC`, [userId]);
                    mysqlRows = (rows || []).map(r => ({
                        ...r,
                        shop_name: r.shop_name || 'Unknown Shop',
                        total_waiting: 0,
                        queue_position: 0
                    }));
                    hydrateQueues(mysqlRows);
                    await persistMissingQueues(fromMemory(), mysqlRows);
                }
            } catch (err) {
                LOG.error(`MySQL getUserHistory failed for ${userId}, falling back to local`, err.message);
            }
            const local = fromMemory();
            const seen = new Set(mysqlRows.map((r) => String(r.id)));
            const extra = local.filter((r) => r?.id == null || !seen.has(String(r.id)));
            return [...mysqlRows, ...extra].sort((a, b) => {
                const ta = new Date(a.joined_at || 0).getTime();
                const tb = new Date(b.joined_at || 0).getTime();
                return tb - ta;
            });
        },

        getVendorHistory: async (vendorId) => {
            const inMemoryDb = mem();
            const fromMemory = () => {
                if (!vendorId) return [];
                return inMemoryDb.queues
                    .filter(q => sameId(q.vendor_id, vendorId) && ["done", "cancelled"].includes(q.status))
                    .map(q => ({
                        ...q,
                        userName: (inMemoryDb.users || []).find(u => sameId(u.id, q.user_id))?.name || 'Unknown'
                    }));
            };
            let mysqlRows = [];
            try {
                if (getPool()) {
                    const [rows] = await getPool().query(
                        'SELECT q.*, u.name as userName FROM queues q LEFT JOIN users u ON q.user_id = u.id WHERE q.vendor_id = ? AND q.status IN ("done", "cancelled") ORDER BY q.joined_at DESC',
                        [vendorId]
                    );
                    mysqlRows = rows || [];
                    hydrateQueues(mysqlRows);
                    await persistMissingQueues(fromMemory(), mysqlRows);
                }
            } catch (err) {
                LOG.error(`MySQL getVendorHistory failed for ${vendorId}, falling back to local`, err.message);
            }
            const local = fromMemory();
            const seen = new Set(mysqlRows.map((r) => String(r.id)));
            return [...mysqlRows, ...local.filter((r) => !seen.has(String(r.id)))]
                .sort((a, b) => new Date(b.joined_at || 0) - new Date(a.joined_at || 0));
        },
    };
};
