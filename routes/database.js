const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const {
    MATCHMAKING_PRESETS,
    deepClone,
    normalizeTemplate,
    calculateMatchmakingScore,
    buildAiInsight
} = require('./matchmakingEngine');

const LOG_FILE = path.join(__dirname, 'error.log');

const appendErrorLog = (msg, detail) => {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ERROR: ${msg} | DETAIL: ${detail}\n`;
    fs.appendFile(LOG_FILE, logEntry, (err) => {
        if (err) console.error("Failed to write to error log file:", err);
    });
};

const LOG_CONFIG = {
    ENABLED: true,
    PERF_THRESHOLD: 50 // ms
};

const LOG = {
    info: (msg) => { if(LOG_CONFIG.ENABLED) console.log(`[DB INFO] ${new Date().toLocaleTimeString()} | ${msg}`) },
    error: (msg, detail = "") => {
        // Always log errors
        console.error(`[DB ERROR] ${new Date().toLocaleTimeString()} | ${msg} ${detail}`);
        appendErrorLog(msg, detail);
    },
    success: (msg) => { if(LOG_CONFIG.ENABLED) console.log(`[DB SUCCESS] ${new Date().toLocaleTimeString()} | ${msg}`) },
    warning: (msg) => { if(LOG_CONFIG.ENABLED) console.log(`[DB WARN] ${new Date().toLocaleTimeString()} | ${msg}`) }
};

const DB_TYPE = process.env.DB_TYPE || 'inmemory';
const DEFAULT_PRODUCT_IMAGE = 'https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=800';

// Helper for dynamic seed dates
const now = new Date();
const todayStr = now.toISOString().split('T')[0];
const currentTime = now.toTimeString().slice(0, 5);

const tomorrow = new Date(now);
tomorrow.setDate(tomorrow.getDate() + 1);
const tomorrowStr = tomorrow.toISOString().split('T')[0];

const dayAfter = new Date(now);
dayAfter.setDate(dayAfter.getDate() + 2);
const dayAfterStr = dayAfter.toISOString().split('T')[0];

// --- IN-MEMORY DATA ---
let inMemoryDb = {
    users: [
        { id: 'usr_admin', name: 'Super Admin', email: 'admin@qrqueue.com', mobile: '9999999999', role: 'super_admin', location_name: 'Delhi' },
        { id: 'usr_vendor', name: 'Demo Vendor', email: 'vendor@qrqueue.com', mobile: '8888888888', role: 'vendor', location_name: 'Mumbai' },
        { id: 'usr_user', name: 'Demo User', email: 'user@qrqueue.com', mobile: '7777777777', role: 'user', location_name: 'Mumbai' },
        { id: 'usr_temple_owner', name: 'Temple Admin', email: 'temple@qrqueue.com', mobile: '6666666666', role: 'vendor', location_name: 'Varanasi' },
        { id: 'usr_temple_user', name: 'Temple User', email: 'devotee@qrqueue.com', mobile: '5555555555', role: 'user', location_name: 'Varanasi' },
        { id: 'usr_new_patient', name: 'Clinic Patient', email: 'patient@example.com', mobile: '4444444444', role: 'user', location_name: 'Delhi' },
        { id: 'usr_new_vendor_test', name: 'Test Vendor', email: 'testvendor@qrqueue.com', mobile: '3333333333', role: 'vendor', location_name: 'Bangalore' },
        { id: 'usr_rahul', name: 'Rahul Sharma', email: 'rahul@example.com', mobile: '9876543210', role: 'user', location_name: 'Pune' },
        { id: 'usr_u1', name: 'User One', email: 'u1@test.com', mobile: '1111111111', role: 'user', location_name: 'Mumbai' },
        { id: 'usr_u2', name: 'User Two', email: 'u2@test.com', mobile: '2222222222', role: 'user', location_name: 'Mumbai' },
        { id: 'usr_u3', name: 'User Three', email: 'u3@test.com', mobile: '3333333331', role: 'user', location_name: 'Delhi' },
        { id: 'usr_u4', name: 'User Four', email: 'u4@test.com', mobile: '4444444441', role: 'user', location_name: 'Bangalore' },
        { id: 'usr_u5', name: 'User Five', email: 'u5@test.com', mobile: '5555555551', role: 'user', location_name: 'Pune' },
        { id: 'usr_v1', name: 'Vendor One', email: 'v1@test.com', mobile: '1212121212', role: 'vendor', location_name: 'Mumbai' },
        { id: 'usr_match_u1', name: 'Match Test User 1', email: 'match_u1@test.com', mobile: '9090909001', role: 'user', location_name: 'Delhi' },
        { id: 'usr_match_u2', name: 'Match Test User 2', email: 'match_u2@test.com', mobile: '9090909002', role: 'user', location_name: 'Mumbai' },
        { id: 'usr_trade1', name: 'Trade User 1', email: 'trade1@test.com', mobile: '8000000001', role: 'user', location_name: 'Delhi' },
        { id: 'usr_trade1vendor', name: 'Trade Vendor 1', email: 'trade1vendor@test.com', mobile: '8000000002', role: 'vendor', location_name: 'Delhi' },
        { id: 'usr_offer1', name: 'Offer User 1', email: 'offer1@test.com', mobile: '8000000003', role: 'user', location_name: 'Mumbai' },
        { id: 'usr_offer1vendor', name: 'Offer Vendor 1', email: 'offer1vendor@test.com', mobile: '8000000004', role: 'vendor', location_name: 'Mumbai' },
        { id: 'usr_qlessuser1', name: 'QLess User 1', email: 'qlessuser1@test.com', mobile: '8000000005', role: 'user', location_name: 'Mumbai' },
        { id: 'usr_qlessvendor1', name: 'QLess Vendor 1', email: 'qlessvendor1@test.com', mobile: '8000000006', role: 'vendor', location_name: 'Mumbai' },
        { id: 'usr_fleetuser1', name: 'Fleet User 1', email: 'fleetuser1@test.com', mobile: '8000000007', role: 'user', location_name: 'Delhi' },
        { id: 'usr_fleetvendor1', name: 'Fleet Vendor 1', email: 'fleetvendor1@test.com', mobile: '8000000008', role: 'vendor', location_name: 'Delhi' },
        { id: 'usr_realuser1', name: 'Realestate User 1', email: 'realuser1@test.com', mobile: '8000000009', role: 'user', location_name: 'Bangalore' },
        { id: 'usr_realvendor1', name: 'Realestate Vendor 1', email: 'realvendor1@test.com', mobile: '8000000010', role: 'vendor', location_name: 'Bangalore' }
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
            features_appointments: true,
            features_queue: true,
            features_matchmaking: false,
            gateway_razorpay: true,
            gateway_sabpaisa: true,
            visibility_top_rated: true,
            visibility_list: true,
            visibility_feed: true
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
            features_appointments: true,
            features_queue: true,
            features_matchmaking: false
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
            features_appointments: true,
            features_queue: true,
            features_matchmaking: false
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
            features_appointments: true,
            features_queue: true,
            features_matchmaking: false
        },
        {
            id: 'v_5',
            owner_id: 'usr_new_vendor_test',
            shop_name: 'Super Market',
            category: 'Retail',
            is_active: true,
            is_promoted: false,
            latitude: 0,
            longitude: 0,
            appointmentCount: 0,
            google_link: '',
            instagram_handle: '',
            facebook_link: '',
            features_products: true,
            features_payments: true,
            features_appointments: false,
            features_queue: false,
            features_matchmaking: false
        },
        {
            id: 'v_new1',
            owner_id: 'usr_v1',
            shop_name: 'Vendor One Shop',
            category: 'General',
            is_active: true,
            is_promoted: false,
            latitude: 0,
            longitude: 0,
            appointmentCount: 2,
            google_link: '',
            instagram_handle: '',
            facebook_link: '',
            features_products: true,
            features_payments: true,
            features_appointments: true,
            features_queue: true,
            features_matchmaking: true
        },
        {
            id: 'v_match_super',
            owner_id: 'usr_admin',
            shop_name: 'Super Matchmaking Studio',
            category: 'Matchmaking',
            is_active: true,
            is_promoted: false,
            latitude: 0,
            longitude: 0,
            appointmentCount: 0,
            google_link: '',
            instagram_handle: '',
            facebook_link: '',
            features_products: false,
            features_payments: false,
            features_appointments: false,
            features_queue: false,
            features_matchmaking: true,
            visibility_top_rated: false,
            visibility_list: true,
            visibility_feed: false
        },
        {
            id: 'v_trade1',
            owner_id: 'usr_trade1vendor',
            shop_name: 'Trade Shop 1',
            category: 'Trade',
            is_active: true,
            is_promoted: false,
            latitude: 0,
            longitude: 0,
            appointmentCount: 0,
            google_link: '',
            instagram_handle: '',
            facebook_link: '',
            features_products: false,
            features_payments: false,
            features_appointments: false,
            features_queue: false,
            features_matchmaking: false,
            features_trade: true,
            visibility_top_rated: false,
            visibility_list: true,
            visibility_feed: false
        },
        {
            id: 'v_offer1',
            owner_id: 'usr_offer1vendor',
            shop_name: 'Offer Shop 1',
            category: 'Offer',
            is_active: true,
            is_promoted: false,
            latitude: 0,
            longitude: 0,
            appointmentCount: 0,
            google_link: '',
            instagram_handle: '',
            facebook_link: '',
            features_products: false,
            features_payments: false,
            features_appointments: false,
            features_queue: false,
            features_matchmaking: false,
            features_offer: true,
            current_offer: 'Launch offer · up to 40% off',
            location_name: 'Mumbai',
            visibility_top_rated: false,
            visibility_list: true,
            visibility_feed: false
        },
        {
            id: 'v_qless1',
            owner_id: 'usr_qlessvendor1',
            shop_name: 'QLess Shop 1',
            category: 'QLess',
            is_active: true,
            is_promoted: false,
            latitude: 0,
            longitude: 0,
            appointmentCount: 0,
            google_link: '',
            instagram_handle: '',
            facebook_link: '',
            features_products: true,
            features_payments: true,
            features_appointments: true,
            features_queue: true,
            features_matchmaking: false,
            features_qless: true,
            visibility_top_rated: false,
            visibility_list: true,
            visibility_feed: false
        },
        {
            id: 'v_fleet1',
            owner_id: 'usr_fleetvendor1',
            shop_name: 'Fleet Shop 1',
            category: 'Fleet',
            is_active: true,
            is_promoted: false,
            latitude: 0,
            longitude: 0,
            appointmentCount: 0,
            google_link: '',
            instagram_handle: '',
            facebook_link: '',
            features_products: true,
            features_payments: true,
            features_appointments: true,
            features_queue: true,
            features_matchmaking: false,
            features_fleet: true,
            visibility_top_rated: false,
            visibility_list: true,
            visibility_feed: false
        },
        {
            id: 'v_realestate1',
            owner_id: 'usr_realvendor1',
            shop_name: 'Realestate Shop 1',
            category: 'Realestate',
            is_active: true,
            is_promoted: false,
            latitude: 0,
            longitude: 0,
            appointmentCount: 0,
            google_link: '',
            instagram_handle: '',
            facebook_link: '',
            features_products: true,
            features_payments: true,
            features_appointments: true,
            features_queue: true,
            features_matchmaking: false,
            features_realestate: true,
            visibility_top_rated: false,
            visibility_list: true,
            visibility_feed: false
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
                'https://plus.unsplash.com/premium_photo-1661775756810-82dbd209fc95?w=800',
                'https://images.unsplash.com/photo-1516549655169-df83a0774514?w=800',
                'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=800'
            ]
        },
        { id: 5, vendor_id: 'v_2', name: 'Hair Spa Premium', price: 799, offer: 'Flat 100 OFF', offer_amount: 100, validity_from: '2026-01-01', validity_to: '2026-12-31', image_urls: [] },
        { id: 6, vendor_id: 'v_3', name: 'Health Checkup Basic', price: 1299, offer: 'Free Follow-up', offer_amount: 0, validity_from: '2026-01-01', validity_to: '2026-12-31', image_urls: [] },
        { id: 7, vendor_id: 'v_4', name: 'Prasad Combo', price: 199, offer: 'Temple Special', offer_amount: 20, validity_from: '2026-01-01', validity_to: '2026-12-31', image_urls: [] }
    ],
    orders: [
        { id: 1, vendor_id: 'v_1', user_id: 'usr_user', total_amount: 500, created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
        { id: 2, vendor_id: 'v_1', user_id: 'usr_admin', total_amount: 1200, created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
        { id: 3, vendor_id: 'v_1', user_id: 'usr_user', total_amount: 300, created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
        { id: 4, vendor_id: 'v_new1', user_id: 'usr_u1', total_amount: 150, created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) },
        { id: 5, vendor_id: 'v_new1', user_id: 'usr_u2', total_amount: 250, created_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) },
        { id: 6, vendor_id: 'v_new1', user_id: 'usr_u3', total_amount: 450, created_at: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000) }
    ],
    queues: [
        { id: 1, vendor_id: 'v_1', user_id: 'usr_user', status: 'waiting', joined_at: new Date(Date.now() - 20 * 60 * 1000) },
        { id: 2, vendor_id: 'v_1', user_id: 'usr_admin', status: 'waiting', joined_at: new Date(Date.now() - 10 * 60 * 1000) },
        { id: 3, vendor_id: 'v_1', user_id: 'usr_user', status: 'done', joined_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
        { id: 4, vendor_id: 'v_1', user_id: 'usr_admin', status: 'cancelled', joined_at: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        { id: 5, vendor_id: 'v_4', user_id: 'usr_temple_user', status: 'waiting', joined_at: new Date(Date.now() - 15 * 60 * 1000) },
        { id: 6, vendor_id: 'v_5', user_id: 'usr_rahul', status: 'waiting', joined_at: new Date(Date.now() - 5 * 60 * 1000) }
    ],
    otps: [],
    appointments: [
        { id: 1, vendor_id: 'v_1', user_id: 'usr_user', date: '2026-02-15', time: '10:30', status: 'pending', created_at: new Date() },
        { id: 2, vendor_id: 'v_2', user_id: 'usr_user', date: '2026-02-16', time: '15:00', status: 'confirmed', created_at: new Date() },
        { id: 3, vendor_id: 'v_3', user_id: 'usr_admin', date: '2026-02-17', time: '11:00', status: 'pending', created_at: new Date() },
        { id: 4, vendor_id: 'v_1', user_id: 'usr_admin', date: '2026-02-18', time: '16:30', status: 'confirmed', created_at: new Date() },
        { id: 5, vendor_id: 'v_2', user_id: 'usr_vendor', date: '2026-02-19', time: '09:30', status: 'pending', created_at: new Date() },
        { id: 6, vendor_id: 'v_3', user_id: 'usr_vendor', date: '2026-02-20', time: '14:00', status: 'confirmed', created_at: new Date() },
        { id: 7, vendor_id: 'v_4', user_id: 'usr_temple_user', date: '2026-02-21', time: '08:00', status: 'confirmed', created_at: new Date() },
        { id: 8, vendor_id: 'v_5', user_id: 'usr_rahul', date: '2026-02-22', time: '10:00', status: 'pending', created_at: new Date() },
        
        // Updated appointments for users 1-5 to current date/time
        { id: 9, vendor_id: 'v_new1', user_id: 'usr_u1', date: todayStr, time: currentTime, status: 'confirmed', created_at: new Date() },
        { id: 10, vendor_id: 'v_new1', user_id: 'usr_u2', date: todayStr, time: currentTime, status: 'confirmed', created_at: new Date() },
        { id: 11, vendor_id: 'v_new1', user_id: 'usr_u3', date: todayStr, time: currentTime, status: 'confirmed', created_at: new Date() },
        { id: 12, vendor_id: 'v_new1', user_id: 'usr_u4', date: todayStr, time: currentTime, status: 'confirmed', created_at: new Date() },
        { id: 13, vendor_id: 'v_new1', user_id: 'usr_u5', date: todayStr, time: currentTime, status: 'confirmed', created_at: new Date() },

        // New Future Appointments for vendor1 (v_new1)
        { id: 14, vendor_id: 'v_new1', user_id: 'usr_user', date: todayStr, time: '11:00', status: 'confirmed', created_at: new Date() },
        { id: 15, vendor_id: 'v_new1', user_id: 'usr_user', date: tomorrowStr, time: '11:00', status: 'confirmed', created_at: new Date() },
        { id: 16, vendor_id: 'v_new1', user_id: 'usr_user', date: dayAfterStr, time: '11:00', status: 'confirmed', created_at: new Date() }
    ],
    activities: [
        { id: 1, type: 'appointment', vendor_id: 'v_new1', userId: 'usr_u1', userName: 'User One', message: 'booked an appointment at Vendor One Shop', timestamp: new Date(Date.now() - 60 * 60 * 1000), reactions: {} },
        { id: 2, type: 'review', vendor_id: 'v_5', userId: 'usr_rahul', userName: 'Rahul Sharma', message: 'rated Super Market 5 stars', timestamp: new Date(Date.now() - 30 * 60 * 1000), reactions: { '👍': 2, '❤️': 1 } }
    ],
    settings: {
        enable_queue: true,
        enable_appointments: true,
        enable_shopping: true,
        enable_matchmaking: true,
        enable_offer: true,
        enable_trade: true
    },
    matchmaking_templates: [
        {
            vendor_id: 'v_match_super',
            template_name: 'Super Admin Matchmaking Basic',
            selected_preset: 'classic_marriage_v1',
            questions: [
                {
                    id: 'q_super_1',
                    text: 'How do you prefer to spend weekends?',
                    options: [
                        { id: 'a', label: 'With family and close friends', marks: 10, tags: ['family', 'home'] },
                        { id: 'b', label: 'Social events and travel', marks: 8, tags: ['travel', 'social'] },
                        { id: 'c', label: 'Alone with no interaction', marks: -2, tags: ['solo'] }
                    ]
                },
                {
                    id: 'q_super_2',
                    text: 'How do you handle disagreements?',
                    options: [
                        { id: 'a', label: 'Calm discussion and understanding', marks: 10, tags: ['communication', 'respect'] },
                        { id: 'b', label: 'Take time and resolve later', marks: 6, tags: ['balanced'] },
                        { id: 'c', label: 'Anger and blame', marks: -5, tags: ['anger'] }
                    ]
                }
            ],
            scoring: { pass: 50, good: 70, best: 90 },
            is_active: true
        }
    ],
    matchmaking_submissions: []
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

    // Error handling for the pool
    pool.on('error', (err) => {
        LOG.error('Unexpected database pool error', err.message);
        if (err.code === 'PROTOCOL_CONNECTION_LOST') {
            LOG.warning('Database connection lost. Reconnecting...');
        }
    });

    // Test connection after a delay to ensure the server starts up first
    setTimeout(() => {
        LOG.info("Testing database connection (delayed)...");
        pool.getConnection()
            .then(conn => {
                LOG.success("MySQL Database Connected successfully!");
                conn.release();
            })
            .catch(err => {
                LOG.error("MySQL Connection Failed!", err.message);
                LOG.warning("Verify TiDB IP Whitelist (0.0.0.0/0) and Render Env Variables.");
            });
    }, 5000);
}

// Cleanup on exit
process.on('SIGINT', async () => {
    if (pool) {
        LOG.info('Closing database pool...');
        await pool.end();
    }
    process.exit(0);
});

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

// Helper to format Date for MySQL (Local Server Time)
const toMysqlDateTime = (date) => {
    const d = new Date(date);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

let matchmakingTablesReady = false;
const ensureMatchmakingTables = async () => {
    if (!pool || matchmakingTablesReady) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS matchmaking_templates (
            id INT AUTO_INCREMENT PRIMARY KEY,
            vendor_id VARCHAR(64) NOT NULL UNIQUE,
            template_name VARCHAR(255) NOT NULL,
            selected_preset VARCHAR(120) NOT NULL,
            template_json LONGTEXT NOT NULL,
            scoring_json LONGTEXT NOT NULL,
            is_active TINYINT(1) DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS matchmaking_submissions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            vendor_id VARCHAR(64) NOT NULL,
            user_id VARCHAR(64) NOT NULL,
            answers_json LONGTEXT NOT NULL,
            score DOUBLE DEFAULT 0,
            percentage DOUBLE DEFAULT 0,
            band VARCHAR(64) DEFAULT 'needs_improvement',
            tags_json LONGTEXT NULL,
            insight_json LONGTEXT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_vendor_user (vendor_id, user_id)
        )
    `);
    matchmakingTablesReady = true;
};

