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

// Import test data from data.js
let testData = {};
try {
    testData = require('./database/data.js');
} catch (error) {
    console.warn('[DB] Could not load test data from data.js:', error.message);
}

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
        { id: 'usr_realvendor1', name: 'Realestate Vendor 1', email: 'realvendor1@test.com', mobile: '8000000010', role: 'vendor', location_name: 'Bangalore' },
        { id: 'usr_cyber1', name: 'Cyber User 1', email: 'cyber1@test.com', mobile: '8000000011', role: 'user', location_name: 'Mumbai' },
        { id: 'usr_cybervendor1', name: 'Cyber Vendor 1', email: 'cybervendor1@test.com', mobile: '8000000012', role: 'vendor', location_name: 'Mumbai' }
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
            features_products: true,
            features_payments: true,
            features_appointments: true,
            features_queue: true,
            features_matchmaking: false,
            features_cyber: true,
            visibility_top_rated: false,
            visibility_list: true,
            visibility_feed: false
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
    cyberThreats: [
        // Phone Scams (Most Common)
        {
            id: 'threat_phone_001',
            user_id: 'usr_user',
            type: 'phone',
            value: '9876543210',
            title: 'Fake Bank OTP Scam',
            description: 'Caller claiming to be from SBI asking for OTP to verify account. Multiple users reported.',
            severity: 'high',
            category: 'scam',
            tags: ['bank', 'otp', 'sbi', 'fraud'],
            report_count: 45,
            reported_by: ['usr_user', 'usr_u1', 'usr_u2'],
            status: 'active',
            verified: true,
            verified_by: 'admin',
            location: 'Mumbai',
            created_at: new Date('2024-01-10'),
            updated_at: new Date('2024-01-14')
        },
        {
            id: 'threat_phone_002',
            user_id: 'usr_u1',
            type: 'phone',
            value: '9876543211',
            title: 'Income Tax Refund Scam',
            description: 'Caller claiming income tax refund and asking for bank details. Reported by 32 users.',
            severity: 'high',
            category: 'fraud',
            tags: ['income-tax', 'refund', 'bank-details'],
            report_count: 32,
            reported_by: ['usr_u1', 'usr_u2', 'usr_u3'],
            status: 'active',
            verified: true,
            location: 'Delhi',
            created_at: new Date('2024-01-08'),
            updated_at: new Date('2024-01-13')
        },
        {
            id: 'threat_phone_003',
            user_id: 'usr_u2',
            type: 'phone',
            value: '9876543212',
            title: 'KYC Update Scam',
            description: 'Caller asking to update KYC by clicking link. Multiple reports from Bangalore.',
            severity: 'critical',
            category: 'phishing',
            tags: ['kyc', 'link', 'update'],
            report_count: 67,
            reported_by: ['usr_u2', 'usr_u4', 'usr_u5'],
            status: 'active',
            verified: true,
            location: 'Bangalore',
            created_at: new Date('2024-01-05'),
            updated_at: new Date('2024-01-15')
        },
        // Email Threats
        {
            id: 'threat_email_001',
            user_id: 'usr_u3',
            type: 'email',
            value: 'support@bank-sbi-update.com',
            title: 'Phishing Email - Fake SBI',
            description: 'Phishing email claiming to be from SBI asking for login credentials. Reported by 28 users.',
            severity: 'high',
            category: 'phishing',
            tags: ['email', 'sbi', 'phishing', 'credentials'],
            report_count: 28,
            reported_by: ['usr_u3', 'usr_u1'],
            status: 'active',
            verified: true,
            location: 'Pune',
            created_at: new Date('2024-01-09'),
            updated_at: new Date('2024-01-12')
        },
        {
            id: 'threat_email_002',
            user_id: 'usr_u4',
            type: 'email',
            value: 'noreply@paytm-security.com',
            title: 'Fake Paytm Security Alert',
            description: 'Fake Paytm security alert email asking to verify account. Multiple reports.',
            severity: 'medium',
            category: 'phishing',
            tags: ['paytm', 'security', 'alert'],
            report_count: 19,
            reported_by: ['usr_u4', 'usr_u5'],
            status: 'active',
            verified: false,
            location: 'Mumbai',
            created_at: new Date('2024-01-11'),
            updated_at: new Date('2024-01-14')
        },
        // URL Threats
        {
            id: 'threat_url_001',
            user_id: 'usr_u5',
            type: 'url',
            value: 'https://sbi-online-verify.in',
            title: 'Fake SBI Website',
            description: 'Fake SBI website designed to steal banking credentials. Reported by 54 users.',
            severity: 'critical',
            category: 'phishing',
            tags: ['url', 'sbi', 'fake-website', 'credentials'],
            report_count: 54,
            reported_by: ['usr_u5', 'usr_user', 'usr_u1'],
            status: 'active',
            verified: true,
            location: 'Delhi',
            created_at: new Date('2024-01-07'),
            updated_at: new Date('2024-01-15')
        },
        {
            id: 'threat_url_002',
            user_id: 'usr_user',
            type: 'url',
            value: 'http://paytm-kyc-update.com',
            title: 'Fake Paytm KYC Portal',
            description: 'Fake Paytm KYC update portal. Multiple users reported losing money.',
            severity: 'critical',
            category: 'fraud',
            tags: ['paytm', 'kyc', 'fake-portal'],
            report_count: 41,
            reported_by: ['usr_user', 'usr_u2'],
            status: 'active',
            verified: true,
            location: 'Bangalore',
            created_at: new Date('2024-01-06'),
            updated_at: new Date('2024-01-13')
        },
        // UPI Threats
        {
            id: 'threat_upi_001',
            user_id: 'usr_u1',
            type: 'upi',
            value: 'fraud@paytm',
            title: 'Fake UPI ID - Money Theft',
            description: 'UPI ID used to receive fraudulent payments. Multiple victims reported.',
            severity: 'high',
            category: 'fraud',
            tags: ['upi', 'paytm', 'money-theft'],
            report_count: 23,
            reported_by: ['usr_u1', 'usr_u3'],
            status: 'active',
            verified: true,
            location: 'Mumbai',
            created_at: new Date('2024-01-12'),
            updated_at: new Date('2024-01-14')
        },
        // More Phone Scams
        {
            id: 'threat_phone_004',
            user_id: 'usr_u2',
            type: 'phone',
            value: '9876543213',
            title: 'Credit Card Activation Scam',
            description: 'Caller claiming credit card needs activation and asking for card details.',
            severity: 'high',
            category: 'scam',
            tags: ['credit-card', 'activation', 'card-details'],
            report_count: 38,
            reported_by: ['usr_u2', 'usr_u4'],
            status: 'active',
            verified: true,
            location: 'Delhi',
            created_at: new Date('2024-01-11'),
            updated_at: new Date('2024-01-15')
        },
        {
            id: 'threat_phone_005',
            user_id: 'usr_u3',
            type: 'phone',
            value: '9876543214',
            title: 'Lottery Winner Scam',
            description: 'Caller claiming lottery win and asking for processing fee. Classic scam.',
            severity: 'medium',
            category: 'scam',
            tags: ['lottery', 'winner', 'processing-fee'],
            report_count: 15,
            reported_by: ['usr_u3'],
            status: 'active',
            verified: false,
            location: 'Pune',
            created_at: new Date('2024-01-13'),
            updated_at: new Date('2024-01-13')
        },
        {
            id: 'threat_phone_006',
            user_id: 'usr_u4',
            type: 'phone',
            value: '9876543215',
            title: 'SIM Card Deactivation Scam',
            description: 'Caller claiming SIM will be deactivated and asking for personal details.',
            severity: 'high',
            category: 'fraud',
            tags: ['sim', 'deactivation', 'personal-details'],
            report_count: 29,
            reported_by: ['usr_u4', 'usr_u5'],
            status: 'active',
            verified: true,
            location: 'Bangalore',
            created_at: new Date('2024-01-09'),
            updated_at: new Date('2024-01-14')
        }
    ],
    threatAlerts: [
        {
            id: 'alert_001',
            threat_id: 'threat_phone_001',
            user_id: null,
            type: 'threat_alert',
            title: 'New High Severity Threat: Fake Bank OTP Scam',
            message: 'A high severity threat has been reported. Be cautious of calls asking for OTP.',
            threat_data: { type: 'phone', severity: 'high' },
            read: false,
            created_at: new Date('2024-01-10')
        },
        {
            id: 'alert_002',
            threat_id: 'threat_url_001',
            user_id: null,
            type: 'threat_alert',
            title: 'Critical Threat: Fake SBI Website Detected',
            message: 'A fake SBI website has been reported. Do not enter credentials on suspicious sites.',
            threat_data: { type: 'url', severity: 'critical' },
            read: false,
            created_at: new Date('2024-01-07')
        }
    ],
    // Cyber Security Tips
    cyberSecurityTips: [
        {
            id: 1,
            title: 'Use Strong, Unique Passwords',
            description: 'Create passwords with at least 12 characters, mixing letters, numbers, and symbols.',
            category: 'Password',
            priority: 'high'
        },
        {
            id: 2,
            title: 'Enable Two-Factor Authentication',
            description: 'Add an extra layer of security to your accounts with 2FA.',
            category: 'Authentication',
            priority: 'high'
        },
        {
            id: 3,
            title: 'Keep Software Updated',
            description: 'Regularly update your operating system and apps to patch security vulnerabilities.',
            category: 'Updates',
            priority: 'high'
        },
        {
            id: 4,
            title: 'Be Wary of Phishing Emails',
            description: 'Never click links or download attachments from suspicious emails.',
            category: 'Phishing',
            priority: 'medium'
        },
        {
            id: 5,
            title: 'Use VPN on Public WiFi',
            description: 'Protect your data when using public WiFi networks with a VPN.',
            category: 'Network',
            priority: 'medium'
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
    // System Settings
    settings: {
        enable_queue: false,
        enable_appointments: false,
        enable_shopping: false,
        enable_matchmaking: false,
        enable_offer: false,
        enable_trade: false,
        enable_qless: false,
        enable_fleet: true,
        enable_realestate: false,
        enable_cyber: true,
        theme_position: 'auto',
        enable_news: true,
        news_user_emails: 'newsuser1',
        news_vendor_emails: 'newsvendor1'
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
    matchmaking_submissions: [],
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

let cyberThreatTablesReady = false;
const ensureCyberThreatTables = async () => {
    if (!pool || cyberThreatTablesReady) return;
    
    try {
        // Cyber Threats Table
        await pool.query(`
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
        await pool.query(`
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
    if (!pool || vendorFeatureColumnsReady) return;
    try {
        await pool.query(`
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

/**
 * Ensure cyber users and vendor exist in MySQL
 * Syncs cyber users and vendor from in-memory DB to MySQL
 */
const ensureCyberUsersAndVendor = async () => {
    if (!pool) return;
    
    try {
        // Make sure vendors table has required feature flags/visibility columns
        await ensureVendorFeatureColumns();

        // Ensure cyber users exist in MySQL
        const cyberUsers = [
            { id: 'usr_cyber1', name: 'Cyber User 1', email: 'cyber1@test.com', mobile: '8000000011', role: 'user', location_name: 'Mumbai' },
            { id: 'usr_cybervendor1', name: 'Cyber Vendor 1', email: 'cybervendor1@test.com', mobile: '8000000012', role: 'vendor', location_name: 'Mumbai' }
        ];
        
        for (const user of cyberUsers) {
            const [existing] = await pool.query('SELECT id FROM users WHERE id = ?', [user.id]);
            if (existing.length === 0) {
                await pool.query(
                    `INSERT INTO users (id, name, email, mobile, role, location_name, created_at) 
                     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                    [user.id, user.name, user.email, user.mobile, user.role, user.location_name]
                );
                LOG.success(`[Cyber Sync] Created user: ${user.id} (${user.name})`);
            } else {
                // Update existing user
                await pool.query(
                    `UPDATE users SET name=?, email=?, mobile=?, role=?, location_name=? WHERE id=?`,
                    [user.name, user.email, user.mobile, user.role, user.location_name, user.id]
                );
                LOG.info(`[Cyber Sync] Updated user: ${user.id} (${user.name})`);
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
            features_products: true,
            features_payments: true,
            features_appointments: true,
            features_queue: true,
            features_matchmaking: false,
            features_cyber: true,
            visibility_top_rated: false,
            visibility_list: true,
            visibility_feed: false
        };
        
        const [existingVendor] = await pool.query('SELECT id FROM vendors WHERE id = ?', [cyberVendor.id]);
        if (existingVendor.length === 0) {
            await pool.query(
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
        } else {
            // Update existing vendor, ensure features_cyber is enabled
            await pool.query(
                `UPDATE vendors SET 
                    owner_id=?, shop_name=?, category=?, is_active=?, is_promoted=?,
                    latitude=?, longitude=?, google_link=?, instagram_handle=?, facebook_link=?,
                    features_products=?, features_payments=?, features_appointments=?, features_queue=?,
                    features_matchmaking=?, features_cyber=?, visibility_top_rated=?, visibility_list=?, visibility_feed=?
                WHERE id=?`,
                [
                    cyberVendor.owner_id, cyberVendor.shop_name, cyberVendor.category,
                    cyberVendor.is_active, cyberVendor.is_promoted, cyberVendor.latitude, cyberVendor.longitude,
                    cyberVendor.google_link, cyberVendor.instagram_handle, cyberVendor.facebook_link,
                    cyberVendor.features_products, cyberVendor.features_payments, cyberVendor.features_appointments,
                    cyberVendor.features_queue, cyberVendor.features_matchmaking, cyberVendor.features_cyber,
                    cyberVendor.visibility_top_rated, cyberVendor.visibility_list, cyberVendor.visibility_feed,
                    cyberVendor.id
                ]
            );
            LOG.info(`[Cyber Sync] Updated vendor: ${cyberVendor.id} (${cyberVendor.shop_name})`);
        }
        
        LOG.success('[Cyber Sync] Cyber users and vendor synced to MySQL');
    } catch (error) {
        LOG.error('[Cyber Sync] Error syncing cyber users and vendor:', error.message);
    }
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

    /**
     * Auto-complete queue items from previous days
     * Marks all "waiting" queue items from previous days as "done"
     */
    autoCompleteQueues: async () => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayStr = toMysqlDateTime(today).split(' ')[0]; // YYYY-MM-DD
        
        const affectedVendorIds = new Set();

        try {
            if (pool) {
                // Find queue items that are "waiting" and joined_at date is before today
                const [rows] = await pool.query(
                    `SELECT * FROM queues 
                     WHERE status = 'waiting' 
                     AND DATE(joined_at) < ?`,
                    [todayStr]
                );

                if (rows.length > 0) {
                    const ids = rows.map(r => r.id);
                    await pool.query(
                        `UPDATE queues SET status = 'done' WHERE id IN (?)`,
                        [ids]
                    );
                    
                    // Collect affected vendor IDs for socket updates
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

        // In-memory implementation
        inMemoryDb.queues.forEach(queue => {
            if (queue.status === 'waiting') {
                const queueDate = new Date(queue.joined_at);
                const queueDateStr = new Date(queueDate.getFullYear(), queueDate.getMonth(), queueDate.getDate());
                
                // If queue was created before today, mark as done
                if (queueDateStr < today) {
                    queue.status = 'done';
                    affectedVendorIds.add(queue.vendor_id);
                    LOG.info(`[AUTO-COMPLETE] Queue ${queue.id} from ${queue.joined_at} marked as done`);
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
                // Exclude service-specific vendors (Trade, Offer, QLess, Fleet, Realestate, Cyber, Trust Score) unless includeTradeOffer is true
                // Note: includeTradeOffer is used as a catch-all for including service vendors (including cyber and trust score)
                const excludeServiceVendors = includeTradeOffer ? '' : 'AND (v.features_trade IS NULL OR v.features_trade = 0 OR v.features_trade = false) AND (v.features_offer IS NULL OR v.features_offer = 0 OR v.features_offer = false) AND (v.features_qless IS NULL OR v.features_qless = 0 OR v.features_qless = false) AND (v.features_fleet IS NULL OR v.features_fleet = 0 OR v.features_fleet = false) AND (v.features_realestate IS NULL OR v.features_realestate = 0 OR v.features_realestate = false) AND (v.features_cyber IS NULL OR v.features_cyber = 0 OR v.features_cyber = false) AND (v.features_trust_score IS NULL OR v.features_trust_score = 0 OR v.features_trust_score = false)';
                // Build WHERE clause parts
                const whereParts = [baseWhere];
                if (excludeServiceVendors) whereParts.push(excludeServiceVendors);
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

        LOG.info(`[getVendors] Using in-memory fallback - includeTradeOffer: ${includeTradeOffer}`);
        let filtered = activeOnly ? inMemoryDb.vendors.filter(v => v.is_active) : inMemoryDb.vendors;
        LOG.info(`[getVendors] In-memory vendors before filtering: ${filtered.length}`);
        
        // Filter out service-specific vendors (Trade, Offer, QLess, Fleet, Realestate, Cyber, Trust Score) from main vendor list (unless includeTradeOffer is true)
        if (!includeTradeOffer) {
            filtered = filtered.filter(v => 
                v.features_trade !== true && 
                v.features_offer !== true &&
                v.features_qless !== true &&
                v.features_fleet !== true &&
                v.features_realestate !== true &&
                v.features_cyber !== true &&
                v.features_trust_score !== true
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
        if (!inMemoryDb.queues || !Array.isArray(inMemoryDb.queues)) {
            return [];
        }
        return inMemoryDb.queues.filter(q => q.vendor_id === vendorId && q.status === "waiting")
            .map(q => {
                const u = inMemoryDb.users.find(u => u.id === q.user_id);
                return { ...q, userName: u ? u.name : 'Unknown', userMobile: u ? u.mobile : '' };
            }).sort((a, b) => {
                // Handle cases where joined_at might be undefined or not a number
                const aTime = a.joined_at || 0;
                const bTime = b.joined_at || 0;
                return aTime - bTime;
            });
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
        if (!inMemoryDb.appointments || !Array.isArray(inMemoryDb.appointments)) {
            return [];
        }
        return inMemoryDb.appointments
            .filter(a => a.vendor_id === vendorId)
            .map(a => {
                const u = inMemoryDb.users.find(u => u.id === a.user_id);
                return { ...a, userName: u ? u.name : 'Unknown', userMobile: u ? u.mobile : '' };
            })
            .sort((a, b) => {
                // Handle cases where date/time might be undefined
                const aDate = a.date || '';
                const bDate = b.date || '';
                const dateCompare = aDate.localeCompare(bDate);
                if (dateCompare !== 0) return dateCompare;
                const aTime = a.time || '';
                const bTime = b.time || '';
                return aTime.localeCompare(bTime);
            });
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
            if (pool) {
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS notifications (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        user_id VARCHAR(64),
                        title VARCHAR(255),
                        message TEXT,
                        type VARCHAR(50),
                        data_json TEXT,
                        is_read TINYINT DEFAULT 0,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                const [res] = await pool.query('INSERT INTO notifications SET ?', [payload]);
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
            if (pool) {
                const [rows] = await pool.query(
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
            if (pool) {
                await pool.query('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [notificationId, userId]);
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
            if (pool) {
                await pool.query('DELETE FROM notifications WHERE id = ? AND user_id = ?', [notificationId, userId]);
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

    createActivity: async (activityData) => {
        try {
            if (pool) {
                const { type, user_id, user_name, message, metadata } = activityData;
                const [result] = await pool.query(
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
                        enable_queue: false,
                        enable_appointments: false,
                        enable_shopping: false,
                        enable_matchmaking: false,
                        enable_offer: false,
                        enable_trade: false,
                        enable_qless: false,
                        enable_fleet: true,
                        enable_realestate: false,
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
                        news_user_emails: 'newsuser1',
                        news_vendor_emails: 'newsvendor1',
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
                        enable_lazy_loading: false // Default: false (eager loading for better performance)
                    };
                    const hasEnableNewsRow = rows.some(r => r.key_name === 'enable_news');
                    rows.forEach(r => {
                        if (settings.hasOwnProperty(r.key_name)) {
                            // Handle boolean values
                            if (typeof settings[r.key_name] === 'boolean') {
                                settings[r.key_name] = r.value === 'true' || r.value === 1 || r.value === true;
                            } else {
                                // Handle string values (like theme_position)
                                settings[r.key_name] = r.value;
                            }
                            return;
                        }
                        if (r.key_name === 'enable_trade_news' && !hasEnableNewsRow) {
                            settings.enable_news = r.value === 'true' || r.value === 1 || r.value === true;
                        }
                    });
                    return settings;
                } catch (e) {
                    // Table might not exist, return defaults
                    return { 
                        enable_queue: false, 
                        enable_appointments: false, 
                        enable_shopping: false, 
                        enable_matchmaking: false, 
                        enable_offer: false, 
                        enable_trade: false,
                        enable_qless: false,
                        enable_fleet: true,
                        enable_realestate: false,
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
                        news_user_emails: 'newsuser1',
                        news_vendor_emails: 'newsvendor1',
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
                        auto_scan_auto_clean: false
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
            enable_queue: false,
            enable_appointments: false,
            enable_shopping: false,
            enable_matchmaking: false,
            enable_offer: false,
            enable_trade: false,
            enable_qless: false,
            enable_fleet: true,
            enable_realestate: false,
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
            news_user_emails: 'newsuser1',
            news_vendor_emails: 'newsvendor1',
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
            auto_scan_auto_clean: false
        };
        return { ...defaultSettings, ...inMemoryDb.settings };
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
                            value TEXT
                        )
                    `);
                    try {
                        await pool.query('ALTER TABLE system_settings MODIFY value TEXT');
                    } catch (e) {
                        LOG.warning('system_settings ALTER value TEXT skipped', e.message);
                    }
                    
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
    ,
    ensureNewsCacheTable: async () => {
        if (!pool) return;
        await pool.query(`
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
        if (pool) {
            try {
                await db.ensureNewsCacheTable();
                for (const item of items) {
                    await pool.query(
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
        if (pool) {
            try {
                await db.ensureNewsCacheTable();
                const [rows] = await pool.query(
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
        if (pool) {
            try {
                await db.ensureNewsCacheTable();
                await pool.query('TRUNCATE TABLE news_cache');
                return { success: true };
            } catch (err) {
                LOG.error('MySQL clearNewsCache failed', err.message);
            }
        }
        inMemoryDb.news_cache = [];
        return { success: true };
    }
};

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

// Merge test data from data.js into inMemoryDb
if (testData && typeof testData === 'object') {
    Object.keys(testData).forEach(key => {
        if (Array.isArray(testData[key]) && Array.isArray(inMemoryDb[key])) {
            // Merge arrays: use test data if inMemoryDb array is empty, otherwise merge
            if (inMemoryDb[key].length === 0) {
                inMemoryDb[key] = [...testData[key]];
            } else {
                // Merge unique items based on id
                const existingIds = new Set(inMemoryDb[key].map(item => item.id));
                testData[key].forEach(item => {
                    if (!existingIds.has(item.id)) {
                        inMemoryDb[key].push(item);
                    }
                });
            }
        } else if (testData[key] && !inMemoryDb[key]) {
            // Copy if inMemoryDb doesn't have this key
            inMemoryDb[key] = testData[key];
        }
    });
    LOG.info(`Loaded test data: ${Object.keys(testData).filter(k => Array.isArray(testData[k])).map(k => `${k}(${testData[k].length})`).join(', ')}`);
}

// Copy all inMemoryDb properties directly (for arrays like cyberThreats, threatAlerts, etc.)
Object.keys(inMemoryDb).forEach(key => {
    if (!db.hasOwnProperty(key)) {
        measuredDb[key] = inMemoryDb[key];
    }
});

// Explicitly ensure cyberThreats is exported (for analytics)
if (inMemoryDb.cyberThreats) {
    measuredDb.cyberThreats = inMemoryDb.cyberThreats;
    LOG.info(`Exported cyberThreats: ${measuredDb.cyberThreats.length} threats`);
} else {
    LOG.warning('cyberThreats not found in inMemoryDb');
}

// Explicitly ensure threatIntelligence is exported
if (inMemoryDb.threatIntelligence) {
    measuredDb.threatIntelligence = inMemoryDb.threatIntelligence;
    LOG.info(`Exported threatIntelligence: ${measuredDb.threatIntelligence.length} threats`);
} else {
    LOG.warning('threatIntelligence not found in inMemoryDb');
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
measuredDb.inMemoryDb = inMemoryDb; // Export in-memory DB for trading data service
measuredDb.ensureFleetTables = ensureFleetTables; // Export for fleetService
measuredDb.ensureCyberThreatTables = ensureCyberThreatTables; // Export for cyberThreatService
measuredDb.ensureCyberUsersAndVendor = ensureCyberUsersAndVendor; // Export for cyber sync

module.exports = measuredDb;
