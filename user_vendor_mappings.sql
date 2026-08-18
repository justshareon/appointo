-- User-Vendor Mappings schema
-- Matches inMemoryDb.user_vendor_mappings in database.js
-- Current runtime uses in-memory. Run this script when switching DB_TYPE=mysql.

USE qr_queue;

CREATE TABLE IF NOT EXISTS user_vendor_mappings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    vendor_id VARCHAR(64) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_user_vendor (user_id, vendor_id),
    INDEX idx_user (user_id),
    INDEX idx_vendor (vendor_id)
);

-- Seed rows copied from inMemoryDb.user_vendor_mappings
INSERT IGNORE INTO user_vendor_mappings (id, user_id, vendor_id) VALUES
(1, 'usr_user', 'v_1'),
(2, 'usr_user', 'v_new1'),
(3, 'usr_u1', 'v_new1'),
(4, 'usr_u2', 'v_new1'),
(5, 'usr_u3', 'v_new1'),
(6, 'usr_u4', 'v_new1'),
(7, 'usr_u5', 'v_new1'),
(8, 'usr_temple_user', 'v_4'),
(9, 'usr_rahul', 'v_5'),
(10, 'usr_new_patient', 'v_3'),
(11, 'usr_trade1', 'v_trade1'),
(12, 'usr_offer1', 'v_offer1'),
(13, 'usr_qlessuser1', 'v_qless1'),
(14, 'usr_fleetuser1', 'v_fleet1'),
(15, 'usr_realuser1', 'v_realestate1'),
(16, 'usr_cyber1', 'v_cyber1'),
(17, 'usr_match_u1', 'v_match_super'),
(18, 'usr_match_u2', 'v_match_super');
