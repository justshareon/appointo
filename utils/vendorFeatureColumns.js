/**
 * Shared vendor feature-flag columns for in-memory ↔ MySQL sync.
 * Keep in sync with SERVICE_FEATURES in database.js.
 */
const VENDOR_FEATURE_COLUMNS = [
  'features_cyber',
  'features_trade',
  'features_offer',
  'features_qless',
  'features_fleet',
  'features_r_detector',
  'features_realestate',
  'features_trust_score',
  'features_news',
];

const ALTER_VENDOR_FEATURE_SQL = `
  ALTER TABLE vendors
    ADD COLUMN IF NOT EXISTS features_queue TINYINT(1) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS features_matchmaking TINYINT(1) DEFAULT 0,
    ${VENDOR_FEATURE_COLUMNS.map((c) => `ADD COLUMN IF NOT EXISTS ${c} TINYINT(1) DEFAULT 0`).join(',\n    ')},
    ADD COLUMN IF NOT EXISTS visibility_top_rated TINYINT(1) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS visibility_list TINYINT(1) DEFAULT 1,
    ADD COLUMN IF NOT EXISTS visibility_feed TINYINT(1) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS location_name VARCHAR(255)
`;

const BASE_VENDOR_INSERT_COLUMNS = [
  'id', 'owner_id', 'shop_name', 'category', 'is_active', 'is_promoted',
  'latitude', 'longitude', 'google_link', 'instagram_handle', 'facebook_link',
  'features_products', 'features_payments', 'features_appointments', 'features_queue',
  'features_matchmaking',
  ...VENDOR_FEATURE_COLUMNS,
  'visibility_top_rated', 'visibility_list', 'visibility_feed', 'location_name',
];

function flag(vendor, key) {
  return vendor?.[key] === true || vendor?.[key] === 1 || vendor?.[key] === '1' ? 1 : 0;
}

function vendorRowFromSeed(vendor) {
  return {
    id: vendor.id,
    owner_id: vendor.owner_id || '',
    shop_name: vendor.shop_name || '',
    category: vendor.category || '',
    is_active: vendor.is_active !== false ? 1 : 0,
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
    features_matchmaking: flag(vendor, 'features_matchmaking'),
    features_cyber: flag(vendor, 'features_cyber'),
    features_trade: flag(vendor, 'features_trade'),
    features_offer: flag(vendor, 'features_offer'),
    features_qless: flag(vendor, 'features_qless'),
    features_fleet: flag(vendor, 'features_fleet'),
    features_r_detector: flag(vendor, 'features_r_detector'),
    features_realestate: flag(vendor, 'features_realestate'),
    features_trust_score: flag(vendor, 'features_trust_score'),
    features_news: flag(vendor, 'features_news'),
    visibility_top_rated: flag(vendor, 'visibility_top_rated'),
    visibility_list: vendor.visibility_list !== false ? 1 : 0,
    visibility_feed: flag(vendor, 'visibility_feed'),
    location_name: vendor.location_name || '',
  };
}

function vendorInsertPlaceholders(count = BASE_VENDOR_INSERT_COLUMNS.length) {
  return Array(count).fill('?').join(', ');
}

function vendorUpsertUpdateClause() {
  return BASE_VENDOR_INSERT_COLUMNS
    .filter((c) => c !== 'id')
    .map((c) => `${c} = VALUES(${c})`)
    .join(',\n    ');
}

module.exports = {
  VENDOR_FEATURE_COLUMNS,
  ALTER_VENDOR_FEATURE_SQL,
  BASE_VENDOR_INSERT_COLUMNS,
  vendorRowFromSeed,
  vendorInsertPlaceholders,
  vendorUpsertUpdateClause,
};