let fleetTablesReady = false;
const ensureFleetTables = async () => {
    if (!pool || fleetTablesReady) return;
    try {
        // Fleet Queues
        await pool.query(`
            CREATE TABLE IF NOT EXISTS fleet_queues (
                id INT AUTO_INCREMENT PRIMARY KEY,
                gate_id VARCHAR(255) NOT NULL,
                gate_name VARCHAR(255) NOT NULL,
                driver_id VARCHAR(255) NOT NULL,
                vendor_id VARCHAR(255),
                status ENUM('waiting', 'processing', 'completed', 'cancelled') DEFAULT 'waiting',
                position INT DEFAULT 0,
                estimated_wait_time INT DEFAULT 0,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                processed_at TIMESTAMP NULL,
                completed_at TIMESTAMP NULL,
                notes TEXT,
                INDEX idx_gate_status (gate_id, status),
                INDEX idx_driver (driver_id)
            )
        `);
        
        // Fleet Trips
        await pool.query(`
            CREATE TABLE IF NOT EXISTS fleet_trips (
                id INT AUTO_INCREMENT PRIMARY KEY,
                driver_id VARCHAR(255) NOT NULL,
                vendor_id VARCHAR(255),
                trip_type ENUM('pickup', 'delivery', 'transport', 'other') DEFAULT 'transport',
                origin VARCHAR(255),
                destination VARCHAR(255),
                start_latitude DECIMAL(10, 8),
                start_longitude DECIMAL(11, 8),
                end_latitude DECIMAL(10, 8),
                end_longitude DECIMAL(11, 8),
                status ENUM('scheduled', 'in_progress', 'completed', 'cancelled') DEFAULT 'scheduled',
                scheduled_start TIMESTAMP,
                actual_start TIMESTAMP NULL,
                completed_at TIMESTAMP NULL,
                distance_miles DECIMAL(10, 2) DEFAULT 0,
                duration_minutes INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_driver_status (driver_id, status),
                INDEX idx_vendor (vendor_id)
            )
        `);
        
        // Fleet Road Conditions
        await pool.query(`
            CREATE TABLE IF NOT EXISTS fleet_road_conditions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                type ENUM('pothole', 'lane_closure', 'wet_road', 'accident', 'construction', 'other') NOT NULL,
                latitude DECIMAL(10, 8) NOT NULL,
                longitude DECIMAL(11, 8) NOT NULL,
                distance_from_location DECIMAL(10, 2),
                severity ENUM('low', 'medium', 'high') DEFAULT 'medium',
                description TEXT,
                reported_by VARCHAR(255),
                reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                resolved_at TIMESTAMP NULL,
                is_active BOOLEAN DEFAULT TRUE,
                INDEX idx_location (latitude, longitude),
                INDEX idx_type_active (type, is_active)
            )
        `);
        
        // Fleet Hazards
        await pool.query(`
            CREATE TABLE IF NOT EXISTS fleet_hazards (
                id INT AUTO_INCREMENT PRIMARY KEY,
                driver_id VARCHAR(255) NOT NULL,
                hazard_type ENUM('pothole', 'lane_closure', 'wet_road', 'accident', 'construction', 'other') NOT NULL,
                latitude DECIMAL(10, 8) NOT NULL,
                longitude DECIMAL(11, 8) NOT NULL,
                description TEXT,
                image_url TEXT,
                points_awarded INT DEFAULT 5,
                status ENUM('reported', 'verified', 'resolved') DEFAULT 'reported',
                reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                verified_at TIMESTAMP NULL,
                resolved_at TIMESTAMP NULL,
                INDEX idx_driver (driver_id),
                INDEX idx_status (status)
            )
        `);
        
        // Fleet Driver Stats
        await pool.query(`
            CREATE TABLE IF NOT EXISTS fleet_driver_stats (
                id INT AUTO_INCREMENT PRIMARY KEY,
                driver_id VARCHAR(255) NOT NULL,
                stat_date DATE NOT NULL,
                trips_count INT DEFAULT 0,
                miles_driven DECIMAL(10, 2) DEFAULT 0,
                safe_events INT DEFAULT 0,
                points_earned INT DEFAULT 0,
                safety_score INT DEFAULT 100,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_driver_date (driver_id, stat_date),
                INDEX idx_driver_date (driver_id, stat_date)
            )
        `);
        
        // Fleet Gates
        await pool.query(`
            CREATE TABLE IF NOT EXISTS fleet_gates (
                id INT AUTO_INCREMENT PRIMARY KEY,
                gate_id VARCHAR(255) NOT NULL UNIQUE,
                gate_name VARCHAR(255) NOT NULL,
                location_name VARCHAR(255),
                latitude DECIMAL(10, 8),
                longitude DECIMAL(11, 8),
                vendor_id VARCHAR(255),
                is_active BOOLEAN DEFAULT TRUE,
                current_queue_count INT DEFAULT 0,
                estimated_wait_time INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_vendor (vendor_id),
                INDEX idx_active (is_active)
            )
        `);
        
        // Seed sample gates
        await pool.query(`
            INSERT IGNORE INTO fleet_gates (gate_id, gate_name, location_name, vendor_id, is_active)
            VALUES
            ('gate_7', 'Port of Oakland - Gate 7', 'Oakland, CA', 'v_fleet1', TRUE),
            ('gate_12', 'Port of Oakland - Gate 12', 'Oakland, CA', 'v_fleet1', TRUE),
            ('gate_1', 'Port of Los Angeles - Gate 1', 'Los Angeles, CA', 'v_fleet1', TRUE)
        `);
        
        fleetTablesReady = true;
        LOG.success("Fleet tables created successfully");
    } catch (err) {
        LOG.error("Failed to create fleet tables", err.message);
    }
};

