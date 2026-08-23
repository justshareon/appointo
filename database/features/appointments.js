/**
 * Appointments feature DB — in-memory first, MySQL when DB_TYPE=mysql.
 * Connected from backend/database.js via dbContext.
 */
module.exports = function createAppointmentsFeature(ctx) {
    const getPool = () => ctx.getPool();
    const LOG = ctx.LOG;
    const mem = () => ctx.inMemoryDb;
    const toMysqlDateTime = (...args) => ctx.toMysqlDateTime(...args);
    const sameId = (a, b) => String(a) === String(b);

    const appointmentDateStr = (value) => {
        if (value == null) return '';
        if (typeof value === 'string') return value.slice(0, 10);
        try {
            return toMysqlDateTime(value).split(' ')[0];
        } catch (e) {
            return String(value).slice(0, 10);
        }
    };

    const persistAppointment = async (row) => {
        const pool = getPool();
        if (!pool || !row) return;
        const created = row.created_at || new Date();
        if (row.id != null) {
            await pool.query(
                `INSERT INTO appointments (id, vendor_id, user_id, date, time, status, notes, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE status = VALUES(status), notes = VALUES(notes), date = VALUES(date), time = VALUES(time)`,
                [row.id, row.vendor_id, row.user_id, row.date, row.time, row.status || 'pending', row.notes || null, created]
            );
            return;
        }
        await pool.query(
            `INSERT INTO appointments (vendor_id, user_id, date, time, status, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [row.vendor_id, row.user_id, row.date, row.time, row.status || 'pending', row.notes || null, created]
        );
    };

    const persistMissingAppointments = async (localRows, mysqlRows) => {
        const pool = getPool();
        if (!pool) return;
        const seen = new Set((mysqlRows || []).map((r) => String(r.id)));
        const missing = (localRows || []).filter((row) => row && (row.id == null || !seen.has(String(row.id))));
        if (!missing.length) return;
        const { insertMany } = require('../sqlBatch');
        try {
            const toRow = (row) => ({
                id: row.id,
                vendor_id: row.vendor_id,
                user_id: row.user_id,
                date: row.date,
                time: row.time,
                status: row.status || 'pending',
                notes: row.notes || null,
                created_at: row.created_at || new Date(),
            });
            await insertMany(
                pool,
                'appointments',
                ['id', 'vendor_id', 'user_id', 'date', 'time', 'status', 'notes', 'created_at'],
                missing.filter((r) => r.id != null).map(toRow),
                { update: 'status = VALUES(status), notes = VALUES(notes), date = VALUES(date), time = VALUES(time)' }
            );
            await insertMany(
                pool,
                'appointments',
                ['vendor_id', 'user_id', 'date', 'time', 'status', 'notes', 'created_at'],
                missing.filter((r) => r.id == null).map(toRow)
            );
        } catch (e) {
            for (const row of missing) {
                try { await persistAppointment(row); } catch (err) { /* keep serving */ }
            }
        }
    };

    const expireInMemory = (currentDate, affectedVendorIds) => {
        const inMemoryDb = mem();
        (inMemoryDb.appointments || []).forEach((app) => {
            if ((app.status === 'pending' || app.status === 'confirmed') && appointmentDateStr(app.date) < currentDate) {
                app.status = 'completed';
                affectedVendorIds.add(app.vendor_id);
                const relatedQueue = (inMemoryDb.queues || []).find((q) =>
                    sameId(q.user_id, app.user_id) && sameId(q.vendor_id, app.vendor_id) && q.status === 'waiting'
                );
                if (relatedQueue) relatedQueue.status = 'done';
            }
        });
    };

    const resolvePool = async () => {
        const existing = getPool();
        if (existing) return existing;
        if (typeof ctx.ensureWritePool === 'function') {
            try { return await ctx.ensureWritePool(); } catch (e) { return null; }
        }
        return null;
    };

    return {
        feature: 'appointments',
        ensureTables: async (mainDb) => {
            if (mainDb?.ensureFeatureSchema) await mainDb.ensureFeatureSchema('appointments');
        },
        autoExpireAppointments: async () => {
            const now = new Date();
            const currentDate = toMysqlDateTime(now).split(' ')[0];
            const affectedVendorIds = new Set();

            try {
                const pool = await resolvePool();
                if (pool) {
                    try {
                        const { ensureFeatureSchema } = require('../schema/featureTables');
                        await ensureFeatureSchema('appointments', { getPool: () => pool });
                    } catch (e) { /* schema already tried */ }
                    const [rows] = await pool.query(
                        `SELECT id, vendor_id, user_id FROM appointments
                         WHERE status IN ('pending', 'confirmed') AND date < ? LIMIT 1000`,
                        [currentDate]
                    );
                    if (rows.length > 0) {
                        const ids = rows.map((r) => r.id);
                        rows.forEach((app) => affectedVendorIds.add(app.vendor_id));
                        await pool.query(
                            `UPDATE appointments SET status = 'completed' WHERE id IN (${ids.map(() => '?').join(',')})`,
                            ids
                        );
                        await pool.query(
                            `UPDATE queues q
                             INNER JOIN appointments a ON q.user_id = a.user_id AND q.vendor_id = a.vendor_id
                             SET q.status = 'done'
                             WHERE q.status = 'waiting' AND a.id IN (${ids.map(() => '?').join(',')})`,
                            ids
                        );
                        LOG.success(`[AUTO-EXPIRE] Completed ${rows.length} expired appointments`);
                    }
                }
            } catch (err) {
                LOG.error("MySQL autoExpireAppointments failed, falling back to local", err.message);
            }

            expireInMemory(currentDate, affectedVendorIds);
            return Array.from(affectedVendorIds);
        },

        deleteAppointmentById: async (appointmentId) => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    const [rows] = await getPool().query('SELECT vendor_id, user_id FROM appointments WHERE id = ?', [appointmentId]);
                    const [result] = await getPool().query('DELETE FROM appointments WHERE id = ?', [appointmentId]);
                    if (result.affectedRows > 0 && rows[0]) {
                        const { vendor_id, user_id } = rows[0];
                        await getPool().query(
                            'DELETE FROM queues WHERE user_id = ? AND vendor_id = ? AND status = "waiting"',
                            [user_id, vendor_id]
                        );
                        LOG.info(`[SYNC] Appointment Delete -> Queue Delete for user ${user_id}`);
                    }
                    return result.affectedRows > 0;
                }
            } catch (err) {
                LOG.error("MySQL deleteAppointmentById failed, falling back to local", err.message);
            }

            const app = inMemoryDb.appointments.find(a => a.id === parseInt(appointmentId));
            if (app) {
                const initialQueueLen = inMemoryDb.queues.length;
                inMemoryDb.queues = inMemoryDb.queues.filter(q =>
                    !(q.user_id === app.user_id && q.vendor_id === app.vendor_id && q.status === 'waiting')
                );
                if (inMemoryDb.queues.length < initialQueueLen) {
                    LOG.info(`[SYNC] Appointment Delete -> Queue Delete for user ${app.user_id}`);
                }
            }
            const initialLength = inMemoryDb.appointments.length;
            inMemoryDb.appointments = inMemoryDb.appointments.filter(a => a.id !== parseInt(appointmentId));
            return inMemoryDb.appointments.length < initialLength;
        },

        getAppointmentsByUser: async (userId) => {
            const inMemoryDb = mem();
            const sameId = (a, b) => String(a) === String(b);
            const fromMemory = () => {
                if (!userId) return [];
                return (inMemoryDb.appointments || [])
                    .filter(a => sameId(a.user_id, userId))
                    .map(a => {
                        const sameDay = (inMemoryDb.appointments || []).filter(x => sameId(x.vendor_id, a.vendor_id) && x.date === a.date && x.status !== 'cancelled');
                        return {
                            ...a,
                            shop_name: a.shop_name || (inMemoryDb.vendors || []).find(v => sameId(v.id, a.vendor_id))?.shop_name || 'Unknown',
                            total_at_shop_on_day: sameDay.length,
                            appointment_number: sameDay.filter(x => x.created_at < a.created_at).length + 1
                        };
                    });
            };
            let mysqlRows = [];
            try {
                if (getPool()) {
                    const [rows] = await getPool().query(`
                    SELECT a.*, v.shop_name
                    FROM appointments a
                    LEFT JOIN vendors v ON a.vendor_id = v.id
                    WHERE a.user_id = ?
                    ORDER BY a.date ASC, a.time ASC`, [userId]);
                    mysqlRows = (rows || []).map(r => ({
                        ...r,
                        shop_name: r.shop_name || 'Unknown',
                        total_at_shop_on_day: 0,
                        appointment_number: 0
                    }));
                    if (!Array.isArray(inMemoryDb.appointments)) inMemoryDb.appointments = [];
                    const seen = new Set(inMemoryDb.appointments.map((a) => String(a.id)));
                    for (const row of mysqlRows) {
                        if (row?.id == null || seen.has(String(row.id))) continue;
                        inMemoryDb.appointments.push({ ...row });
                        seen.add(String(row.id));
                    }
                    await persistMissingAppointments(fromMemory(), mysqlRows);
                }
            } catch (err) {
                LOG.error(`MySQL getAppointmentsByUser failed for ${userId}, falling back to local`, err.message);
            }
            const local = fromMemory();
            const seen = new Set(mysqlRows.map((r) => String(r.id)));
            const extra = local.filter((r) => r?.id == null || !seen.has(String(r.id)));
            return [...mysqlRows, ...extra].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.time || '').localeCompare(String(b.time || '')));
        },

        addAppointment: async (appData) => {
            const inMemoryDb = mem();
            const row = {
                vendor_id: appData.vendor_id,
                user_id: appData.user_id,
                date: appData.date,
                time: appData.time,
                status: appData.status || 'pending',
                notes: appData.notes || null,
                created_at: appData.created_at || new Date()
            };
            try {
                if (getPool()) {
                    const [result] = await getPool().query(
                        `INSERT INTO appointments (vendor_id, user_id, date, time, status, notes, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [row.vendor_id, row.user_id, row.date, row.time, row.status, row.notes, row.created_at]
                    );
                    row.id = result?.insertId || row.id;
                }
            } catch (err) {
                LOG.error("MySQL addAppointment failed, falling back to local", err.message);
            }
            if (!Array.isArray(inMemoryDb.appointments)) inMemoryDb.appointments = [];
            const exists = inMemoryDb.appointments.some((a) =>
                (row.id != null && String(a.id) === String(row.id)) ||
                (String(a.user_id) === String(row.user_id) && String(a.vendor_id) === String(row.vendor_id) && a.date === row.date && a.time === row.time)
            );
            if (!exists) inMemoryDb.appointments.push({ ...row, id: row.id || Date.now() });
            if (row.id == null) {
                const { mirrorQuery } = require('../mysqlMirror');
                await mirrorQuery(
                    `INSERT INTO appointments (vendor_id, user_id, date, time, status, notes, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE status = VALUES(status), notes = VALUES(notes)`,
                    [row.vendor_id, row.user_id, row.date, row.time, row.status, row.notes, row.created_at]
                );
            }
            return true;
        },

        updateAppointmentStatus: async (appointmentId, status) => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    const [rows] = await getPool().query('SELECT vendor_id, user_id FROM appointments WHERE id = ?', [appointmentId]);
                    const vendorId = rows[0]?.vendor_id || null;
                    const userId = rows[0]?.user_id || null;
                    await getPool().query('UPDATE appointments SET status = ? WHERE id = ?', [status, appointmentId]);
                    if ((status === 'cancelled' || status === 'completed') && userId && vendorId) {
                        const targetQueueStatus = status === 'completed' ? 'done' : 'cancelled';
                        await getPool().query(
                            'UPDATE queues SET status = ? WHERE user_id = ? AND vendor_id = ? AND status = "waiting"',
                            [targetQueueStatus, userId, vendorId]
                        );
                        LOG.info(`[SYNC] Appointment ${status} -> Queue ${targetQueueStatus} for user ${userId}`);
                    }
                    return { success: true, vendorId, userId };
                }
            } catch (err) {
                LOG.error(`MySQL updateAppointmentStatus failed for ${appointmentId}, falling back to local`, err.message);
            }

            const app = inMemoryDb.appointments.find(a => a.id === parseInt(appointmentId, 10) || String(a.id) === String(appointmentId));
            if (app) {
                app.status = status;
                if (status === 'cancelled' || status === 'completed') {
                    const targetQueueStatus = status === 'completed' ? 'done' : 'cancelled';
                    const relatedQueue = inMemoryDb.queues.find(q =>
                        q.user_id === app.user_id && q.vendor_id === app.vendor_id && q.status === 'waiting'
                    );
                    if (relatedQueue) {
                        relatedQueue.status = targetQueueStatus;
                        LOG.info(`[SYNC] Appointment ${status} -> Queue ${targetQueueStatus} for user ${app.user_id}`);
                    }
                }
                const { mirrorQuery } = require('../mysqlMirror');
                await mirrorQuery(
                    `UPDATE appointments SET status = ? WHERE vendor_id = ? AND user_id = ? AND date = ? AND time = ?`,
                    [status, app.vendor_id, app.user_id, app.date, app.time]
                );
                if (status === 'cancelled' || status === 'completed') {
                    const targetQueueStatus = status === 'completed' ? 'done' : 'cancelled';
                    await mirrorQuery(
                        `UPDATE queues SET status = ? WHERE user_id = ? AND vendor_id = ? AND status = "waiting"`,
                        [targetQueueStatus, app.user_id, app.vendor_id]
                    );
                }
                return { success: true, vendorId: app.vendor_id, userId: app.user_id };
            }
            return { success: false, vendorId: null, userId: null };
        },

        getAppointmentsByVendor: async (vendorId) => {
            const inMemoryDb = mem();
            const decorate = (a) => {
                const u = (inMemoryDb.users || []).find(usr => String(usr.id) === String(a.user_id));
                const v = (inMemoryDb.vendors || []).find(ven => String(ven.id) === String(a.vendor_id));
                return {
                    ...a,
                    userName: a.userName || (u ? u.name : 'Unknown'),
                    userMobile: a.userMobile || (u ? u.mobile : ''),
                    shop_name: a.shop_name || (v ? v.shop_name : '')
                };
            };
            const localFor = (ids, shopName) => {
                if (!inMemoryDb.appointments || !Array.isArray(inMemoryDb.appointments)) return [];
                return inMemoryDb.appointments
                    .filter((a) => {
                        if (ids.has(String(a.vendor_id))) return true;
                        if (shopName && String(a.shop_name || '') === String(shopName)) return true;
                        return false;
                    })
                    .map(decorate);
            };

            const ids = new Set([String(vendorId)]);
            let shopName = '';
            let ownerId = '';
            const localVendor = (inMemoryDb.vendors || []).find(v => String(v.id) === String(vendorId));
            if (localVendor) {
                shopName = localVendor.shop_name || '';
                ownerId = localVendor.owner_id != null ? String(localVendor.owner_id) : '';
                (inMemoryDb.vendors || []).forEach((v) => {
                    if (shopName && v.shop_name === shopName) ids.add(String(v.id));
                    if (ownerId && String(v.owner_id) === ownerId) ids.add(String(v.id));
                });
            }

            let mysqlRows = [];
            try {
                if (getPool()) {
                    const [vendorRows] = await getPool().query(
                        `SELECT id, shop_name, owner_id FROM vendors
                         WHERE id = ?
                            OR (? <> '' AND shop_name = ?)
                            OR (? <> '' AND owner_id = ?)`,
                        [vendorId, shopName || '', shopName || '', ownerId || '', ownerId || '']
                    );
                    (vendorRows || []).forEach((v) => {
                        if (v?.id != null) ids.add(String(v.id));
                        if (v?.shop_name) shopName = shopName || v.shop_name;
                    });
                    const idList = [...ids];
                    const placeholders = idList.map(() => '?').join(',');
                    const [rows] = await getPool().query(
                        `SELECT a.*, u.name as userName, u.mobile as userMobile, v.shop_name
                         FROM appointments a
                         LEFT JOIN users u ON u.id = a.user_id
                         LEFT JOIN vendors v ON v.id = a.vendor_id
                         WHERE a.vendor_id IN (${placeholders})
                            OR (? <> '' AND v.shop_name = ?)
                         ORDER BY a.date ASC, a.time ASC`,
                        [...idList, shopName || '', shopName || '']
                    );
                    mysqlRows = rows || [];
                    const inMemoryDb = mem();
                    if (!Array.isArray(inMemoryDb.appointments)) inMemoryDb.appointments = [];
                    const seen = new Set(inMemoryDb.appointments.map((a) => String(a.id)));
                    for (const row of mysqlRows) {
                        if (row?.id == null || seen.has(String(row.id))) continue;
                        inMemoryDb.appointments.push({ ...row });
                        seen.add(String(row.id));
                    }
                    await persistMissingAppointments(localFor(ids, shopName), mysqlRows);
                }
            } catch (err) {
                LOG.error(`MySQL getAppointmentsByVendor failed for ${vendorId}, falling back to local`, err.message);
            }

            const localRows = localFor(ids, shopName);
            const merged = new Map();
            [...mysqlRows, ...localRows].forEach((row) => {
                const key = row.id != null ? `id:${row.id}` : `${row.vendor_id}:${row.user_id}:${row.date}:${row.time}`;
                if (!merged.has(key)) merged.set(key, decorate(row));
            });
            return [...merged.values()].sort((a, b) => {
                const dateCompare = String(a.date || '').localeCompare(String(b.date || ''));
                if (dateCompare !== 0) return dateCompare;
                return String(a.time || '').localeCompare(String(b.time || ''));
            });
        },

        getAllAppointments: async () => {
            const inMemoryDb = mem();
            let mysqlRows = [];
            try {
                if (getPool()) {
                    const [rows] = await getPool().query('SELECT * FROM appointments');
                    mysqlRows = rows || [];
                    if (!Array.isArray(inMemoryDb.appointments)) inMemoryDb.appointments = [];
                    const seen = new Set(inMemoryDb.appointments.map((a) => String(a.id)));
                    for (const row of mysqlRows) {
                        if (row?.id == null || seen.has(String(row.id))) continue;
                        inMemoryDb.appointments.push({ ...row });
                        seen.add(String(row.id));
                    }
                }
            } catch (err) {
                LOG.error("MySQL getAllAppointments failed", err.message);
            }
            const local = inMemoryDb.appointments || [];
            const seen = new Set(mysqlRows.map((r) => String(r.id)));
            return [...mysqlRows, ...local.filter((r) => r?.id == null || !seen.has(String(r.id)))];
        },
    };
};
