/**
 * Appointments feature DB — in-memory first, MySQL when DB_TYPE=mysql.
 * Connected from backend/database.js via dbContext.
 */
module.exports = function createAppointmentsFeature(ctx) {
    const getPool = () => ctx.getPool();
    const LOG = ctx.LOG;
    const mem = () => ctx.inMemoryDb;
    const toMysqlDateTime = (...args) => ctx.toMysqlDateTime(...args);

    return {
        feature: 'appointments',
        autoExpireAppointments: async () => {
            const now = new Date();
            const currentDate = toMysqlDateTime(now).split(' ')[0];
            const affectedVendorIds = new Set();
            const inMemoryDb = mem();

            try {
                if (getPool()) {
                    try {
                        await getPool().query(`
                        ALTER TABLE appointments
                        ADD INDEX IF NOT EXISTS idx_status_date (status, date DESC)
                    `);
                    } catch (e) { /* index may exist */ }

                    const [rows] = await getPool().query(
                        `SELECT id, vendor_id, user_id FROM appointments 
                         WHERE status IN ('pending', 'confirmed') AND date < ? LIMIT 1000`,
                        [currentDate]
                    );
                    if (rows.length > 0) {
                        const ids = rows.map(r => r.id);
                        await getPool().query(
                            `UPDATE appointments SET status = 'completed', updated_at = NOW() WHERE id IN (${ids.map(() => '?').join(',')})`,
                            ids
                        );
                        const updates = rows.map(app => async () => {
                            affectedVendorIds.add(app.vendor_id);
                            await getPool().query(
                                'UPDATE queues SET status = "done", updated_at = NOW() WHERE user_id = ? AND vendor_id = ? AND status = "waiting"',
                                [app.user_id, app.vendor_id]
                            );
                        });
                        for (let i = 0; i < updates.length; i += 10) {
                            await Promise.all(updates.slice(i, i + 10).map(fn => fn().catch(e => LOG.warning('[AUTO-EXPIRE] Queue sync failed:', e.message))));
                        }
                        LOG.success(`[AUTO-EXPIRE] Completed ${rows.length} expired appointments`);
                        return Array.from(affectedVendorIds);
                    }
                    return [];
                }
            } catch (err) {
                LOG.error("MySQL autoExpireAppointments failed, falling back to local", err.message);
            }

            inMemoryDb.appointments.forEach(app => {
                if ((app.status === 'pending' || app.status === 'confirmed') && app.date < currentDate) {
                    app.status = 'completed';
                    affectedVendorIds.add(app.vendor_id);
                    const relatedQueue = inMemoryDb.queues.find(q =>
                        q.user_id === app.user_id && q.vendor_id === app.vendor_id && q.status === 'waiting'
                    );
                    if (relatedQueue) {
                        relatedQueue.status = 'done';
                        LOG.info(`[AUTO-EXPIRE] Appointment ${app.id} completed -> Queue done`);
                    }
                }
            });
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
            try {
                if (getPool()) {
                    const [rows] = await getPool().query(`
                    WITH AppStats AS (
                        SELECT a.*, v.shop_name,
                               COUNT(*) OVER(PARTITION BY a.vendor_id, a.date) as total_at_shop_on_day_calc,
                               RANK() OVER(PARTITION BY a.vendor_id, a.date ORDER BY a.created_at ASC) as appointment_number_calc
                        FROM appointments a
                        JOIN vendors v ON a.vendor_id = v.id
                    )
                    SELECT * FROM AppStats WHERE user_id = ? ORDER BY date ASC, time ASC`, [userId]);
                    if (rows) {
                        return rows.map(r => ({
                            ...r,
                            total_at_shop_on_day: r.total_at_shop_on_day_calc,
                            appointment_number: r.appointment_number_calc
                        }));
                    }
                }
            } catch (err) {
                LOG.error(`MySQL getAppointmentsByUser failed for ${userId}, falling back to local`, err.message);
            }
            if (!userId) return [];
            return inMemoryDb.appointments
                .filter(a => a.user_id === userId)
                .map(a => {
                    const sameDay = inMemoryDb.appointments.filter(x => x.vendor_id === a.vendor_id && x.date === a.date && x.status !== 'cancelled');
                    return {
                        ...a,
                        shop_name: inMemoryDb.vendors.find(v => v.id === a.vendor_id)?.shop_name || 'Unknown',
                        total_at_shop_on_day: sameDay.length,
                        appointment_number: sameDay.filter(x => x.created_at < a.created_at).length + 1
                    };
                })
                .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
        },

        addAppointment: async (appData) => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    await getPool().query('INSERT INTO appointments SET ?', [appData]);
                    return true;
                }
            } catch (err) {
                LOG.error("MySQL addAppointment failed, falling back to local", err.message);
            }
            inMemoryDb.appointments.push({ ...appData, id: inMemoryDb.appointments.length + 1 });
            return true;
        },

        updateAppointmentStatus: async (appointmentId, status) => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    await getPool().query('UPDATE appointments SET status = ? WHERE id = ?', [status, appointmentId]);
                    if (status === 'cancelled' || status === 'completed') {
                        const [rows] = await getPool().query('SELECT vendor_id, user_id FROM appointments WHERE id = ?', [appointmentId]);
                        if (rows[0]) {
                            const targetQueueStatus = status === 'completed' ? 'done' : 'cancelled';
                            await getPool().query(
                                'UPDATE queues SET status = ? WHERE user_id = ? AND vendor_id = ? AND status = "waiting"',
                                [targetQueueStatus, rows[0].user_id, rows[0].vendor_id]
                            );
                            LOG.info(`[SYNC] Appointment ${status} -> Queue ${targetQueueStatus} for user ${rows[0].user_id}`);
                        }
                    }
                    return true;
                }
            } catch (err) {
                LOG.error(`MySQL updateAppointmentStatus failed for ${appointmentId}, falling back to local`, err.message);
            }

            const app = inMemoryDb.appointments.find(a => a.id === parseInt(appointmentId));
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
                return true;
            }
            return !!app;
        },

        getAppointmentsByVendor: async (vendorId) => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    const [rows] = await getPool().query(`
                    SELECT a.*, u.name as userName, u.mobile as userMobile
                    FROM appointments a JOIN users u ON a.user_id = u.id 
                    WHERE a.vendor_id = ? ORDER BY a.date ASC, a.time ASC`, [vendorId]);
                    if (rows) return rows;
                }
            } catch (err) {
                LOG.error(`MySQL getAppointmentsByVendor failed for ${vendorId}, falling back to local`, err.message);
            }
            if (!vendorId) return [];
            if (!inMemoryDb.appointments || !Array.isArray(inMemoryDb.appointments)) return [];
            return inMemoryDb.appointments
                .filter(a => a.vendor_id === vendorId)
                .map(a => {
                    const u = inMemoryDb.users.find(u => u.id === a.user_id);
                    return { ...a, userName: u ? u.name : 'Unknown', userMobile: u ? u.mobile : '' };
                })
                .sort((a, b) => {
                    const dateCompare = (a.date || '').localeCompare(b.date || '');
                    if (dateCompare !== 0) return dateCompare;
                    return (a.time || '').localeCompare(b.time || '');
                });
        },

        getAllAppointments: async () => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    const [rows] = await getPool().query('SELECT * FROM appointments');
                    return rows;
                }
            } catch (err) {
                LOG.error("MySQL getAllAppointments failed", err.message);
            }
            return inMemoryDb.appointments;
        },
    };
};
