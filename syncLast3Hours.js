/**
 * Sync last 3 hours of activity: in-memory ↔ MySQL.
 * Only upserts rows that look recent and are missing / stale.
 * If nothing missed → no-op (leave as-is).
 *
 * Usage: node syncLast3Hours.js
 */
require('./loadEnv');
const db = require('./database');
const LOG = require('./utils/logger');
const featureConnectionManager = require('./database/featureConnectionManager');

const HOURS = 3;
const CUTOFF_MS = Date.now() - HOURS * 60 * 60 * 1000;
const cutoffDate = new Date(CUTOFF_MS);
const todayStr = new Date().toISOString().slice(0, 10);

const mem = () => db.inMemoryDb;

const ts = (value) => {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
};

const isRecent = (row, fields = ['created_at', 'updated_at', 'joined_at', 'timestamp']) => {
  if (!row) return false;
  for (const f of fields) {
    if (ts(row[f]) >= CUTOFF_MS) return true;
  }
  // Appointments booked for "today" count as recent activity window
  if (row.date && String(row.date).slice(0, 10) === todayStr) return true;
  return false;
};

const productNameKey = (name) =>
  String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

async function getPool() {
  let pool = typeof db.getPool === 'function' ? db.getPool() : null;
  if (!pool) pool = await featureConnectionManager.acquireForSync('core');
  return pool;
}

async function syncRecentUsers(pool) {
  // Missed creates: in memory but not MySQL (no time filter — dual-write gaps)
  let n = 0;
  for (const u of mem().users || []) {
    const [existing] = await pool.query('SELECT id FROM users WHERE id = ? LIMIT 1', [u.id]);
    if (existing?.length) continue;
    await pool.query(
      `INSERT INTO users (id, name, email, mobile, role, location_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), email=VALUES(email), mobile=VALUES(mobile), role=VALUES(role), location_name=VALUES(location_name)`,
      [u.id, u.name || '', u.email || null, u.mobile || null, u.role || 'user', u.location_name || '', u.created_at || new Date()]
    );
    n += 1;
    LOG.info(`[3h] user inserted ${u.id} (${u.name})`);
  }
  return n;
}

async function syncRecentVendors(pool) {
  // Vendors rarely have created_at — sync any in-memory vendor missing from MySQL (missed creates)
  let n = 0;
  for (const v of mem().vendors || []) {
    const [existing] = await pool.query('SELECT id FROM vendors WHERE id = ? LIMIT 1', [v.id]);
    if (existing?.length) continue;
    await pool.query(
      `INSERT INTO vendors (
          id, owner_id, shop_name, category, is_active, is_promoted,
          latitude, longitude, features_products, features_payments, features_appointments, features_queue,
          visibility_list, location_name
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE shop_name=VALUES(shop_name), owner_id=VALUES(owner_id), visibility_list=VALUES(visibility_list)`,
      [
        v.id,
        v.owner_id || '',
        v.shop_name || '',
        v.category || '',
        v.is_active !== false ? 1 : 0,
        v.is_promoted ? 1 : 0,
        v.latitude || 0,
        v.longitude || 0,
        v.features_products !== false ? 1 : 0,
        v.features_payments !== false ? 1 : 0,
        v.features_appointments !== false ? 1 : 0,
        v.features_queue !== false ? 1 : 0,
        v.visibility_list !== false ? 1 : 0,
        v.location_name || '',
      ]
    );
    n += 1;
    LOG.info(`[3h] vendor inserted ${v.id} (${v.shop_name})`);
  }
  return n;
}

async function syncRecentMappings(pool) {
  let n = 0;
  for (const m of mem().user_vendor_mappings || []) {
    const [existing] = await pool.query(
      'SELECT id FROM user_vendor_mappings WHERE user_id = ? AND vendor_id = ? LIMIT 1',
      [m.user_id, m.vendor_id]
    );
    if (existing?.length) continue;
    await pool.query(
      'INSERT IGNORE INTO user_vendor_mappings (user_id, vendor_id, created_at) VALUES (?, ?, ?)',
      [m.user_id, m.vendor_id, m.created_at || new Date()]
    );
    n += 1;
    LOG.info(`[3h] mapping inserted ${m.user_id}→${m.vendor_id}`);
  }
  return n;
}

