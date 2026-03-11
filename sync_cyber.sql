-- SQL Script to Sync Cyber Users and Vendor to MySQL
-- Run this directly in your MySQL client (phpMyAdmin, MySQL Workbench, etc.)

-- 1. Insert/Update Cyber Users
INSERT INTO users (id, name, email, mobile, role, location_name, created_at) 
VALUES ('usr_cyber1', 'Cyber User 1', 'cyber1@test.com', '8000000011', 'user', 'Mumbai', NOW())
ON DUPLICATE KEY UPDATE 
    name='Cyber User 1', 
    email='cyber1@test.com', 
    mobile='8000000011', 
    role='user', 
    location_name='Mumbai';

INSERT INTO users (id, name, email, mobile, role, location_name, created_at) 
VALUES ('usr_cybervendor1', 'Cyber Vendor 1', 'cybervendor1@test.com', '8000000012', 'vendor', 'Mumbai', NOW())
ON DUPLICATE KEY UPDATE 
    name='Cyber Vendor 1', 
    email='cybervendor1@test.com', 
    mobile='8000000012', 
    role='vendor', 
    location_name='Mumbai';

-- 2. Insert/Update Cyber Vendor
INSERT INTO vendors (
    id, owner_id, shop_name, category, is_active, is_promoted, 
    latitude, longitude, google_link, instagram_handle, facebook_link,
    features_products, features_payments, features_appointments, features_queue,
    features_matchmaking, features_cyber, visibility_top_rated, visibility_list, visibility_feed
) VALUES (
    'v_cyber1', 
    'usr_cybervendor1', 
    'Cyber Shop 1', 
    'Cyber', 
    1,  -- is_active (MUST be 1)
    0,  -- is_promoted
    0,  -- latitude
    0,  -- longitude
    '', -- google_link
    '', -- instagram_handle
    '', -- facebook_link
    1,  -- features_products
    1,  -- features_payments
    1,  -- features_appointments
    1,  -- features_queue
    0,  -- features_matchmaking
    1,  -- features_cyber (MUST be 1)
    0,  -- visibility_top_rated
    1,  -- visibility_list (MUST be 1)
    0   -- visibility_feed
)
ON DUPLICATE KEY UPDATE
    owner_id='usr_cybervendor1',
    shop_name='Cyber Shop 1',
    category='Cyber',
    is_active=1,
    features_cyber=1,  -- CRITICAL: Must be 1
    visibility_list=1; -- CRITICAL: Must be 1

-- 3. Verify the data
SELECT 'Users' as type, id, name, email, mobile, role FROM users WHERE id IN ('usr_cyber1', 'usr_cybervendor1')
UNION ALL
SELECT 'Vendor' as type, id, shop_name as name, owner_id as email, '' as mobile, category as role FROM vendors WHERE id = 'v_cyber1';

-- 4. Check critical vendor fields
SELECT 
    id,
    shop_name,
    owner_id,
    features_cyber,
    is_active,
    visibility_list,
    CASE 
        WHEN features_cyber = 1 AND is_active = 1 AND visibility_list = 1 THEN '✓ All OK'
        ELSE '✗ Check values'
    END as status
FROM vendors 
WHERE id = 'v_cyber1';

