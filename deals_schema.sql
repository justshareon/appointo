-- MySQL Schema for Deals/Coupons from Multiple Sources (Flipkart, Amazon, etc.)

-- Companies/Sources Table
CREATE TABLE IF NOT EXISTS companies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE COMMENT 'Company name: Flipkart, Amazon, etc.',
    slug VARCHAR(50) NOT NULL UNIQUE COMMENT 'URL-friendly identifier',
    base_url VARCHAR(255) COMMENT 'Base URL of the company',
    api_endpoint VARCHAR(255) COMMENT 'API endpoint for fetching deals',
    api_key VARCHAR(255) COMMENT 'API key if required',
    logo_url VARCHAR(255) COMMENT 'Company logo URL',
    is_active BOOLEAN DEFAULT TRUE,
    sync_interval_minutes INT DEFAULT 30 COMMENT 'How often to sync data (in minutes)',
    last_synced_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_active (is_active),
    INDEX idx_last_synced (last_synced_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Global Categories Table (unified across all companies)
CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    parent_id INT NULL COMMENT 'For hierarchical categories',
    level TINYINT DEFAULT 1 COMMENT 'Category level (1=root, 2=sub, etc.)',
    description TEXT,
    image_url VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL,
    INDEX idx_parent (parent_id),
    INDEX idx_slug (slug),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Company Category Mapping (maps company's category names to global categories)
CREATE TABLE IF NOT EXISTS company_category_mapping (
    id INT AUTO_INCREMENT PRIMARY KEY,
    company_id INT NOT NULL,
    company_category_name VARCHAR(200) NOT NULL COMMENT 'Category name as provided by company',
    company_category_id VARCHAR(100) COMMENT 'Category ID from company API if available',
    global_category_id INT NOT NULL COMMENT 'Mapped to our global category',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (global_category_id) REFERENCES categories(id) ON DELETE CASCADE,
    UNIQUE KEY unique_company_category (company_id, company_category_name),
    INDEX idx_company (company_id),
    INDEX idx_global_category (global_category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Products Table (for product-specific deals)
CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    company_id INT NOT NULL,
    external_product_id VARCHAR(200) COMMENT 'Product ID from company API',
    name VARCHAR(500) NOT NULL,
    description TEXT,
    image_url VARCHAR(255),
    price DECIMAL(10, 2) COMMENT 'Current price',
    original_price DECIMAL(10, 2) COMMENT 'Original price before discount',
    url VARCHAR(500) COMMENT 'Product URL on company site',
    category_id INT COMMENT 'Primary category',
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    INDEX idx_company (company_id),
    INDEX idx_category (category_id),
    INDEX idx_external_id (company_id, external_product_id),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Deals Table
CREATE TABLE IF NOT EXISTS deals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    company_id INT NOT NULL,
    external_deal_id VARCHAR(200) COMMENT 'Deal ID from company API',
    title VARCHAR(500) NOT NULL COMMENT 'Deal title, e.g., "Fashion Mega Sale"',
    description TEXT,
    
    -- Discount fields (flexible structure)
    discount_text_raw VARCHAR(500) COMMENT 'Original discount text: "Up to 90% OFF", "Starting at ₹9", etc.',
    discount_type ENUM('PERCENT_UPTO', 'PERCENT_FLAT', 'PERCENT_MIN', 'AMOUNT_UPTO', 'AMOUNT_FLAT', 'AMOUNT_MIN', 'STARTING_AT', 'OTHER') DEFAULT 'OTHER',
    
    -- Percentage discounts
    discount_percentage_min DECIMAL(5, 2) NULL COMMENT 'Minimum discount percentage (for "Minimum 30% OFF")',
    discount_percentage_max DECIMAL(5, 2) NULL COMMENT 'Maximum discount percentage (for "Up to 90% OFF")',
    
    -- Amount discounts
    discount_amount_min DECIMAL(10, 2) NULL COMMENT 'Minimum discount amount (for "Up to ₹500 off")',
    discount_amount_max DECIMAL(10, 2) NULL COMMENT 'Maximum discount amount',
    
    -- Starting price
    starting_price DECIMAL(10, 2) NULL COMMENT 'Starting price (for "Starting at ₹9")',
    
    -- Deal metadata
    url VARCHAR(500) COMMENT 'Link to deal page',
    image_url VARCHAR(255) COMMENT 'Deal banner/image',
    start_date DATETIME COMMENT 'Deal start date',
    end_date DATETIME COMMENT 'Deal end date',
    is_active BOOLEAN DEFAULT TRUE,
    is_featured BOOLEAN DEFAULT FALSE,
    view_count INT DEFAULT 0,
    
    -- JSON for flexible storage of additional data
    metadata JSON COMMENT 'Additional flexible data from API',
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    
    INDEX idx_company (company_id),
    INDEX idx_external_id (company_id, external_deal_id),
    INDEX idx_active (is_active),
    INDEX idx_featured (is_featured),
    INDEX idx_dates (start_date, end_date),
    INDEX idx_discount_percentage (discount_percentage_max),
    INDEX idx_discount_amount (discount_amount_max),
    INDEX idx_starting_price (starting_price)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Deal-Category Mapping (Many-to-Many: deals can apply to multiple categories)
CREATE TABLE IF NOT EXISTS deal_categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    deal_id INT NOT NULL,
    category_id INT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
    UNIQUE KEY unique_deal_category (deal_id, category_id),
    INDEX idx_deal (deal_id),
    INDEX idx_category (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Deal-Product Mapping (Many-to-Many: deals can apply to specific products)
CREATE TABLE IF NOT EXISTS deal_products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    deal_id INT NOT NULL,
    product_id INT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE KEY unique_deal_product (deal_id, product_id),
    INDEX idx_deal (deal_id),
    INDEX idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sync Log Table (to track data synchronization)
CREATE TABLE IF NOT EXISTS sync_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    company_id INT NOT NULL,
    sync_type ENUM('FULL', 'INCREMENTAL') DEFAULT 'FULL',
    status ENUM('PENDING', 'IN_PROGRESS', 'SUCCESS', 'FAILED') DEFAULT 'PENDING',
    records_fetched INT DEFAULT 0,
    records_saved INT DEFAULT 0,
    records_updated INT DEFAULT 0,
    records_deleted INT DEFAULT 0,
    error_message TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    INDEX idx_company (company_id),
    INDEX idx_status (status),
    INDEX idx_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert sample companies
INSERT INTO companies (name, slug, base_url, sync_interval_minutes) VALUES
('Flipkart', 'flipkart', 'https://www.flipkart.com', 30),
('Amazon', 'amazon', 'https://www.amazon.in', 30)
ON DUPLICATE KEY UPDATE name=name;

-- Insert sample categories
INSERT INTO categories (name, slug, parent_id, level) VALUES
('Electronics', 'electronics', NULL, 1),
('Fashion', 'fashion', NULL, 1),
('Groceries', 'groceries', NULL, 1),
('Home & Kitchen', 'home-kitchen', NULL, 1),
('Personal Care', 'personal-care', NULL, 1),
('Mobile Phones', 'mobile-phones', (SELECT id FROM categories WHERE slug='electronics'), 2),
('Laptops', 'laptops', (SELECT id FROM categories WHERE slug='electronics'), 2),
('Apparel', 'apparel', (SELECT id FROM categories WHERE slug='fashion'), 2),
('Footwear', 'footwear', (SELECT id FROM categories WHERE slug='fashion'), 2)
ON DUPLICATE KEY UPDATE name=name;

