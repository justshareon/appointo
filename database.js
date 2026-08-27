require('./loadEnv');
const path = require('path');
const mysql = require('mysql2');
const fs = require('fs');
const { logDbAccess } = require('./utils/dbTiming');
const {
    MATCHMAKING_PRESETS,
    deepClone,
    normalizeTemplate,
    calculateMatchmakingScore,
    buildAiInsight
} = require('./matchmakingEngine');
const featureConnectionManager = require('./database/featureConnectionManager');
const { insertMany } = require('./database/sqlBatch');
const { resolveProductImages } = require('./utils/categoryImages');

/** Resolve MySQL pool for current request (lazy, feature-aware). */
const getPool = () => featureConnectionManager.getPool();

/** Ensure a MySQL pool exists for writes even outside request middleware. */
const ensureWritePool = async () => {
    let pool = getPool();
    if (pool) return pool;
    if (String(process.env.DB_TYPE || DB_TYPE || '').toLowerCase() !== 'mysql') return null;
    try {
        pool = await featureConnectionManager.acquireForSync('core');
        return pool || getPool();
    } catch (err) {
        LOG.warning(`[ensureWritePool] ${err.message}`);
        return null;
    }
};

const SERVICE_FEATURES = ['trade', 'offer', 'qless', 'fleet', 'realestate', 'cyber', 'trust_score', 'news'];
const isFeatureFlagOn = (v, feature) => {
    const val = v?.[`features_${feature}`];
    return val === true || val === 1 || val === '1';
};

// Feature seed in data.js is loaded only when that feature is first opened.
let testData = null;
function getTestData() {
    if (testData) return testData;
    try {
        testData = require('./database/data.js');
    } catch (error) {
        console.warn('[DB] Could not load test data from data.js:', error.message);
        testData = {};
    }
    return testData;
}

const LOG_FILE = path.join(__dirname, 'error.log');
const recentErrorLog = new Map();

const appendErrorLog = (msg, detail) => {
    const key = `${msg}|${detail}`;
    const nowMs = Date.now();
    const prev = recentErrorLog.get(key) || 0;
    if (nowMs - prev < 5 * 60 * 1000) return;
    recentErrorLog.set(key, nowMs);
    if (recentErrorLog.size > 200) {
        for (const [k, t] of recentErrorLog) {
            if (nowMs - t > 10 * 60 * 1000) recentErrorLog.delete(k);
        }
    }
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

const { resolveDbType } = require('./utils/resolveDbType');
const DB_TYPE = resolveDbType();

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
        { id: 'usr_newsuser11', name: 'News User 1', email: 'newsuser11@test.com', mobile: '8000000111', role: 'user', location_name: 'Delhi' },
        { id: 'usr_newsvendor1', name: 'News Vendor 1', email: 'newsvendor1@test.com', mobile: '8000000222', role: 'vendor', location_name: 'Delhi' },
        { id: 'usr_offer1', name: 'Offer User 1', email: 'offer1@test.com', mobile: '8000000003', role: 'user', location_name: 'Mumbai' },
        { id: 'usr_offer1vendor', name: 'Offer Vendor 1', email: 'offer1vendor@test.com', mobile: '8000000004', role: 'vendor', location_name: 'Mumbai' },
        { id: 'usr_qlessuser1', name: 'QLess User 1', email: 'qlessuser1@test.com', mobile: '8000000005', role: 'user', location_name: 'Mumbai' },
        { id: 'usr_qlessvendor1', name: 'QLess Vendor 1', email: 'qlessvendor1@test.com', mobile: '8000000006', role: 'vendor', location_name: 'Mumbai' },
        { id: 'usr_fleetuser1', name: 'Amit Sharma', email: 'fleetuser1@test.com', mobile: '8000000007', role: 'user', location_name: 'Bhiwandi' },
        { id: 'usr_fleetuser2', name: 'Suresh Jadhav', email: 'fleetuser2@test.com', mobile: '8000000017', role: 'user', location_name: 'Panvel' },
        { id: 'usr_fleetuser3', name: 'Priya Kulkarni', email: 'fleetuser3@test.com', mobile: '8000000027', role: 'user', location_name: 'Pune' },
        { id: 'usr_fleetvendor1', name: 'Rajesh Patil', email: 'fleetvendor1@test.com', mobile: '8000000008', role: 'vendor', location_name: 'Mumbai' },
        { id: 'usr_realuser1', name: 'Realestate User 1', email: 'realuser1@test.com', mobile: '8000000009', role: 'user', location_name: 'Bangalore' },
        { id: 'usr_realvendor1', name: 'Realestate Vendor 1', email: 'realvendor1@test.com', mobile: '8000000010', role: 'vendor', location_name: 'Bangalore' },
        { id: 'usr_cyber1', name: 'Cyber User 1', email: 'cyber1@test.com', mobile: '8000000011', role: 'user', location_name: 'Mumbai' },
        { id: 'usr_cybervendor1', name: 'Cyber Vendor 1', email: 'cybervendor1@test.com', mobile: '8000000012', role: 'vendor', location_name: 'Mumbai' },
        { id: 'usr_trust1', name: 'Trust User 1', email: 'trust1@test.com', mobile: '8000000101', role: 'user', location_name: 'Mumbai' },
        { id: 'usr_trustvendor1', name: 'Trust Vendor 1', email: 'trustvendor1@test.com', mobile: '8000000102', role: 'vendor', location_name: 'Mumbai' },
        // Runtime demo accounts (must exist in MySQL via sync)
        { id: 'usr_anuj', name: 'Anuj', email: 'anuj@test.com', mobile: '9000000001', role: 'user', location_name: 'Mumbai' },
        { id: 'usr_sam', name: 'Sam', email: 'sam@test.com', mobile: '9000000002', role: 'user', location_name: 'Mumbai' },
        { id: 'usr_siddhi', name: 'Siddhi', email: 'siddhi@test.com', mobile: '9000000003', role: 'vendor', location_name: 'Mumbai' }
    ],
    vendors: [
        {
            id: 'v_1',
            owner_id: 'usr_vendor',
            shop_name: 'Smile Dental Clinic',
            category: 'Hospital',
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
            shop_name: 'Western Express Logistics',
            category: 'Fleet',
            is_active: true,
            is_promoted: false,
            latitude: 19.076,
            longitude: 72.8777,
            location_name: 'Mumbai → Pune',
            appointmentCount: 0,
            google_link: '',
            instagram_handle: '',
            facebook_link: '',
            features_products: false,
            features_payments: false,
            features_appointments: false,
            features_queue: false,
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
            features_products: false,
            features_payments: false,
            features_appointments: false,
            features_queue: false,
            features_matchmaking: false,
            features_realestate: true,
            visibility_top_rated: false,
            visibility_list: true,
            visibility_feed: false
        },
        {
            id: 'v_cyber1',
            owner_id: 'usr_cybervendor1',
            shop_name: 'Cyber Shop 1',
            category: 'Cyber',
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
            features_cyber: true,
            visibility_top_rated: false,
            visibility_list: true,
            visibility_feed: false
        },
        {
            id: 'v_trust1',
            owner_id: 'usr_trustvendor1',
            shop_name: 'Trust Score Services',
            category: 'Trust Services',
            is_active: true,
            is_promoted: false,
            latitude: 19.1136,
            longitude: 72.8697,
            location_name: 'Mumbai',
            appointmentCount: 0,
            google_link: '',
            instagram_handle: '',
            facebook_link: '',
            features_products: true,
            features_payments: true,
            features_appointments: true,
            features_queue: true,
            features_matchmaking: false,
            features_trust_score: true,
            visibility_top_rated: false,
            visibility_list: true,
            visibility_feed: false
        },
        {
            id: 'v_siddhi',
            owner_id: 'usr_siddhi',
            shop_name: 'Siddhi Vendor',
            category: 'Shop',
            is_active: true,
            is_promoted: true,
            latitude: 19.076,
            longitude: 72.8777,
            location_name: 'Mumbai',
            appointmentCount: 0,
            google_link: '',
            instagram_handle: '',
            facebook_link: '',
            features_products: true,
            features_payments: true,
            features_appointments: true,
            features_queue: true,
            features_matchmaking: false,
            visibility_top_rated: true,
            visibility_list: true,
            visibility_feed: true
        }
    ],
    // Suraksha (Cyber Safety) in-memory data
    surakshaValidations: [],
    surakshaReports: [],
    surakshaDevices: [],
    // Caller Validation (Truecaller-like) data
    spamNumbers: [],
    callHistory: [],
    communityReports: [],
    // Cyber Threats (User-reported threats) - Test data based on real internet searches
    cyberThreats: [],
    threatAlerts: [],
    // Cyber Security Tips
    cyberSecurityTips: [],
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
        { id: 7, vendor_id: 'v_4', name: 'Prasad Combo', price: 199, offer: 'Temple Special', offer_amount: 20, validity_from: '2026-01-01', validity_to: '2026-12-31', image_urls: [] },
        { id: 12, vendor_id: 'v_qless1', name: 'QLess Express Pass', price: 199, offer: 'Skip the line', offer_amount: 20, validity_from: '2026-01-01', validity_to: '2026-12-31', image_urls: ['https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=800'] },
        { id: 13, vendor_id: 'v_qless1', name: 'Priority Token Pack', price: 499, offer: '3 tokens', offer_amount: 50, validity_from: '2026-01-01', validity_to: '2026-12-31', image_urls: ['https://images.unsplash.com/photo-1556742111-a301076d9d18?w=800'] },
        { id: 1001, vendor_id: 'v_siddhi', name: 'Siddhi Combo Pack', price: 299, offer: '10% OFF', offer_amount: 30, validity_from: '2026-01-01', validity_to: '2026-12-31', image_urls: ['https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=800'], name_key: 'siddhi combo pack', stock: 50 },
        { id: 1002, vendor_id: 'v_siddhi', name: 'Siddhi Special Service', price: 499, offer: 'Flat 50 OFF', offer_amount: 50, validity_from: '2026-01-01', validity_to: '2026-12-31', image_urls: ['https://images.unsplash.com/photo-1556740749-887f6717d7e4?w=800'], name_key: 'siddhi special service', stock: 30 },
        { id: 1003, vendor_id: 'v_siddhi', name: 'Quick Care Visit', price: 199, offer: 'No Offer', offer_amount: 0, validity_from: '2026-01-01', validity_to: '2026-12-31', image_urls: [], name_key: 'quick care visit', stock: 100 }
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
        { id: 16, vendor_id: 'v_new1', user_id: 'usr_user', date: dayAfterStr, time: '11:00', status: 'confirmed', created_at: new Date() },
        { id: 17, vendor_id: 'v_siddhi', user_id: 'usr_anuj', date: todayStr, time: currentTime, status: 'pending', created_at: new Date(), notes: 'Booked with Siddhi Vendor' },
        { id: 18, vendor_id: 'v_siddhi', user_id: 'usr_sam', date: tomorrowStr, time: '11:00', status: 'confirmed', created_at: new Date(), notes: 'Booked with Siddhi Vendor' }
    ],
    activities: [
        { id: 1, type: 'appointment', vendor_id: 'v_new1', userId: 'usr_u1', userName: 'User One', message: 'booked an appointment at Vendor One Shop', timestamp: new Date(Date.now() - 60 * 60 * 1000), reactions: {} },
        { id: 2, type: 'review', vendor_id: 'v_5', userId: 'usr_rahul', userName: 'Rahul Sharma', message: 'rated Super Market 5 stars', timestamp: new Date(Date.now() - 30 * 60 * 1000), reactions: { '👍': 2, '❤️': 1 } }
    ],
    user_vendor_mappings: [
        { id: 1, user_id: 'usr_user', vendor_id: 'v_1' },
        { id: 2, user_id: 'usr_user', vendor_id: 'v_new1' },
        { id: 3, user_id: 'usr_u1', vendor_id: 'v_new1' },
        { id: 4, user_id: 'usr_u2', vendor_id: 'v_new1' },
        { id: 5, user_id: 'usr_u3', vendor_id: 'v_new1' },
        { id: 6, user_id: 'usr_u4', vendor_id: 'v_new1' },
        { id: 7, user_id: 'usr_u5', vendor_id: 'v_new1' },
        { id: 8, user_id: 'usr_temple_user', vendor_id: 'v_4' },
        { id: 9, user_id: 'usr_rahul', vendor_id: 'v_5' },
        { id: 10, user_id: 'usr_new_patient', vendor_id: 'v_3' },
        { id: 11, user_id: 'usr_trade1', vendor_id: 'v_trade1' },
        { id: 12, user_id: 'usr_offer1', vendor_id: 'v_offer1' },
        { id: 13, user_id: 'usr_qlessuser1', vendor_id: 'v_qless1' },
        { id: 14, user_id: 'usr_fleetuser1', vendor_id: 'v_fleet1' },
        { id: 22, user_id: 'usr_fleetuser2', vendor_id: 'v_fleet1' },
        { id: 23, user_id: 'usr_fleetuser3', vendor_id: 'v_fleet1' },
        { id: 15, user_id: 'usr_realuser1', vendor_id: 'v_realestate1' },
        { id: 16, user_id: 'usr_cyber1', vendor_id: 'v_cyber1' },
        { id: 17, user_id: 'usr_match_u1', vendor_id: 'v_match_super' },
        { id: 18, user_id: 'usr_match_u2', vendor_id: 'v_match_super' },
        { id: 19, user_id: 'usr_trust1', vendor_id: 'v_trust1' },
        { id: 20, user_id: 'usr_anuj', vendor_id: 'v_siddhi' },
        { id: 21, user_id: 'usr_sam', vendor_id: 'v_siddhi' },
    ],
    chat_messages: [],
    // System Settings
    settings: {
        enable_queue: true,
        enable_appointments: true,
        enable_shopping: true,
        enable_matchmaking: true,
        enable_offer: true,
        enable_trade: true,
        enable_qless: true,
        enable_fleet: true,
        enable_realestate: true,
        enable_cyber: true,
        enable_trust_score: true,
        theme_position: 'auto',
        enable_news: true,
        enable_trade_extra_tabs: false,
        enable_lazy_loading: true,
        ui_theme: 'facebook',
        news_user_emails: 'newsuser11',
        news_vendor_emails: 'newsvendor1@test.com',
        trade_news_source: 'telegram',
        trade_news_sources: '[{"id":"google-global","type":"rss","enabled":true,"name":"Google News Global","url":"https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"global_news"},{"id":"google-tech","type":"rss","enabled":true,"name":"Google News Technology","url":"https://news.google.com/rss/search?q=technology&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"new_technology"},{"id":"google-sports","type":"rss","enabled":true,"name":"Google News Sports","url":"https://news.google.com/rss/search?q=sports&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"sports"},{"id":"google-travel","type":"rss","enabled":true,"name":"Google News Travel","url":"https://news.google.com/rss/search?q=travel%20deals&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"travel"},{"id":"google-coupons","type":"rss","enabled":true,"name":"Google News Coupons","url":"https://news.google.com/rss/search?q=local%20coupons%20OR%20food%20coupons&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"food_coupons"},{"id":"google-deals","type":"rss","enabled":true,"name":"Google News Deals","url":"https://news.google.com/rss/search?q=deal%20of%20the%20day%20OR%20flash%20sale&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"trending_deals"},{"id":"google-flash-sale","type":"rss","enabled":true,"name":"Google News Flash Sale","url":"https://news.google.com/rss/search?q=flash%20sale%20OR%20limited%20time%20offer%20OR%20mega%20sale&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"trending_offer"},{"id":"slickdeals","type":"rss","enabled":true,"name":"Slickdeals Frontpage","url":"https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1","category":"trending_deals"},{"id":"dealnews","type":"rss","enabled":true,"name":"DealNews","url":"https://www.dealnews.com/rss/","category":"trending_offer"}]',
        news_cache_auto_refresh: true,
        news_cache_cron: '0 */3 * * *',
    },
    vendor_categories: [
        { id: 'cat_shop', name: 'Shop', created_at: new Date() },
        { id: 'cat_hotel', name: 'Hotel', created_at: new Date() },
        { id: 'cat_hospital', name: 'Hospital', created_at: new Date() },
        { id: 'cat_doctor', name: 'Doctor', created_at: new Date() },
        { id: 'cat_railway', name: 'Railway', created_at: new Date() },
    ],
    health_reports: [
        {
            id: 'hr_user_2022',
            user_id: 'usr_user',
            vendor_id: 'v_1',
            report_year: 2022,
            report_type: 'lab',
            file_name: 'annual-lab-2022.pdf',
            notes: 'HbA1c 5.6 LDL 118 creatinine 0.90 fasting glucose 96 triglycerides 132 HDL 46 hemoglobin 13.4 TSH 2.1 ALT 28 uric acid 5.4 vitamin D 28 BP 122/78',
            markers: {},
            extracted_text: '',
            created_at: new Date('2022-08-12T10:00:00'),
        },
        {
            id: 'hr_user_2023',
            user_id: 'usr_user',
            vendor_id: 'v_1',
            report_year: 2023,
            report_type: 'lab',
            file_name: 'annual-lab-2023.pdf',
            notes: 'HbA1c 5.9 LDL 132 creatinine 1.00 fasting glucose 104 triglycerides 158 HDL 41 hemoglobin 13.1 TSH 2.4 ALT 36 uric acid 6.1 vitamin D 22 BP 128/82',
            markers: {},
            extracted_text: '',
            created_at: new Date('2023-08-18T10:00:00'),
        },
        {
            id: 'hr_user_2024',
            user_id: 'usr_user',
            vendor_id: 'v_1',
            report_year: 2024,
            report_type: 'lab',
            file_name: 'annual-lab-2024.pdf',
            notes: 'HbA1c 6.2 LDL 148 creatinine 1.10 fasting glucose 112 triglycerides 176 HDL 38 hemoglobin 12.8 TSH 3.1 ALT 49 uric acid 6.8 vitamin D 18 BP 134/86',
            markers: {},
            extracted_text: '',
            created_at: new Date('2024-08-20T10:00:00'),
        },
        {
            id: 'hr_user_2025',
            user_id: 'usr_user',
            vendor_id: 'v_1',
            report_year: 2025,
            report_type: 'lab',
            file_name: 'annual-lab-2025.pdf',
            notes: 'HbA1c 6.4 LDL 155 creatinine 1.20 fasting glucose 118 triglycerides 189 HDL 37 hemoglobin 12.6 TSH 3.6 ALT 58 uric acid 7.2 vitamin D 16 BP 138/88',
            markers: {},
            extracted_text: '',
            created_at: new Date('2025-08-21T10:00:00'),
        },
        {
            id: 'hr_vendor_2023',
            user_id: 'usr_vendor',
            vendor_id: 'v_1',
            report_year: 2023,
            report_type: 'lab',
            file_name: 'clinic-owner-lab-2023.pdf',
            notes: 'HbA1c 5.5 LDL 110 creatinine 0.95 fasting glucose 92 triglycerides 120 HDL 48 hemoglobin 14.2 TSH 1.8 ALT 24 uric acid 5.1 vitamin D 32 BP 118/76',
            markers: {},
            extracted_text: '',
            created_at: new Date('2023-09-02T10:00:00'),
        },
        {
            id: 'hr_vendor_2025',
            user_id: 'usr_vendor',
            vendor_id: 'v_1',
            report_year: 2025,
            report_type: 'lab',
            file_name: 'clinic-owner-lab-2025.pdf',
            notes: 'HbA1c 5.8 LDL 128 creatinine 1.02 fasting glucose 101 triglycerides 149 HDL 44 hemoglobin 13.9 TSH 2.2 ALT 33 uric acid 5.8 vitamin D 24 BP 126/80',
            markers: {},
            extracted_text: '',
            created_at: new Date('2025-09-04T10:00:00'),
        },
    ],
    health_illness_years: [],
    health_predictions: [],
    matchmaking_templates: [],
    matchmaking_submissions: [],
    trustScoreProjects: [],
    trustScoreFraudAlerts: [],
    trustScoreBuilders: [],
    trustScoreReviews: [],
    trustScoreComplaints: [],
    trustScoreWatchlist: [],
    trustScoreLandLedger: [],
    trustScoreContributorScores: [],
    trustScoreApiConfigs: [],
    boardMeetings: [],
    corporateActions: [],
    tradingWatchlists: {}, // User watchlists: { userId: [{ symbol, addedAt }] }
    tradingPortfolios: {}, // User portfolios: { userId: { holdings: [], positions: [], overallReturns: {} } }
    tradingOrders: {}, // User orders: { userId: [{ id, symbol, type, quantity, price, status, createdAt }] }
    tradingFunds: {}, // User funds: { userId: { availableBalance, investedAmount, transactions: [] } }
    tradingData: {
        marketIndices: [],
        stockQuotes: [],
        topGainers: [],
        topLosers: [],
        marketHigh: [],
        mostBought: []
    }
};

