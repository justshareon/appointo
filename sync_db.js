const mysql = require('mysql2/promise');
require('dotenv').config();

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

// --- IN-MEMORY DATA REPLICATION ---
const inMemoryDb = {
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
            features_offer: false,
            visibility_top_rated: false,
            visibility_list: true,
            visibility_feed: false
        },
        {
            id: 'v_offer1',
            owner_id: 'usr_offer1vendor',
            shop_name: 'Offer Shop 1',
            category: 'Offers',
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
            features_trade: false,
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
            features_products: false,
            features_payments: false,
            features_appointments: false,
            features_queue: false,
            features_matchmaking: false,
            features_trade: false,
            features_offer: false,
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
            features_products: false,
            features_payments: false,
            features_appointments: false,
            features_queue: false,
            features_matchmaking: false,
            features_trade: false,
            features_offer: false,
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
            features_trade: false,
            features_offer: false,
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
        { id: 15, user_id: 'usr_realuser1', vendor_id: 'v_realestate1' },
        { id: 16, user_id: 'usr_match_u1', vendor_id: 'v_match_super' },
        { id: 17, user_id: 'usr_match_u2', vendor_id: 'v_match_super' },
    ],
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
        enable_news: true,
        news_user_emails: 'newsuser11',
        news_vendor_emails: 'newsvendor1'
    },
    matchmaking_templates: [
        {
            vendor_id: 'v_match_super',
            template_name: 'Super Admin Matchmaking Basic',
            selected_preset: 'classic_marriage_v1',
            template_json: JSON.stringify([
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
            ]),
            scoring_json: JSON.stringify({ pass: 50, good: 70, best: 90 }),
            is_active: true
        }
    ]
};

