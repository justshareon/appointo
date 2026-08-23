/**
 * User ↔ vendor chat — messages retained 10 days then deleted.
 */
const RETENTION_MS = 10 * 24 * 60 * 60 * 1000;

module.exports = function createChatFeature(ctx) {
    const getPool = () => ctx.getPool();
    const LOG = ctx.LOG;
    const mem = () => ctx.inMemoryDb;

    const ensureMem = () => {
        const db = mem();
        if (!Array.isArray(db.chat_messages)) db.chat_messages = [];
        return db;
    };

    const cutoffDate = () => new Date(Date.now() - RETENTION_MS);

    const withinRetention = (row) => {
        const t = new Date(row.created_at || 0).getTime();
        return Number.isFinite(t) && t >= Date.now() - RETENTION_MS;
    };

    let chatSchemaReady = false;

    const api = {
        feature: 'chat',
        RETENTION_DAYS: 10,
        ensureTables: async () => api.ensureChatSchema(),

        ensureChatSchema: async () => {
            if (chatSchemaReady || !getPool()) return;
            try {
                await getPool().query(`
                    CREATE TABLE IF NOT EXISTS chat_messages (
                        id BIGINT AUTO_INCREMENT PRIMARY KEY,
                        user_id VARCHAR(255) NOT NULL,
                        vendor_id VARCHAR(255) NOT NULL,
                        sender_id VARCHAR(255) NOT NULL,
                        sender_role VARCHAR(16) NOT NULL,
                        body TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        INDEX idx_chat_thread_time (user_id, vendor_id, created_at),
                        INDEX idx_chat_created (created_at)
                    )
                `);
                chatSchemaReady = true;
            } catch (err) {
                LOG.warning('[Chat] ensure schema:', err.message);
            }
        },

        purgeExpiredChatMessages: async () => {
            const inMemoryDb = ensureMem();
            const before = inMemoryDb.chat_messages.length;
            inMemoryDb.chat_messages = inMemoryDb.chat_messages.filter(withinRetention);
            const memRemoved = before - inMemoryDb.chat_messages.length;

            let mysqlRemoved = 0;
            try {
                if (getPool()) {
                    await api.ensureChatSchema();
                    const [result] = await getPool().query(
                        'DELETE FROM chat_messages WHERE created_at < ?',
                        [cutoffDate()]
                    );
                    mysqlRemoved = result?.affectedRows || 0;
                }
            } catch (err) {
                LOG.warning('[Chat] purge failed:', err.message);
            }
            if (memRemoved || mysqlRemoved) {
                LOG.info(`[Chat] Purged expired messages mem=${memRemoved} mysql=${mysqlRemoved}`);
            }
            return { memRemoved, mysqlRemoved };
        },

        addChatMessage: async ({ user_id, vendor_id, sender_id, sender_role, body }) => {
            const inMemoryDb = ensureMem();
            const text = String(body || '').trim().slice(0, 2000);
            if (!text) throw new Error('Message body is required');
            if (!user_id || !vendor_id || !sender_id) throw new Error('user_id, vendor_id, sender_id required');

            const row = {
                user_id: String(user_id),
                vendor_id: String(vendor_id),
                sender_id: String(sender_id),
                sender_role: sender_role === 'vendor' ? 'vendor' : 'user',
                body: text,
                created_at: new Date(),
            };

            try {
                if (getPool()) {
                    await api.ensureChatSchema();
                    const [result] = await getPool().query(
                        `INSERT INTO chat_messages (user_id, vendor_id, sender_id, sender_role, body, created_at)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [row.user_id, row.vendor_id, row.sender_id, row.sender_role, row.body, row.created_at]
                    );
                    row.id = result?.insertId || Date.now();
                } else {
                    row.id = (inMemoryDb.chat_messages[inMemoryDb.chat_messages.length - 1]?.id || 0) + 1;
                }
            } catch (err) {
                LOG.error('[Chat] add failed, using memory', err.message);
                row.id = (inMemoryDb.chat_messages[inMemoryDb.chat_messages.length - 1]?.id || 0) + 1;
            }

            inMemoryDb.chat_messages.push(row);
            return row;
        },

        getChatMessages: async (userId, vendorId) => {
            const inMemoryDb = ensureMem();
            const cut = cutoffDate();
            try {
                if (getPool()) {
                    await api.ensureChatSchema();
                    const [rows] = await getPool().query(
                        `SELECT id, user_id, vendor_id, sender_id, sender_role, body, created_at FROM chat_messages
                         WHERE user_id = ?
                           AND vendor_id = ?
                           AND created_at >= ?
                         ORDER BY created_at ASC
                         LIMIT 500`,
                        [userId, vendorId, cut]
                    );
                    if (rows) return rows;
                }
            } catch (err) {
                LOG.error('[Chat] get messages failed', err.message);
            }
            return inMemoryDb.chat_messages
                .filter(
                    (m) =>
                        String(m.user_id) === String(userId) &&
                        String(m.vendor_id) === String(vendorId) &&
                        withinRetention(m)
                )
                .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
                .slice(-500);
        },

        getChatThreadsForUser: async (userId) => {
            const inMemoryDb = ensureMem();
            const cut = cutoffDate();
            try {
                if (getPool()) {
                    await api.ensureChatSchema();
                    const [rows] = await getPool().query(
                        `SELECT m.vendor_id, v.shop_name,
                                MAX(m.created_at) AS last_at,
                                SUBSTRING_INDEX(GROUP_CONCAT(m.body ORDER BY m.created_at DESC SEPARATOR '\\n'), '\\n', 1) AS last_body,
                                COUNT(*) AS message_count
                         FROM chat_messages m
                         LEFT JOIN vendors v ON m.vendor_id = v.id
                         WHERE m.user_id = ?
                           AND m.created_at >= ?
                         GROUP BY m.vendor_id, v.shop_name
                         ORDER BY last_at DESC`,
                        [userId, cut]
                    );
                    if (rows) {
                        return rows.map((r) => ({
                            vendor_id: r.vendor_id,
                            user_id: userId,
                            shop_name: r.shop_name || 'Shop',
                            last_at: r.last_at,
                            last_body: r.last_body || '',
                            message_count: Number(r.message_count || 0),
                        }));
                    }
                }
            } catch (err) {
                LOG.warning('[Chat] threads for user (mysql) failed:', err.message);
            }

            const map = new Map();
            inMemoryDb.chat_messages
                .filter((m) => String(m.user_id) === String(userId) && withinRetention(m))
                .forEach((m) => {
                    const key = String(m.vendor_id);
                    const prev = map.get(key);
                    if (!prev || new Date(m.created_at) > new Date(prev.last_at)) {
                        const v = (inMemoryDb.vendors || []).find((x) => String(x.id) === key);
                        map.set(key, {
                            vendor_id: m.vendor_id,
                            user_id: userId,
                            shop_name: v?.shop_name || 'Shop',
                            last_at: m.created_at,
                            last_body: m.body,
                            message_count: (prev?.message_count || 0) + 1,
                        });
                    } else if (prev) {
                        prev.message_count += 1;
                    }
                });
            return [...map.values()].sort((a, b) => new Date(b.last_at) - new Date(a.last_at));
        },

        getChatThreadsForVendorOwner: async (ownerId) => {
            const inMemoryDb = ensureMem();
            const cut = cutoffDate();
            const owned = (inMemoryDb.vendors || [])
                .filter((v) => String(v.owner_id) === String(ownerId))
                .map((v) => String(v.id));

            try {
                if (getPool()) {
                    await api.ensureChatSchema();
                    const [rows] = await getPool().query(
                        `SELECT m.user_id, m.vendor_id, v.shop_name, u.name AS user_name,
                                MAX(m.created_at) AS last_at,
                                SUBSTRING_INDEX(GROUP_CONCAT(m.body ORDER BY m.created_at DESC SEPARATOR '\\n'), '\\n', 1) AS last_body,
                                COUNT(*) AS message_count
                         FROM chat_messages m
                         JOIN vendors v ON m.vendor_id = v.id
                         LEFT JOIN users u ON m.user_id = u.id
                         WHERE v.owner_id = ?
                           AND m.created_at >= ?
                         GROUP BY m.user_id, m.vendor_id, v.shop_name, u.name
                         ORDER BY last_at DESC`,
                        [ownerId, cut]
                    );
                    if (rows) {
                        return rows.map((r) => ({
                            user_id: r.user_id,
                            vendor_id: r.vendor_id,
                            shop_name: r.shop_name || 'Shop',
                            user_name: r.user_name || 'Customer',
                            last_at: r.last_at,
                            last_body: r.last_body || '',
                            message_count: Number(r.message_count || 0),
                        }));
                    }
                }
            } catch (err) {
                LOG.warning('[Chat] threads for vendor failed:', err.message);
            }

            const map = new Map();
            inMemoryDb.chat_messages
                .filter((m) => owned.includes(String(m.vendor_id)) && withinRetention(m))
                .forEach((m) => {
                    const key = `${m.vendor_id}::${m.user_id}`;
                    const prev = map.get(key);
                    if (!prev || new Date(m.created_at) > new Date(prev.last_at)) {
                        const v = (inMemoryDb.vendors || []).find((x) => String(x.id) === String(m.vendor_id));
                        const u = (inMemoryDb.users || []).find((x) => String(x.id) === String(m.user_id));
                        map.set(key, {
                            user_id: m.user_id,
                            vendor_id: m.vendor_id,
                            shop_name: v?.shop_name || 'Shop',
                            user_name: u?.name || 'Customer',
                            last_at: m.created_at,
                            last_body: m.body,
                            message_count: (prev?.message_count || 0) + 1,
                        });
                    } else if (prev) {
                        prev.message_count += 1;
                    }
                });
            return [...map.values()].sort((a, b) => new Date(b.last_at) - new Date(a.last_at));
        },
    };

    return api;
};