// --- MYSQL CONNECTION (lazy via featureConnectionManager — no pool at startup) ---
// Pool opens only when a feature route is hit (core for auth/login, trade for trading, etc.)
// and closes after idle timeout when no requests are using that feature.

// Cleanup delegated to featureConnectionManager
process.on('SIGINT', async () => {
    await featureConnectionManager.closeAll();
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
    const vendor = (inMemoryDb.vendors || []).find((v) => String(v.id) === String(product.vendor_id));
    const category = product.vendor_category || product.category || vendor?.category;
    if (category && !product.vendor_category) product.vendor_category = category;
    product.image_urls = resolveProductImages(cleaned, category, product.id || product.name);
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
    if (!getPool() || matchmakingTablesReady) return;
    await getPool().query(`
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
    await getPool().query(`
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

const dbContext = require('./database/dbContext');
dbContext.getPool = getPool;
dbContext.inMemoryDb = inMemoryDb;
dbContext.LOG = LOG;
dbContext.DB_TYPE = DB_TYPE;
dbContext.toMysqlDateTime = toMysqlDateTime;
dbContext.ensureWritePool = ensureWritePool;
dbContext.normalizeProductRow = normalizeProductRow;
dbContext.MATCHMAKING_PRESETS = MATCHMAKING_PRESETS;
dbContext.deepClone = deepClone;
dbContext.normalizeTemplate = normalizeTemplate;
dbContext.calculateMatchmakingScore = calculateMatchmakingScore;
dbContext.buildAiInsight = buildAiInsight;
dbContext.ensureMatchmakingTables = ensureMatchmakingTables;

const featureApi = (createFn) => {
    const { feature, ...api } = createFn(dbContext);
    return api;
};

let cyberThreatTablesReady = false;
const ensureCyberThreatTables = async () => {
    if (!getPool() || cyberThreatTablesReady) return;
    
    try {
        // Cyber Threats Table
        await getPool().query(`
            CREATE TABLE IF NOT EXISTS cyber_threats (
                id VARCHAR(255) PRIMARY KEY,
                user_id VARCHAR(64) NOT NULL,
                type ENUM('phone', 'email', 'url', 'upi', 'bank_account', 'other') NOT NULL,
                value VARCHAR(255) NOT NULL,
                title VARCHAR(500) NOT NULL,
                description TEXT,
                severity ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
                category ENUM('phishing', 'scam', 'malware', 'fraud', 'spam', 'other') DEFAULT 'other',
                tags JSON,
                evidence TEXT,
                location VARCHAR(255),
                report_count INT DEFAULT 1,
                reported_by JSON,
                status ENUM('active', 'resolved', 'false_positive') DEFAULT 'active',
                verified BOOLEAN DEFAULT FALSE,
                verified_by VARCHAR(64),
                verified_at DATETIME NULL,
                source VARCHAR(100),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_type_value (type, value),
                INDEX idx_status (status),
                INDEX idx_severity (severity),
                INDEX idx_user (user_id),
                INDEX idx_created (created_at)
            )
        `);
        
        // Threat Alerts Table
        await getPool().query(`
            CREATE TABLE IF NOT EXISTS threat_alerts (
                id VARCHAR(255) PRIMARY KEY,
                threat_id VARCHAR(255) NOT NULL,
                user_id VARCHAR(64),
                type VARCHAR(50) DEFAULT 'threat_alert',
                title VARCHAR(500) NOT NULL,
                message TEXT,
                threat_data JSON,
                is_read BOOLEAN DEFAULT FALSE,
                read_at DATETIME NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_user_read (user_id, is_read),
                INDEX idx_threat (threat_id),
                FOREIGN KEY (threat_id) REFERENCES cyber_threats(id) ON DELETE CASCADE
            )
        `);
        
        cyberThreatTablesReady = true;
        LOG.success('[Database] Cyber threat tables ensured');
    } catch (error) {
        LOG.error('[Database] Error ensuring cyber threat tables:', error);
    }
};

/**
 * Ensure vendor feature/visibility columns exist in MySQL vendors table
 * (needed for cyber, trading, trust-score, etc. feature flags)
 */
let vendorFeatureColumnsReady = false;
const ensureVendorFeatureColumns = async () => {
    if (!getPool() || vendorFeatureColumnsReady) return;
    try {
        await getPool().query(`
            ALTER TABLE vendors
                ADD COLUMN IF NOT EXISTS features_queue TINYINT(1) DEFAULT 0,
                ADD COLUMN IF NOT EXISTS features_matchmaking TINYINT(1) DEFAULT 0,
                ADD COLUMN IF NOT EXISTS features_cyber TINYINT(1) DEFAULT 0,
                ADD COLUMN IF NOT EXISTS features_trade TINYINT(1) DEFAULT 0,
                ADD COLUMN IF NOT EXISTS features_offer TINYINT(1) DEFAULT 0,
                ADD COLUMN IF NOT EXISTS features_qless TINYINT(1) DEFAULT 0,
                ADD COLUMN IF NOT EXISTS features_fleet TINYINT(1) DEFAULT 0,
                ADD COLUMN IF NOT EXISTS features_realestate TINYINT(1) DEFAULT 0,
                ADD COLUMN IF NOT EXISTS features_trust_score TINYINT(1) DEFAULT 0,
                ADD COLUMN IF NOT EXISTS features_news TINYINT(1) DEFAULT 0,
                ADD COLUMN IF NOT EXISTS visibility_top_rated TINYINT(1) DEFAULT 0,
                ADD COLUMN IF NOT EXISTS visibility_list TINYINT(1) DEFAULT 1,
                ADD COLUMN IF NOT EXISTS visibility_feed TINYINT(1) DEFAULT 0
        `);
        vendorFeatureColumnsReady = true;
        LOG.success('[Database] Vendor feature/visibility columns ensured');
    } catch (err) {
        LOG.warning('[Database] Error ensuring vendor feature columns (non-fatal):', err.message || err);
    }
};

let userVendorMappingTableReady = false;
const ensureUserVendorMappingTable = async () => {
    if (!getPool() || userVendorMappingTableReady) return;
    try {
        await getPool().query(`
            CREATE TABLE IF NOT EXISTS user_vendor_mappings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id VARCHAR(64) NOT NULL,
                vendor_id VARCHAR(64) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_user_vendor (user_id, vendor_id),
                INDEX idx_user (user_id),
                INDEX idx_vendor (vendor_id)
            )
        `);
        userVendorMappingTableReady = true;
        LOG.success('[Database] user_vendor_mappings table ensured');
    } catch (err) {
        LOG.warning('[Database] Error ensuring user_vendor_mappings table:', err.message || err);
    }
};

let usersUpdatedAtReady = false;
const ensureUsersUpdatedAtColumn = async () => {
    if (!getPool() || usersUpdatedAtReady) return;
    try {
        await getPool().query(`
            ALTER TABLE users
            ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        `);
        usersUpdatedAtReady = true;
        LOG.success('[Database] users.updated_at column ensured');
    } catch (err) {
        if (/Duplicate column/i.test(err.message || '')) {
            usersUpdatedAtReady = true;
        } else {
            LOG.warning('[Database] users.updated_at column (non-fatal):', err.message || err);
        }
    }
};

const stampUserUpdatedAt = async (userId) => {
    const now = new Date();
    const user = inMemoryDb.users.find(u => u.id === userId);
    if (user) user.updated_at = now;
    if (!getPool()) return;
    try {
        await ensureUsersUpdatedAtColumn();
        await getPool().query('UPDATE users SET updated_at = NOW() WHERE id = ?', [userId]);
    } catch (err) {
        LOG.warning('[Database] stamp updated_at failed:', err.message || err);
    }
};

let seedUsersVendorsDone = false;
let seedUsersVendorsPromise = null;

/**
 * Seed missing users/vendors/mappings into MySQL once per process.
 * Existing MySQL rows are left unchanged (no ON DUPLICATE KEY UPDATE from seed).
 */
const ensureAllUsersAndVendors = async () => {
    if (seedUsersVendorsDone) return;
    if (seedUsersVendorsPromise) return seedUsersVendorsPromise;

    seedUsersVendorsPromise = (async () => {
        const pool = (await ensureWritePool()) || getPool();
        if (!pool) {
            seedUsersVendorsPromise = null;
            return;
        }

        try {
            await ensureVendorFeatureColumns();
            await ensureUserVendorMappingTable();
            await ensureUsersUpdatedAtColumn();

            const [existingUsers] = await pool.query('SELECT id FROM users');
            const haveUsers = new Set((existingUsers || []).map((r) => String(r.id)));
            const missingUsers = (inMemoryDb.users || []).filter((u) => !haveUsers.has(String(u.id)));

            if (missingUsers.length === 0) {
                LOG.info(`[All Users Sync] Skip inserts: ${haveUsers.size} users already in MySQL`);
            } else {
                LOG.info(`[All Users Sync] Inserting ${missingUsers.length} missing users (${haveUsers.size} already present)`);
            }

            let created = 0;
            if (missingUsers.length) {
                created = await insertMany(
                    pool,
                    'users',
                    ['id', 'name', 'email', 'mobile', 'role', 'location_name', 'created_at'],
                    missingUsers.map((user) => ({
                        id: user.id,
                        name: user.name,
                        email: user.email,
                        mobile: user.mobile,
                        role: user.role,
                        location_name: user.location_name,
                        created_at: user.created_at || new Date(),
                    })),
                    { ignore: true }
                );
            }
            if (created > 0) {
                LOG.success(`[All Users Sync] Completed: ${created} inserted`);
            }

            const [existingVendors] = await pool.query('SELECT id FROM vendors');
            const haveVendors = new Set((existingVendors || []).map((r) => String(r.id)));
            const missingVendors = (inMemoryDb.vendors || []).filter((v) => !haveVendors.has(String(v.id)));

            if (missingVendors.length === 0) {
                LOG.info(`[All Vendors Sync] Skip inserts: ${haveVendors.size} vendors already in MySQL`);
            } else {
                LOG.info(`[All Vendors Sync] Inserting ${missingVendors.length} missing vendors (${haveVendors.size} already present)`);
            }

            let vendorsCreated = 0;
            if (missingVendors.length) {
                vendorsCreated = await insertMany(
                    pool,
                    'vendors',
                    [
                        'id', 'owner_id', 'shop_name', 'category', 'is_active', 'is_promoted',
                        'latitude', 'longitude', 'google_link', 'instagram_handle', 'facebook_link',
                        'features_products', 'features_payments', 'features_appointments', 'features_queue',
                        'features_matchmaking', 'features_cyber', 'features_trade', 'features_offer', 'features_qless',
                        'features_fleet', 'features_realestate', 'visibility_top_rated', 'visibility_list', 'visibility_feed', 'location_name',
                    ],
                    missingVendors.map((vendor) => ({
                        id: vendor.id,
                        owner_id: vendor.owner_id,
                        shop_name: vendor.shop_name,
                        category: vendor.category,
                        is_active: vendor.is_active ? 1 : 0,
                        is_promoted: vendor.is_promoted ? 1 : 0,
                        latitude: vendor.latitude || 0,
                        longitude: vendor.longitude || 0,
                        google_link: vendor.google_link || '',
                        instagram_handle: vendor.instagram_handle || '',
                        facebook_link: vendor.facebook_link || '',
                        features_products: vendor.features_products !== false ? 1 : 0,
                        features_payments: vendor.features_payments !== false ? 1 : 0,
                        features_appointments: vendor.features_appointments !== false ? 1 : 0,
                        features_queue: vendor.features_queue !== false ? 1 : 0,
                        features_matchmaking: vendor.features_matchmaking ? 1 : 0,
                        features_cyber: vendor.features_cyber ? 1 : 0,
                        features_trade: vendor.features_trade ? 1 : 0,
                        features_offer: vendor.features_offer ? 1 : 0,
                        features_qless: vendor.features_qless ? 1 : 0,
                        features_fleet: vendor.features_fleet ? 1 : 0,
                        features_realestate: vendor.features_realestate ? 1 : 0,
                        visibility_top_rated: vendor.visibility_top_rated ? 1 : 0,
                        visibility_list: vendor.visibility_list !== false ? 1 : 0,
                        visibility_feed: vendor.visibility_feed ? 1 : 0,
                        location_name: vendor.location_name || '',
                    })),
                    { ignore: true }
                );
            }
            if (vendorsCreated > 0) {
                LOG.success(`[All Vendors Sync] Completed: ${vendorsCreated} inserted`);
            }

            const mappings = inMemoryDb.user_vendor_mappings || [];
            const [existingMaps] = await pool.query('SELECT user_id, vendor_id FROM user_vendor_mappings');
            const haveMaps = new Set((existingMaps || []).map((r) => `${r.user_id}::${r.vendor_id}`));
            const missingMaps = mappings.filter((m) => !haveMaps.has(`${m.user_id}::${m.vendor_id}`));

            if (missingMaps.length === 0) {
                LOG.info(`[Mappings Sync] Skip inserts: ${haveMaps.size} mappings already in MySQL`);
            } else {
                LOG.info(`[Mappings Sync] Inserting ${missingMaps.length} missing mappings (${haveMaps.size} already present)`);
            }

            let mappingsCreated = 0;
            if (missingMaps.length) {
                mappingsCreated = await insertMany(
                    pool,
                    'user_vendor_mappings',
                    ['user_id', 'vendor_id', 'created_at'],
                    missingMaps.map((mapping) => ({
                        user_id: mapping.user_id,
                        vendor_id: mapping.vendor_id,
                        created_at: mapping.created_at || new Date(),
                    })),
                    { ignore: true }
                );
            }
            if (mappingsCreated > 0) {
                LOG.success(`[Mappings Sync] Completed: ${mappingsCreated} mappings inserted`);
            }

            try {
                const [mysqlUsers] = await pool.query('SELECT id, name, email, mobile, role, location_name, created_at FROM users');
                const userIds = new Set(inMemoryDb.users.map((u) => String(u.id)));
                (mysqlUsers || []).forEach((u) => {
                    if (!userIds.has(String(u.id))) {
                        inMemoryDb.users.push(u);
                        userIds.add(String(u.id));
                    }
                });
                const [mysqlVendors] = await pool.query('SELECT * FROM vendors');
                const vendorIds = new Set(inMemoryDb.vendors.map((v) => String(v.id)));
                (mysqlVendors || []).forEach((v) => {
                    if (!vendorIds.has(String(v.id))) {
                        inMemoryDb.vendors.push(v);
                        vendorIds.add(String(v.id));
                    }
                });
                LOG.info(`[Hydrate] memory users=${inMemoryDb.users.length} vendors=${inMemoryDb.vendors.length}`);
            } catch (hydrateErr) {
                LOG.warning(`[Hydrate] skipped: ${hydrateErr.message}`);
            }

            seedUsersVendorsDone = true;
            LOG.success('[Database Init] Seed check complete (missing rows only; existing MySQL data kept)');
        } catch (error) {
            seedUsersVendorsPromise = null;
            LOG.error('[All Users/Vendors Sync] Error syncing all data:', error.message);
        }
    })();

    return seedUsersVendorsPromise;
};

/**
 * Ensure cyber users and vendor exist in MySQL
 * Syncs cyber users and vendor from in-memory DB to MySQL
 */
const ensureCyberUsersAndVendor = async () => {
    if (!getPool()) return;
    
    try {
        // Make sure vendors table has required feature flags/visibility columns
        await ensureVendorFeatureColumns();

        // Ensure cyber users exist in MySQL
        const cyberUsers = [
            { id: 'usr_cyber1', name: 'Cyber User 1', email: 'cyber1@test.com', mobile: '8000000011', role: 'user', location_name: 'Mumbai' },
            { id: 'usr_cybervendor1', name: 'Cyber Vendor 1', email: 'cybervendor1@test.com', mobile: '8000000012', role: 'vendor', location_name: 'Mumbai' }
        ];
        
        for (const user of cyberUsers) {
            const [existing] = await getPool().query('SELECT id FROM users WHERE id = ?', [user.id]);
            if (existing.length === 0) {
                await getPool().query(
                    `INSERT IGNORE INTO users (id, name, email, mobile, role, location_name, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                    [user.id, user.name, user.email, user.mobile, user.role, user.location_name]
                );
                LOG.success(`[Cyber Sync] Created user: ${user.id} (${user.name})`);
            }
        }
        
        // Ensure cyber vendor exists in MySQL
        const cyberVendor = {
            id: 'v_cyber1',
            owner_id: 'usr_cybervendor1',
            shop_name: 'Cyber Shop 1',
            category: 'Cyber',
            is_active: true,
            is_promoted: false,
            latitude: 0,
            longitude: 0,
            google_link: '',
            instagram_handle: '',
            facebook_link: '',
            features_products: false,
            features_payments: false,
            features_appointments: false,
            features_queue: false,
            features_matchmaking: false,
            features_cyber: true,
            visibility_top_rated: false,
            visibility_list: true,
            visibility_feed: false
        };
        
        const [existingVendor] = await getPool().query('SELECT id FROM vendors WHERE id = ?', [cyberVendor.id]);
        if (existingVendor.length === 0) {
            await getPool().query(
                `INSERT INTO vendors (
                    id, owner_id, shop_name, category, is_active, is_promoted, 
                    latitude, longitude, google_link, instagram_handle, facebook_link,
                    features_products, features_payments, features_appointments, features_queue,
                    features_matchmaking, features_cyber, visibility_top_rated, visibility_list, visibility_feed
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    cyberVendor.id, cyberVendor.owner_id, cyberVendor.shop_name, cyberVendor.category,
                    cyberVendor.is_active, cyberVendor.is_promoted, cyberVendor.latitude, cyberVendor.longitude,
                    cyberVendor.google_link, cyberVendor.instagram_handle, cyberVendor.facebook_link,
                    cyberVendor.features_products, cyberVendor.features_payments, cyberVendor.features_appointments,
                    cyberVendor.features_queue, cyberVendor.features_matchmaking, cyberVendor.features_cyber,
                    cyberVendor.visibility_top_rated, cyberVendor.visibility_list, cyberVendor.visibility_feed
                ]
            );
            LOG.success(`[Cyber Sync] Created vendor: ${cyberVendor.id} (${cyberVendor.shop_name})`);
        }
        
        LOG.success('[Cyber Sync] Cyber users and vendor synced to MySQL');
    } catch (error) {
        LOG.error('[Cyber Sync] Error syncing cyber users and vendor:', error.message);
    }
};

let fleetTablesReady = false;
const ensureFleetTables = async () => {
    if (!getPool() || fleetTablesReady) return;
    try {
        // Fleet Queues
        await getPool().query(`
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
        await getPool().query(`
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
        await getPool().query(`
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
        await getPool().query(`
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
        await getPool().query(`
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
        await getPool().query(`
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
        
        try {
            const { applyMumbaiPuneFleetSeed } = require('./database/features/fleetRouteSeed');
            await applyMumbaiPuneFleetSeed(getPool());
            LOG.success('Fleet demo route applied: Mumbai → Pune');
        } catch (seedErr) {
            LOG.warning('Fleet Mumbai–Pune seed skipped:', seedErr.message);
        }

        fleetTablesReady = true;
        LOG.success("Fleet tables created successfully");
    } catch (err) {
        LOG.error("Failed to create fleet tables", err.message);
    }
};

const db = {
    getType: () => DB_TYPE,
    ...featureApi(require('./database/features/appointments')),
    ...featureApi(require('./database/features/queue')),
    ...featureApi(require('./database/features/shopping')),
    ...featureApi(require('./database/features/matchmaking')),
    ...featureApi(require('./database/features/chat')),

    // Users / vendors / settings stay here; feature CRUD is in backend/database/features/
    getUsers: async () => {
        const mapUser = (u, index = 0) => ({
            id: u.id,
            name: u.name || 'Unknown',
            email: u.email || null,
            mobile: u.mobile || null,
            role: u.role || 'user',
            location_name: u.location_name || null,
            created_at: u.created_at || null,
            updated_at: u.updated_at || u.created_at || new Date(Date.now() - index * 3600000),
        });
        try {
            if (getPool()) {
                await ensureUsersUpdatedAtColumn();
                const [rows] = await getPool().query(
                    'SELECT id, name, email, mobile, role, location_name, created_at, updated_at FROM users ORDER BY COALESCE(updated_at, created_at) DESC, id DESC'
                );
                if (rows) {
                    LOG.info(`[getUsers] Returning ${rows.length} users from MySQL`);
                    return rows.map(mapUser);
                }
            }
        } catch (err) {
            LOG.error("MySQL getUsers failed, falling back to local", err.message);
        }
        const localUsers = [...inMemoryDb.users]
            .map((u, i) => mapUser(u, i))
            .sort((a, b) => {
                const ta = new Date(a.updated_at || a.created_at || 0).getTime();
                const tb = new Date(b.updated_at || b.created_at || 0).getTime();
                return tb - ta;
            });
        LOG.info(`[getUsers] Returning ${localUsers.length} users from local in-memory DB`);
        return localUsers;
    },

    getUserByMobile: async (mobile) => {
        const cleanMobile = mobile.toString().replace(/\D/g, '').slice(-10);
        try {
            if (getPool()) {
                const [rows] = await getPool().query('SELECT * FROM users WHERE mobile = ? OR mobile = ?', [mobile, cleanMobile]);
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
            if (getPool()) {
                // Case-insensitive email lookup
                const [rows] = await getPool().query(
                    'SELECT * FROM users WHERE email = ? OR LOWER(email) = ? LIMIT 1',
                    [email.trim(), normalizedEmail]
                );
                if (rows && rows.length > 0) return rows[0];
            }
        } catch (err) {
            LOG.error(`MySQL getUserByEmail failed for ${email}, falling back to local`, err.message);
        }
        return inMemoryDb.users.find(u => u.email && u.email.toLowerCase() === normalizedEmail);
    },

    getUserById: async (id) => {
        try {
            if (getPool()) {
                const [rows] = await getPool().query('SELECT * FROM users WHERE id = ?', [id]);
                if (rows && rows.length > 0) return rows[0];
            }
        } catch (err) {
            LOG.error(`MySQL getUserById failed for ${id}, falling back to local`, err.message);
        }
        return inMemoryDb.users.find(u => u.id === id);
    },

    addUser: async (user) => {
        if (!user?.id) {
            throw new Error('User id is required');
        }
        const exists = inMemoryDb.users.some((u) => u.id === user.id);
        if (!exists) {
            inMemoryDb.users.push(user);
        }

        const writeMysql = async (pool) => {
            await pool.query(
                `INSERT INTO users (id, name, email, mobile, role, location_name, loyalty_points, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                   name = VALUES(name),
                   email = VALUES(email),
                   mobile = VALUES(mobile),
                   role = VALUES(role),
                   location_name = VALUES(location_name)`,
                [
                    user.id,
                    user.name || '',
                    user.email || null,
                    user.mobile || null,
                    user.role || 'user',
                    user.location_name || null,
                    user.loyalty_points || 0,
                    user.created_at || new Date()
                ]
            );
        };

        try {
            if (DB_TYPE === 'mysql') {
                const pool = await ensureWritePool();
                if (pool) {
                    await writeMysql(pool);
                    return user;
                }
            }
        } catch (err) {
            LOG.error("MySQL addUser failed, falling back to local", err.message);
        }

        try {
            const { mirrorQuery } = require('./database/mysqlMirror');
            await mirrorQuery(
                `INSERT INTO users (id, name, email, mobile, role, location_name, loyalty_points, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                   name = VALUES(name),
                   email = VALUES(email),
                   mobile = VALUES(mobile),
                   role = VALUES(role),
                   location_name = VALUES(location_name)`,
                [
                    user.id,
                    user.name || '',
                    user.email || null,
                    user.mobile || null,
                    user.role || 'user',
                    user.location_name || null,
                    user.loyalty_points || 0,
                    user.created_at || new Date()
                ]
            );
        } catch (err) {
            LOG.warning(`[addUser] MySQL mirror skip: ${err.message}`);
        }

        return user;
    },

    updateUserProfile: async (userId, data) => {
        // Clean data: remove undefined/null but allow empty strings if intended
        const cleanData = {};
        if (data.name !== undefined) cleanData.name = data.name;
        if (data.email !== undefined) cleanData.email = data.email;
        if (data.mobile !== undefined) cleanData.mobile = data.mobile;
        if (data.location_name !== undefined) cleanData.location_name = data.location_name;

        try {
            if (getPool()) {
                await ensureUsersUpdatedAtColumn();
                await getPool().query('UPDATE users SET ?, updated_at = NOW() WHERE id = ?', [cleanData, userId]);
                const user = inMemoryDb.users.find(u => u.id === userId);
                if (user) Object.assign(user, cleanData, { updated_at: new Date() });
                return true;
            }
        } catch (err) {
            LOG.error(`MySQL updateUserProfile failed for ${userId}, falling back to local`, err.message);
        }
        
        const user = inMemoryDb.users.find(u => u.id === userId);
        if (user) {
            Object.assign(user, cleanData, { updated_at: new Date() });
        }
        return !!user;
    },

    updateUserRole: async (userId, role) => {
        LOG.info(`Updating role for user ${userId} to ${role}`);
        try {
            if (getPool()) {
                await ensureUsersUpdatedAtColumn();
                await getPool().query('UPDATE users SET role = ?, updated_at = NOW() WHERE id = ?', [role, userId]);
                const user = inMemoryDb.users.find(u => u.id === userId);
                if (user) {
                    user.role = role;
                    user.updated_at = new Date();
                }
                return true;
            }
        } catch (err) {
            LOG.error(`MySQL updateUserRole failed for ${userId}, falling back to local`, err.message);
        }
        const user = inMemoryDb.users.find(u => u.id === userId);
        if (user) {
            user.role = role;
            user.updated_at = new Date();
        }
        return !!user;
    },

    deleteUser: async (userId) => {
        inMemoryDb.user_vendor_mappings = (inMemoryDb.user_vendor_mappings || []).filter(m => m.user_id !== userId);
        inMemoryDb.users = inMemoryDb.users.filter(u => u.id !== userId);
        if (DB_TYPE === 'mysql') {
            try {
                if (getPool()) {
                    await getPool().query('DELETE FROM user_vendor_mappings WHERE user_id = ?', [userId]);
                    await getPool().query('DELETE FROM users WHERE id = ?', [userId]);
                }
            } catch (err) {
                LOG.error(`MySQL deleteUser failed for ${userId}, in-memory write kept`, err.message);
            }
        }
        return true;
    },

    getUserVendorMappings: async (userId = null) => {
        // Source of truth is in-memory. MySQL is used only when DB_TYPE=mysql.
        if (DB_TYPE === 'mysql') {
            try {
                if (getPool()) {
                    await ensureUserVendorMappingTable();
                    const query = userId
                        ? 'SELECT * FROM user_vendor_mappings WHERE user_id = ? ORDER BY id ASC'
                        : 'SELECT * FROM user_vendor_mappings ORDER BY id ASC';
                    const params = userId ? [userId] : [];
                    const [rows] = await getPool().query(query, params);
                    if (rows) return rows;
                }
            } catch (err) {
                LOG.error('MySQL getUserVendorMappings failed, falling back to local', err.message);
            }
        }
        const mappings = inMemoryDb.user_vendor_mappings || [];
        return userId ? mappings.filter(m => m.user_id === userId) : mappings;
    },

    getMappedVendorIdsForUser: async (userId) => {
        const mappings = await db.getUserVendorMappings(userId);
        return mappings.map(m => m.vendor_id);
    },

    addUserVendorMapping: async (userId, vendorId) => {
        const existing = (inMemoryDb.user_vendor_mappings || []).find(
            m => m.user_id === userId && m.vendor_id === vendorId
        );
        if (existing) return existing;

        const mapping = {
            id: Date.now(),
            user_id: userId,
            vendor_id: vendorId,
            created_at: new Date()
        };

        inMemoryDb.user_vendor_mappings = inMemoryDb.user_vendor_mappings || [];
        inMemoryDb.user_vendor_mappings.push(mapping);

        if (DB_TYPE === 'mysql') {
            try {
                if (getPool()) {
                    await ensureUserVendorMappingTable();
                    await getPool().query(
                        'INSERT INTO user_vendor_mappings (user_id, vendor_id, created_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE user_id = user_id',
                        [userId, vendorId]
                    );
                }
            } catch (err) {
                if (/duplicate/i.test(String(err.message || ''))) {
                    LOG.warning('MySQL user_vendor_mapping already exists, in-memory write kept');
                } else {
                    LOG.error('MySQL addUserVendorMapping failed, in-memory write kept', err.message);
                }
            }
        }
        await stampUserUpdatedAt(userId);
        return mapping;
    },

    removeUserVendorMapping: async (userId, vendorId) => {
        inMemoryDb.user_vendor_mappings = (inMemoryDb.user_vendor_mappings || []).filter(
            m => !(m.user_id === userId && m.vendor_id === vendorId)
        );
        if (DB_TYPE === 'mysql') {
            try {
                if (getPool()) {
                    await ensureUserVendorMappingTable();
                    await getPool().query(
                        'DELETE FROM user_vendor_mappings WHERE user_id = ? AND vendor_id = ?',
                        [userId, vendorId]
                    );
                }
            } catch (err) {
                LOG.error('MySQL removeUserVendorMapping failed, in-memory write kept', err.message);
            }
        }
        await stampUserUpdatedAt(userId);
        return true;
    },

    isFleetVendorRow: (vendor) => {
        if (!vendor) return false;
        return vendor.features_fleet === true || vendor.features_fleet === 1 || vendor.features_fleet === '1';
    },

    getFleetRoster: async (vendorId) => {
        if (!vendorId) return [];
        const vendor = await db.getVendorById(vendorId);
        const mappings = await db.getUserVendorMappings();
        const mappedIds = mappings.filter((m) => String(m.vendor_id) === String(vendorId)).map((m) => String(m.user_id));
        const users = await db.getUsers();
        const ownerId = vendor?.owner_id ? String(vendor.owner_id) : '';
        return users.filter((u) => {
            if (!mappedIds.includes(String(u.id))) return false;
            if (ownerId && String(u.id) === ownerId) return false;
            const role = String(u.role || '').toLowerCase();
            if (role === 'vendor' || role === 'super_admin') return false;
            return true;
        }).map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            mobile: u.mobile,
            role: u.role || 'user',
            location_name: u.location_name,
            vendor_id: vendorId,
        }));
    },

    getFleetOverview: async () => {
        const result = await db.getVendors(false, 1, 1000, 'newest', '', true);
        const vendorList = Array.isArray(result) ? result : (result?.vendors || []);
        const fleetVendors = vendorList.filter((v) => db.isFleetVendorRow(v));
        const vendors = [];
        let driverCount = 0;
        for (const vendor of fleetVendors) {
            const roster = await db.getFleetRoster(vendor.id);
            driverCount += roster.length;
            vendors.push({
                id: vendor.id,
                shop_name: vendor.shop_name,
                location_name: vendor.location_name || vendor.city || '',
                category: vendor.category,
                owner_id: vendor.owner_id,
                driver_count: roster.length,
                is_active: vendor.is_active !== false,
            });
        }
        return {
            vendor_count: fleetVendors.length,
            driver_count: driverCount,
            vendors,
        };
    },

    getUsersWithVendorMappings: async () => {
        const users = await db.getUsers();
        const mappings = await db.getUserVendorMappings();
        const vendors = await db.getVendors(false, 1, 1000, 'newest', '', true);
        const vendorList = Array.isArray(vendors) ? vendors : (vendors.vendors || vendors.rows || []);

        const vendorMap = {};
        vendorList.forEach(v => { vendorMap[v.id] = v; });

        const usersWithMappings = users.map(user => {
            const mappedIds = mappings.filter(m => m.user_id === user.id).map(m => m.vendor_id);
            return {
                ...user,
                mapped_vendors: mappedIds
                    .map(id => vendorMap[id])
                    .filter(Boolean)
                    .map(v => ({ id: v.id, shop_name: v.shop_name, category: v.category }))
            };
        });

        return {
            users: usersWithMappings,
            vendors: vendorList.map(v => ({ id: v.id, shop_name: v.shop_name, category: v.category, owner_id: v.owner_id }))
        };
    },

    getMappedVendorsForUser: async (userId) => {
        const mappedIds = await db.getMappedVendorIdsForUser(userId);
        const relatedIds = new Set(mappedIds.map(String));

        // Include shops the user already booked / queued with so they can see products & buy
        try {
            const [appts, queues] = await Promise.all([
                db.getAppointmentsByUser(userId).catch(() => []),
                typeof db.getUserHistory === 'function'
                    ? db.getUserHistory(userId).catch(() => [])
                    : Promise.resolve([]),
            ]);
            (appts || []).forEach((a) => {
                if (a?.vendor_id) relatedIds.add(String(a.vendor_id));
            });
            (queues || []).forEach((q) => {
                if (q?.vendor_id && String(q.status || '').toLowerCase() !== 'cancelled') {
                    relatedIds.add(String(q.vendor_id));
                }
            });
        } catch (e) {
            LOG.warning('[getMappedVendorsForUser] related shops lookup failed:', e.message);
        }

        // Persist missing mappings so Home / shopping stay linked
        for (const vendorId of relatedIds) {
            if (!mappedIds.map(String).includes(String(vendorId))) {
                try {
                    await db.addUserVendorMapping(userId, vendorId);
                } catch (e) { /* non-fatal */ }
            }
        }

        const idList = [...relatedIds];
        if (!idList.length) {
            return { vendors: [], hasMappings: false };
        }

        const vendorsResult = await db.getVendors(false, 1, 1000, 'newest', '', true);
        const allVendors = Array.isArray(vendorsResult) ? vendorsResult : (vendorsResult.vendors || []);
        const mappedSet = new Set(idList);
        const vendors = allVendors.filter(
            (v) => mappedSet.has(String(v.id)) && v.is_active !== false && v.visibility_list !== false
        );

        return { vendors, hasMappings: true };
    },

    // OTPs
    addOtp: async (otpData) => {
        const localOtp = {
            ...otpData,
            mobile: otpData.mobile.toString().replace(/\D/g, '').slice(-10)
        };
        try {
            if (getPool()) {
                // Use formatted string to prevent timezone shifts by the driver
                const expiresAt = toMysqlDateTime(otpData.expires_at);
                const createdAt = toMysqlDateTime(otpData.created_at || new Date());
                
                await getPool().query(
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
            if (getPool()) {
                // Fetch latest OTP record regardless of expiry to debug/validate
                const [rows] = await getPool().query('SELECT * FROM otps WHERE mobile = ? AND otp = ? ORDER BY created_at DESC LIMIT 1', [cleanMobile, cleanOtp]);
                
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
                    const [anyRows] = await getPool().query('SELECT otp, created_at FROM otps WHERE mobile = ? ORDER BY created_at DESC LIMIT 1', [cleanMobile]);
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
            if (getPool()) {
                const [rows] = await getPool().query(
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
            if (getPool()) {
                await getPool().query('DELETE FROM otps WHERE mobile = ?', [cleanMobile]);
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
    getVendors: async (activeOnly = true, page = 1, limit = 10, sortBy = 'newest', searchQuery = '', includeTradeOffer = false, feature = '') => {
        const featureKey = SERVICE_FEATURES.includes(String(feature || '').toLowerCase())
            ? String(feature).toLowerCase()
            : '';
        try {
            if (DB_TYPE === 'mysql' && getPool()) {
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
                const featureOnly = featureKey ? `AND IFNULL(v.features_${featureKey}, 0) = 1` : '';
                const excludeServiceVendors = (!featureKey && !includeTradeOffer)
                    ? 'AND (v.features_trade IS NULL OR v.features_trade = 0 OR v.features_trade = false) AND (v.features_offer IS NULL OR v.features_offer = 0 OR v.features_offer = false) AND (v.features_qless IS NULL OR v.features_qless = 0 OR v.features_qless = false) AND (v.features_fleet IS NULL OR v.features_fleet = 0 OR v.features_fleet = false) AND (v.features_realestate IS NULL OR v.features_realestate = 0 OR v.features_realestate = false) AND (v.features_cyber IS NULL OR v.features_cyber = 0 OR v.features_cyber = false) AND (v.features_trust_score IS NULL OR v.features_trust_score = 0 OR v.features_trust_score = false)'
                    : '';
                const whereParts = [baseWhere];
                if (featureOnly) whereParts.push(featureOnly);
                if (excludeServiceVendors) whereParts.push(excludeServiceVendors);
                if (searchClause) whereParts.push(searchClause);
                const whereClause = 'WHERE ' + whereParts.join(' ');

                const query = `
                    SELECT v.*,
                    u.location_name AS owner_location,
                    COALESCE(q.wait_count, 0) AS q_count_raw,
                    COALESCE(a.open_count, 0) AS a_count_raw,
                    COALESCE(a.open_count, 0) AS appointments_open,
                    COALESCE(a.today_pending, 0) AS appointments_running,
                    COALESCE(a.today_pending, 0) AS today_pending_appointments,
                    COALESCE(a.today_completed, 0) AS today_completed_appointments,
                    COALESCE(a.total_count, 0) AS appointments_total,
                    COALESCE(pr.product_count, 0) AS product_count,
                    COALESCE(o.orders_count, 0) AS orders_count,
                    COALESCE(o.payments_done, 0) AS payments_done,
                    COALESCE(o.payments_amount, 0) AS payments_amount,
                    (COALESCE(a.today_completed, 0) + COALESCE(qd.today_done, 0) + COALESCE(o.today_orders, 0)) AS today_processed
                    FROM vendors v
                    LEFT JOIN users u ON u.id = v.owner_id
                    LEFT JOIN (
                        SELECT vendor_id, COUNT(*) AS wait_count
                        FROM queues WHERE status = 'waiting'
                        GROUP BY vendor_id
                    ) q ON q.vendor_id = v.id
                    LEFT JOIN (
                        SELECT vendor_id,
                            SUM(status IN ('confirmed', 'pending')) AS open_count,
                            SUM(date = ? AND status IN ('pending', 'confirmed')) AS today_pending,
                            SUM(date = ? AND status = 'completed') AS today_completed,
                            COUNT(*) AS total_count
                        FROM appointments
                        GROUP BY vendor_id
                    ) a ON a.vendor_id = v.id
                    LEFT JOIN (
                        SELECT vendor_id, COUNT(*) AS product_count
                        FROM products
                        GROUP BY vendor_id
                    ) pr ON pr.vendor_id = v.id
                    LEFT JOIN (
                        SELECT vendor_id,
                            COUNT(*) AS orders_count,
                            SUM(
                                LOWER(COALESCE(status,'')) IN ('paid','completed','success','done')
                                OR LOWER(COALESCE(fulfillment_status,'')) IN ('delivered','completed','paid')
                                OR (payment_ref IS NOT NULL AND payment_ref <> '')
                            ) AS payments_done,
                            COALESCE(SUM(CASE WHEN
                                LOWER(COALESCE(status,'')) IN ('paid','completed','success','done')
                                OR LOWER(COALESCE(fulfillment_status,'')) IN ('delivered','completed','paid')
                                OR (payment_ref IS NOT NULL AND payment_ref <> '')
                                OR total_amount > 0
                            THEN total_amount ELSE 0 END), 0) AS payments_amount,
                            SUM(created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)) AS today_orders
                        FROM orders
                        GROUP BY vendor_id
                    ) o ON o.vendor_id = v.id
                    LEFT JOIN (
                        SELECT vendor_id, COUNT(*) AS today_done
                        FROM queues
                        WHERE status IN ('done', 'completed') AND joined_at >= ? AND joined_at < DATE_ADD(?, INTERVAL 1 DAY)
                        GROUP BY vendor_id
                    ) qd ON qd.vendor_id = v.id
                    ${whereClause}
                    ORDER BY ${orderBy.replace('appointmentCount', '(COALESCE(q.wait_count,0) + COALESCE(a.open_count,0))').replace('live_queue_count', 'COALESCE(q.wait_count,0)')}
                    LIMIT ? OFFSET ?
                `;

                LOG.info(`[getVendors] Query: feature=${featureKey || 'none'}, includeTradeOffer=${includeTradeOffer}, activeOnly=${activeOnly}`);
                params.push(todayStr, todayStr, todayStr, todayStr, todayStr, todayStr, Number(limit), Number(offset));
                const [rawRows] = await getPool().query(query, params);
                
                // Add calculated fields to match previous schema exactly
                const rows = rawRows.map(row => {
                    const q_count = Number(row.q_count_raw || 0);
                    const a_count = Number(row.a_count_raw || 0);
                    return {
                        ...row,
                        location_name: row.location_name || row.owner_location || '',
                        appointmentCount: q_count + a_count,
                        live_queue_count: q_count,
                        appointments_open: Number(row.appointments_open || a_count || 0),
                        appointments_running: Number(row.appointments_running || row.today_pending_appointments || 0),
                        appointments_total: Number(row.appointments_total || 0),
                        today_pending_appointments: Number(row.today_pending_appointments || 0),
                        today_completed_appointments: Number(row.today_completed_appointments || 0),
                        product_count: Number(row.product_count || 0),
                        orders_count: Number(row.orders_count || 0),
                        payments_done: Number(row.payments_done || 0),
                        payments_amount: Number(row.payments_amount || 0),
                        today_processed: Number(row.today_processed || 0),
                    };
                });
                LOG.info(`[getVendors] MySQL returned ${rows.length} vendors`);
                
                // Debug: Log service vendors if any
                if (includeTradeOffer) {
                    const offerVendors = rows.filter(v => v.features_offer === 1 || v.features_offer === true);
                    const tradeVendors = rows.filter(v => v.features_trade === 1 || v.features_trade === true);
                    const qlessVendors = rows.filter(v => v.features_qless === 1 || v.features_qless === true);
                    const fleetVendors = rows.filter(v => v.features_fleet === 1 || v.features_fleet === true);
                    const realestateVendors = rows.filter(v => v.features_realestate === 1 || v.features_realestate === true);
                    const cyberVendors = rows.filter(v => v.features_cyber === 1 || v.features_cyber === true);
                    const trustScoreVendors = rows.filter(v => v.features_trust_score === 1 || v.features_trust_score === true);
                    LOG.info(`[getVendors] MySQL: Found ${offerVendors.length} offer, ${tradeVendors.length} trade, ${qlessVendors.length} qless, ${fleetVendors.length} fleet, ${realestateVendors.length} realestate, ${cyberVendors.length} cyber, ${trustScoreVendors.length} trust_score vendors`);
                    if (cyberVendors.length > 0) {
                        LOG.info(`[getVendors] MySQL Cyber vendors:`, cyberVendors.map(v => ({ id: v.id, shop_name: v.shop_name, features_cyber: v.features_cyber, owner_id: v.owner_id })));
                    }
                    if (offerVendors.length > 0) {
                        LOG.info(`[getVendors] MySQL Offer vendors:`, offerVendors.map(v => ({ id: v.id, shop_name: v.shop_name, features_offer: v.features_offer })));
                    }
                    if (trustScoreVendors.length > 0) {
                        LOG.info(`[getVendors] MySQL Trust Score vendors:`, trustScoreVendors.map(v => ({ id: v.id, shop_name: v.shop_name, features_trust_score: v.features_trust_score, owner_id: v.owner_id })));
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

        LOG.info(`[getVendors] Using in-memory fallback - feature: ${featureKey || 'none'}, includeTradeOffer: ${includeTradeOffer}`);
        let filtered = activeOnly ? inMemoryDb.vendors.filter(v => v.is_active) : inMemoryDb.vendors;
        LOG.info(`[getVendors] In-memory vendors before filtering: ${filtered.length}`);

        if (featureKey) {
            filtered = filtered.filter(v => isFeatureFlagOn(v, featureKey));
            LOG.info(`[getVendors] After feature=${featureKey} filter: ${filtered.length}`);
        } else if (!includeTradeOffer) {
            filtered = filtered.filter(v =>
                !SERVICE_FEATURES.some(f => isFeatureFlagOn(v, f))
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
            const cyberVendors = filtered.filter(v => v.features_cyber === true);
            const trustScoreVendors = filtered.filter(v => v.features_trust_score === true);
            LOG.info(`[getVendors] In-memory: Found ${offerVendors.length} offer, ${tradeVendors.length} trade, ${qlessVendors.length} qless, ${fleetVendors.length} fleet, ${realestateVendors.length} realestate, ${cyberVendors.length} cyber, ${trustScoreVendors.length} trust_score vendors`);
            if (trustScoreVendors.length > 0) {
                LOG.info(`[getVendors] In-memory trust score vendors:`, trustScoreVendors.map(v => ({ 
                    id: v?.id || 'NO_ID', 
                    shop_name: v?.shop_name || 'NO_NAME', 
                    owner_id: v?.owner_id || 'NO_OWNER',
                    features_trust_score: v?.features_trust_score 
                })));
            }
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
            const openAppts = inMemoryDb.appointments.filter(a => a.vendor_id === v.id && (a.status === 'confirmed' || a.status === 'pending'));
            const aCount = openAppts.length;
            const allAppts = inMemoryDb.appointments.filter(a => a.vendor_id === v.id);
            const todayPending = allAppts.filter(a => a.date === todayStr && ['pending', 'confirmed'].includes(a.status)).length;
            const todayCompleted = allAppts.filter(a => a.date === todayStr && a.status === 'completed').length;
            const products = (inMemoryDb.products || []).filter(p => String(p.vendor_id) === String(v.id));
            const orders = (inMemoryDb.orders || []).filter(o => String(o.vendor_id) === String(v.id));
            const isPaid = (o) => {
                const st = String(o.status || '').toLowerCase();
                const fs = String(o.fulfillment_status || '').toLowerCase();
                return ['paid', 'completed', 'success', 'done'].includes(st)
                    || ['delivered', 'completed', 'paid'].includes(fs)
                    || !!(o.payment_ref)
                    || Number(o.total_amount) > 0;
            };
            const paidOrders = orders.filter(isPaid);
            const todayQueueDone = inMemoryDb.queues.filter(q => {
                if (String(q.vendor_id) !== String(v.id)) return false;
                if (!['done', 'completed'].includes(String(q.status || '').toLowerCase())) return false;
                const d = q.joined_at ? new Date(q.joined_at).toISOString().slice(0, 10) : '';
                return d === todayStr;
            }).length;
            const todayOrders = orders.filter(o => {
                const d = o.created_at ? new Date(o.created_at).toISOString().slice(0, 10) : '';
                return d === todayStr;
            }).length;
            const owner = (inMemoryDb.users || []).find((u) => String(u.id) === String(v.owner_id));

            return { 
                ...v,
                location_name: v.location_name || owner?.location_name || '',
                owner_location: owner?.location_name || '',
                appointmentCount: qCount + aCount,
                live_queue_count: qCount,
                appointments_open: aCount,
                appointments_running: todayPending,
                appointments_total: allAppts.length,
                today_pending_appointments: todayPending,
                today_completed_appointments: todayCompleted,
                product_count: products.length,
                orders_count: orders.length,
                payments_done: paidOrders.length,
                payments_amount: paidOrders.reduce((s, o) => s + (Number(o.total_amount) || 0), 0),
                today_processed: todayCompleted + todayQueueDone + todayOrders,
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
            if (getPool()) {
                const [rows] = await getPool().query('SELECT * FROM vendors WHERE owner_id = ?', [ownerId]);
                if (rows && rows.length > 0) return rows[0];
            }
        } catch (err) {
            LOG.error(`MySQL getVendorByOwnerId failed for ${ownerId}, falling back to local`, err.message);
        }
        return inMemoryDb.vendors.find(v => String(v.owner_id) === String(ownerId));
    },

    getVendorById: async (vendorId) => {
        try {
            if (getPool()) {
                const [rows] = await getPool().query('SELECT * FROM vendors WHERE id = ?', [vendorId]);
                if (rows && rows.length > 0) return rows[0];
            }
        } catch (err) {
            LOG.error(`MySQL getVendorById failed for ${vendorId}, falling back to local`, err.message);
        }
        return inMemoryDb.vendors.find(v => v.id === vendorId);
    },

    updateVendor: async (vendorId, field, value) => {
        try {
            if (getPool()) {
                await getPool().query(`UPDATE vendors SET ${field} = ? WHERE id = ?`, [value, vendorId]);
                return true;
            }
        } catch (err) {
            LOG.error(`MySQL updateVendor failed for ${vendorId}, falling back to local`, err.message);
        }
        const vendor = inMemoryDb.vendors.find(v => v.id === vendorId);
        if (vendor) vendor[field] = value;
        return !!vendor;
    },

    getVendorCategories: async () => {
        const { uniqueSortedCategories, DEFAULT_VENDOR_CATEGORIES, titleCaseCategory } = require('./utils/vendorCategories');
        if (!Array.isArray(inMemoryDb.vendor_categories)) {
            inMemoryDb.vendor_categories = [];
        }
        DEFAULT_VENDOR_CATEGORIES.forEach((name) => {
            const exists = inMemoryDb.vendor_categories.some(
                (c) => String(c.name || '').toLowerCase() === name.toLowerCase()
            );
            if (!exists) {
                inMemoryDb.vendor_categories.push({
                    id: `cat_${name.toLowerCase().replace(/\s+/g, '_')}`,
                    name,
                    created_at: new Date()
                });
            }
        });

        try {
            if (getPool()) {
                const [rows] = await getPool().query(
                    'SELECT id, name, created_at FROM vendor_categories ORDER BY name ASC'
                );
                if (rows?.length) {
                    rows.forEach((row) => {
                        const label = titleCaseCategory(row.name);
                        if (!label) return;
                        const exists = inMemoryDb.vendor_categories.some(
                            (c) => String(c.name || '').toLowerCase() === label.toLowerCase()
                        );
                        if (!exists) {
                            inMemoryDb.vendor_categories.push({
                                id: row.id || `cat_${label.toLowerCase().replace(/\s+/g, '_')}`,
                                name: label,
                                created_at: row.created_at || new Date()
                            });
                        }
                    });
                }
            }
        } catch (err) {
            LOG.warning('[getVendorCategories] MySQL read skipped:', err.message);
        }

        const fromVendors = (inMemoryDb.vendors || []).map((v) => v.category).filter(Boolean);
        const names = uniqueSortedCategories([
            ...inMemoryDb.vendor_categories.map((c) => c.name),
            ...fromVendors
        ]);
        return names.map((name) => {
            const row = inMemoryDb.vendor_categories.find(
                (c) => String(c.name || '').toLowerCase() === name.toLowerCase()
            );
            return {
                id: row?.id || `cat_${name.toLowerCase().replace(/\s+/g, '_')}`,
                name,
                created_at: row?.created_at || null
            };
        });
    },

    addVendorCategory: async (name) => {
        const { titleCaseCategory } = require('./utils/vendorCategories');
        const label = titleCaseCategory(name);
        if (!label) {
            throw new Error('Category name is required');
        }
        if (!Array.isArray(inMemoryDb.vendor_categories)) {
            inMemoryDb.vendor_categories = [];
        }
        const existing = inMemoryDb.vendor_categories.find(
            (c) => String(c.name || '').toLowerCase() === label.toLowerCase()
        );
        if (existing) {
            return { category: existing, created: false };
        }

        const category = {
            id: `cat_${label.toLowerCase().replace(/\s+/g, '_')}_${Math.random().toString(36).slice(2, 6)}`,
            name: label,
            created_at: new Date()
        };
        inMemoryDb.vendor_categories.push(category);

        const sql = `INSERT INTO vendor_categories (id, name, created_at)
                     VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE name = VALUES(name)`;
        const params = [category.id, category.name, category.created_at];

        try {
            if (DB_TYPE === 'mysql' && getPool()) {
                await getPool().query(sql, params);
            } else {
                const { mirrorQuery } = require('./database/mysqlMirror');
                await mirrorQuery(sql, params);
            }
        } catch (err) {
            LOG.warning('[addVendorCategory] MySQL mirror skip:', err.message);
        }

        return { category, created: true };
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
        if (normalizedVendor.category) {
            try {
                await db.addVendorCategory(normalizedVendor.category);
            } catch (e) {
                LOG.warning('[addVendor] category catalog update skipped:', e.message);
            }
        }

        // Always keep in-memory copy so sync / local reads never lose runtime vendors
        const memIdx = inMemoryDb.vendors.findIndex((v) => String(v.id) === String(normalizedVendor.id));
        if (memIdx >= 0) {
            inMemoryDb.vendors[memIdx] = { ...inMemoryDb.vendors[memIdx], ...normalizedVendor };
        } else {
            inMemoryDb.vendors.push(normalizedVendor);
        }

        try {
            const pool = await ensureWritePool();
            if (pool) {
                await pool.query(
                    `INSERT INTO vendors (
                        id, owner_id, shop_name, category, is_active, is_promoted,
                        latitude, longitude, google_link, instagram_handle, facebook_link,
                        features_products, features_payments, features_appointments, features_queue,
                        features_matchmaking, features_cyber, features_trade, features_offer, features_qless,
                        features_fleet, features_realestate, features_trust_score,
                        visibility_top_rated, visibility_list, visibility_feed, location_name
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        owner_id = VALUES(owner_id),
                        shop_name = VALUES(shop_name),
                        category = VALUES(category),
                        is_active = VALUES(is_active),
                        features_products = VALUES(features_products),
                        features_payments = VALUES(features_payments),
                        features_appointments = VALUES(features_appointments),
                        features_queue = VALUES(features_queue),
                        visibility_list = VALUES(visibility_list),
                        location_name = VALUES(location_name)`,
                    [
                        normalizedVendor.id,
                        normalizedVendor.owner_id || '',
                        normalizedVendor.shop_name || '',
                        normalizedVendor.category || '',
                        normalizedVendor.is_active !== false ? 1 : 0,
                        normalizedVendor.is_promoted ? 1 : 0,
                        normalizedVendor.latitude || 0,
                        normalizedVendor.longitude || 0,
                        normalizedVendor.google_link || '',
                        normalizedVendor.instagram_handle || '',
                        normalizedVendor.facebook_link || '',
                        normalizedVendor.features_products !== false ? 1 : 0,
                        normalizedVendor.features_payments !== false ? 1 : 0,
                        normalizedVendor.features_appointments !== false ? 1 : 0,
                        normalizedVendor.features_queue !== false ? 1 : 0,
                        normalizedVendor.features_matchmaking ? 1 : 0,
                        normalizedVendor.features_cyber ? 1 : 0,
                        normalizedVendor.features_trade ? 1 : 0,
                        normalizedVendor.features_offer ? 1 : 0,
                        normalizedVendor.features_qless ? 1 : 0,
                        normalizedVendor.features_fleet ? 1 : 0,
                        normalizedVendor.features_realestate ? 1 : 0,
                        normalizedVendor.features_trust_score ? 1 : 0,
                        normalizedVendor.visibility_top_rated ? 1 : 0,
                        normalizedVendor.visibility_list !== false ? 1 : 0,
                        normalizedVendor.visibility_feed ? 1 : 0,
                        normalizedVendor.location_name || '',
                    ]
                );
            }
        } catch (err) {
            LOG.error("MySQL addVendor failed, in-memory vendor kept", err.message);
        }
        return normalizedVendor;
    },

    // Notifications (in-app)
    addNotification: async (notification) => {
        const payload = {
            user_id: notification.user_id,
            title: notification.title || 'Notification',
            message: notification.message || '',
            type: notification.type || 'system',
            data_json: JSON.stringify(notification.data || {}),
            is_read: 0,
            created_at: notification.created_at || new Date()
        };
        try {
            if (getPool()) {
                const [res] = await getPool().query(
                    `INSERT INTO notifications (user_id, title, body, message, type, data_json, is_read, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
                    [payload.user_id, payload.title, payload.message, payload.message, payload.type, payload.data_json, payload.created_at]
                );
                return { id: res.insertId, ...payload };
            }
        } catch (err) {
            LOG.error("MySQL addNotification failed, falling back to local", err.message);
        }
        const newId = (inMemoryDb.notifications[inMemoryDb.notifications.length - 1]?.id || 0) + 1;
        const item = { id: newId, ...payload };
        inMemoryDb.notifications.push(item);
        return item;
    },

    getNotificationsByUser: async (userId, limit = 50) => {
        try {
            if (getPool()) {
                const [rows] = await getPool().query(
                    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
                    [userId, Number(limit) || 50]
                );
                return rows || [];
            }
        } catch (err) {
            LOG.error("MySQL getNotificationsByUser failed, falling back to local", err.message);
        }
        return inMemoryDb.notifications
            .filter(n => String(n.user_id) === String(userId))
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, Number(limit) || 50);
    },

    markNotificationRead: async (notificationId, userId) => {
        try {
            if (getPool()) {
                await getPool().query('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [notificationId, userId]);
                return { success: true };
            }
        } catch (err) {
            LOG.error("MySQL markNotificationRead failed, falling back to local", err.message);
        }
        const item = inMemoryDb.notifications.find(n => String(n.id) === String(notificationId) && String(n.user_id) === String(userId));
        if (item) item.is_read = 1;
        return { success: true };
    },

    deleteNotification: async (notificationId, userId) => {
        try {
            if (getPool()) {
                await getPool().query('DELETE FROM notifications WHERE id = ? AND user_id = ?', [notificationId, userId]);
                return { success: true };
            }
        } catch (err) {
            LOG.error("MySQL deleteNotification failed, falling back to local", err.message);
        }
        inMemoryDb.notifications = inMemoryDb.notifications.filter(
            n => !(String(n.id) === String(notificationId) && String(n.user_id) === String(userId))
        );
        return { success: true };
    },

    // Activities
    getActivities: async (limit = 20) => {
        try {
            if (getPool()) {
                // Try to join with vendors to check visibility_feed
                // Note: Assuming activities table has vendor_id. If not, this might fail or need adjustment.
                // For robustness, we'll try a LEFT JOIN if possible, or just select all.
                try {
                    const [rows] = await getPool().query(`
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
                    const [rows] = await getPool().query('SELECT * FROM activities ORDER BY timestamp DESC LIMIT ?', [limit]);
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

    createActivity: async (activityData) => {
        try {
            if (getPool()) {
                const { type, user_id, user_name, message, metadata } = activityData;
                const [result] = await getPool().query(
                    `INSERT INTO activities (type, user_id, user_name, message, metadata, timestamp) 
                     VALUES (?, ?, ?, ?, ?, NOW())`,
                    [type, user_id, user_name, message, JSON.stringify(metadata || {})]
                );
                return { id: result.insertId, ...activityData, timestamp: new Date() };
            }
        } catch (err) {
            LOG.error("MySQL createActivity failed, falling back to local", err.message);
        }
        
        // In-memory implementation
        const newActivity = {
            id: inMemoryDb.activities.length + 1,
            ...activityData,
            timestamp: new Date()
        };
        inMemoryDb.activities.push(newActivity);
        return newActivity;
    },

    // --- SYSTEM SETTINGS ---
    getSettings: async () => {
        // Use in-memory settings unless MySQL mode is explicitly enabled
        if (DB_TYPE !== 'mysql') {
            return inMemoryDb.settings;
        }
        try {
            if (getPool()) {
                // Return cached settings if they exist and are fresh (within last 5 seconds)
                if (inMemoryDb.lastSettingsFetch && Date.now() - inMemoryDb.lastSettingsFetch < 5000) {
                    return inMemoryDb.settings;
                }
                // Try to fetch from a settings table, or return defaults if not exists
                // We'll assume a table 'system_settings' with columns key_name, is_enabled
                try {
                    const [rows] = await getPool().query('SELECT * FROM system_settings LIMIT 100');
                    const settings = {
                        enable_queue: true,
                        enable_appointments: true,
                        enable_shopping: true,
                        enable_matchmaking: true,
                        enable_offer: true,
                        enable_trade: true,
                        enable_qless: true,
                        enable_fleet: true,
                        enable_realestate: true,
                        enable_cyber: true,
                        enable_trust_score: true,
                        theme_position: 'auto',
                        auto_validate_calls: false,
                        auto_validate_links: false,
                        auto_validate_sms: false,
                        auto_validate_emails: false,
                        threat_scan_interval: 5,
                        enable_threat_intelligence: false,
                        enable_notification_validation: false,
                        enable_mobile_security_scan: false,
                        enable_subscription_management: false,
                        enable_auto_validation: false,
                        enable_suraksha: false,
                        enable_caller_validation: false,
                        enable_email_notifications: false,
                        enable_sms_notifications: false,
                        enable_in_app_notifications: false,
                        enable_pdf_reports: false,
                        enable_news: true,
                        news_user_emails: 'newsuser11',
                        news_vendor_emails: 'newsvendor1@test.com',
                        trade_news_source: 'telegram',
                        trade_news_sources: '[{"id":"google-global","type":"rss","enabled":true,"name":"Google News Global","url":"https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"global_news"},{"id":"google-tech","type":"rss","enabled":true,"name":"Google News Technology","url":"https://news.google.com/rss/search?q=technology&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"new_technology"},{"id":"google-sports","type":"rss","enabled":true,"name":"Google News Sports","url":"https://news.google.com/rss/search?q=sports&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"sports"},{"id":"google-travel","type":"rss","enabled":true,"name":"Google News Travel","url":"https://news.google.com/rss/search?q=travel%20deals&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"travel"},{"id":"google-coupons","type":"rss","enabled":true,"name":"Google News Coupons","url":"https://news.google.com/rss/search?q=local%20coupons%20OR%20food%20coupons&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"food_coupons"},{"id":"google-deals","type":"rss","enabled":true,"name":"Google News Deals","url":"https://news.google.com/rss/search?q=deal%20of%20the%20day%20OR%20flash%20sale&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"trending_deals"},{"id":"google-flash-sale","type":"rss","enabled":true,"name":"Google News Flash Sale","url":"https://news.google.com/rss/search?q=flash%20sale%20OR%20limited%20time%20offer%20OR%20mega%20sale&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"trending_offer"},{"id":"slickdeals","type":"rss","enabled":true,"name":"Slickdeals Frontpage","url":"https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1","category":"trending_deals"},{"id":"dealnews","type":"rss","enabled":true,"name":"DealNews","url":"https://www.dealnews.com/rss/","category":"trending_offer"}]',
                        news_grouping_mode: 'category',
                        news_subscribers: '',
                        news_cache_last_updated: '',
                        news_cache_ttl_hours: 24,
                        news_cache_auto_refresh: true,
                        news_cache_cron: '0 */3 * * *',
                        news_default_country: 'IN',
                        news_default_city: 'Delhi',
                        news_default_locality: 'Delhi',
                        news_default_lat: '28.6139',
                        news_default_lng: '77.2090',
                        news_preset_country: 'IN',
                        youtube_latest_rss: 'https://www.youtube.com/feeds/videos.xml?chart=mostPopular&hl=en',
                        enable_trends_for_flash_sale: true,
                        trends_geo: 'IN',
                        trends_rss_template: 'https://trends.google.com/trends/trendingsearches/daily/rss?geo={geo}',
                        newsapi_api_key: '',
                        newsapi_language: 'en',
                        gnews_api_key: '',
                        gnews_language: 'en',
                        gnews_country: '',
                        gdelt_query: 'stock market OR nifty OR sensex OR trading',
                        gdelt_timespan: '1d',
                        gdelt_languages: 'eng',
                        telegram_bot_token: '',
                        telegram_channel: '',
                        telegram_news_categories: 'cyber_threat,entertainment,sports,global_news,new_technology,new_offer,trending_offer,trending_deals,food_coupons,travel,flight,country_visit,other',
                        telegram_news_filters: '{"cyber_threat":["cyber","malware","ransomware","phishing","breach","hack","vulnerability","zero-day","ddos","data leak"],"entertainment":["movie","film","trailer","celebrity","music","tv","series","award","entertainment"],"sports":["sports","match","tournament","league","cricket","football","soccer","tennis","olympic"],"global_news":["global","world","international","geopolitical","diplomatic","united nations","war","summit"],"new_technology":["technology","tech","ai","artificial intelligence","robot","startup","innovation","chip","semiconductor","gadget"],"new_offer":["offer","discount","sale","deal","coupon","cashback"],"trending_offer":["hot deal","limited offer","best offer","flash sale","trending offer"],"trending_deals":["deal of the day","trending deal","mega sale","daily deal"],"food_coupons":["food coupon","food offer","restaurant offer","swiggy","zomato","ubereats","dominos","pizza"],"travel":["travel","tour","holiday","vacation","trip","package","hotel","resort"],"flight":["flight","airline","airfare","ticket","airport","aviation"],"country_visit":["visit","visa","tourist","immigration","country visit","travel advisory"]}',
                        telegram_news_global_filters: '',
                        telegram_news_filter_mode: 'include',
                        telegram_news_per_category_limit: 20,
                        telegram_news_since_hours: 48,
                        telegram_news_limit: 50,
                        notify_on_orders: true,
                        notify_on_appointments: true,
                        notify_on_queue: true,
                        notify_on_queue_status: true,
                        notify_on_queue_leave: true,
                        notify_on_queue_delete: true,
                        notify_on_appointment_status: true,
                        notify_on_appointment_delete: true,
                        notify_on_matchmaking: true,
                        notify_on_subscriptions: true,
                        notify_on_subscription_cancel: true,
                        notify_on_subscription_auto_renew: true,
                        notify_on_vendor_profile: true,
                        notify_on_product_updates: true,
                        notify_email_provider: 'resend',
                        notify_email_from: '',
                        notify_email_recipients: '',
                        notify_email_webhook_url: '',
                        notify_sms_provider: 'textbelt',
                        notify_sms_from: '',
                        notify_sms_recipients: '',
                        notify_sms_webhook_url: '',
                        auto_scan_enabled: false,
                        auto_scan_time: '09:00',
                        auto_scan_notify_threats: true,
                        auto_scan_auto_clean: false,
                        enable_lazy_loading: true, // Feature screens load on demand; unload when idle
                        enable_trade_extra_tabs: false,
                        ui_theme: 'facebook'
                    };
                    const parseSettingBool = (raw) => {
                        if (raw === true || raw === false) return raw;
                        if (raw === 1 || raw === 0) return raw === 1;
                        const s = String(raw ?? '').trim().toLowerCase();
                        if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
                        if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
                        // Unknown / empty → keep as enabled for feature flags
                        return true;
                    };
                    const hasEnableNewsRow = rows.some(r => r.key_name === 'enable_news');
                    rows.forEach(r => {
                        const rawVal = r.value !== undefined && r.value !== null
                            ? r.value
                            : r.is_enabled;
                        if (settings.hasOwnProperty(r.key_name)) {
                            // Handle boolean values
                            if (typeof settings[r.key_name] === 'boolean') {
                                settings[r.key_name] = parseSettingBool(rawVal);
                            } else {
                                // Handle string values (like theme_position)
                                settings[r.key_name] = rawVal;
                            }
                            return;
                        }
                        if (r.key_name === 'enable_trade_news' && !hasEnableNewsRow) {
                            settings.enable_news = parseSettingBool(rawVal);
                        }
                    });
                    settings.enable_offer = true;
                    settings.enable_trade = true;
                    settings.enable_trust_score = true;
                    settings.enable_news = true;
                    if (!settings.trade_news_sources || String(settings.trade_news_sources).trim() === '') {
                        settings.trade_news_sources = '[{"id":"google-global","type":"rss","enabled":true,"name":"Google News Global","url":"https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"global_news"},{"id":"google-tech","type":"rss","enabled":true,"name":"Google News Technology","url":"https://news.google.com/rss/search?q=technology&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"new_technology"},{"id":"google-sports","type":"rss","enabled":true,"name":"Google News Sports","url":"https://news.google.com/rss/search?q=sports&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"sports"},{"id":"google-travel","type":"rss","enabled":true,"name":"Google News Travel","url":"https://news.google.com/rss/search?q=travel%20deals&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"travel"},{"id":"google-coupons","type":"rss","enabled":true,"name":"Google News Coupons","url":"https://news.google.com/rss/search?q=local%20coupons%20OR%20food%20coupons&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"food_coupons"},{"id":"google-deals","type":"rss","enabled":true,"name":"Google News Deals","url":"https://news.google.com/rss/search?q=deal%20of%20the%20day%20OR%20flash%20sale&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"trending_deals"},{"id":"google-flash-sale","type":"rss","enabled":true,"name":"Google News Flash Sale","url":"https://news.google.com/rss/search?q=flash%20sale%20OR%20limited%20time%20offer%20OR%20mega%20sale&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"trending_offer"},{"id":"slickdeals","type":"rss","enabled":true,"name":"Slickdeals Frontpage","url":"https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1","category":"trending_deals"},{"id":"dealnews","type":"rss","enabled":true,"name":"DealNews","url":"https://www.dealnews.com/rss/","category":"trending_offer"}]';
                    }
                    if (!settings.telegram_bot_token && process.env.TELEGRAM_BOT_TOKEN) {
                        settings.telegram_bot_token = process.env.TELEGRAM_BOT_TOKEN;
                    }
                    if (!settings.gnews_api_key && process.env.GNEWS_API_KEY) {
                        settings.gnews_api_key = process.env.GNEWS_API_KEY;
                    }
                    if (!settings.newsapi_api_key && process.env.NEWSAPI_API_KEY) {
                        settings.newsapi_api_key = process.env.NEWSAPI_API_KEY;
                    }
                    inMemoryDb.settings = settings;
                    inMemoryDb.lastSettingsFetch = Date.now();
                    return settings;
                } catch (e) {
                    // Table might not exist, return defaults
                    return { 
                        enable_queue: true, 
                        enable_appointments: true, 
                        enable_shopping: true, 
                        enable_matchmaking: true, 
                        enable_offer: true, 
                        enable_trade: true,
                        enable_qless: true,
                        enable_fleet: true,
                        enable_realestate: true,
                        enable_cyber: true,
                        enable_trust_score: true,
                        theme_position: 'auto',
                        auto_validate_calls: false,
                        auto_validate_links: false,
                        auto_validate_sms: false,
                        auto_validate_emails: false,
                        threat_scan_interval: 5,
                        enable_threat_intelligence: true,
                        enable_notification_validation: true,
                        enable_mobile_security_scan: true,
                        enable_subscription_management: true,
                        enable_auto_validation: true,
                        enable_suraksha: true,
                        enable_caller_validation: true,
                        enable_email_notifications: true,
                        enable_sms_notifications: true,
                        enable_in_app_notifications: true,
                        enable_pdf_reports: true,
                        enable_news: true,
                        news_user_emails: 'newsuser11',
                        news_vendor_emails: 'newsvendor1@test.com',
                        trade_news_source: 'telegram',
                        trade_news_sources: '[{"id":"google-global","type":"rss","enabled":true,"name":"Google News Global","url":"https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"global_news"},{"id":"google-tech","type":"rss","enabled":true,"name":"Google News Technology","url":"https://news.google.com/rss/search?q=technology&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"new_technology"},{"id":"google-sports","type":"rss","enabled":true,"name":"Google News Sports","url":"https://news.google.com/rss/search?q=sports&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"sports"},{"id":"google-travel","type":"rss","enabled":true,"name":"Google News Travel","url":"https://news.google.com/rss/search?q=travel%20deals&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"travel"},{"id":"google-coupons","type":"rss","enabled":true,"name":"Google News Coupons","url":"https://news.google.com/rss/search?q=local%20coupons%20OR%20food%20coupons&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"food_coupons"},{"id":"google-deals","type":"rss","enabled":true,"name":"Google News Deals","url":"https://news.google.com/rss/search?q=deal%20of%20the%20day%20OR%20flash%20sale&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"trending_deals"},{"id":"google-flash-sale","type":"rss","enabled":true,"name":"Google News Flash Sale","url":"https://news.google.com/rss/search?q=flash%20sale%20OR%20limited%20time%20offer%20OR%20mega%20sale&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"trending_offer"},{"id":"slickdeals","type":"rss","enabled":true,"name":"Slickdeals Frontpage","url":"https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1","category":"trending_deals"},{"id":"dealnews","type":"rss","enabled":true,"name":"DealNews","url":"https://www.dealnews.com/rss/","category":"trending_offer"}]',
                        news_grouping_mode: 'category',
                        news_subscribers: '',
                        news_cache_last_updated: '',
                        news_cache_ttl_hours: 24,
                        news_cache_auto_refresh: true,
                        news_cache_cron: '0 */3 * * *',
                        news_default_country: 'IN',
                        news_default_city: 'Delhi',
                        news_default_locality: 'Delhi',
                        news_default_lat: '28.6139',
                        news_default_lng: '77.2090',
                        news_preset_country: 'IN',
                        youtube_latest_rss: 'https://www.youtube.com/feeds/videos.xml?chart=mostPopular&hl=en',
                        enable_trends_for_flash_sale: true,
                        trends_geo: 'IN',
                        trends_rss_template: 'https://trends.google.com/trends/trendingsearches/daily/rss?geo={geo}',
                        newsapi_api_key: '',
                        newsapi_language: 'en',
                        gnews_api_key: '',
                        gnews_language: 'en',
                        gnews_country: '',
                        gdelt_query: 'stock market OR nifty OR sensex OR trading',
                        gdelt_timespan: '1d',
                        gdelt_languages: 'eng',
                        telegram_bot_token: '',
                        telegram_channel: '',
                        telegram_news_categories: 'cyber_threat,entertainment,sports,global_news,new_technology,new_offer,trending_offer,trending_deals,food_coupons,travel,flight,country_visit,other',
                        telegram_news_filters: '{"cyber_threat":["cyber","malware","ransomware","phishing","breach","hack","vulnerability","zero-day","ddos","data leak"],"entertainment":["movie","film","trailer","celebrity","music","tv","series","award","entertainment"],"sports":["sports","match","tournament","league","cricket","football","soccer","tennis","olympic"],"global_news":["global","world","international","geopolitical","diplomatic","united nations","war","summit"],"new_technology":["technology","tech","ai","artificial intelligence","robot","startup","innovation","chip","semiconductor","gadget"],"new_offer":["offer","discount","sale","deal","coupon","cashback"],"trending_offer":["hot deal","limited offer","best offer","flash sale","trending offer"],"trending_deals":["deal of the day","trending deal","mega sale","daily deal"],"food_coupons":["food coupon","food offer","restaurant offer","swiggy","zomato","ubereats","dominos","pizza"],"travel":["travel","tour","holiday","vacation","trip","package","hotel","resort"],"flight":["flight","airline","airfare","ticket","airport","aviation"],"country_visit":["visit","visa","tourist","immigration","country visit","travel advisory"]}',
                        telegram_news_global_filters: '',
                        telegram_news_filter_mode: 'include',
                        telegram_news_per_category_limit: 20,
                        telegram_news_since_hours: 48,
                        telegram_news_limit: 50,
                        notify_on_orders: true,
                        notify_on_appointments: true,
                        notify_on_queue: true,
                        notify_on_queue_status: true,
                        notify_on_queue_leave: true,
                        notify_on_queue_delete: true,
                        notify_on_appointment_status: true,
                        notify_on_appointment_delete: true,
                        notify_on_matchmaking: true,
                        notify_on_subscriptions: true,
                        notify_on_subscription_cancel: true,
                        notify_on_subscription_auto_renew: true,
                        notify_on_vendor_profile: true,
                        notify_on_product_updates: true,
                        notify_email_provider: 'resend',
                        notify_email_from: '',
                        notify_email_recipients: '',
                        notify_email_webhook_url: '',
                        notify_sms_provider: 'textbelt',
                        notify_sms_from: '',
                        notify_sms_recipients: '',
                        notify_sms_webhook_url: '',
                        auto_scan_enabled: false,
                        auto_scan_time: '09:00',
                        auto_scan_notify_threats: true,
                        auto_scan_auto_clean: false,
                        enable_lazy_loading: true,
                        enable_trade_extra_tabs: false,
                        ui_theme: 'facebook'
                    };
                }
            }
        } catch (err) {
            LOG.error("MySQL getSettings failed", err.message);
        }
        // Ensure settings object exists with all defaults
        if (!inMemoryDb.settings) {
            inMemoryDb.settings = {};
        }
        // Merge with defaults to ensure all settings are present
        const defaultSettings = {
            enable_queue: true,
            enable_appointments: true,
            enable_shopping: true,
            enable_matchmaking: true,
            enable_offer: true,
            enable_trade: true,
            enable_qless: true,
            enable_fleet: true,
            enable_realestate: true,
            enable_cyber: true,
            enable_trust_score: true,
            theme_position: 'auto',
            auto_validate_calls: false,
            auto_validate_links: false,
            auto_validate_sms: false,
            auto_validate_emails: false,
            threat_scan_interval: 5,
            enable_threat_intelligence: true,
            enable_notification_validation: true,
            enable_mobile_security_scan: true,
            enable_subscription_management: true,
            enable_auto_validation: true,
            enable_suraksha: true,
            enable_caller_validation: true,
            enable_email_notifications: true,
            enable_sms_notifications: true,
            enable_in_app_notifications: true,
            enable_pdf_reports: true,
            enable_news: true,
            news_user_emails: 'newsuser11',
            news_vendor_emails: 'newsvendor1@test.com',
            trade_news_source: 'telegram',
            trade_news_sources: '[{"id":"google-global","type":"rss","enabled":true,"name":"Google News Global","url":"https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"global_news"},{"id":"google-tech","type":"rss","enabled":true,"name":"Google News Technology","url":"https://news.google.com/rss/search?q=technology&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"new_technology"},{"id":"google-sports","type":"rss","enabled":true,"name":"Google News Sports","url":"https://news.google.com/rss/search?q=sports&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"sports"},{"id":"google-travel","type":"rss","enabled":true,"name":"Google News Travel","url":"https://news.google.com/rss/search?q=travel%20deals&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"travel"},{"id":"google-coupons","type":"rss","enabled":true,"name":"Google News Coupons","url":"https://news.google.com/rss/search?q=local%20coupons%20OR%20food%20coupons&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"food_coupons"},{"id":"google-deals","type":"rss","enabled":true,"name":"Google News Deals","url":"https://news.google.com/rss/search?q=deal%20of%20the%20day%20OR%20flash%20sale&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"trending_deals"},{"id":"google-flash-sale","type":"rss","enabled":true,"name":"Google News Flash Sale","url":"https://news.google.com/rss/search?q=flash%20sale%20OR%20limited%20time%20offer%20OR%20mega%20sale&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"trending_offer"},{"id":"slickdeals","type":"rss","enabled":true,"name":"Slickdeals Frontpage","url":"https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1","category":"trending_deals"},{"id":"dealnews","type":"rss","enabled":true,"name":"DealNews","url":"https://www.dealnews.com/rss/","category":"trending_offer"}]',
            news_grouping_mode: 'category',
            news_subscribers: '',
            news_cache_last_updated: '',
            news_cache_ttl_hours: 24,
            news_cache_auto_refresh: true,
            news_cache_cron: '0 */3 * * *',
            news_default_country: 'IN',
            news_default_city: 'Delhi',
            news_default_locality: 'Delhi',
            news_default_lat: '28.6139',
            news_default_lng: '77.2090',
            news_preset_country: 'IN',
            youtube_latest_rss: 'https://www.youtube.com/feeds/videos.xml?chart=mostPopular&hl=en',
            enable_trends_for_flash_sale: true,
            trends_geo: 'IN',
            trends_rss_template: 'https://trends.google.com/trends/trendingsearches/daily/rss?geo={geo}',
            newsapi_api_key: '',
            newsapi_language: 'en',
            gnews_api_key: '',
            gnews_language: 'en',
            gnews_country: '',
            gdelt_query: 'stock market OR nifty OR sensex OR trading',
            gdelt_timespan: '1d',
            gdelt_languages: 'eng',
            telegram_bot_token: '',
            telegram_channel: '',
            telegram_news_categories: 'cyber_threat,entertainment,sports,global_news,new_technology,new_offer,trending_offer,trending_deals,food_coupons,travel,flight,country_visit,other',
            telegram_news_filters: '{"cyber_threat":["cyber","malware","ransomware","phishing","breach","hack","vulnerability","zero-day","ddos","data leak"],"entertainment":["movie","film","trailer","celebrity","music","tv","series","award","entertainment"],"sports":["sports","match","tournament","league","cricket","football","soccer","tennis","olympic"],"global_news":["global","world","international","geopolitical","diplomatic","united nations","war","summit"],"new_technology":["technology","tech","ai","artificial intelligence","robot","startup","innovation","chip","semiconductor","gadget"],"new_offer":["offer","discount","sale","deal","coupon","cashback"],"trending_offer":["hot deal","limited offer","best offer","flash sale","trending offer"],"trending_deals":["deal of the day","trending deal","mega sale","daily deal"],"food_coupons":["food coupon","food offer","restaurant offer","swiggy","zomato","ubereats","dominos","pizza"],"travel":["travel","tour","holiday","vacation","trip","package","hotel","resort"],"flight":["flight","airline","airfare","ticket","airport","aviation"],"country_visit":["visit","visa","tourist","immigration","country visit","travel advisory"]}',
            telegram_news_global_filters: '',
            telegram_news_filter_mode: 'include',
            telegram_news_per_category_limit: 20,
            telegram_news_since_hours: 48,
            telegram_news_limit: 50,
            notify_on_orders: true,
            notify_on_appointments: true,
            notify_on_queue: true,
            notify_on_queue_status: true,
            notify_on_queue_leave: true,
            notify_on_queue_delete: true,
            notify_on_appointment_status: true,
            notify_on_appointment_delete: true,
            notify_on_matchmaking: true,
            notify_on_subscriptions: true,
            notify_on_subscription_cancel: true,
            notify_on_subscription_auto_renew: true,
            notify_on_vendor_profile: true,
            notify_on_product_updates: true,
            notify_email_provider: 'resend',
            notify_email_from: '',
            notify_email_recipients: '',
            notify_email_webhook_url: '',
            notify_sms_provider: 'textbelt',
            notify_sms_from: '',
            notify_sms_recipients: '',
            notify_sms_webhook_url: '',
            enable_email_notifications: true,
            enable_sms_notifications: true,
            enable_in_app_notifications: true,
            enable_pdf_reports: true,
            enable_news: true,
            trade_news_source: 'telegram',
            trade_news_sources: '[{"id":"google-global","type":"rss","enabled":true,"name":"Google News Global","url":"https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"global_news"},{"id":"google-tech","type":"rss","enabled":true,"name":"Google News Technology","url":"https://news.google.com/rss/search?q=technology&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"new_technology"},{"id":"google-sports","type":"rss","enabled":true,"name":"Google News Sports","url":"https://news.google.com/rss/search?q=sports&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"sports"},{"id":"google-travel","type":"rss","enabled":true,"name":"Google News Travel","url":"https://news.google.com/rss/search?q=travel%20deals&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"travel"},{"id":"google-coupons","type":"rss","enabled":true,"name":"Google News Coupons","url":"https://news.google.com/rss/search?q=local%20coupons%20OR%20food%20coupons&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"food_coupons"},{"id":"google-deals","type":"rss","enabled":true,"name":"Google News Deals","url":"https://news.google.com/rss/search?q=deal%20of%20the%20day%20OR%20flash%20sale&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"trending_deals"},{"id":"google-flash-sale","type":"rss","enabled":true,"name":"Google News Flash Sale","url":"https://news.google.com/rss/search?q=flash%20sale%20OR%20limited%20time%20offer%20OR%20mega%20sale&hl=en-IN&gl=IN&ceid=IN:en","country":"IN","category":"trending_offer"},{"id":"slickdeals","type":"rss","enabled":true,"name":"Slickdeals Frontpage","url":"https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1","category":"trending_deals"},{"id":"dealnews","type":"rss","enabled":true,"name":"DealNews","url":"https://www.dealnews.com/rss/","category":"trending_offer"}]',
            news_grouping_mode: 'category',
            news_subscribers: '',
            news_cache_last_updated: '',
            news_cache_ttl_hours: 24,
            news_cache_auto_refresh: true,
            news_cache_cron: '0 */3 * * *',
            news_default_country: 'IN',
            news_default_city: 'Delhi',
            news_default_locality: 'Delhi',
            news_default_lat: '28.6139',
            news_default_lng: '77.2090',
            news_preset_country: 'IN',
            youtube_latest_rss: 'https://www.youtube.com/feeds/videos.xml?chart=mostPopular&hl=en',
            enable_trends_for_flash_sale: true,
            trends_geo: 'IN',
            trends_rss_template: 'https://trends.google.com/trends/trendingsearches/daily/rss?geo={geo}',
            newsapi_api_key: '',
            newsapi_language: 'en',
            gnews_api_key: '',
            gnews_language: 'en',
            gnews_country: '',
            gdelt_query: 'stock market OR nifty OR sensex OR trading',
            gdelt_timespan: '1d',
            gdelt_languages: 'eng',
            telegram_bot_token: '',
            telegram_channel: '',
            telegram_news_categories: 'cyber_threat,entertainment,sports,global_news,new_technology,new_offer,trending_offer,trending_deals,food_coupons,travel,flight,country_visit,other',
            telegram_news_filters: '{"cyber_threat":["cyber","malware","ransomware","phishing","breach","hack","vulnerability","zero-day","ddos","data leak"],"entertainment":["movie","film","trailer","celebrity","music","tv","series","award","entertainment"],"sports":["sports","match","tournament","league","cricket","football","soccer","tennis","olympic"],"global_news":["global","world","international","geopolitical","diplomatic","united nations","war","summit"],"new_technology":["technology","tech","ai","artificial intelligence","robot","startup","innovation","chip","semiconductor","gadget"],"new_offer":["offer","discount","sale","deal","coupon","cashback"],"trending_offer":["hot deal","limited offer","best offer","flash sale","trending offer"],"trending_deals":["deal of the day","trending deal","mega sale","daily deal"],"food_coupons":["food coupon","food offer","restaurant offer","swiggy","zomato","ubereats","dominos","pizza"],"travel":["travel","tour","holiday","vacation","trip","package","hotel","resort"],"flight":["flight","airline","airfare","ticket","airport","aviation"],"country_visit":["visit","visa","tourist","immigration","country visit","travel advisory"]}',
            telegram_news_global_filters: '',
            telegram_news_filter_mode: 'include',
            telegram_news_per_category_limit: 20,
            telegram_news_since_hours: 48,
            telegram_news_limit: 50,
            notify_on_orders: true,
            notify_on_appointments: true,
            notify_on_queue: true,
            notify_on_queue_status: true,
            notify_on_queue_leave: true,
            notify_on_queue_delete: true,
            notify_on_appointment_status: true,
            notify_on_appointment_delete: true,
            notify_on_matchmaking: true,
            notify_on_subscriptions: true,
            notify_on_subscription_cancel: true,
            notify_on_subscription_auto_renew: true,
            notify_on_vendor_profile: true,
            notify_on_product_updates: true,
            notify_email_provider: 'resend',
            notify_email_from: '',
            notify_email_recipients: '',
            notify_email_webhook_url: '',
            notify_sms_provider: 'textbelt',
            notify_sms_from: '',
            notify_sms_recipients: '',
            notify_sms_webhook_url: '',
            auto_scan_enabled: false,
            auto_scan_time: '09:00',
            auto_scan_notify_threats: true,
            auto_scan_auto_clean: false,
            enable_lazy_loading: true,
            enable_trade_extra_tabs: false,
            ui_theme: 'facebook',
        };
        const merged = { ...defaultSettings, ...inMemoryDb.settings };
        merged.enable_offer = true;
        merged.enable_trade = true;
        merged.enable_trust_score = true;
        merged.enable_news = true;
        if (!merged.trade_news_sources || String(merged.trade_news_sources).trim() === '') {
            merged.trade_news_sources = defaultSettings.trade_news_sources;
        }
        return merged;
    },

    updateSettings: async (newSettings) => {
        try {
            if (getPool()) {
                // Upsert logic for MySQL
                // CREATE TABLE IF NOT EXISTS system_settings (key_name VARCHAR(50) PRIMARY KEY, value VARCHAR(10));
                try {
                    await getPool().query(`
                        CREATE TABLE IF NOT EXISTS system_settings (
                            key_name VARCHAR(50) PRIMARY KEY, 
                            value TEXT
                        )
                    `);
                    try {
                        await getPool().query('ALTER TABLE system_settings MODIFY value TEXT');
                    } catch (e) {
                        LOG.warning('system_settings ALTER value TEXT skipped', e.message);
                    }
                    
                    for (const [key, val] of Object.entries(newSettings)) {
                        await getPool().query(
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
    ,
    persistNewsSettings: async () => {
        const patch = { enable_news: true };
        inMemoryDb.settings = { ...(inMemoryDb.settings || {}), ...patch };
        try {
            if (getPool()) {
                await getPool().query(`
                    CREATE TABLE IF NOT EXISTS system_settings (
                        key_name VARCHAR(50) PRIMARY KEY,
                        value TEXT
                    )
                `);
                await getPool().query(
                    'INSERT INTO system_settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?',
                    ['enable_news', 'true', 'true']
                );
                LOG.info('[Settings] enable_news synced to MySQL');
            } else {
                LOG.info('[Settings] enable_news applied in-memory');
            }
        } catch (e) {
            LOG.warning('[Settings] persistNewsSettings skipped: ' + (e.message || e));
        }
        return inMemoryDb.settings;
    }
    ,
    persistUiChromeSettings: async () => {
        const patch = {
            enable_trade_extra_tabs: false,
            enable_lazy_loading: true,
            ui_theme: 'facebook',
            enable_offer: true,
        };
        inMemoryDb.settings = { ...(inMemoryDb.settings || {}), ...patch };
        try {
            if (getPool()) {
                await getPool().query(`
                    CREATE TABLE IF NOT EXISTS system_settings (
                        key_name VARCHAR(50) PRIMARY KEY,
                        value TEXT
                    )
                `);
                for (const [key, val] of Object.entries(patch)) {
                    await getPool().query(
                        'INSERT INTO system_settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?',
                        [key, String(val), String(val)]
                    );
                }
                LOG.info('[Settings] UI chrome synced to MySQL (Facebook theme, lazy load, hide trade extra tabs)');
            } else {
                LOG.info('[Settings] UI chrome applied in-memory (Facebook theme, lazy load, hide trade extra tabs)');
            }
        } catch (e) {
            LOG.warning('[Settings] persistUiChromeSettings skipped: ' + (e.message || e));
        }
        return inMemoryDb.settings;
    }
    ,
    ensureNewsCacheTable: async () => {
        if (!getPool()) return;
        await getPool().query(`
            CREATE TABLE IF NOT EXISTS news_cache (
                id INT AUTO_INCREMENT PRIMARY KEY,
                unique_key VARCHAR(255) UNIQUE,
                text TEXT,
                link TEXT,
                source VARCHAR(255),
                category VARCHAR(255),
                country VARCHAR(255),
                city VARCHAR(255),
                locality VARCHAR(255),
                image TEXT,
                published_at DATETIME NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
    },
    saveNewsItems: async (items) => {
        if (!Array.isArray(items) || items.length === 0) return { saved: 0 };
        if (getPool()) {
            try {
                await db.ensureNewsCacheTable();
                for (const item of items) {
                    await getPool().query(
                        `INSERT INTO news_cache 
                        (unique_key, text, link, source, category, country, city, locality, image, published_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE 
                            text=VALUES(text),
                            link=VALUES(link),
                            source=VALUES(source),
                            category=VALUES(category),
                            country=VALUES(country),
                            city=VALUES(city),
                            locality=VALUES(locality),
                            image=VALUES(image),
                            published_at=VALUES(published_at)`,
                        [
                            item.unique_key,
                            item.text || '',
                            item.link || '',
                            item.source || '',
                            item.category || '',
                            item.country || '',
                            item.city || '',
                            item.locality || '',
                            item.image || '',
                            item.date ? new Date(item.date) : null
                        ]
                    );
                }
                return { saved: items.length };
            } catch (err) {
                LOG.error('MySQL saveNewsItems failed', err.message);
            }
        }

        if (!inMemoryDb.news_cache) inMemoryDb.news_cache = [];
        const existing = new Map(inMemoryDb.news_cache.map(i => [i.unique_key, i]));
        items.forEach(item => {
            if (existing.has(item.unique_key)) {
                existing.set(item.unique_key, { ...existing.get(item.unique_key), ...item });
            } else {
                existing.set(item.unique_key, item);
            }
        });
        inMemoryDb.news_cache = Array.from(existing.values());
        return { saved: items.length };
    },
    getNewsItems: async (limit = 100) => {
        if (getPool()) {
            try {
                await db.ensureNewsCacheTable();
                const [rows] = await getPool().query(
                    `SELECT unique_key, text, link, source, category, country, city, locality, image, published_at 
                     FROM news_cache 
                     ORDER BY published_at DESC 
                     LIMIT ?`,
                    [limit]
                );
                return rows.map(r => ({
                    unique_key: r.unique_key,
                    text: r.text,
                    link: r.link,
                    source: r.source,
                    category: r.category,
                    country: r.country,
                    city: r.city,
                    locality: r.locality,
                    image: r.image,
                    date: r.published_at ? new Date(r.published_at).toISOString() : new Date().toISOString()
                }));
            } catch (err) {
                LOG.error('MySQL getNewsItems failed', err.message);
            }
        }

        if (!inMemoryDb.news_cache) inMemoryDb.news_cache = [];
        const sorted = [...inMemoryDb.news_cache].sort((a, b) => {
            const ta = new Date(a.date || 0).getTime();
            const tb = new Date(b.date || 0).getTime();
            return tb - ta;
        });
        return sorted.slice(0, limit);
    }
    ,
    clearNewsCache: async () => {
        if (getPool()) {
            try {
                await db.ensureNewsCacheTable();
                await getPool().query('TRUNCATE TABLE news_cache');
                return { success: true };
            } catch (err) {
                LOG.error('MySQL clearNewsCache failed', err.message);
            }
        }
        inMemoryDb.news_cache = [];
        return { success: true };
    }
};

dbContext.db = db;

// Performance Wrapper
const measuredDb = { LOG_CONFIG }; // Export config

// Ensure autoValidationDetections is available
if (!inMemoryDb.autoValidationDetections) {
    inMemoryDb.autoValidationDetections = [];
}

// Ensure mobileSecurityScans is available
if (!inMemoryDb.mobileSecurityScans) {
    inMemoryDb.mobileSecurityScans = [];
}

// Export mobileSecurityScans
if (!measuredDb.mobileSecurityScans) {
    measuredDb.mobileSecurityScans = inMemoryDb.mobileSecurityScans;
}

// Ensure autoValidationDetections is exported
if (!measuredDb.autoValidationDetections) {
    measuredDb.autoValidationDetections = inMemoryDb.autoValidationDetections;
}

// Ensure subscriptions is available
if (!inMemoryDb.subscriptions) {
    inMemoryDb.subscriptions = [];
}

// Ensure news cache is available
if (!inMemoryDb.news_cache) {
    inMemoryDb.news_cache = [];
}

// Export subscriptions
if (!measuredDb.subscriptions) {
    measuredDb.subscriptions = inMemoryDb.subscriptions;
}

// Ensure notificationValidations is available
if (!inMemoryDb.notificationValidations) {
    inMemoryDb.notificationValidations = [];
}

// Ensure notifications is available
if (!inMemoryDb.notifications) {
    inMemoryDb.notifications = [];
}

// Export notificationValidations
if (!measuredDb.notificationValidations) {
    measuredDb.notificationValidations = inMemoryDb.notificationValidations;
}

if (!measuredDb.notifications) {
    measuredDb.notifications = inMemoryDb.notifications;
}

// Ensure threatIntelligence is available
if (!inMemoryDb.threatIntelligence) {
    inMemoryDb.threatIntelligence = [];
}

// Export threatIntelligence
if (!measuredDb.threatIntelligence) {
    measuredDb.threatIntelligence = inMemoryDb.threatIntelligence;
}

const CORE_DATA_KEYS = new Set([
    'users',
    'vendors',
    'products',
    'orders',
    'queues',
    'otps',
    'appointments',
    'activities',
    'settings',
    'user_vendor_mappings',
    'subscriptions',
    'health_reports',
    'health_illness_years',
]);

// Core seed lives in this file. data.js feature collections load on first feature open.
LOG.info('Core in-memory seed ready (feature seed/jobs deferred until first open)');

// Copy all inMemoryDb properties directly (for arrays like cyberThreats, threatAlerts, etc.)
Object.keys(inMemoryDb).forEach(key => {
    if (!db.hasOwnProperty(key)) {
        measuredDb[key] = inMemoryDb[key];
    }
});

// Feature arrays stay empty until ensureFeature() copies seed from data.js
if (inMemoryDb.cyberThreats) {
    measuredDb.cyberThreats = inMemoryDb.cyberThreats;
}

if (inMemoryDb.threatIntelligence) {
    measuredDb.threatIntelligence = inMemoryDb.threatIntelligence;
}

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
                    const usedMysql = DB_TYPE === 'mysql' && !!getPool();
                    const source = usedMysql ? 'MYSQL' : 'INMEMORY';
                    logDbAccess(source, key, duration);
                }
            };
        }
    } else {
        measuredDb[key] = db[key];
    }
}

// Export pool for use in other modules (like dealsService)
measuredDb.getPool = () => getPool();
measuredDb.pool = null; // Lazy — use getPool() or featureConnectionManager
measuredDb.featureConnectionManager = featureConnectionManager;
measuredDb.inMemoryDb = inMemoryDb; // Export in-memory DB for trading data service
measuredDb.loadFeatureSeed = (keys = []) => {
    const source = getTestData();
    let loaded = 0;
    keys.forEach((key) => {
        if (CORE_DATA_KEYS.has(key)) return;
        if (Array.isArray(inMemoryDb[key]) && inMemoryDb[key].length > 0) {
            measuredDb[key] = inMemoryDb[key];
            return;
        }
        if (source[key] != null) {
            inMemoryDb[key] = Array.isArray(source[key]) ? source[key].slice() : source[key];
            loaded += Array.isArray(inMemoryDb[key]) ? inMemoryDb[key].length : 1;
        } else if (!inMemoryDb[key]) {
            inMemoryDb[key] = [];
        }
        measuredDb[key] = inMemoryDb[key];
    });
    if (loaded) {
        LOG.info(`Loaded in-memory feature seed (${loaded} rows) for [${keys.join(', ')}]`);
    }
};
measuredDb.ensureFleetTables = ensureFleetTables;
measuredDb.ensureCyberThreatTables = ensureCyberThreatTables;
measuredDb.ensureMatchmakingTables = ensureMatchmakingTables;
measuredDb.ensureVendorFeatureColumns = ensureVendorFeatureColumns;
measuredDb.ensureUserVendorMappingTable = ensureUserVendorMappingTable;
measuredDb.ensureUsersUpdatedAtColumn = ensureUsersUpdatedAtColumn;
measuredDb.ensureAllUsersAndVendors = ensureAllUsersAndVendors;
measuredDb.ensureCyberUsersAndVendor = ensureCyberUsersAndVendor;
measuredDb.ensureFeatureSchema = (featureId) => {
    const { ensureFeatureSchema } = require('./database/schema/featureTables');
    return ensureFeatureSchema(featureId, measuredDb);
};

module.exports = measuredDb;