async function ensureCoreTables(connection) {
    await connection.query(`
        CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(255) PRIMARY KEY,
            name VARCHAR(255),
            email VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255),
            role ENUM('user', 'vendor', 'super_admin') DEFAULT 'user',
            mobile VARCHAR(20),
            location_name VARCHAR(255),
            loyalty_points INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await connection.query(`
        CREATE TABLE IF NOT EXISTS vendors (
            id VARCHAR(255) PRIMARY KEY,
            owner_id VARCHAR(255),
            shop_name VARCHAR(255),
            category VARCHAR(100),
            is_active BOOLEAN DEFAULT TRUE,
            is_promoted BOOLEAN DEFAULT FALSE,
            latitude DECIMAL(10, 8),
            longitude DECIMAL(11, 8),
            branding_primary_color VARCHAR(10) DEFAULT '#6200ee',
            branding_bg_color VARCHAR(10) DEFAULT '#f8f9fa',
            google_link TEXT,
            instagram_handle VARCHAR(100),
            facebook_link TEXT,
            sms_enabled BOOLEAN DEFAULT FALSE,
            features_products BOOLEAN DEFAULT TRUE,
            features_payments BOOLEAN DEFAULT TRUE,
            features_appointments BOOLEAN DEFAULT TRUE,
            features_queue BOOLEAN DEFAULT TRUE,
            features_matchmaking BOOLEAN DEFAULT FALSE,
            features_trade BOOLEAN DEFAULT FALSE,
            features_offer BOOLEAN DEFAULT FALSE,
            features_qless BOOLEAN DEFAULT FALSE,
            features_fleet BOOLEAN DEFAULT FALSE,
            features_realestate BOOLEAN DEFAULT FALSE,
            gateway_razorpay BOOLEAN DEFAULT TRUE,
            gateway_sabpaisa BOOLEAN DEFAULT TRUE,
            visibility_top_rated BOOLEAN DEFAULT TRUE,
            visibility_list BOOLEAN DEFAULT TRUE,
            visibility_feed BOOLEAN DEFAULT TRUE
        )
    `);
    await connection.query(`
        CREATE TABLE IF NOT EXISTS products (
            id INT AUTO_INCREMENT PRIMARY KEY,
            vendor_id VARCHAR(255),
            name VARCHAR(255),
            price DECIMAL(10, 2),
            description TEXT,
            offer VARCHAR(255),
            offer_amount DECIMAL(10, 2) DEFAULT 0,
            image_urls_json JSON,
            validity_from DATE,
            validity_to DATE,
            category VARCHAR(100),
            stock INT DEFAULT 0
        )
    `);
    await connection.query(`
        CREATE TABLE IF NOT EXISTS orders (
            id INT AUTO_INCREMENT PRIMARY KEY,
            vendor_id VARCHAR(255) NOT NULL,
            user_id VARCHAR(255) NOT NULL,
            total_amount DECIMAL(10,2) NOT NULL,
            payment_gateway VARCHAR(30),
            payment_ref VARCHAR(255),
            status ENUM('paid', 'pending', 'failed') DEFAULT 'paid',
            items_json JSON,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await connection.query(`
        CREATE TABLE IF NOT EXISTS queues (
            id INT AUTO_INCREMENT PRIMARY KEY,
            vendor_id VARCHAR(255),
            user_id VARCHAR(255),
            status ENUM('waiting', 'serving', 'done', 'cancelled') DEFAULT 'waiting',
            position INT,
            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await connection.query(`
        CREATE TABLE IF NOT EXISTS appointments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            vendor_id VARCHAR(255),
            user_id VARCHAR(255),
            date DATE,
            time TIME,
            status ENUM('pending', 'confirmed', 'completed', 'cancelled') DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await connection.query(`
        CREATE TABLE IF NOT EXISTS activities (
            id INT AUTO_INCREMENT PRIMARY KEY,
            type VARCHAR(50),
            vendor_id VARCHAR(255),
            user_id VARCHAR(255),
            user_name VARCHAR(255),
            message TEXT,
            metadata JSON,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

async function sync() {
    console.log("Starting MySQL Sync...");
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com',
        port: process.env.DB_PORT || 4000,
        user: process.env.DB_USER || '45gthaydhVD1pM3.root',
        password: process.env.DB_PASSWORD || 'XHSYhumyCXkvaj9m',
        database: process.env.DB_NAME || 'qr_queue',
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log("Connected to MySQL.");
        console.log("Ensuring tables exist (CREATE IF NOT EXISTS)...");
        await ensureCoreTables(connection);

        // 1. ALTER USERS TABLE
        try {
            await connection.query(`ALTER TABLE users ADD COLUMN location_name VARCHAR(255) DEFAULT NULL`);
            console.log("Added location_name to users.");
        } catch (e) {
            if (e.code !== 'ER_DUP_FIELDNAME') console.log("Skipping users column add:", e.message);
        }

        // 2. ALTER VENDORS TABLE
        const vendorCols = [
            'features_queue BOOLEAN DEFAULT TRUE',
            'features_appointments BOOLEAN DEFAULT TRUE', 
            'features_products BOOLEAN DEFAULT TRUE',
            'features_payments BOOLEAN DEFAULT TRUE',
            'features_matchmaking BOOLEAN DEFAULT FALSE',
            'features_trade BOOLEAN DEFAULT FALSE',
            'features_offer BOOLEAN DEFAULT FALSE',
            'features_qless BOOLEAN DEFAULT FALSE',
            'features_fleet BOOLEAN DEFAULT FALSE',
            'features_realestate BOOLEAN DEFAULT FALSE',
            'gateway_razorpay BOOLEAN DEFAULT TRUE',
            'gateway_sabpaisa BOOLEAN DEFAULT TRUE',
            'visibility_top_rated BOOLEAN DEFAULT TRUE',
            'visibility_list BOOLEAN DEFAULT TRUE',
            'visibility_feed BOOLEAN DEFAULT TRUE'
        ];

        for (const col of vendorCols) {
            try {
                await connection.query(`ALTER TABLE vendors ADD COLUMN ${col}`);
                console.log(`Added ${col.split(' ')[0]} to vendors.`);
            } catch (e) {
                if (e.code !== 'ER_DUP_FIELDNAME') console.log(`Skipping vendors column add (${col.split(' ')[0]}):`, e.message);
            }
        }

        // 3. SYNC USERS — insert missing only; leave existing MySQL rows unchanged
        console.log("Syncing Users (insert missing, ignore existing)...");
        const [existingUsers] = await connection.query('SELECT id FROM users');
        const existingUserIds = new Set(existingUsers.map(u => u.id));
        let usersInserted = 0;
        for (const u of inMemoryDb.users) {
            if (existingUserIds.has(u.id)) continue;
            await connection.query(
                `INSERT IGNORE INTO users (id, name, email, mobile, role, location_name, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                [u.id, u.name, u.email, u.mobile, u.role, u.location_name]
            );
            usersInserted++;
        }
        console.log(`Users: inserted ${usersInserted}, ignored ${inMemoryDb.users.length - usersInserted} existing (${existingUsers.length} already in MySQL)`);

        // 4. SYNC VENDORS — insert missing only
        console.log("Syncing Vendors (insert missing, ignore existing)...");
        for (const v of inMemoryDb.vendors) {
            await connection.query(
                `INSERT IGNORE INTO vendors (
                    id, owner_id, shop_name, category, is_active, is_promoted, latitude, longitude,
                    google_link, instagram_handle, facebook_link,
                    features_products, features_payments, features_appointments, features_queue, features_matchmaking,
                    features_trade, features_offer, features_qless, features_fleet, features_realestate,
                    gateway_razorpay, gateway_sabpaisa,
                    visibility_top_rated, visibility_list, visibility_feed
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    v.id, v.owner_id, v.shop_name, v.category, v.is_active, v.is_promoted, v.latitude, v.longitude,
                    v.google_link, v.instagram_handle, v.facebook_link,
                    v.features_products, v.features_payments, v.features_appointments, v.features_queue, v.features_matchmaking,
                    v.features_trade || false, v.features_offer || false, v.features_qless || false, v.features_fleet || false, v.features_realestate || false,
                    v.gateway_razorpay, v.gateway_sabpaisa,
                    v.visibility_top_rated, v.visibility_list, v.visibility_feed
                ]
            );
        }

        // 5. SYNC PRODUCTS — insert missing only
        console.log("Syncing Products (insert missing, ignore existing)...");
        for (const p of inMemoryDb.products) {
            const imageUrlsJson = JSON.stringify(p.image_urls || []);
            await connection.query(
                `INSERT IGNORE INTO products (id, vendor_id, name, price, offer, offer_amount, validity_from, validity_to, image_urls_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [p.id, p.vendor_id, p.name, p.price, p.offer, p.offer_amount, p.validity_from, p.validity_to, imageUrlsJson]
            );
        }

        // 6. SYNC ORDERS — insert missing only
        console.log("Syncing Orders (insert missing, ignore existing)...");
        const [existingOrders] = await connection.query('SELECT id FROM orders');
        const existingOrderIds = new Set(existingOrders.map(o => o.id));
        let ordersInserted = 0;
        for (const o of inMemoryDb.orders) {
            if (existingOrderIds.has(o.id)) continue;
            await connection.query(
                `INSERT IGNORE INTO orders (id, vendor_id, user_id, total_amount, created_at)
                 VALUES (?, ?, ?, ?, ?)`,
                [o.id, o.vendor_id, o.user_id, o.total_amount, o.created_at || new Date()]
            );
            ordersInserted++;
        }
        console.log(`Orders: inserted ${ordersInserted}, ignored ${inMemoryDb.orders.length - ordersInserted} existing`);

        // 7. SYNC QUEUES — insert missing only
        console.log("Syncing Queues (insert missing, ignore existing)...");
        const [existingQueues] = await connection.query('SELECT id FROM queues');
        const existingQueueIds = new Set(existingQueues.map(q => q.id));
        let queuesInserted = 0;
        for (const q of inMemoryDb.queues) {
            if (existingQueueIds.has(q.id)) continue;
            await connection.query(
                `INSERT IGNORE INTO queues (id, vendor_id, user_id, status, joined_at)
                 VALUES (?, ?, ?, ?, ?)`,
                [q.id, q.vendor_id, q.user_id, q.status, q.joined_at || new Date()]
            );
            queuesInserted++;
        }
        console.log(`Queues: inserted ${queuesInserted}, ignored ${inMemoryDb.queues.length - queuesInserted} existing`);

        // 8. SYNC APPOINTMENTS — insert missing only
        console.log("Syncing Appointments (insert missing, ignore existing)...");
        const [existingAppointments] = await connection.query('SELECT id FROM appointments');
        const existingAppointmentIds = new Set(existingAppointments.map(a => a.id));
        let appointmentsInserted = 0;
        for (const a of inMemoryDb.appointments) {
            if (existingAppointmentIds.has(a.id)) continue;
            await connection.query(
                `INSERT IGNORE INTO appointments (id, vendor_id, user_id, date, time, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [a.id, a.vendor_id, a.user_id, a.date, a.time, a.status, a.created_at || new Date()]
            );
            appointmentsInserted++;
        }
        console.log(`Appointments: inserted ${appointmentsInserted}, ignored ${inMemoryDb.appointments.length - appointmentsInserted} existing`);

        // 9. SYNC SYSTEM SETTINGS
        console.log("Syncing System Settings...");
        await connection.query(`
             CREATE TABLE IF NOT EXISTS system_settings (
                key_name VARCHAR(50) PRIMARY KEY, 
                value VARCHAR(10)
            )
        `);
        for (const [key, val] of Object.entries(inMemoryDb.settings)) {
             await connection.query(
                'INSERT IGNORE INTO system_settings (key_name, value) VALUES (?, ?)',
                [key, String(val)]
            );
        }

        // 10. ENSURE OTPS TABLE
        console.log("Ensuring OTP Table...");
        await connection.query(`
            CREATE TABLE IF NOT EXISTS otps (
                id INT AUTO_INCREMENT PRIMARY KEY,
                mobile VARCHAR(15) NOT NULL,
                otp VARCHAR(10) NOT NULL,
                expires_at DATETIME,
                created_at DATETIME
            )
        `);
        // Fix for missing columns if table existed but without created_at
        try {
            await connection.query(`ALTER TABLE otps ADD COLUMN created_at DATETIME`);
            console.log("Added created_at column to otps.");
        } catch (e) {
            if (e.code !== 'ER_DUP_FIELDNAME') console.log("Skipping otps column add:", e.message);
        }

        // 11. ENSURE MATCHMAKING TABLES
        console.log("Ensuring Matchmaking Tables...");
        await connection.query(`
            CREATE TABLE IF NOT EXISTS matchmaking_templates (
                id INT AUTO_INCREMENT PRIMARY KEY,
                vendor_id VARCHAR(64) NOT NULL UNIQUE,
                template_name VARCHAR(255) NOT NULL,
                selected_preset VARCHAR(120) NOT NULL,
                template_json LONGTEXT NOT NULL,
                scoring_json LONGTEXT NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        await connection.query(`
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
        console.log("Syncing Matchmaking Templates...");
        for (const t of inMemoryDb.matchmaking_templates || []) {
            await connection.query(
                `INSERT IGNORE INTO matchmaking_templates (vendor_id, template_name, selected_preset, template_json, scoring_json, is_active)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    t.vendor_id,
                    t.template_name,
                    t.selected_preset || 'custom',
                    t.template_json || '[]',
                    t.scoring_json || '{"pass":50,"good":70,"best":90}',
                    t.is_active === false ? 0 : 1
                ]
            );
        }

        // 12. ENSURE USER-VENDOR MAPPINGS TABLE
        console.log("Ensuring User-Vendor Mappings Table...");
        await connection.query(`
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
        console.log("Syncing User-Vendor Mappings...");
        for (const m of inMemoryDb.user_vendor_mappings || []) {
            await connection.query(
                `INSERT IGNORE INTO user_vendor_mappings (user_id, vendor_id, created_at) VALUES (?, ?, NOW())`,
                [m.user_id, m.vendor_id]
            );
        }
        console.log(`Synced ${(inMemoryDb.user_vendor_mappings || []).length} user-vendor mappings`);

        console.log("Sync Completed Successfully!");

    } catch (e) {
        console.error("Sync Failed:", e);
    } finally {
        await connection.end();
    }
}

if (require.main === module) {
    sync();
}

module.exports = { sync, ensureCoreTables };