async function syncRecentProducts(pool) {
  // Missed product creates only (already in MySQL → skip)
  let n = 0;
  for (const p of mem().products || []) {
    const nameKey = p.name_key || productNameKey(p.name);
    const [existing] = await pool.query(
      'SELECT id FROM products WHERE vendor_id = ? AND (id = ? OR name_key = ?) LIMIT 1',
      [p.vendor_id, p.id, nameKey]
    );
    if (existing?.length) continue;
    await pool.query(
      `INSERT INTO products (id, vendor_id, name, name_key, price, description, offer, offer_amount, image_urls_json, validity_from, validity_to, category, stock)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE price=VALUES(price), offer=VALUES(offer), offer_amount=VALUES(offer_amount)`,
      [
        p.id,
        p.vendor_id,
        p.name,
        nameKey,
        p.price || 0,
        p.description || '',
        p.offer || '',
        p.offer_amount || 0,
        JSON.stringify(p.image_urls || []),
        p.validity_from || null,
        p.validity_to || null,
        p.category || '',
        p.stock != null ? p.stock : 100,
      ]
    );
    n += 1;
    LOG.info(`[3h] product inserted ${p.id} ${p.name}`);
  }
  return n;
}

async function syncRecentAppointments(pool) {
  const recent = (mem().appointments || []).filter((a) => isRecent(a));
  let n = 0;
  for (const a of recent) {
    const [existing] = await pool.query(
      `SELECT id FROM appointments
       WHERE vendor_id = ? AND user_id = ? AND date = ? AND time = ?
       LIMIT 1`,
      [a.vendor_id, a.user_id, a.date, a.time]
    );
    if (existing?.length) continue;
    await pool.query(
      `INSERT INTO appointments (vendor_id, user_id, date, time, status, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status=VALUES(status), notes=VALUES(notes)`,
      [
        a.vendor_id,
        a.user_id,
        a.date,
        a.time,
        a.status || 'pending',
        a.notes || null,
        a.created_at || new Date(),
      ]
    );
    n += 1;
    LOG.info(`[3h] appointment inserted ${a.vendor_id} ${a.user_id} ${a.date} ${a.time}`);
  }
  return n;
}

async function syncRecentQueues(pool) {
  const recent = (mem().queues || []).filter((q) => isRecent(q, ['joined_at', 'created_at']));
  let n = 0;
  for (const q of recent) {
    const [existing] = await pool.query(
      `SELECT id FROM queues WHERE vendor_id = ? AND user_id = ? AND status = ? LIMIT 1`,
      [q.vendor_id, q.user_id, q.status || 'waiting']
    );
    if (existing?.length) continue;
    await pool.query(
      `INSERT INTO queues (vendor_id, user_id, status, position, joined_at)
       VALUES (?, ?, ?, ?, ?)`,
      [q.vendor_id, q.user_id, q.status || 'waiting', q.position || 0, q.joined_at || new Date()]
    );
    n += 1;
    LOG.info(`[3h] queue inserted ${q.vendor_id} ${q.user_id}`);
  }
  return n;
}

async function syncRecentOrders(pool) {
  const recent = (mem().orders || []).filter((o) => isRecent(o));
  let n = 0;
  for (const o of recent) {
    if (o.id != null) {
      const [existing] = await pool.query('SELECT id FROM orders WHERE id = ? LIMIT 1', [o.id]);
      if (existing?.length) continue;
    }
    await pool.query(
      `INSERT INTO orders (id, vendor_id, user_id, total_amount, status, items_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE total_amount=VALUES(total_amount), status=VALUES(status)`,
      [
        o.id,
        o.vendor_id,
        o.user_id,
        o.total_amount || 0,
        o.status || 'received',
        typeof o.items_json === 'string' ? o.items_json : JSON.stringify(o.items || o.items_json || []),
        o.created_at || new Date(),
      ]
    );
    n += 1;
    LOG.info(`[3h] order inserted ${o.id}`);
  }
  return n;
}

