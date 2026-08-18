/**
 * Queue feature DB — in-memory first, MySQL when DB_TYPE=mysql.
 * Connected from backend/database.js via dbContext.
 */
module.exports = function createQueueFeature(ctx) {
    const getPool = () => ctx.getPool();
    const LOG = ctx.LOG;
    const mem = () => ctx.inMemoryDb;
    const toMysqlDateTime = (...args) => ctx.toMysqlDateTime(...args);

    return {
        feature: 'queue',
        autoCompleteQueues: async () => {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const todayStr = toMysqlDateTime(today).split(' ')[0];
            const affectedVendorIds = new Set();
            const inMemoryDb = mem();

            try {
                if (getPool()) {
                    const [rows] = await getPool().query(
                        `SELECT * FROM queues WHERE status = 'waiting' AND DATE(joined_at) < ?`,
                        [todayStr]
                    );
                    if (rows.length > 0) {
                        const ids = rows.map(r => r.id);
                        await getPool().query(`UPDATE queues SET status = 'done' WHERE id IN (?)`, [ids]);
                        for (const queue of rows) {
                            affectedVendorIds.add(queue.vendor_id);
                            LOG.info(`[AUTO-COMPLETE] Queue ${queue.id} from ${queue.joined_at} marked as done`);
                        }
                        return Array.from(affectedVendorIds);
                    }
                    return [];
                }
            } catch (err) {
                LOG.error("MySQL autoCompleteQueues failed, falling back to local", err.message);
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
            try {
                if (getPool()) {
                    const [rows] = await getPool().query(
                        'SELECT q.*, u.name as userName, u.mobile as userMobile FROM queues q JOIN users u ON q.user_id = u.id WHERE q.vendor_id = ? AND q.status = "waiting" ORDER BY q.joined_at ASC',
                        [vendorId]
                    );
                    if (rows) return rows;
                }
            } catch (err) {
                LOG.error(`MySQL getQueueByVendor failed for ${vendorId}, falling back to local`, err.message);
            }
            if (!inMemoryDb.queues || !Array.isArray(inMemoryDb.queues)) return [];
            return inMemoryDb.queues.filter(q => q.vendor_id === vendorId && q.status === "waiting")
                .map(q => {
                    const u = inMemoryDb.users.find(u => u.id === q.user_id);
                    return { ...q, userName: u ? u.name : 'Unknown', userMobile: u ? u.mobile : '' };
                }).sort((a, b) => (a.joined_at || 0) - (b.joined_at || 0));
        },

        addQueueItem: async (item) => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    await getPool().query('INSERT INTO queues SET ?', [item]);
                    return true;
                }
            } catch (err) {
                LOG.error("MySQL addQueueItem failed, falling back to local", err.message);
            }
            inMemoryDb.queues.push({ ...item, id: inMemoryDb.queues.length + 1 });
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
            try {
                if (getPool()) {
                    const [rows] = await getPool().query(`
                    WITH QueueStats AS (
                        SELECT q.*, v.shop_name,
                               COUNT(*) OVER(PARTITION BY q.vendor_id, q.status) as total_waiting_calc,
                               RANK() OVER(PARTITION BY q.vendor_id, q.status ORDER BY q.joined_at ASC) as queue_position_calc
                        FROM queues q
                        JOIN vendors v ON q.vendor_id = v.id
                        WHERE q.user_id = ? OR q.status = 'waiting'
                    )
                    SELECT * FROM QueueStats WHERE user_id = ? ORDER BY joined_at DESC`, [userId, userId]);
                    if (rows) {
                        return rows.map(r => ({
                            ...r,
                            total_waiting: r.status === 'waiting' ? r.total_waiting_calc : 0,
                            queue_position: r.status === 'waiting' ? r.queue_position_calc : 0
                        }));
                    }
                }
            } catch (err) {
                LOG.error(`MySQL getUserHistory failed for ${userId}, falling back to local`, err.message);
            }
            if (!userId) return [];
            return inMemoryDb.queues.filter(q => q.user_id === userId)
                .map(q => {
                    const v = inMemoryDb.vendors.find(v => v.id === q.vendor_id);
                    const sameVendorWaiting = inMemoryDb.queues.filter(x => x.vendor_id === q.vendor_id && x.status === 'waiting');
                    return {
                        ...q,
                        shop_name: v ? v.shop_name : 'Unknown Shop',
                        total_waiting: sameVendorWaiting.length,
                        queue_position: sameVendorWaiting.filter(x => x.joined_at < q.joined_at).length + 1
                    };
                }).sort((a, b) => b.joined_at - a.joined_at);
        },

        getVendorHistory: async (vendorId) => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    const [rows] = await getPool().query(
                        'SELECT q.*, u.name as userName FROM queues q JOIN users u ON q.user_id = u.id WHERE q.vendor_id = ? AND q.status IN ("done", "cancelled") ORDER BY q.joined_at DESC',
                        [vendorId]
                    );
                    if (rows) return rows;
                }
            } catch (err) {
                LOG.error(`MySQL getVendorHistory failed for ${vendorId}, falling back to local`, err.message);
            }
            if (!vendorId) return [];
            return inMemoryDb.queues.filter(q => q.vendor_id === vendorId && ["done", "cancelled"].includes(q.status))
                .map(q => ({ ...q, userName: inMemoryDb.users.find(u => u.id === q.user_id)?.name || 'Unknown' }))
                .sort((a, b) => b.joined_at - a.joined_at);
        },
    };
};
