-- Production MySQL bootstrap for APS + release modules (run after base schema / sync:all).
-- Safe to re-run: uses INSERT ... ON DUPLICATE KEY UPDATE.

CREATE TABLE IF NOT EXISTS system_settings (
  key_name VARCHAR(128) PRIMARY KEY,
  value TEXT
);

-- APS runtime storage toggle (mysql | inmemory); empty = follow DB_TYPE env
INSERT INTO system_settings (key_name, value) VALUES ('aps_runtime_db_type', 'inmemory')
  ON DUPLICATE KEY UPDATE value = VALUES(value);

-- Trading Excel metadata (Discover market date)
INSERT INTO system_settings (key_name, value) VALUES ('trading_excel_data_as_of', '')
  ON DUPLICATE KEY UPDATE key_name = key_name;
INSERT INTO system_settings (key_name, value) VALUES ('trading_excel_uploaded_at', '')
  ON DUPLICATE KEY UPDATE key_name = key_name;

-- Pool floors (super-admin APS can override in app)
INSERT INTO system_settings (key_name, value) VALUES ('db_pool_min_limit', '3')
  ON DUPLICATE KEY UPDATE value = IF(value IS NULL OR value = '', VALUES(value), value);
INSERT INTO system_settings (key_name, value) VALUES ('db_pool_default_limit', '5')
  ON DUPLICATE KEY UPDATE value = IF(value IS NULL OR value = '', VALUES(value), value);

-- Feature flags often stored as settings keys (ensure rows exist; values from admin UI / seed)
INSERT INTO system_settings (key_name, value) VALUES ('enable_news', 'true')
  ON DUPLICATE KEY UPDATE key_name = key_name;
INSERT INTO system_settings (key_name, value) VALUES ('enable_offer', 'true')
  ON DUPLICATE KEY UPDATE key_name = key_name;
INSERT INTO system_settings (key_name, value) VALUES ('enable_trade', 'true')
  ON DUPLICATE KEY UPDATE key_name = key_name;
INSERT INTO system_settings (key_name, value) VALUES ('enable_smart', 'true')
  ON DUPLICATE KEY UPDATE key_name = key_name;
INSERT INTO system_settings (key_name, value) VALUES ('enable_r_detector', 'true')
  ON DUPLICATE KEY UPDATE key_name = key_name;

-- sync_module_state is created by app migrations; after bootstrap run:
--   cd backend && npm run sync:all
-- APS revalidate aligns last 4h memory <-> MySQL when toggling storage mode.