const db = {
    getType: () => DB_TYPE,

    // Auto-Expire Logic
    autoExpireAppointments: async () => {
        const now = new Date();
        const currentDate = toMysqlDateTime(now).split(' ')[0]; // YYYY-MM-DD
        const currentTime = now.toTimeString().slice(0, 5); // "HH:MM"

        const affectedVendorIds = new Set();

        try {
            if (pool) {
                // Find appointments that are pending/confirmed AND date < today
                // We REMOVED the check for (date = today AND time < now) so today's late appointments stay Pending (Red)
                const [rows] = await pool.query(
                    `SELECT * FROM appointments 
                     WHERE status IN ('pending', 'confirmed') 
                     AND date < ?`,
                    [currentDate]
                );

                if (rows.length > 0) {
                    const ids = rows.map(r => r.id);
                    await pool.query(
                        `UPDATE appointments SET status = 'completed' WHERE id IN (?)`,
                        [ids]
                    );
                    
                    // Sync queues for these
                    for (const app of rows) {
                        affectedVendorIds.add(app.vendor_id);
                        await pool.query(
                            'UPDATE queues SET status = "done" WHERE user_id = ? AND vendor_id = ? AND status = "waiting"',
                            [app.user_id, app.vendor_id]
                        );
                        LOG.info(`[AUTO-EXPIRE] Appointment ${app.id} completed -> Queue done`);
                    }
                    return Array.from(affectedVendorIds);
                }
                return [];
            }
        } catch (err) {
            LOG.error("MySQL autoExpireAppointments failed, falling back to local", err.message);
        }

        // In-memory implementation
        inMemoryDb.appointments.forEach(app => {
            if (app.status === 'pending' || app.status === 'confirmed') {
                // Only expire if date is strictly before today
                if (app.date < currentDate) {
                    app.status = 'completed';
                    affectedVendorIds.add(app.vendor_id);
                    
                    // Sync queue
                    const relatedQueue = inMemoryDb.queues.find(q => 
                        q.user_id === app.user_id && 
                        q.vendor_id === app.vendor_id && 
                        q.status === 'waiting'
                    );
                    if (relatedQueue) {
                        relatedQueue.status = 'done';
                        LOG.info(`[AUTO-EXPIRE] Appointment ${app.id} completed -> Queue done`);
                    }
                }
            }
        });
        return Array.from(affectedVendorIds);
    },

    // Users
    getUsers: async () => {
        try {
            if (pool) {
                const [rows] = await pool.query('SELECT id, name, email, mobile, role, location_name, created_at FROM users ORDER BY created_at DESC, id DESC');
                if (rows) {
                    LOG.info(`[getUsers] Returning ${rows.length} users from MySQL`);
                    // Ensure all required fields are present
                    return rows.map(u => ({
                        id: u.id,
                        name: u.name || 'Unknown',
                        email: u.email || null,
                        mobile: u.mobile || null,
                        role: u.role || 'user',
                        location_name: u.location_name || null,
                        created_at: u.created_at
                    }));
                }
            }
        } catch (err) {
            LOG.error("MySQL getUsers failed, falling back to local", err.message);
        }
        // In-memory: reverse to show newest first (assuming push order)
        const localUsers = [...inMemoryDb.users].reverse();
        LOG.info(`[getUsers] Returning ${localUsers.length} users from local in-memory DB`);
        return localUsers;
    },

    getUserByMobile: async (mobile) => {
        const cleanMobile = mobile.toString().replace(/\D/g, '').slice(-10);
        try {
            if (pool) {
                const [rows] = await pool.query('SELECT * FROM users WHERE mobile = ? OR mobile = ?', [mobile, cleanMobile]);
                if (rows && rows.length > 0) return rows[0];
            }
        } catch (err) {
            LOG.error(`MySQL getUserByMobile failed for ${mobile}, falling back to local`, err.message);
        }
        return inMemoryDb.users.find(u => {
            const uMobile = u.mobile.toString().replace(/\D/g, '').slice(-10);
            return uMobile === cleanMobile;
        });
    },

    getUserByEmail: async (email) => {
        if (!email) return null;
        const normalizedEmail = email.trim().toLowerCase();
        try {
            if (pool) {
                // Case-insensitive email lookup
                const [rows] = await pool.query('SELECT * FROM users WHERE LOWER(email) = ?', [normalizedEmail]);
                if (rows && rows.length > 0) return rows[0];
            }
        } catch (err) {
            LOG.error(`MySQL getUserByEmail failed for ${email}, falling back to local`, err.message);
        }
        return inMemoryDb.users.find(u => u.email && u.email.toLowerCase() === normalizedEmail);
    },

    getUserById: async (id) => {
        try {
            if (pool) {
                const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
                if (rows && rows.length > 0) return rows[0];
            }
        } catch (err) {
            LOG.error(`MySQL getUserById failed for ${id}, falling back to local`, err.message);
        }
        return inMemoryDb.users.find(u => u.id === id);
    },

    addUser: async (user) => {
        try {
            if (pool) {
                await pool.query('INSERT INTO users SET ?', [user]);
                return user;
            }
        } catch (err) {
            LOG.error("MySQL addUser failed, falling back to local", err.message);
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

        try {
            if (pool) {
                await pool.query('UPDATE users SET ? WHERE id = ?', [cleanData, userId]);
                return true;
            }
        } catch (err) {
            LOG.error(`MySQL updateUserProfile failed for ${userId}, falling back to local`, err.message);
        }
        
        const user = inMemoryDb.users.find(u => u.id === userId);
        if (user) {
            Object.assign(user, cleanData);
        }
        return !!user;
    },

    updateUserRole: async (userId, role) => {
        LOG.info(`Updating role for user ${userId} to ${role}`);
        try {
            if (pool) {
                await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, userId]);
                return true;
            }
        } catch (err) {
            LOG.error(`MySQL updateUserRole failed for ${userId}, falling back to local`, err.message);
        }
        const user = inMemoryDb.users.find(u => u.id === userId);
        if (user) {
            user.role = role;
        }
        return !!user;
    },

    // OTPs
    addOtp: async (otpData) => {
        const localOtp = {
            ...otpData,
            mobile: otpData.mobile.toString().replace(/\D/g, '').slice(-10)
        };
        try {
            if (pool) {
                // Use formatted string to prevent timezone shifts by the driver
                const expiresAt = toMysqlDateTime(otpData.expires_at);
                const createdAt = toMysqlDateTime(otpData.created_at || new Date());
                
                await pool.query(
                    'INSERT INTO otps (mobile, otp, expires_at, created_at) VALUES (?, ?, ?, ?)', 
                    [otpData.mobile, otpData.otp, expiresAt, createdAt]
                );
                LOG.info(`[MySQL] OTP added for ${otpData.mobile} (Expires: ${expiresAt})`);
                // Keep in-memory copy in sync as fallback/debug source.
                inMemoryDb.otps.push(localOtp);
                return true;
            }
        } catch (err) {
            LOG.error("MySQL addOtp failed, falling back to local", err.message);
        }
        inMemoryDb.otps.push(localOtp);
        return true;
    },

    getValidOtp: async (mobile, otp) => {
        const cleanOtp = otp.toString().trim();
        const cleanMobile = mobile.toString().replace(/\D/g, '').slice(-10);
        
        try {
            if (pool) {
                // Fetch latest OTP record regardless of expiry to debug/validate
                const [rows] = await pool.query('SELECT * FROM otps WHERE mobile = ? AND otp = ? ORDER BY created_at DESC LIMIT 1', [cleanMobile, cleanOtp]);
                
                if (rows && rows.length > 0) {
                    const record = rows[0];
                    const nowMs = Date.now();
                    const expiresMs = new Date(record.expires_at).getTime();
                    
                    // console.log(`[DEBUG OTP] Input=${cleanOtp}, DB=${record.otp}, Exp=${expiresMs}, Now=${nowMs}`);

                    if (expiresMs > nowMs) {
                        return record;
                    } else {
                        LOG.warning(`[MySQL] OTP found but expired. Mobile: ${mobile}, Expires: ${record.expires_at}, Now: ${new Date().toISOString()}`);
                        return null;
                    }
                } else {
                    // DEBUG: Check if ANY otp exists for this mobile (mismatch code?)
                    const [anyRows] = await pool.query('SELECT otp, created_at FROM otps WHERE mobile = ? ORDER BY created_at DESC LIMIT 1', [cleanMobile]);
                    if (anyRows.length > 0) {
                        LOG.warning(`[MySQL] OTP Code Mismatch for ${mobile}. Input: ${cleanOtp}, Latest in DB: ${anyRows[0].otp} (Created: ${anyRows[0].created_at})`);
                    } else {
                        LOG.warning(`[MySQL] No OTP records found for ${mobile} at all.`);
                    }
                }
            }
        } catch (err) {
            LOG.error(`MySQL getValidOtp failed for ${mobile}, falling back to local`, err.message);
        }
        
        return inMemoryDb.otps.find(o => {
            const oMobile = o.mobile.toString().replace(/\D/g, '').slice(-10);
            return oMobile === cleanMobile && o.otp === cleanOtp && new Date(o.expires_at).getTime() > Date.now();
        });
    },

    getLatestValidOtpByMobile: async (mobile) => {
        const cleanMobile = mobile.toString().replace(/\D/g, '').slice(-10);
        try {
            if (pool) {
                const [rows] = await pool.query(
                    'SELECT * FROM otps WHERE mobile = ? ORDER BY created_at DESC, id DESC LIMIT 1',
                    [cleanMobile]
                );
                if (rows && rows.length > 0) {
                    const record = rows[0];
                    const expiresMs = new Date(record.expires_at).getTime();
                    if (expiresMs > Date.now()) {
                        return record;
                    }
                }
                return null;
            }
        } catch (err) {
            LOG.error(`MySQL getLatestValidOtpByMobile failed for ${mobile}, falling back to local`, err.message);
        }
        const candidates = inMemoryDb.otps
            .filter(o => o.mobile.toString().replace(/\D/g, '').slice(-10) === cleanMobile)
            .sort((a, b) => (new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()));
        const latest = candidates[0];
        if (!latest) return null;
        return new Date(latest.expires_at).getTime() > Date.now() ? latest : null;
    },

    deleteOtpsByMobile: async (mobile) => {
        const cleanMobile = mobile.toString().replace(/\D/g, '').slice(-10);
        try {
            if (pool) {
                await pool.query('DELETE FROM otps WHERE mobile = ?', [cleanMobile]);
            }
        } catch (err) {
            LOG.error(`MySQL deleteOtpsByMobile failed for ${mobile}, falling back to local`, err.message);
        }
        // Always keep local fallback aligned.
        inMemoryDb.otps = inMemoryDb.otps.filter(
            o => o.mobile.toString().replace(/\D/g, '').slice(-10) !== cleanMobile
        );
        return true;
    },

    // Vendors
    getVendors: async (activeOnly = true, page = 1, limit = 10, sortBy = 'newest', searchQuery = '', includeTradeOffer = false) => {
        try {
            if (pool) {
                // Determine today's date in YYYY-MM-DD format for MySQL comparison
                const now = new Date();
                const year = now.getFullYear();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = String(now.getDate()).padStart(2, '0');
                const todayStr = `${year}-${month}-${day}`;

                let orderBy = 'v.id DESC';
                if (sortBy === 'most_active') orderBy = 'appointmentCount DESC';
                if (sortBy === 'least_active') orderBy = 'appointmentCount ASC';
                if (sortBy === 'high_users') orderBy = 'live_queue_count DESC';

                let searchClause = '';
                const params = [];
                if (searchQuery) {
                    searchClause = `AND (v.shop_name LIKE ? OR v.owner_name LIKE ? OR v.owner_mobile LIKE ?)`;
                    const likeQuery = `%${searchQuery}%`;
                    params.push(likeQuery, likeQuery, likeQuery);
                }

                const offset = (page - 1) * limit;

                // Build WHERE clause properly
                const baseWhere = activeOnly ? 'v.is_active = TRUE' : '1=1';
                const excludeTradeOffer = includeTradeOffer ? '' : 'AND (v.features_trade IS NULL OR v.features_trade = 0 OR v.features_trade = false) AND (v.features_offer IS NULL OR v.features_offer = 0 OR v.features_offer = false)';
                // Build WHERE clause parts
                const whereParts = [baseWhere];
                if (excludeTradeOffer) whereParts.push(excludeTradeOffer);
                if (searchClause) whereParts.push(searchClause);
                const whereClause = 'WHERE ' + whereParts.join(' ');

                const query = `
                    SELECT v.*, 
                    COALESCE(q_counts.q_count, 0) + COALESCE(a_counts.a_count, 0) as appointmentCount,
                    COALESCE(q_live.live_count, 0) as live_queue_count,
                    COALESCE(a_today_pending.pending_count, 0) as today_pending_appointments,
                    COALESCE(a_today_completed.completed_count, 0) as today_completed_appointments
                    FROM vendors v
                    LEFT JOIN (SELECT vendor_id, COUNT(*) as q_count FROM queues WHERE status = 'waiting' GROUP BY vendor_id) q_counts ON v.id = q_counts.vendor_id
                    LEFT JOIN (SELECT vendor_id, COUNT(*) as a_count FROM appointments WHERE status = 'confirmed' OR status = 'pending' GROUP BY vendor_id) a_counts ON v.id = a_counts.vendor_id
                    
                    -- New Metrics
                    LEFT JOIN (SELECT vendor_id, COUNT(*) as live_count FROM queues WHERE status = 'waiting' GROUP BY vendor_id) q_live ON v.id = q_live.vendor_id
                    LEFT JOIN (SELECT vendor_id, COUNT(*) as pending_count FROM appointments WHERE date = '${todayStr}' AND status IN ('pending', 'confirmed') GROUP BY vendor_id) a_today_pending ON v.id = a_today_pending.vendor_id
                    LEFT JOIN (SELECT vendor_id, COUNT(*) as completed_count FROM appointments WHERE date = '${todayStr}' AND status = 'completed' GROUP BY vendor_id) a_today_completed ON v.id = a_today_completed.vendor_id

                    ${whereClause}
                    ORDER BY ${orderBy}
                    LIMIT ${limit} OFFSET ${offset}
                `;
                
                LOG.info(`[getVendors] Query: includeTradeOffer=${includeTradeOffer}, activeOnly=${activeOnly}, searchQuery="${searchQuery}"`);
                LOG.info(`[getVendors] WHERE clause: ${whereClause}`);
                
                const [rows] = await pool.query(query, params);
                LOG.info(`[getVendors] MySQL returned ${rows.length} vendors`);
                
                // Debug: Log offer/trade vendors if any
                if (includeTradeOffer) {
                    const offerVendors = rows.filter(v => v.features_offer === 1 || v.features_offer === true);
                    const tradeVendors = rows.filter(v => v.features_trade === 1 || v.features_trade === true);
                    LOG.info(`[getVendors] Found ${offerVendors.length} offer vendors, ${tradeVendors.length} trade vendors`);
                    if (offerVendors.length > 0) {
                        LOG.info(`[getVendors] Offer vendors:`, offerVendors.map(v => ({ id: v.id, shop_name: v.shop_name, features_offer: v.features_offer })));
                    }
                }
                
                return rows || [];
            }
        } catch (err) {
            LOG.error("MySQL getVendors failed, falling back to local", err.message);
        }

        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const todayStr = `${year}-${month}-${day}`;

        LOG.info(`[getVendors] Using in-memory fallback - includeTradeOffer: ${includeTradeOffer}`);
        let filtered = activeOnly ? inMemoryDb.vendors.filter(v => v.is_active) : inMemoryDb.vendors;
        LOG.info(`[getVendors] In-memory vendors before filtering: ${filtered.length}`);
        
        // Filter out service-specific vendors (Trade, Offer, QLess, Fleet, Realestate) from main vendor list (unless includeTradeOffer is true)
        if (!includeTradeOffer) {
            filtered = filtered.filter(v => 
                v.features_trade !== true && 
                v.features_offer !== true &&
                v.features_qless !== true &&
                v.features_fleet !== true &&
                v.features_realestate !== true
            );
            LOG.info(`[getVendors] After excluding service vendors: ${filtered.length}`);
        } else {
            LOG.info(`[getVendors] Including service vendors: ${filtered.length}`);
            // Log service vendors found
            const offerVendors = filtered.filter(v => v.features_offer === true);
            const tradeVendors = filtered.filter(v => v.features_trade === true);
            const qlessVendors = filtered.filter(v => v.features_qless === true);
            const fleetVendors = filtered.filter(v => v.features_fleet === true);
            const realestateVendors = filtered.filter(v => v.features_realestate === true);
            LOG.info(`[getVendors] In-memory: Found ${offerVendors.length} offer, ${tradeVendors.length} trade, ${qlessVendors.length} qless, ${fleetVendors.length} fleet, ${realestateVendors.length} realestate vendors`);
            if (offerVendors.length > 0) {
                LOG.info(`[getVendors] In-memory offer vendors:`, offerVendors.map(v => ({ 
                    id: v?.id || 'NO_ID', 
                    shop_name: v?.shop_name || 'NO_NAME', 
                    owner_id: v?.owner_id || 'NO_OWNER',
                    features_offer: v?.features_offer 
                })));
            }
            if (qlessVendors.length > 0) {
                LOG.info(`[getVendors] In-memory qless vendors:`, qlessVendors.map(v => ({ 
                    id: v?.id || 'NO_ID', 
                    shop_name: v?.shop_name || 'NO_NAME', 
                    owner_id: v?.owner_id || 'NO_OWNER',
                    features_qless: v?.features_qless 
                })));
            }
        }
        
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(v => 
                (v.shop_name && v.shop_name.toLowerCase().includes(q)) ||
                (v.owner_name && v.owner_name.toLowerCase().includes(q)) ||
                (v.owner_mobile && v.owner_mobile.includes(q))
            );
        }

        // Calculate metrics for ALL first (in-memory) so we can sort
        filtered = filtered.map(v => {
            const qCount = inMemoryDb.queues.filter(q => q.vendor_id === v.id && q.status === 'waiting').length;
            const aCount = inMemoryDb.appointments.filter(a => a.vendor_id === v.id && (a.status === 'confirmed' || a.status === 'pending')).length;
            
            const liveQueueCount = qCount;
            const todayPending = inMemoryDb.appointments.filter(a => a.vendor_id === v.id && a.date === todayStr && ['pending', 'confirmed'].includes(a.status)).length;
            const todayCompleted = inMemoryDb.appointments.filter(a => a.vendor_id === v.id && a.date === todayStr && a.status === 'completed').length;

            return { 
                ...v, 
                appointmentCount: qCount + aCount,
                live_queue_count: liveQueueCount,
                today_pending_appointments: todayPending,
                today_completed_appointments: todayCompleted
            };
        });

        // Sort
        if (sortBy === 'newest') filtered.reverse(); // assuming pushing adds to end
        else if (sortBy === 'most_active') filtered.sort((a, b) => b.appointmentCount - a.appointmentCount);
        else if (sortBy === 'least_active') filtered.sort((a, b) => a.appointmentCount - b.appointmentCount);
        else if (sortBy === 'high_users') filtered.sort((a, b) => b.live_queue_count - a.live_queue_count);
        else filtered.reverse(); // Default newest

        // Paginate
        const startIndex = (page - 1) * limit;
        return filtered.slice(startIndex, startIndex + limit);
    },

    getVendorByOwnerId: async (ownerId) => {
        try {
            if (pool) {
                const [rows] = await pool.query('SELECT * FROM vendors WHERE owner_id = ?', [ownerId]);
                if (rows && rows.length > 0) return rows[0];
            }
        } catch (err) {
            LOG.error(`MySQL getVendorByOwnerId failed for ${ownerId}, falling back to local`, err.message);
        }
        return inMemoryDb.vendors.find(v => v.owner_id === ownerId);
    },

    getVendorById: async (vendorId) => {
        try {
            if (pool) {
                const [rows] = await pool.query('SELECT * FROM vendors WHERE id = ?', [vendorId]);
                if (rows && rows.length > 0) return rows[0];
            }
        } catch (err) {
            LOG.error(`MySQL getVendorById failed for ${vendorId}, falling back to local`, err.message);
        }
        return inMemoryDb.vendors.find(v => v.id === vendorId);
    },

    updateVendor: async (vendorId, field, value) => {
        try {
            if (pool) {
                await pool.query(`UPDATE vendors SET ${field} = ? WHERE id = ?`, [value, vendorId]);
                return true;
            }
        } catch (err) {
            LOG.error(`MySQL updateVendor failed for ${vendorId}, falling back to local`, err.message);
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
            features_queue: true,
            features_matchmaking: false,
            features_trade: false,
            features_offer: false,
            gateway_razorpay: true,
            gateway_sabpaisa: true,
            visibility_top_rated: true,
            visibility_list: true,
            visibility_feed: true,
            ...vendorData
        };
        try {
            if (pool) {
                await pool.query('INSERT INTO vendors SET ?', [normalizedVendor]);
                return normalizedVendor;
            }
        } catch (err) {
            LOG.error("MySQL addVendor failed, falling back to local", err.message);
        }
        inMemoryDb.vendors.push(normalizedVendor);
        return normalizedVendor;
    },

    // Queues
    getQueueByVendor: async (vendorId) => {
        try {
            if (pool) {
                const [rows] = await pool.query('SELECT q.*, u.name as userName, u.mobile as userMobile FROM queues q JOIN users u ON q.user_id = u.id WHERE q.vendor_id = ? AND q.status = "waiting" ORDER BY q.joined_at ASC', [vendorId]);
                if (rows) return rows;
            }
        } catch (err) {
            LOG.error(`MySQL getQueueByVendor failed for ${vendorId}, falling back to local`, err.message);
        }
        return inMemoryDb.queues.filter(q => q.vendor_id === vendorId && q.status === "waiting")
            .map(q => {
                const u = inMemoryDb.users.find(u => u.id === q.user_id);
                return { ...q, userName: u ? u.name : 'Unknown', userMobile: u ? u.mobile : '' };
            }).sort((a, b) => a.joined_at - b.joined_at);
    },

    addQueueItem: async (item) => {
        try {
            if (pool) {
                await pool.query('INSERT INTO queues SET ?', [item]);
                return true;
            }
        } catch (err) {
            LOG.error("MySQL addQueueItem failed, falling back to local", err.message);
        }
        inMemoryDb.queues.push({ ...item, id: inMemoryDb.queues.length + 1 });
        return true;
    },

    removeQueueItem: async (userId, vendorId) => {
        try {
            if (pool) {
                const [result] = await pool.query('DELETE FROM queues WHERE user_id = ? AND vendor_id = ? AND status = "waiting"', [userId, vendorId]);
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
        try {
            if (pool) {
                // Get details before delete for sync
                const [rows] = await pool.query('SELECT vendor_id, user_id FROM queues WHERE id = ?', [queueId]);
                const [result] = await pool.query('DELETE FROM queues WHERE id = ?', [queueId]);
                
                // Sync: Delete related appointment
                if (result.affectedRows > 0 && rows[0]) {
                    const { vendor_id, user_id } = rows[0];
                    await pool.query('DELETE FROM appointments WHERE user_id = ? AND vendor_id = ? AND status IN ("pending", "confirmed")', [user_id, vendor_id]);
                    LOG.info(`[SYNC] Queue Delete -> Appointment Delete for user ${user_id}`);
                }
                return result.affectedRows > 0;
            }
        } catch (err) {
            LOG.error("MySQL deleteQueueItemById failed, falling back to local", err.message);
        }
        
        const item = inMemoryDb.queues.find(q => q.id === parseInt(queueId));
        if (item) {
            // Sync: Delete related appointment
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

    deleteAppointmentById: async (appointmentId) => {
        try {
            if (pool) {
                // Get details before delete for sync
                const [rows] = await pool.query('SELECT vendor_id, user_id FROM appointments WHERE id = ?', [appointmentId]);
                const [result] = await pool.query('DELETE FROM appointments WHERE id = ?', [appointmentId]);
                
                // Sync: Delete related queue item
                if (result.affectedRows > 0 && rows[0]) {
                    const { vendor_id, user_id } = rows[0];
                    await pool.query('DELETE FROM queues WHERE user_id = ? AND vendor_id = ? AND status = "waiting"', [user_id, vendor_id]);
                    LOG.info(`[SYNC] Appointment Delete -> Queue Delete for user ${user_id}`);
                }
                return result.affectedRows > 0;
            }
        } catch (err) {
            LOG.error("MySQL deleteAppointmentById failed, falling back to local", err.message);
        }

        const app = inMemoryDb.appointments.find(a => a.id === parseInt(appointmentId));
        if (app) {
            // Sync: Delete related queue item
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

    updateQueueStatus: async (queueId, status) => {
        try {
            let vendorId = null;
            let userId = null;

            if (pool) {
                // MySQL Implementation with Sync
                await pool.query('UPDATE queues SET status = ? WHERE id = ?', [status, queueId]);
                const [rows] = await pool.query('SELECT vendor_id, user_id FROM queues WHERE id = ?', [queueId]);
                if (rows[0]) {
                    vendorId = rows[0].vendor_id;
                    userId = rows[0].user_id;
                    
                    // Sync: Update related appointment
                    if (userId && (status === 'done' || status === 'cancelled')) {
                        const apptStatus = status === 'done' ? 'completed' : 'cancelled';
                        await pool.query(
                            'UPDATE appointments SET status = ? WHERE user_id = ? AND vendor_id = ? AND status IN ("pending", "confirmed")',
                            [apptStatus, userId, vendorId]
                        );
                        LOG.info(`[SYNC] Queue ${status} -> Appointment ${apptStatus} for user ${userId}`);
                    }
                }
                return vendorId;
            }
        } catch (err) {
            LOG.error(`MySQL updateQueueStatus failed for ${queueId}, falling back to local`, err.message);
        }

        // In-Memory Implementation with Sync
        const item = inMemoryDb.queues.find(q => q.id === parseInt(queueId));
        if (item) {
            item.status = status;
            
            // Sync with Appointments
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
        try {
            if (pool) {
                const [rows] = await pool.query(`
                    WITH QueueStats AS (
                        SELECT q.*, v.shop_name,
                               COUNT(*) OVER(PARTITION BY q.vendor_id, q.status) as total_waiting_calc,
                               RANK() OVER(PARTITION BY q.vendor_id, q.status ORDER BY q.joined_at ASC) as queue_position_calc
                        FROM queues q
                        JOIN vendors v ON q.vendor_id = v.id
                        WHERE q.user_id = ? OR q.status = 'waiting'
                    )
                    SELECT * FROM QueueStats WHERE user_id = ? ORDER BY joined_at DESC`, [userId, userId]);
                
                // Map the window function results to the expected property names
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
        try {
            if (pool) {
                const [rows] = await pool.query('SELECT q.*, u.name as userName FROM queues q JOIN users u ON q.user_id = u.id WHERE q.vendor_id = ? AND q.status IN ("done", "cancelled") ORDER BY q.joined_at DESC', [vendorId]);
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

    // Appointments
    getAppointmentsByUser: async (userId) => {
        try {
            if (pool) {
                const [rows] = await pool.query(`
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
        try {
            if (pool) {
                await pool.query('INSERT INTO appointments SET ?', [appData]);
                return true;
            }
        } catch (err) {
            LOG.error("MySQL addAppointment failed, falling back to local", err.message);
        }
        inMemoryDb.appointments.push({ ...appData, id: inMemoryDb.appointments.length + 1 });
        return true;
    },

    updateAppointmentStatus: async (appointmentId, status) => {
        try {
            if (pool) {
                await pool.query('UPDATE appointments SET status = ? WHERE id = ?', [status, appointmentId]);
                
                // Sync: If appointment cancelled/completed, update queue
                if (status === 'cancelled' || status === 'completed') {
                    const [rows] = await pool.query('SELECT vendor_id, user_id FROM appointments WHERE id = ?', [appointmentId]);
                    if (rows[0]) {
                        const targetQueueStatus = status === 'completed' ? 'done' : 'cancelled';
                        await pool.query(
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
            
            // Sync with Queue
            if (status === 'cancelled' || status === 'completed') {
                const targetQueueStatus = status === 'completed' ? 'done' : 'cancelled';
                const relatedQueue = inMemoryDb.queues.find(q => 
                    q.user_id === app.user_id && 
                    q.vendor_id === app.vendor_id && 
                    q.status === 'waiting'
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
        try {
            if (pool) {
                const [rows] = await pool.query(`
                    SELECT a.*, u.name as userName, u.mobile as userMobile
                    FROM appointments a 
                    JOIN users u ON a.user_id = u.id 
                    WHERE a.vendor_id = ? 
                    ORDER BY a.date ASC, a.time ASC`, [vendorId]);
                if (rows) return rows;
            }
        } catch (err) {
            LOG.error(`MySQL getAppointmentsByVendor failed for ${vendorId}, falling back to local`, err.message);
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
        try {
            if (pool) {
                const [rows] = await pool.query('SELECT * FROM products WHERE vendor_id = ? ORDER BY id DESC', [vendorId]);
                if (rows) return rows.map(normalizeProductRow);
            }
        } catch (err) {
            LOG.error(`MySQL getProductsByVendor failed for ${vendorId}, falling back to local`, err.message);
        }
        return inMemoryDb.products.filter(p => p.vendor_id === vendorId).map(normalizeProductRow);
    },

    getProductById: async (id) => {
        try {
            if (pool) {
                const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
                if (rows && rows.length > 0) return normalizeProductRow(rows[0]);
            }
        } catch (err) {
            LOG.error(`MySQL getProductById failed for ${id}, falling back to local`, err.message);
        }
        const item = inMemoryDb.products.find(p => String(p.id) === String(id));
        return item ? normalizeProductRow(item) : null;
    },

    getAllProductsWithVendors: async () => {
        try {
            if (pool) {
                const [rows] = await pool.query(
                    `SELECT p.*, v.shop_name, v.features_payments, v.features_products
                     FROM products p
                     JOIN vendors v ON p.vendor_id = v.id
                     WHERE v.is_active = TRUE AND v.features_products = TRUE
                     ORDER BY p.id DESC`
                );
                if (rows) return rows.map(normalizeProductRow);
            }
        } catch (err) {
            LOG.error("MySQL getAllProductsWithVendors failed, falling back to local", err.message);
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
        try {
            if (pool) {
                const payload = {
                    ...productData,
                    image_urls_json: JSON.stringify(imageUrls)
                };
                delete payload.image_urls;
                await pool.query('INSERT INTO products SET ?', [payload]);
                const [rows] = await pool.query('SELECT * FROM products WHERE id = LAST_INSERT_ID()');
                if (rows && rows[0]) return normalizeProductRow(rows[0]);
            }
        } catch (err) {
            LOG.error("MySQL addProduct failed, falling back to local", err.message);
        }
        const newId = (inMemoryDb.products[inMemoryDb.products.length - 1]?.id || 0) + 1;
        const item = { id: newId, ...productData, image_urls: imageUrls };
        inMemoryDb.products.push(item);
        return normalizeProductRow(item);
    },

    updateProduct: async (productId, updateData) => {
        const imageUrls = Array.isArray(updateData.image_urls) ? updateData.image_urls.filter(Boolean) : null;
        try {
            if (pool) {
                const payload = { ...updateData };
                if (imageUrls) payload.image_urls_json = JSON.stringify(imageUrls);
                delete payload.image_urls;
                await pool.query('UPDATE products SET ? WHERE id = ?', [payload, productId]);
                return db.getProductById(productId);
            }
        } catch (err) {
            LOG.error(`MySQL updateProduct failed for ${productId}, falling back to local`, err.message);
        }
        const item = inMemoryDb.products.find(p => String(p.id) === String(productId));
        if (!item) return null;
        Object.assign(item, updateData);
        if (imageUrls) item.image_urls = imageUrls;
        return normalizeProductRow(item);
    },

    // Orders
    addOrder: async (orderData) => {
        try {
            if (pool) {
                await pool.query('INSERT INTO orders SET ?', [orderData]);
                return orderData;
            }
        } catch (err) {
            LOG.error("MySQL addOrder failed, falling back to local", err.message);
        }
        const newId = (inMemoryDb.orders[inMemoryDb.orders.length - 1]?.id || 0) + 1;
        const item = { id: newId, ...orderData };
        inMemoryDb.orders.push(item);
        return item;
    },

    getOrdersByVendorOwner: async (ownerId) => {
        try {
            if (pool) {
                const [rows] = await pool.query(
                    `SELECT o.*, v.shop_name, u.name as user_name
                     FROM orders o
                     JOIN vendors v ON o.vendor_id = v.id
                     LEFT JOIN users u ON o.user_id = u.id
                     WHERE v.owner_id = ?
                     ORDER BY o.created_at DESC`,
                    [ownerId]
                );
                if (rows) return rows;
            }
        } catch (err) {
            LOG.error(`MySQL getOrdersByVendorOwner failed for ${ownerId}, falling back to local`, err.message);
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
        try {
            if (pool) {
                // Try to join with vendors to check visibility_feed
                // Note: Assuming activities table has vendor_id. If not, this might fail or need adjustment.
                // For robustness, we'll try a LEFT JOIN if possible, or just select all.
                try {
                    const [rows] = await pool.query(`
                        SELECT a.* 
                        FROM activities a
                        LEFT JOIN vendors v ON a.vendor_id = v.id
                        WHERE v.visibility_feed IS NULL OR v.visibility_feed = TRUE
                        ORDER BY a.timestamp DESC LIMIT ?`, [limit]);
                if (rows) {
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
                } catch (e) {
                    // Fallback if vendor_id column missing in activities
                    LOG.warning("MySQL getActivities join failed (schema mismatch?), falling back to simple select", e.message);
                    const [rows] = await pool.query('SELECT * FROM activities ORDER BY timestamp DESC LIMIT ?', [limit]);
                    return rows; 
                }
            }
        } catch (err) {
            LOG.error("MySQL getActivities failed, falling back to local", err.message);
        }
        
        return inMemoryDb.activities
            .filter(a => {
                if (!a.vendor_id) return true; // Keep system/global activities
                const v = inMemoryDb.vendors.find(v => v.id === a.vendor_id);
                return v ? v.visibility_feed !== false : true;
            })
            .slice(-limit).reverse();
    },

    // Matchmaking
    getMatchmakingPresets: async () => {
        return deepClone(MATCHMAKING_PRESETS);
    },

    getVendorMatchmakingTemplate: async (vendorId) => {
        try {
            if (pool) {
                await ensureMatchmakingTables();
                const [rows] = await pool.query(
                    'SELECT * FROM matchmaking_templates WHERE vendor_id = ? LIMIT 1',
                    [vendorId]
                );
                if (rows && rows.length) {
                    const row = rows[0];
                    return {
                        vendor_id: row.vendor_id,
                        template_name: row.template_name,
                        selected_preset: row.selected_preset,
                        questions: JSON.parse(row.template_json || '[]'),
                        scoring: JSON.parse(row.scoring_json || '{"pass":50,"good":70,"best":90}'),
                        is_active: row.is_active !== 0
                    };
                }
            }
        } catch (err) {
            LOG.error(`MySQL getVendorMatchmakingTemplate failed for ${vendorId}, falling back to local`, err.message);
        }
        return inMemoryDb.matchmaking_templates.find((x) => x.vendor_id === vendorId) || null;
    },

    saveVendorMatchmakingTemplate: async (vendorId, payload) => {
        const normalized = normalizeTemplate(payload || {});
        const finalTemplate = {
            vendor_id: vendorId,
            template_name: normalized.template_name,
            selected_preset: normalized.selected_preset,
            questions: normalized.questions,
            scoring: normalized.scoring,
            is_active: payload?.is_active !== false
        };
        try {
            if (pool) {
                await ensureMatchmakingTables();
                await pool.query(
                    `INSERT INTO matchmaking_templates (vendor_id, template_name, selected_preset, template_json, scoring_json, is_active)
                     VALUES (?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                     template_name = VALUES(template_name),
                     selected_preset = VALUES(selected_preset),
                     template_json = VALUES(template_json),
                     scoring_json = VALUES(scoring_json),
                     is_active = VALUES(is_active)`,
                    [
                        vendorId,
                        finalTemplate.template_name,
                        finalTemplate.selected_preset,
                        JSON.stringify(finalTemplate.questions || []),
                        JSON.stringify(finalTemplate.scoring || { pass: 50, good: 70, best: 90 }),
                        finalTemplate.is_active ? 1 : 0
                    ]
                );
                return finalTemplate;
            }
        } catch (err) {
            LOG.error(`MySQL saveVendorMatchmakingTemplate failed for ${vendorId}, falling back to local`, err.message);
        }
        const idx = inMemoryDb.matchmaking_templates.findIndex((x) => x.vendor_id === vendorId);
        if (idx >= 0) inMemoryDb.matchmaking_templates[idx] = finalTemplate;
        else inMemoryDb.matchmaking_templates.push(finalTemplate);
        return finalTemplate;
    },

    submitMatchmakingAnswers: async ({ vendor_id, user_id, answers, user_name }) => {
        const tpl = await db.getVendorMatchmakingTemplate(vendor_id);
        if (!tpl || tpl.is_active === false || !Array.isArray(tpl.questions) || !tpl.questions.length) {
            throw new Error('Matchmaking template not configured for this vendor');
        }

        const computed = calculateMatchmakingScore(tpl, answers || {});
        const allSubs = await db.getVendorMatchmakingResults(vendor_id, { includeInsights: false });
        const insight = buildAiInsight({
            score: computed.totalScore,
            percentage: computed.percentage,
            band: computed.band,
            tags: computed.tags,
            currentUserId: user_id,
            allSubmissions: allSubs
        });

        const payload = {
            vendor_id,
            user_id,
            user_name: user_name || '',
            answers: answers || {},
            score: computed.totalScore,
            percentage: computed.percentage,
            band: computed.band,
            tags: computed.tags,
            insight
        };

        try {
            if (pool) {
                await ensureMatchmakingTables();
                await pool.query(
                    `INSERT INTO matchmaking_submissions (vendor_id, user_id, answers_json, score, percentage, band, tags_json, insight_json)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                     answers_json = VALUES(answers_json),
                     score = VALUES(score),
                     percentage = VALUES(percentage),
                     band = VALUES(band),
                     tags_json = VALUES(tags_json),
                     insight_json = VALUES(insight_json)`,
                    [
                        payload.vendor_id,
                        payload.user_id,
                        JSON.stringify(payload.answers || {}),
                        payload.score,
                        payload.percentage,
                        payload.band,
                        JSON.stringify(payload.tags || []),
                        JSON.stringify(payload.insight || {})
                    ]
                );
                return payload;
            }
        } catch (err) {
            LOG.error(`MySQL submitMatchmakingAnswers failed for vendor ${vendor_id}, falling back to local`, err.message);
        }

        const idx = inMemoryDb.matchmaking_submissions.findIndex((x) => x.vendor_id === vendor_id && x.user_id === user_id);
        if (idx >= 0) inMemoryDb.matchmaking_submissions[idx] = payload;
        else inMemoryDb.matchmaking_submissions.push(payload);
        return payload;
    },

    getUserMatchmakingSubmissions: async (userId) => {
        try {
            if (pool) {
                await ensureMatchmakingTables();
                const [rows] = await pool.query(
                    `SELECT s.*, v.shop_name
                     FROM matchmaking_submissions s
                     LEFT JOIN vendors v ON v.id = s.vendor_id
                     WHERE s.user_id = ?
                     ORDER BY s.updated_at DESC`,
                    [userId]
                );
                return (rows || []).map((r) => ({
                    id: r.id,
                    vendor_id: r.vendor_id,
                    shop_name: r.shop_name || 'Vendor',
                    user_id: r.user_id,
                    answers: JSON.parse(r.answers_json || '{}'),
                    score: Number(r.score || 0),
                    percentage: Number(r.percentage || 0),
                    band: r.band || 'needs_improvement',
                    tags: JSON.parse(r.tags_json || '[]'),
                    insight: JSON.parse(r.insight_json || '{}'),
                }));
            }
        } catch (err) {
            LOG.error(`MySQL getUserMatchmakingSubmissions failed for ${userId}, falling back to local`, err.message);
        }

        return inMemoryDb.matchmaking_submissions
            .filter((s) => s.user_id === userId)
            .map((s, index) => ({
                id: index + 1,
                ...s,
                shop_name: inMemoryDb.vendors.find((v) => v.id === s.vendor_id)?.shop_name || 'Vendor'
            }));
    },

    getVendorMatchmakingResults: async (vendorId, options = {}) => {
        const includeInsights = options?.includeInsights !== false;
        try {
            if (pool) {
                await ensureMatchmakingTables();
                const [rows] = await pool.query(
                    `SELECT s.*, u.name as user_name, u.mobile as user_mobile
                     FROM matchmaking_submissions s
                     LEFT JOIN users u ON u.id = s.user_id
                     WHERE s.vendor_id = ?
                     ORDER BY s.percentage DESC, s.updated_at DESC`,
                    [vendorId]
                );
                return (rows || []).map((r) => ({
                    id: r.id,
                    vendor_id: r.vendor_id,
                    user_id: r.user_id,
                    user_name: r.user_name || 'User',
                    user_mobile: r.user_mobile || '',
                    answers: JSON.parse(r.answers_json || '{}'),
                    score: Number(r.score || 0),
                    percentage: Number(r.percentage || 0),
                    band: r.band || 'needs_improvement',
                    tags: JSON.parse(r.tags_json || '[]'),
                    insight: includeInsights ? JSON.parse(r.insight_json || '{}') : {}
                }));
            }
        } catch (err) {
            LOG.error(`MySQL getVendorMatchmakingResults failed for ${vendorId}, falling back to local`, err.message);
        }

        return inMemoryDb.matchmaking_submissions
            .filter((s) => s.vendor_id === vendorId)
            .map((s, index) => {
                const user = inMemoryDb.users.find((u) => u.id === s.user_id) || {};
                return {
                    id: index + 1,
                    ...s,
                    user_name: user.name || s.user_name || 'User',
                    user_mobile: user.mobile || ''
                };
            })
            .sort((a, b) => (b.percentage || 0) - (a.percentage || 0));
    },

    // --- ANALYTICS HELPERS ---
    getAllAppointments: async () => {
        try {
            if (pool) {
                const [rows] = await pool.query('SELECT * FROM appointments');
                return rows;
            }
        } catch (err) {
            LOG.error("MySQL getAllAppointments failed", err.message);
        }
        return inMemoryDb.appointments;
    },

    getAllOrders: async () => {
        try {
            if (pool) {
                const [rows] = await pool.query('SELECT * FROM orders');
                return rows;
            }
        } catch (err) {
            LOG.error("MySQL getAllOrders failed", err.message);
        }
        return inMemoryDb.orders;
    },

    getAllProducts: async () => {
        try {
            if (pool) {
                const [rows] = await pool.query('SELECT * FROM products');
                return rows;
            }
        } catch (err) {
            LOG.error("MySQL getAllProducts failed", err.message);
        }
        return inMemoryDb.products;
    },

    // --- SYSTEM SETTINGS ---
    getSettings: async () => {
        try {
            if (pool) {
                // Try to fetch from a settings table, or return defaults if not exists
                // We'll assume a table 'system_settings' with columns key_name, is_enabled
                try {
                    const [rows] = await pool.query('SELECT * FROM system_settings');
                    const settings = {
                        enable_queue: true,
                        enable_appointments: true,
                        enable_shopping: true,
                        enable_matchmaking: true,
                        enable_offer: true,
                        enable_trade: true
                    };
                    rows.forEach(r => {
                        if (settings.hasOwnProperty(r.key_name)) {
                            settings[r.key_name] = r.value === 'true' || r.value === 1 || r.value === true;
                        }
                    });
                    return settings;
                } catch (e) {
                    // Table might not exist, return defaults
                    return { enable_queue: true, enable_appointments: true, enable_shopping: true, enable_matchmaking: true, enable_offer: true, enable_trade: true };
                }
            }
        } catch (err) {
            LOG.error("MySQL getSettings failed", err.message);
        }
        return inMemoryDb.settings;
    },

    updateSettings: async (newSettings) => {
        try {
            if (pool) {
                // Upsert logic for MySQL
                // CREATE TABLE IF NOT EXISTS system_settings (key_name VARCHAR(50) PRIMARY KEY, value VARCHAR(10));
                try {
                    await pool.query(`
                        CREATE TABLE IF NOT EXISTS system_settings (
                            key_name VARCHAR(50) PRIMARY KEY, 
                            value VARCHAR(10)
                        )
                    `);
                    
                    for (const [key, val] of Object.entries(newSettings)) {
                        await pool.query(
                            'INSERT INTO system_settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?',
                            [key, String(val), String(val)]
                        );
                    }
                    return newSettings;
                } catch (e) {
                    LOG.error("MySQL settings update failed", e.message);
                }
            }
        } catch (err) {
            LOG.error("MySQL updateSettings failed", err.message);
        }
        
        Object.assign(inMemoryDb.settings, newSettings);
        return inMemoryDb.settings;
    }
};

// Performance Wrapper
const measuredDb = { LOG_CONFIG }; // Export config
for (const key in db) {
    if (typeof db[key] === 'function') {
        if (key === 'getType') {
            measuredDb[key] = db[key];
        } else {
            measuredDb[key] = async (...args) => {
                if (!LOG_CONFIG.ENABLED) return await db[key](...args);
                
                const start = Date.now();
                try {
                    return await db[key](...args);
                } finally {
                    const duration = Date.now() - start;
                    if (duration > LOG_CONFIG.PERF_THRESHOLD) {
                        console.log(`[DB PERF] ${key} took ${duration}ms`);
                    }
                }
            };
        }
    } else {
        measuredDb[key] = db[key];
    }
}

// Export pool for use in other modules (like dealsService)
measuredDb.getPool = () => pool;
measuredDb.pool = pool; // Direct access
measuredDb.ensureFleetTables = ensureFleetTables; // Export for fleetService

module.exports = measuredDb;
