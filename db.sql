CREATE DATABASE IF NOT EXISTS qr_queue;
USE qr_queue;

-- Users Table
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
);

-- Vendors Table
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
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- Products Table
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
    stock INT DEFAULT 0,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);

-- Orders Table
CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vendor_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    payment_gateway VARCHAR(30),
    payment_ref VARCHAR(255),
    status ENUM('paid', 'pending', 'failed') DEFAULT 'paid',
    items_json JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Queue Table
CREATE TABLE IF NOT EXISTS queues (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vendor_id VARCHAR(255),
    user_id VARCHAR(255),
    status ENUM('waiting', 'serving', 'done', 'cancelled') DEFAULT 'waiting',
    position INT,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Appointments Table
CREATE TABLE IF NOT EXISTS appointments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vendor_id VARCHAR(255),
    user_id VARCHAR(255),
    date DATE,
    time TIME,
    status ENUM('pending', 'confirmed', 'completed', 'cancelled') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Activities Table
CREATE TABLE IF NOT EXISTS activities (
    id INT AUTO_INCREMENT PRIMARY KEY,
    type VARCHAR(50),
    user_id VARCHAR(255),
    user_name VARCHAR(255),
    message TEXT,
    metadata JSON,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- OTP Table
CREATE TABLE IF NOT EXISTS otps (
    id INT AUTO_INCREMENT PRIMARY KEY,
    mobile VARCHAR(20) NOT NULL,
    otp VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed users with fixed roles/mobiles
INSERT INTO users (id, name, email, role, mobile, location_name)
VALUES
('usr_admin', 'Super Admin', 'admin@qrqueue.com', 'super_admin', '9999999999', 'HQ'),
('usr_vendor', 'Demo Vendor', 'vendor@qrqueue.com', 'vendor', '8888888888', 'City Center'),
('usr_user', 'Demo User', 'user@qrqueue.com', 'user', '7777777777', 'Downtown'),
('usr_temple_owner', 'Temple Admin', 'temple@qrqueue.com', 'vendor', '6666666666', 'Temple Area'),
('usr_temple_user', 'Temple User', 'devotee@qrqueue.com', 'user', '5555555555', 'Temple Area'),
('usr_new_patient', 'Clinic Patient', 'patient@example.com', 'user', '4444444444', 'Medical Square')
ON DUPLICATE KEY UPDATE
name = VALUES(name),
role = VALUES(role),
mobile = VALUES(mobile),
location_name = VALUES(location_name);

-- Seed vendor mapped to vendor user
INSERT INTO vendors (
    id, owner_id, shop_name, category, is_active, is_promoted, latitude, longitude,
    google_link, instagram_handle, facebook_link, features_products, features_payments, features_appointments
)
VALUES
('v_1', 'usr_vendor', 'Smile Dental Clinic', 'Medical', TRUE, TRUE, 0, 0, 'https://g.page/r/smile-dental-clinic', 'smiledentalclinic', 'https://facebook.com/smiledentalclinic', TRUE, TRUE, TRUE),
('v_2', 'usr_vendor', 'Star Salon', 'Services', TRUE, FALSE, 0, 0, 'https://g.page/r/star-salon', 'starsalonofficial', 'https://facebook.com/starsalon', TRUE, FALSE, TRUE),
('v_3', 'usr_admin', 'Admin Health Hub', 'Healthcare', TRUE, TRUE, 0, 0, 'https://g.page/r/admin-health-hub', 'adminhealthhub', 'https://facebook.com/adminhealthhub', TRUE, TRUE, TRUE),
('v_4', 'usr_temple_owner', 'City Temple', 'Temple', TRUE, FALSE, 0, 0, 'https://maps.google.com/?q=city+temple', 'citytempleofficial', 'https://facebook.com/citytemple', FALSE, FALSE, TRUE)
ON DUPLICATE KEY UPDATE
owner_id = VALUES(owner_id),
shop_name = VALUES(shop_name),
category = VALUES(category),
is_active = VALUES(is_active),
is_promoted = VALUES(is_promoted),
google_link = VALUES(google_link),
instagram_handle = VALUES(instagram_handle),
facebook_link = VALUES(facebook_link),
features_products = VALUES(features_products),
features_payments = VALUES(features_payments),
features_appointments = VALUES(features_appointments);

-- Seed sample products
INSERT INTO products (vendor_id, name, price, offer, offer_amount, image_urls_json, validity_from, validity_to, category, stock)
VALUES
('v_1', 'Dental Cleaning Package', 999.00, '10% OFF', 100.00, JSON_ARRAY('https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=800', 'https://images.unsplash.com/photo-1588776814546-ec7e4f0f4c6e?w=800', 'https://images.unsplash.com/photo-1609840114035-3c981b782dfe?w=800'), '2026-01-01', '2026-12-31', 'Dental', 50),
('v_1', 'Teeth Whitening', 1499.00, '15% OFF', 225.00, JSON_ARRAY('https://images.unsplash.com/photo-1588776814546-daab30f310ce?w=800', 'https://images.unsplash.com/photo-1598256989800-fe5f95da9787?w=800', 'https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=800'), '2026-01-01', '2026-12-31', 'Dental', 30),
('v_1', 'Root Canal Consultation', 699.00, 'Flat 50 OFF', 50.00, JSON_ARRAY('https://images.unsplash.com/photo-1606811841689-23dfddce3e95?w=800', 'https://images.unsplash.com/photo-1593022356769-11f762e25ed9?w=800', 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=800'), '2026-01-01', '2026-12-31', 'Dental', 45),
('v_1', 'Dental X-Ray', 499.00, 'No Offer', 0.00, JSON_ARRAY('https://images.unsplash.com/photo-1583912267550-d4bcdd8f8b9e?w=800', 'https://images.unsplash.com/photo-1516549655169-df83a0774514?w=800', 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=800'), '2026-01-01', '2026-12-31', 'Dental', 60),
('v_2', 'Hair Spa Premium', 799.00, 'Flat 100 OFF', 100.00, JSON_ARRAY(), '2026-01-01', '2026-12-31', 'Salon', 80),
('v_3', 'Health Checkup Basic', 1299.00, 'Free Follow-up', 0.00, JSON_ARRAY(), '2026-01-01', '2026-12-31', 'Healthcare', 40),
('v_4', 'Prasad Combo', 199.00, 'Temple Special', 20.00, JSON_ARRAY(), '2026-01-01', '2026-12-31', 'Temple', 100)
ON DUPLICATE KEY UPDATE
price = VALUES(price),
offer = VALUES(offer),
offer_amount = VALUES(offer_amount),
image_urls_json = VALUES(image_urls_json),
validity_from = VALUES(validity_from),
validity_to = VALUES(validity_to),
stock = VALUES(stock);

-- Seed queues/history (waiting)
INSERT INTO queues (id, vendor_id, user_id, status, joined_at)
VALUES
(1, 'v_1', 'usr_user', 'waiting', DATE_SUB(NOW(), INTERVAL 20 MINUTE)),
(2, 'v_1', 'usr_admin', 'waiting', DATE_SUB(NOW(), INTERVAL 10 MINUTE)),
(3, 'v_4', 'usr_temple_user', 'waiting', DATE_SUB(NOW(), INTERVAL 15 MINUTE))
ON DUPLICATE KEY UPDATE
status = VALUES(status),
joined_at = VALUES(joined_at);

-- Seed appointments
INSERT INTO appointments (id, vendor_id, user_id, date, time, status)
VALUES
(1, 'v_1', 'usr_user', '2026-02-15', '10:30:00', 'pending'),
(2, 'v_2', 'usr_user', '2026-02-16', '15:00:00', 'confirmed'),
(3, 'v_4', 'usr_temple_user', '2026-02-21', '08:00:00', 'confirmed')
ON DUPLICATE KEY UPDATE
date = VALUES(date),
time = VALUES(time),
status = VALUES(status);

-- Seed community activities
INSERT INTO activities (id, type, user_id, user_name, message, metadata, timestamp)
VALUES
(1, 'appointment', 'usr_user', 'Demo User', 'booked an appointment at Smile Dental Clinic', JSON_OBJECT(), DATE_SUB(NOW(), INTERVAL 1 HOUR)),
(2, 'review', 'usr_admin', 'Super Admin', 'rated Star Salon 5 stars', JSON_OBJECT('reactions', JSON_OBJECT('👍', 2, '❤️', 1)), DATE_SUB(NOW(), INTERVAL 30 MINUTE))
ON DUPLICATE KEY UPDATE
type = VALUES(type),
message = VALUES(message),
metadata = VALUES(metadata),
timestamp = VALUES(timestamp);
