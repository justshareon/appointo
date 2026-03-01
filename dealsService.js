const axios = require('axios');
const db = require('./database');

const LOG = {
    info: (msg) => console.log(`[DEALS] ${new Date().toLocaleTimeString()} | ${msg}`),
    error: (msg, detail = "") => console.error(`[DEALS ERROR] ${new Date().toLocaleTimeString()} | ${msg} | ${detail}`),
    success: (msg) => console.log(`[DEALS SUCCESS] ${new Date().toLocaleTimeString()} | ${msg}`)
};

// Get database pool from existing database.js
function getPool() {
    // Access the pool from database.js
    if (typeof db.getPool === 'function') {
        const pool = db.getPool();
        return pool || null;
    }
    // Fallback: try to access pool if it's exported directly
    return db.pool || null;
}

// Parse discount text to structured fields
function parseDiscountText(text) {
    if (!text) return {};
    
    const lower = text.toLowerCase();
    const result = {
        discount_text_raw: text,
        discount_type: 'OTHER',
        discount_percentage_min: null,
        discount_percentage_max: null,
        discount_amount_min: null,
        discount_amount_max: null,
        starting_price: null
    };
    
    // "Up to X% OFF"
    const upToPercentMatch = lower.match(/up to (\d+(?:\.\d+)?)%\s*off/i);
    if (upToPercentMatch) {
        result.discount_type = 'PERCENT_UPTO';
        result.discount_percentage_max = parseFloat(upToPercentMatch[1]);
        return result;
    }
    
    // "Flat X% OFF"
    const flatPercentMatch = lower.match(/flat\s+(\d+(?:\.\d+)?)%\s*off/i);
    if (flatPercentMatch) {
        result.discount_type = 'PERCENT_FLAT';
        const value = parseFloat(flatPercentMatch[1]);
        result.discount_percentage_min = value;
        result.discount_percentage_max = value;
        return result;
    }
    
    // "Minimum X% OFF"
    const minPercentMatch = lower.match(/minimum\s+(\d+(?:\.\d+)?)%\s*off/i);
    if (minPercentMatch) {
        result.discount_type = 'PERCENT_MIN';
        result.discount_percentage_min = parseFloat(minPercentMatch[1]);
        return result;
    }
    
    // "Starting at ₹X" or "Starting at Rs X"
    const startingAtMatch = lower.match(/starting\s+at\s*[₹rs]?\s*(\d+(?:,\d+)?(?:\.\d+)?)/i);
    if (startingAtMatch) {
        result.discount_type = 'STARTING_AT';
        result.starting_price = parseFloat(startingAtMatch[1].replace(/,/g, ''));
        return result;
    }
    
    // "Up to ₹X off" or "₹X off"
    const amountMatch = lower.match(/(?:up to\s*)?[₹rs]?\s*(\d+(?:,\d+)?(?:\.\d+)?)\s*off/i);
    if (amountMatch) {
        const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
        if (lower.includes('up to')) {
            result.discount_type = 'AMOUNT_UPTO';
            result.discount_amount_max = amount;
        } else {
            result.discount_type = 'AMOUNT_FLAT';
            result.discount_amount_min = amount;
            result.discount_amount_max = amount;
        }
        return result;
    }
    
    return result;
}

// Fetch deals from external API (mock implementation - replace with real API)
async function fetchDealsFromAPI(company) {
    try {
        LOG.info(`Fetching deals from ${company.name} API...`);
        
        // Mock API call - replace with actual API endpoint
        // const response = await axios.get(company.api_endpoint, {
        //     headers: { 'Authorization': `Bearer ${company.api_key}` }
        // });
        
        // For now, return sample data
        await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API delay
        
        const sampleDeals = [
            {
                external_deal_id: `deal_${company.slug}_1`,
                title: 'Fashion Mega Sale',
                discount_text: 'Up to 90% OFF',
                categories: ['Apparel', 'Footwear', 'Bags'],
                url: `${company.base_url}/fashion-sale`,
                start_date: new Date(),
                end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from now
            },
            {
                external_deal_id: `deal_${company.slug}_2`,
                title: 'Electronics Sale',
                discount_text: 'Up to 80% OFF',
                categories: ['Electronics', 'Accessories'],
                url: `${company.base_url}/electronics-sale`,
                start_date: new Date(),
                end_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
            }
        ];
        
        return sampleDeals;
    } catch (error) {
        LOG.error(`Failed to fetch from ${company.name} API`, error.message);
        throw error;
    }
}