async function syncRecentChat(pool) {
  const recent = (mem().chat_messages || []).filter((m) => isRecent(m));
  let n = 0;
  for (const m of recent) {
    if (m.id != null) {
      const [existing] = await pool.query('SELECT id FROM chat_messages WHERE id = ? LIMIT 1', [m.id]);
      if (existing?.length) continue;
    }
    try {
      await pool.query(
        `INSERT INTO chat_messages (user_id, vendor_id, sender_id, sender_role, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          m.user_id,
          m.vendor_id,
          m.sender_id,
          m.sender_role || 'user',
          m.body || '',
          m.created_at || new Date(),
        ]
      );
      n += 1;
    } catch (e) {
      LOG.warning(`[3h] chat skip: ${e.message}`);
    }
  }
  return n;
}

/** Pull MySQL last-3h rows into memory if missing (so local seed stays aligned). */
async function hydrateFromMysqlRecent(pool) {
  let added = 0;
  try {
    const [users] = await pool.query(
      'SELECT * FROM users WHERE created_at >= ? OR updated_at >= ?',
      [cutoffDate, cutoffDate]
    );
    const ids = new Set((mem().users || []).map((u) => String(u.id)));
    (users || []).forEach((u) => {
      if (!ids.has(String(u.id))) {
        mem().users.push(u);
        ids.add(String(u.id));
        added += 1;
      }
    });
  } catch (e) {
    LOG.warning(`[3h] hydrate users: ${e.message}`);
  }

  try {
    const [appts] = await pool.query(
      'SELECT * FROM appointments WHERE created_at >= ? OR date = ?',
      [cutoffDate, todayStr]
    );
    const key = (a) => `${a.vendor_id}|${a.user_id}|${a.date}|${a.time}`;
    const have = new Set((mem().appointments || []).map(key));
    (appts || []).forEach((a) => {
      if (!have.has(key(a))) {
        mem().appointments.push(a);
        have.add(key(a));
        added += 1;
      }
    });
  } catch (e) {
    LOG.warning(`[3h] hydrate appointments: ${e.message}`);
  }

  try {
    const [orders] = await pool.query('SELECT * FROM orders WHERE created_at >= ?', [cutoffDate]);
    const ids = new Set((mem().orders || []).map((o) => String(o.id)));
    (orders || []).forEach((o) => {
      if (!ids.has(String(o.id))) {
        mem().orders.push(o);
        ids.add(String(o.id));
        added += 1;
      }
    });
  } catch (e) {
    LOG.warning(`[3h] hydrate orders: ${e.message}`);
  }

  return added;
}

async function runSyncLast3Hours() {
  LOG.info('');
  LOG.info(`═══ Last ${HOURS}h activity sync (memory ↔ MySQL) ═══`);
  LOG.info(`Cutoff: ${cutoffDate.toISOString()}`);

  const pool = await getPool();
  const hydrated = await hydrateFromMysqlRecent(pool);

  const counts = {
    users: await syncRecentUsers(pool),
    vendors: await syncRecentVendors(pool),
    mappings: await syncRecentMappings(pool),
    products: await syncRecentProducts(pool),
    appointments: await syncRecentAppointments(pool),
    queues: await syncRecentQueues(pool),
    orders: await syncRecentOrders(pool),
    chat: await syncRecentChat(pool),
    hydrated,
  };

  const written =
    counts.users +
    counts.vendors +
    counts.mappings +
    counts.products +
    counts.appointments +
    counts.queues +
    counts.orders +
    counts.chat;

  LOG.info('');
  if (written === 0 && hydrated === 0) {
    LOG.success(`Nothing missed in last ${HOURS}h — left as-is.`);
  } else {
    LOG.success(`Synced missed activity: ${JSON.stringify(counts)}`);
  }
  LOG.info('═══════════════════════════════════════════');
  return counts;
}

async function syncLast3Hours({ exit = false } = {}) {
  const counts = await runSyncLast3Hours();
  if (exit) process.exit(0);
  return counts;
}

if (require.main === module) {
  syncLast3Hours({ exit: true }).catch((err) => {
    LOG.error('3h sync failed:', err.message || err);
    process.exit(1);
  });
}

module.exports = { syncLast3Hours, runSyncLast3Hours };
