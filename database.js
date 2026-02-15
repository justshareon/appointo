const mysql = require('mysql2');
require('dotenv').config();

const LOG = {
    info: (msg) => console.log(`[DB INFO] ${new Date().toLocaleTimeString()} | ${msg}`),
    error: (msg) => console.error(`[DB ERROR] ${new Date().toLocaleTimeString()} | ${msg}`)
};

const DB_TYPE = process.env.DB_TYPE || 'inmemory';
const DEFAULT_PRODUCT_IMAGE = 'https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=800';

// --- IN-MEMORY DATA ---
let inMemoryDb = {
    users: [
        { id: 'usr_admin', name: 'Super Admin', email: 'admin@qrqueue.com', mobile: '9999999999', role: 'super_admin' },
        { id: 'usr_vendor', name: 'Demo Vendor', email: 'vendor@qrqueue.com', mobile: '8888888888', role: 'vendor' },
        { id: 'usr_user', name: 'Demo User', email: 'user@qrqueue.com', mobile: '7777777777', role: 'user' },
        { id: 'usr_temple_owner', name: 'Temple Admin', email: 'temple@qrqueue.com', mobile: '6666666666', role: 'vendor' },
        { id: 'usr_temple_user', name: 'Temple User', email: 'devotee@qrqueue.com', mobile: '5555555555', role: 'user' },
        { id: 'usr_new_patient', name: 'Clinic Patient', email: 'patient@example.com', mobile: '4444444444', role: 'user' }
    ],
    vendors: [
        {
            id: 'v_1',
            owner_id: 'usr_vendor',
            shop_name: 'Smile Dental Clinic',
            category: 'Medical',
            is_active: true,
            is_promoted: true,
            latitude: 0,
            longitude: 0,
            appointmentCount: 5,
            google_link: 'https://g.page/r/smile-dental-clinic',
            instagram_handle: 'smiledentalclinic',
            facebook_link: 'https://facebook.com/smiledentalclinic',
            features_products: true,
            features_payments: true,
            features_appointments: true
        },
        {
            id: 'v_2',
            owner_id: 'usr_vendor',
            shop_name: 'Star Salon',
            category: 'Services',
            is_active: true,
            is_promoted: false,
            latitude: 0,
            longitude: 0,
            appointmentCount: 2,
            google_link: 'https://g.page/r/star-salon',
            instagram_handle: 'starsalonofficial',
            facebook_link: 'https://facebook.com/starsalon',
            features_products: true,
            features_payments: false,
            features_appointments: true
        },
        {
            id: 'v_3',
            owner_id: 'usr_admin',
            shop_name: 'Admin Health Hub',
            category: 'Healthcare',
            is_active: true,
            is_promoted: true,
            latitude: 0,
            longitude: 0,
            appointmentCount: 1,
            google_link: 'https://g.page/r/admin-health-hub',
            instagram_handle: 'adminhealthhub',
            facebook_link: 'https://facebook.com/adminhealthhub',
            features_products: true,
            features_payments: true,
            features_appointments: true
        },
        {
            id: 'v_4',
            owner_id: 'usr_temple_owner',
            shop_name: 'City Temple',
            category: 'Temple',
            is_active: true,
            is_promoted: false,
            latitude: 0,
            longitude: 0,
            appointmentCount: 3,
            google_link: 'https://maps.google.com/?q=city+temple',
            instagram_handle: 'citytempleofficial',
            facebook_link: 'https://facebook.com/citytemple',
            features_products: false,
            features_payments: false,
            features_appointments: true
        }
    ],
    products: [
        {
            id: 1, vendor_id: 'v_1', name: 'Dental Cleaning Package', price: 999, offer: '10% OFF', offer_amount: 100,
            validity_from: '2026-01-01', validity_to: '2026-12-31',
            image_urls: [
                'https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=800',
                'https://images.unsplash.com/photo-1588776814546-ec7e4f0f4c6e?w=800',
                'https://images.unsplash.com/photo-1609840114035-3c981b782dfe?w=800'
            ]
        },
        {
            id: 2, vendor_id: 'v_1', name: 'Teeth Whitening', price: 1499, offer: '15% OFF', offer_amount: 225,
            validity_from: '2026-01-01', validity_to: '2026-12-31',
            image_urls: [
                'https://images.unsplash.com/photo-1588776814546-daab30f310ce?w=800',
                'https://images.unsplash.com/photo-1598256989800-fe5f95da9787?w=800',
                'https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=800'
            ]
        },
        {
            id: 3, vendor_id: 'v_1', name: 'Root Canal Consultation', price: 699, offer: 'Flat 50 OFF', offer_amount: 50,
            validity_from: '2026-01-01', validity_to: '2026-12-31',
            image_urls: [
                'https://images.unsplash.com/photo-1606811841689-23dfddce3e95?w=800',
                'https://images.unsplash.com/photo-1593022356769-11f762e25ed9?w=800',
                'https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=800'
            ]
        },
        {
            id: 4, vendor_id: 'v_1', name: 'Dental X-Ray', price: 499, offer: 'No Offer', offer_amount: 0,
            validity_from: '2026-01-01', validity_to: '2026-12-31',
            image_urls: [
                'https://images.unsplash.com/photo-1583912267550-d4bcdd8f8b9e?w=800',
                'https://images.unsplash.com/photo-1516549655169-df83a0774514?w=800',
                'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=800'
            ]
        },
        { id: 5, vendor_id: 'v_2', name: 'Hair Spa Premium', price: 799, offer: 'Flat 100 OFF', offer_amount: 100, validity_from: '2026-01-01', validity_to: '2026-12-31', image_urls: [] },
        { id: 6, vendor_id: 'v_3', name: 'Health Checkup Basic', price: 1299, offer: 'Free Follow-up', offer_amount: 0, validity_from: '2026-01-01', validity_to: '2026-12-31', image_urls: [] },
        { id: 7, vendor_id: 'v_4', name: 'Prasad Combo', price: 199, offer: 'Temple Special', offer_amount: 20, validity_from: '2026-01-01', validity_to: '2026-12-31', image_urls: [] }
    ],
    orders: [],
    queues: [
        { id: 1, vendor_id: 'v_1', user_id: 'usr_user', status: 'waiting', joined_at: new Date(Date.now() - 20 * 60 * 1000) },
        { id: 2, vendor_id: 'v_1', user_id: 'usr_admin', status: 'waiting', joined_at: new Date(Date.now() - 10 * 60 * 1000) },
        { id: 3, vendor_id: 'v_1', user_id: 'usr_user', status: 'done', joined_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
        { id: 4, vendor_id: 'v_1', user_id: 'usr_admin', status: 'cancelled', joined_at: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        { id: 5, vendor_id: 'v_4', user_id: 'usr_temple_user', status: 'waiting', joined_at: new Date(Date.now() - 15 * 60 * 1000) }
    ],
    otps: [],
    appointments: [
        { id: 1, vendor_id: 'v_1', user_id: 'usr_user', date: '2026-02-15', time: '10:30', status: 'pending', created_at: new Date() },
        { id: 2, vendor_id: 'v_2', user_id: 'usr_user', date: '2026-02-16', time: '15:00', status: 'confirmed', created_at: new Date() },
        { id: 3, vendor_id: 'v_3', user_id: 'usr_admin', date: '2026-02-17', time: '11:00', status: 'pending', created_at: new Date() },
        { id: 4, vendor_id: 'v_1', user_id: 'usr_admin', date: '2026-02-18', time: '16:30', status: 'confirmed', created_at: new Date() },
        { id: 5, vendor_id: 'v_2', user_id: 'usr_vendor', date: '2026-02-19', time: '09:30', status: 'pending', created_at: new Date() },
        { id: 6, vendor_id: 'v_3', user_id: 'usr_vendor', date: '2026-02-20', time: '14:00', status: 'confirmed', created_at: new Date() },
        { id: 7, vendor_id: 'v_4', user_id: 'usr_temple_user', date: '2026-02-21', time: '08:00', status: 'confirmed', created_at: new Date() }
    ],
    activities: [
        { id: 1, type: 'appointment', userId: 'usr_user', userName: 'Demo User', message: 'booked an appointment at Smile Dental Clinic', timestamp: new Date(Date.now() - 60 * 60 * 1000), reactions: {} },
        { id: 2, type: 'review', userId: 'usr_admin', userName: 'Super Admin', message: 'rated Star Salon 5 stars', timestamp: new Date(Date.now() - 30 * 60 * 1000), reactions: { '👍': 2, '❤️': 1 } }
    ]
};

// --- MYSQL CONNECTION ---
let pool;
if (DB_TYPE === 'mysql') {
    LOG.info(`Connecting to MySQL at ${process.env.DB_HOST}:${process.env.DB_PORT || 3306}...`);
    pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'root',
        database: process.env.DB_NAME || 'qr_queue',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        ssl: {
            rejectUnauthorized: false
        }
    }).promise();

    // Test connection immediately
    pool.getConnection()
        .then(conn => {
            LOG.success("MySQL Database Connected successfully!");
            conn.release();
        })
        .catch(err => {
            LOG.error("MySQL Connection Failed!", err.message);
            console.error(err);
        });
}