// Get or create category
async function getOrCreateCategory(categoryName, parentId = null) {
    const pool = getPool();
    if (!pool) {
        // Return null if pool not available (expected when using in-memory database)
        return null;
    }
    
    const slug = categoryName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    
    // Try to find existing category
    const [existing] = await pool.query(
        'SELECT id FROM categories WHERE slug = ?',
        [slug]
    );
    
    if (existing.length > 0) {
        return existing[0].id;
    }
    
    // Create new category
    const level = parentId ? 2 : 1;
    const [result] = await pool.query(
        'INSERT INTO categories (name, slug, parent_id, level) VALUES (?, ?, ?, ?)',
        [categoryName, slug, parentId, level]
    );
    
    return result.insertId;
}

// Save deals to database
async function saveDealsToDB(companyId, deals) {
    const pool = getPool();
    if (!pool) {
        // Silently skip if pool not available (expected when using in-memory database)
        return { saved: 0, updated: 0 };
    }
    
    let saved = 0;
    let updated = 0;
    
    try {
        for (const deal of deals) {
            const discountData = parseDiscountText(deal.discount_text);
            
            // Check if deal exists
            const [existing] = await pool.query(
                'SELECT id FROM deals WHERE company_id = ? AND external_deal_id = ?',
                [companyId, deal.external_deal_id]
            );
            
            if (existing.length > 0) {
                // Update existing deal
                await pool.query(
                    `UPDATE deals SET 
                        title = ?, 
                        discount_text_raw = ?,
                        discount_type = ?,
                        discount_percentage_min = ?,
                        discount_percentage_max = ?,
                        discount_amount_min = ?,
                        discount_amount_max = ?,
                        starting_price = ?,
                        url = ?,
                        start_date = ?,
                        end_date = ?,
                        updated_at = NOW()
                    WHERE id = ?`,
                    [
                        deal.title,
                        discountData.discount_text_raw,
                        discountData.discount_type,
                        discountData.discount_percentage_min,
                        discountData.discount_percentage_max,
                        discountData.discount_amount_min,
                        discountData.discount_amount_max,
                        discountData.starting_price,
                        deal.url,
                        deal.start_date,
                        deal.end_date,
                        existing[0].id
                    ]
                );
                updated++;
            } else {
                // Insert new deal
                const [result] = await pool.query(
                    `INSERT INTO deals (
                        company_id, external_deal_id, title, discount_text_raw,
                        discount_type, discount_percentage_min, discount_percentage_max,
                        discount_amount_min, discount_amount_max, starting_price,
                        url, start_date, end_date
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        companyId,
                        deal.external_deal_id,
                        deal.title,
                        discountData.discount_text_raw,
                        discountData.discount_type,
                        discountData.discount_percentage_min,
                        discountData.discount_percentage_max,
                        discountData.discount_amount_min,
                        discountData.discount_amount_max,
                        discountData.starting_price,
                        deal.url,
                        deal.start_date,
                        deal.end_date
                    ]
                );
                saved++;
                
                // Link categories
                if (deal.categories && Array.isArray(deal.categories)) {
                    for (const catName of deal.categories) {
                        const categoryId = await getOrCreateCategory(catName);
                        await pool.query(
                            'INSERT IGNORE INTO deal_categories (deal_id, category_id) VALUES (?, ?)',
                            [result.insertId, categoryId]
                        );
                    }
                }
            }
        }
        
        LOG.success(`Saved ${saved} new deals, updated ${updated} existing deals`);
        return { saved, updated };
    } catch (error) {
        LOG.error('Failed to save deals to database', error.message);
        throw error;
    }
}

// Sync deals for a company
async function syncCompanyDeals(companyId) {
    const pool = getPool();
    if (!pool) {
        // Silently skip if pool not available (expected when using in-memory database)
        return;
    }
    
    try {
        // Get company info
        const [companies] = await pool.query('SELECT * FROM companies WHERE id = ?', [companyId]);
        if (companies.length === 0) {
            LOG.error(`Company with id ${companyId} not found`);
            return;
        }
        
        const company = companies[0];
        
        // Check if sync is needed
        const syncInterval = company.sync_interval_minutes || 30;
        const lastSynced = company.last_synced_at;
        const now = new Date();
        
        if (lastSynced) {
            const minutesSinceLastSync = (now - new Date(lastSynced)) / (1000 * 60);
            if (minutesSinceLastSync < syncInterval) {
                LOG.info(`Sync not needed for ${company.name}. Last synced ${Math.floor(minutesSinceLastSync)} minutes ago.`);
                return;
            }
        }
        
        // Create sync log
        const [logResult] = await pool.query(
            'INSERT INTO sync_logs (company_id, status, started_at) VALUES (?, ?, NOW())',
            [companyId, 'IN_PROGRESS']
        );
        const logId = logResult.insertId;
        
        try {
            // Fetch from API
            const deals = await fetchDealsFromAPI(company);
            
            // Save to database
            const { saved, updated } = await saveDealsToDB(companyId, deals);
            
            // Update sync log
            await pool.query(
                `UPDATE sync_logs SET 
                    status = 'SUCCESS',
                    records_fetched = ?,
                    records_saved = ?,
                    records_updated = ?,
                    completed_at = NOW()
                WHERE id = ?`,
                [deals.length, saved, updated, logId]
            );
            
            // Update company last_synced_at
            await pool.query(
                'UPDATE companies SET last_synced_at = NOW() WHERE id = ?',
                [companyId]
            );
            
            LOG.success(`Successfully synced ${deals.length} deals for ${company.name}`);
        } catch (error) {
            // Update sync log with error
            await pool.query(
                `UPDATE sync_logs SET 
                    status = 'FAILED',
                    error_message = ?,
                    completed_at = NOW()
                WHERE id = ?`,
                [error.message, logId]
            );
            throw error;
        }
    } catch (error) {
        LOG.error(`Failed to sync deals for company ${companyId}`, error.message);
        throw error;
    }
}

// Get deals from database (for offer service)
async function getDealsFromDB(filters = {}) {
    const pool = getPool();
    if (!pool) {
        // Silently return empty array if pool not available (expected when using in-memory database)
        return [];
    }
    
    try {
        let query = `
            SELECT d.*, c.name as company_name, c.slug as company_slug
            FROM deals d
            JOIN companies c ON d.company_id = c.id
            WHERE d.is_active = 1
        `;
        const params = [];
        
        // Filter by company
        if (filters.company_id) {
            query += ' AND d.company_id = ?';
            params.push(filters.company_id);
        }
        
        // Filter by category
        if (filters.category_id) {
            query += ' AND EXISTS (SELECT 1 FROM deal_categories dc WHERE dc.deal_id = d.id AND dc.category_id = ?)';
            params.push(filters.category_id);
        }
        
        // Filter by discount percentage
        if (filters.min_discount_percentage) {
            query += ' AND d.discount_percentage_max >= ?';
            params.push(filters.min_discount_percentage);
        }
        
        // Filter active deals (within date range)
        query += ' AND (d.start_date IS NULL OR d.start_date <= NOW())';
        query += ' AND (d.end_date IS NULL OR d.end_date >= NOW())';
        
        // Order by
        query += ' ORDER BY d.discount_percentage_max DESC, d.created_at DESC';
        
        // Limit
        if (filters.limit) {
            query += ' LIMIT ?';
            params.push(filters.limit);
        }
        
        const [deals] = await pool.query(query, params);
        
        // Get categories for each deal
        for (const deal of deals) {
            const [categories] = await pool.query(
                `SELECT c.id, c.name, c.slug 
                FROM categories c
                JOIN deal_categories dc ON c.id = dc.category_id
                WHERE dc.deal_id = ?`,
                [deal.id]
            );
            deal.categories = categories;
        }
        
        return deals;
    } catch (error) {
        LOG.error('Failed to get deals from database', error.message);
        throw error;
    }
}

// Auto-sync all companies (run periodically)
async function autoSyncAllCompanies() {
    const pool = getPool();
    if (!pool) {
        // Silently skip if pool not available (expected when using in-memory database)
        return;
    }
    
    try {
        const [companies] = await pool.query(
            'SELECT id FROM companies WHERE is_active = 1'
        );
        
        for (const company of companies) {
            try {
                await syncCompanyDeals(company.id);
            } catch (error) {
                LOG.error(`Failed to sync company ${company.id}`, error.message);
            }
        }
    } catch (error) {
        LOG.error('Failed to auto-sync companies', error.message);
    }
}

module.exports = {
    syncCompanyDeals,
    getDealsFromDB,
    autoSyncAllCompanies,
    parseDiscountText
};

