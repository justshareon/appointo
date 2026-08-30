/**
 * Single catalog for every product feature.
 *
 * Add a feature later:
 *   1. Add an entry here (id, memory spec, mysql pool).
 *   2. Optional: backend/database/features/<id>.js  (CRUD / ensureTables).
 *   3. Optional: CREATE/ALTER in schema/featureTables.js (never DROP / TRUNCATE).
 *   4. Mount routes with featureDb('<id>') from middleware/featureDbMiddleware.
 *   5. Optional: add screens to navigation/lazyScreens.js FEATURE_SCREEN_GROUPS.
 *
 * In-memory arrays listed in `memory.seedKeys` stay empty at boot and copy from
 * database/data.js on first open. MySQL tables/columns are created on first open.
 */
const CYBER_KEYS = [
    'surakshaValidations',
    'surakshaReports',
    'surakshaDevices',
    'spamNumbers',
    'callHistory',
    'communityReports',
    'cyberThreats',
    'autoValidationDetections',
    'mobileSecurityScans',
    'notificationValidations',
    'threatIntelligence',
    'threatAlerts',
    'cyberSecurityTips',
];

const TRUST_KEYS = [
    'trustScoreProjects',
    'trustScoreFraudAlerts',
    'trustScoreBuilders',
    'trustScoreReviews',
    'trustScoreComplaints',
    'trustScoreWatchlist',
    'trustScoreLandLedger',
    'trustScoreContributorScores',
    'trustScoreApiConfigs',
];

function mem(arrays, extra = {}) {
    return {
        arrays,
        nested: extra.nested || [],
        seedKeys: extra.seedKeys != null ? extra.seedKeys : arrays,
        reclaim: extra.reclaim !== false,
    };
}

const FEATURES = {
    core: {
        id: 'core',
        label: 'Core',
        mysql: true,
        lazy: false,
        memory: { arrays: [], nested: [], seedKeys: [], reclaim: false },
    },
    queue: {
        id: 'queue',
        label: 'Queue',
        mysql: true,
        lazy: true,
        memory: mem([], { reclaim: false }),
    },
    appointments: {
        id: 'appointments',
        label: 'Appointments',
        mysql: true,
        lazy: true,
        memory: mem([], { reclaim: false }),
    },
    shopping: {
        id: 'shopping',
        label: 'Shopping',
        mysql: true,
        lazy: true,
        memory: mem([], { reclaim: false }),
    },
    matchmaking: {
        id: 'matchmaking',
        label: 'Matchmaking',
        mysql: true,
        lazy: true,
        memory: mem(['matchmaking_templates', 'matchmaking_submissions']),
    },
    chat: {
        id: 'chat',
        label: 'Chat',
        mysql: true,
        lazy: true,
        memory: mem(['chat_messages'], { seedKeys: [] }),
    },
    trade: {
        id: 'trade',
        label: 'Trade',
        mysql: true,
        lazy: true,
        memory: mem(['boardMeetings', 'corporateActions'], {
            nested: [
                ['stockData', 'live_stock_data'],
                ['stockData', 'stock_data_history'],
                ['mutualFundData', 'mutual_funds'],
                ['mutualFundData', 'mutual_fund_history'],
            ],
            seedKeys: [],
        }),
    },
    news: {
        id: 'news',
        label: 'News',
        mysql: true,
        lazy: true,
        memory: mem([], { reclaim: false }),
    },
    offer: {
        id: 'offer',
        label: 'Offer',
        mysql: true,
        lazy: true,
        memory: mem([], { reclaim: false }),
    },
    qless: {
        id: 'qless',
        label: 'QLess',
        mysql: true,
        lazy: true,
        memory: mem([], { reclaim: false }),
    },
    fleet: {
        id: 'fleet',
        label: 'Fleet',
        mysql: true,
        lazy: true,
        memory: mem([], { reclaim: false }),
    },
    r_detector: {
        id: 'r_detector',
        label: 'R-Detector',
        mysql: true,
        lazy: true,
        memory: mem(
            [
                'r_detector_activity_pings',
                'r_detector_commute_trips',
                'r_detector_commute_routes',
                'r_detector_commute_schedules',
                'r_detector_scan_results',
            ],
            { reclaim: false }
        ),
    },
    realestate: {
        id: 'realestate',
        label: 'Real estate',
        mysql: true,
        lazy: true,
        memory: mem(['real_estate_properties', 'real_estate_enquiries'], { reclaim: false }),
    },
    cyber: {
        id: 'cyber',
        label: 'Cyber',
        mysql: true,
        lazy: true,
        memory: mem(CYBER_KEYS),
    },
    trust_score: {
        id: 'trust_score',
        label: 'Trust Score',
        mysql: true,
        lazy: true,
        memory: mem(TRUST_KEYS),
    },
    health: {
        id: 'health',
        label: 'Health Predict',
        mysql: true,
        lazy: true,
        memory: mem([], { reclaim: false }),
    },
};

const FEATURE_IDS = Object.keys(FEATURES);
const MYSQL_FEATURES = FEATURE_IDS.filter((id) => FEATURES[id].mysql);
const LAZY_FEATURES = FEATURE_IDS.filter((id) => FEATURES[id].lazy);

function getFeature(id) {
    return FEATURES[id] || null;
}

function getFeatureDataMap() {
    const map = {};
    for (const id of LAZY_FEATURES) {
        const m = FEATURES[id].memory || {};
        map[id] = {
            arrays: m.arrays || [],
            nested: m.nested || [],
            seedKeys: m.seedKeys || [],
            reclaim: m.reclaim !== false,
        };
    }
    return map;
}

module.exports = {
    FEATURES,
    FEATURE_IDS,
    MYSQL_FEATURES,
    LAZY_FEATURES,
    getFeature,
    getFeatureDataMap,
};