const normalizeProductRow = (row) => {
    const product = { ...row };
    let imageUrls = [];
    try {
        const raw = product.image_urls_json || product.image_urls || '[]';
        if (Array.isArray(raw)) {
            imageUrls = raw;
        } else if (typeof raw === 'string') {
            imageUrls = JSON.parse(raw || '[]');
        }
    } catch (e) {
        imageUrls = [];
    }
    const cleaned = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [];
    product.image_urls = cleaned.length ? cleaned : [DEFAULT_PRODUCT_IMAGE];
    return product;
};

const db = {
    getType: () => DB_TYPE,

    // Users
    getUsers: async () => {
        if (DB_TYPE === 'mysql') {
            const [rows] = await pool.query('SELECT * FROM users');
            return rows;
        }
        return inMemoryDb.users;
    },

    getUserByMobile: async (mobile) => {
        const cleanMobile = mobile.toString().replace(/\D/g, '').slice(-10);
        if (DB_TYPE === 'mysql') {
            const [rows] = await pool.query('SELECT * FROM users WHERE mobile = ? OR mobile = ?', [mobile, cleanMobile]);
            return rows[0];
        }
        return inMemoryDb.users.find(u => {
            const uMobile = u.mobile.toString().replace(/\D/g, '').slice(-10);
            return uMobile === cleanMobile;
        });
    },

    getUserByEmail: async (email) => {
        if (DB_TYPE === 'mysql') {
            const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
            return rows[0];
        }
        return inMemoryDb.users.find(u => u.email === email);
    },

    getUserById: async (id) => {
        if (DB_TYPE === 'mysql') {
            const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
            return rows[0];
        }
        return inMemoryDb.users.find(u => u.id === id);
    },

    addUser: async (user) => {
        if (DB_TYPE === 'mysql') {
            await pool.query('INSERT INTO users SET ?', [user]);
            return user;
        }
        inMemoryDb.users.push(user);
        return user;
    },

    updateUserProfile: async (userId, data) => {
        // Clean data: remove undefined/null but allow empty strings if intended
        const cleanData = {};
        if (data.name !== undefined) cleanData.name = data.name;
        if (data.email !== undefined) cleanData.email = data.email;
        if (data.location_name !== undefined) cleanData.location_name = data.location_name;

        if (DB_TYPE === 'mysql') {
            await pool.query('UPDATE users SET ? WHERE id = ?', [cleanData, userId]);
            return true;
        }
        const user = inMemoryDb.users.find(u => u.id === userId);
        if (user) {
            Object.assign(user, cleanData);
        }
        return !!user;
    },

    updateUserRole: async (userId, role) => {
        LOG.info(`Updating role for user ${userId} to ${role}`);
        if (DB_TYPE === 'mysql') {
            await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, userId]);
            return true;
        }
        const user = inMemoryDb.users.find(u => u.id === userId);
        if (user) {
            user.role = role;
        }
        return !!user;
    },

    // OTPs
    addOtp: async (otpData) => {
        if (DB_TYPE === 'mysql') {
            await pool.query('INSERT INTO otps (mobile, otp, expires_at) VALUES (?, ?, ?)', [otpData.mobile, otpData.otp, new Date(otpData.expires_at)]);
            return true;
        }
        inMemoryDb.otps.push(otpData);
        return true;
    },

    getValidOtp: async (mobile, otp) => {
        const cleanOtp = otp.toString().trim();
        const cleanMobile = mobile.toString().replace(/\D/g, '').slice(-10);
        
        if (DB_TYPE === 'mysql') {
            const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
            const [rows] = await pool.query('SELECT * FROM otps WHERE mobile = ? AND otp = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1', [cleanMobile, cleanOtp, now]);
            return rows[0];
        }
        return inMemoryDb.otps.find(o => {
            const oMobile = o.mobile.toString().replace(/\D/g, '').slice(-10);
            return oMobile === cleanMobile && o.otp === cleanOtp && o.expires_at > Date.now();
        });
    },

    deleteOtpsByMobile: async (mobile) => {
        if (DB_TYPE === 'mysql') {
            await pool.query('DELETE FROM otps WHERE mobile = ?', [mobile]);
            return true;
        }
        inMemoryDb.otps = inMemoryDb.otps.filter(o => o.mobile !== mobile);
        return true;
    },

    // Vendors
    getVendors: async (activeOnly = true) => {
        if (DB_TYPE === 'mysql') {
            const query = activeOnly 
                ? `SELECT v.*, 
                   (SELECT COUNT(*) FROM queues WHERE vendor_id = v.id) + 
                   (SELECT COUNT(*) FROM appointments WHERE vendor_id = v.id) as appointmentCount
                   FROM vendors v WHERE v.is_active = TRUE`
                : `SELECT v.*, 
                   (SELECT COUNT(*) FROM queues WHERE vendor_id = v.id) + 
                   (SELECT COUNT(*) FROM appointments WHERE vendor_id = v.id) as appointmentCount
                   FROM vendors v`;
            const [rows] = await pool.query(query);
            return rows;
        }
        return (activeOnly ? inMemoryDb.vendors.filter(v => v.is_active) : inMemoryDb.vendors).map(v => {
            const qCount = inMemoryDb.queues.filter(q => q.vendor_id === v.id).length;
            const aCount = inMemoryDb.appointments.filter(a => a.vendor_id === v.id).length;
            return { ...v, appointmentCount: qCount + aCount };
        });
    },

    getVendorByOwnerId: async (ownerId) => {
        if (DB_TYPE === 'mysql') {
            const [rows] = await pool.query('SELECT * FROM vendors WHERE owner_id = ?', [ownerId]);
            return rows[0];
        }
        return inMemoryDb.vendors.find(v => v.owner_id === ownerId);
    },

    getVendorById: async (vendorId) => {
        if (DB_TYPE === 'mysql') {
            const [rows] = await pool.query('SELECT * FROM vendors WHERE id = ?', [vendorId]);
            return rows[0];
        }
        return inMemoryDb.vendors.find(v => v.id === vendorId);
    },

    updateVendor: async (vendorId, field, value) => {
        if (DB_TYPE === 'mysql') {
            await pool.query(`UPDATE vendors SET ${field} = ? WHERE id = ?`, [value, vendorId]);
            return true;
        }
        const vendor = inMemoryDb.vendors.find(v => v.id === vendorId);
        if (vendor) vendor[field] = value;
        return !!vendor;
    },

    addVendor: async (vendorData) => {
        const normalizedVendor = {
            google_link: '',
            instagram_handle: '',
            facebook_link: '',
            features_products: true,
            features_payments: true,
            features_appointments: true,
            ...vendorData
        };
        if (DB_TYPE === 'mysql') {
            await pool.query('INSERT INTO vendors SET ?', [normalizedVendor]);
            return normalizedVendor;
        }
        inMemoryDb.vendors.push(normalizedVendor);
        return normalizedVendor;
    },

    // Queues
    getQueueByVendor: async (vendorId) => {
        if (DB_TYPE === 'mysql') {
            const [rows] = await pool.query('SELECT q.*, u.name as userName, u.mobile as userMobile FROM queues q JOIN users u ON q.user_id = u.id WHERE q.vendor_id = ? AND q.status = "waiting" ORDER BY q.joined_at ASC', [vendorId]);
            return rows;
        }
        return inMemoryDb.queues.filter(q => q.vendor_id === vendorId && q.status === "waiting")
            .map(q => {
                const u = inMemoryDb.users.find(u => u.id === q.user_id);
                return { ...q, userName: u ? u.name : 'Unknown', userMobile: u ? u.mobile : '' };
            }).sort((a, b) => a.joined_at - b.joined_at);
    },

    addQueueItem: async (item) => {
        if (DB_TYPE === 'mysql') {
            await pool.query('INSERT INTO queues SET ?', [item]);
            return true;
        }
        inMemoryDb.queues.push({ ...item, id: inMemoryDb.queues.length + 1 });
        return true;
    },

    removeQueueItem: async (userId, vendorId) => {
        if (DB_TYPE === 'mysql') {
            const [result] = await pool.query('DELETE FROM queues WHERE user_id = ? AND vendor_id = ? AND status = "waiting"', [userId, vendorId]);
            return result.affectedRows > 0;
        }
        const initialLength = inMemoryDb.queues.length;
        inMemoryDb.queues = inMemoryDb.queues.filter(q => !(q.user_id === userId && q.vendor_id === vendorId && q.status === "waiting"));
        return inMemoryDb.queues.length < initialLength;
    },

    updateQueueStatus: async (queueId, status) => {
        if (DB_TYPE === 'mysql') {
            await pool.query('UPDATE queues SET status = ? WHERE id = ?', [status, queueId]);
            const [rows] = await pool.query('SELECT vendor_id FROM queues WHERE id = ?', [queueId]);
            return rows[0]?.vendor_id;
        }
        const item = inMemoryDb.queues.find(q => q.id === parseInt(queueId));
        if (item) {
            item.status = status;
            return item.vendor_id;
        }
        return null;
    },

    getUserHistory: async (userId) => {
        if (DB_TYPE === 'mysql') {
            const [rows] = await pool.query(`
                SELECT q.*, v.shop_name,
                (SELECT COUNT(*) FROM queues WHERE vendor_id = q.vendor_id AND status = 'waiting') as total_waiting,
                (SELECT COUNT(*) + 1 FROM queues WHERE vendor_id = q.vendor_id AND status = 'waiting' AND joined_at < q.joined_at) as queue_position
                FROM queues q 
                JOIN vendors v ON q.vendor_id = v.id 
                WHERE q.user_id = ? 
                ORDER BY q.joined_at DESC`, [userId]);
            return rows;
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
        if (DB_TYPE === 'mysql') {
            const [rows] = await pool.query('SELECT q.*, u.name as userName FROM queues q JOIN users u ON q.user_id = u.id WHERE q.vendor_id = ? AND q.status IN ("done", "cancelled") ORDER BY q.joined_at DESC', [vendorId]);
            return rows;
        }
        if (!vendorId) return [];
        return inMemoryDb.queues.filter(q => q.vendor_id === vendorId && ["done", "cancelled"].includes(q.status))
            .map(q => ({ ...q, userName: inMemoryDb.users.find(u => u.id === q.user_id)?.name || 'Unknown' }))
            .sort((a, b) => b.joined_at - a.joined_at);
    },

    // Appointments
    getAppointmentsByUser: async (userId) => {
        if (DB_TYPE === 'mysql') {
            const [rows] = await pool.query(`
                SELECT a.*, v.shop_name,
                (SELECT COUNT(*) FROM appointments WHERE vendor_id = a.vendor_id AND date = a.date AND status != 'cancelled') as total_at_shop_on_day,
                (SELECT COUNT(*) + 1 FROM appointments WHERE vendor_id = a.vendor_id AND date = a.date AND created_at < a.created_at AND status != 'cancelled') as appointment_number
                FROM appointments a 
                JOIN vendors v ON a.vendor_id = v.id 
                WHERE a.user_id = ? 
                ORDER BY a.date ASC, a.time ASC`, [userId]);
            return rows;
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
        if (DB_TYPE === 'mysql') {
            await pool.query('INSERT INTO appointments SET ?', [appData]);
            return true;
        }
        inMemoryDb.appointments.push({ ...appData, id: inMemoryDb.appointments.length + 1 });
        return true;
    },

    updateAppointmentStatus: async (appointmentId, status) => {
        if (DB_TYPE === 'mysql') {
            await pool.query('UPDATE appointments SET status = ? WHERE id = ?', [status, appointmentId]);
            return true;
        }
        const app = inMemoryDb.appointments.find(a => a.id === parseInt(appointmentId));
        if (app) app.status = status;
        return !!app;
    },

    getAppointmentsByVendor: async (vendorId) => {
        if (DB_TYPE === 'mysql') {
            const [rows] = await pool.query(`
                SELECT a.*, u.name as userName, u.mobile as userMobile
                FROM appointments a 
                JOIN users u ON a.user_id = u.id 
                WHERE a.vendor_id = ? 
                ORDER BY a.date ASC, a.time ASC`, [vendorId]);
            return rows;
        }
        if (!vendorId) return [];
        return inMemoryDb.appointments
            .filter(a => a.vendor_id === vendorId)
            .map(a => {
                const u = inMemoryDb.users.find(u => u.id === a.user_id);
                return { ...a, userName: u ? u.name : 'Unknown', userMobile: u ? u.mobile : '' };
            })
            .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    },

    // Products
    getProductsByVendor: async (vendorId) => {
        if (DB_TYPE === 'mysql') {
            const [rows] = await pool.query('SELECT * FROM products WHERE vendor_id = ? ORDER BY id DESC', [vendorId]);
            return rows.map(normalizeProductRow);
        }
        return inMemoryDb.products.filter(p => p.vendor_id === vendorId).map(normalizeProductRow);
    },

    getProductById: async (id) => {
        if (DB_TYPE === 'mysql') {
            const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
            return rows[0] ? normalizeProductRow(rows[0]) : null;
        }
        const item = inMemoryDb.products.find(p => String(p.id) === String(id));
        return item ? normalizeProductRow(item) : null;
    },

    getAllProductsWithVendors: async () => {
        if (DB_TYPE === 'mysql') {
            const [rows] = await pool.query(
                `SELECT p.*, v.shop_name, v.features_payments, v.features_products
                 FROM products p
                 JOIN vendors v ON p.vendor_id = v.id
                 WHERE v.is_active = TRUE AND v.features_products = TRUE
                 ORDER BY p.id DESC`
            );
            return rows.map(normalizeProductRow);
        }
        return inMemoryDb.products
            .filter((p) => (inMemoryDb.vendors.find((x) => x.id === p.vendor_id)?.features_products !== false))
            .map((p) => {
            const v = inMemoryDb.vendors.find((x) => x.id === p.vendor_id) || {};
            return {
                ...normalizeProductRow(p),
                shop_name: v.shop_name || 'Unknown Shop',
                features_payments: v.features_payments !== false,
                features_products: v.features_products !== false
            };
        });
    },

    addProduct: async (productData) => {
        const imageUrls = Array.isArray(productData.image_urls) ? productData.image_urls.filter(Boolean) : [];
        if (DB_TYPE === 'mysql') {
            const payload = {
                ...productData,
                image_urls_json: JSON.stringify(imageUrls)
            };
            delete payload.image_urls;
            await pool.query('INSERT INTO products SET ?', [payload]);
            const [rows] = await pool.query('SELECT * FROM products WHERE id = LAST_INSERT_ID()');
            return rows[0] ? normalizeProductRow(rows[0]) : normalizeProductRow(payload);
        }
        const newId = (inMemoryDb.products[inMemoryDb.products.length - 1]?.id || 0) + 1;
        const item = { id: newId, ...productData, image_urls: imageUrls };
        inMemoryDb.products.push(item);
        return normalizeProductRow(item);
    },

    updateProduct: async (productId, updateData) => {
        const imageUrls = Array.isArray(updateData.image_urls) ? updateData.image_urls.filter(Boolean) : null;
        if (DB_TYPE === 'mysql') {
            const payload = { ...updateData };
            if (imageUrls) payload.image_urls_json = JSON.stringify(imageUrls);
            delete payload.image_urls;
            await pool.query('UPDATE products SET ? WHERE id = ?', [payload, productId]);
            return db.getProductById(productId);
        }
        const item = inMemoryDb.products.find(p => String(p.id) === String(productId));
        if (!item) return null;
        Object.assign(item, updateData);
        if (imageUrls) item.image_urls = imageUrls;
        return normalizeProductRow(item);
    },

    // Orders
    addOrder: async (orderData) => {
        if (DB_TYPE === 'mysql') {
            await pool.query('INSERT INTO orders SET ?', [orderData]);
            return orderData;
        }
        const newId = (inMemoryDb.orders[inMemoryDb.orders.length - 1]?.id || 0) + 1;
        const item = { id: newId, ...orderData };
        inMemoryDb.orders.push(item);
        return item;
    },

    getOrdersByVendorOwner: async (ownerId) => {
        if (DB_TYPE === 'mysql') {
            const [rows] = await pool.query(
                `SELECT o.*, v.shop_name, u.name as user_name
                 FROM orders o
                 JOIN vendors v ON o.vendor_id = v.id
                 LEFT JOIN users u ON o.user_id = u.id
                 WHERE v.owner_id = ?
                 ORDER BY o.created_at DESC`,
                [ownerId]
            );
            return rows;
        }
        const ownedVendorIds = inMemoryDb.vendors.filter(v => v.owner_id === ownerId).map(v => v.id);
        return inMemoryDb.orders
            .filter(o => ownedVendorIds.includes(o.vendor_id))
            .map(o => ({
                ...o,
                shop_name: inMemoryDb.vendors.find(v => v.id === o.vendor_id)?.shop_name || 'Unknown Shop',
                user_name: inMemoryDb.users.find(u => u.id === o.user_id)?.name || 'User'
            }))
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    },

    // Activities
    getActivities: async (limit = 20) => {
        if (DB_TYPE === 'mysql') {
            const [rows] = await pool.query('SELECT * FROM activities ORDER BY timestamp DESC LIMIT ?', [limit]);
            return rows.map(r => {
                let metadata = {};
                try {
                    metadata = typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : (r.metadata || {});
                } catch (e) {
                    metadata = {};
                }
                return {
                    id: r.id,
                    type: r.type,
                    userId: r.user_id,
                    userName: r.user_name,
                    message: r.message,
                    timestamp: r.timestamp,
                    reactions: metadata.reactions || {}
                };
            });
        }
        return inMemoryDb.activities.slice(-limit).reverse();
    }
};

module.exports = db;

