# Deals/Coupons System Documentation

## Overview
This system fetches deals/coupons from multiple e-commerce sources (Flipkart, Amazon, etc.), stores them in MySQL database, and serves them through the API. Data is synced automatically every 30 minutes (configurable).

## Database Schema

### Tables

1. **companies** - Stores e-commerce companies/sources
   - `id`, `name`, `slug`, `base_url`, `api_endpoint`, `api_key`
   - `sync_interval_minutes` - How often to sync (default: 30)
   - `last_synced_at` - Last sync timestamp

2. **categories** - Global category hierarchy
   - `id`, `name`, `slug`, `parent_id`, `level`
   - Supports hierarchical categories

3. **company_category_mapping** - Maps company categories to global categories
   - Links company-specific category names to unified categories

4. **products** - Product-specific deals
   - `id`, `company_id`, `external_product_id`, `name`, `price`, `url`

5. **deals** - Main deals table
   - Flexible discount fields:
     - `discount_percentage_min/max` - For percentage discounts
     - `discount_amount_min/max` - For fixed amount discounts
     - `starting_price` - For "Starting at ₹X" deals
     - `discount_text_raw` - Original text for display
   - `discount_type` - ENUM: PERCENT_UPTO, PERCENT_FLAT, PERCENT_MIN, AMOUNT_UPTO, AMOUNT_FLAT, AMOUNT_MIN, STARTING_AT, OTHER

6. **deal_categories** - Many-to-many: deals to categories
7. **deal_products** - Many-to-many: deals to products
8. **sync_logs** - Tracks synchronization history

## Setup

### 1. Create Database Schema
```bash
mysql -u your_user -p your_database < deals_schema.sql
```

### 2. Configure Environment Variables
Add to `.env`:
```env
DB_HOST=localhost
DB_USER=your_user
DB_PASSWORD=your_password
DB_NAME=your_database
DEALS_SYNC_INTERVAL_MINUTES=30  # Optional, default is 30
```

### 3. Add Companies
```sql
INSERT INTO companies (name, slug, base_url, api_endpoint, api_key, sync_interval_minutes) 
VALUES 
('Flipkart', 'flipkart', 'https://www.flipkart.com', 'https://api.flipkart.com/deals', 'your_api_key', 30),
('Amazon', 'amazon', 'https://www.amazon.in', 'https://api.amazon.in/deals', 'your_api_key', 30);
```

## API Endpoints

### Get Deals
```
GET /api/deals
Query Parameters:
  - company_id (optional) - Filter by company
  - category_id (optional) - Filter by category
  - min_discount (optional) - Minimum discount percentage
  - limit (optional) - Max results (default: 100)
```

### Manual Sync
```
POST /api/deals/sync/:companyId
Headers: Authorization: Bearer <token>
Requires: super_admin role
```

## How It Works

### 1. Automatic Sync
- Server starts auto-sync after 1 minute delay
- Runs every 30 minutes (configurable via `DEALS_SYNC_INTERVAL_MINUTES`)
- Checks each company's `last_synced_at` and `sync_interval_minutes`
- Only syncs if interval has passed

### 2. Data Flow
1. **Fetch from External API** - `fetchDealsFromAPI(company)`
   - Calls company's API endpoint
   - Returns array of deals with categories

2. **Parse Discount Text** - `parseDiscountText(text)`
   - Parses "Up to 90% OFF" → `discount_type: PERCENT_UPTO, discount_percentage_max: 90`
   - Parses "Flat 75% OFF" → `discount_type: PERCENT_FLAT, discount_percentage_min/max: 75`
   - Parses "Starting at ₹9" → `discount_type: STARTING_AT, starting_price: 9`

3. **Save to Database** - `saveDealsToDB(companyId, deals)`
   - Updates existing deals (by `external_deal_id`)
   - Inserts new deals
   - Links to categories (creates categories if needed)

4. **Load from Database** - `getDealsFromDB(filters)`
   - Frontend calls `/api/deals` to get deals
   - Filters by company, category, discount, etc.

### 3. Discount Parsing Examples

| Input Text | Parsed Result |
|------------|---------------|
| "Up to 90% OFF" | `type: PERCENT_UPTO, max: 90` |
| "Flat 75% OFF" | `type: PERCENT_FLAT, min: 75, max: 75` |
| "Minimum 30% OFF" | `type: PERCENT_MIN, min: 30` |
| "Starting at ₹9" | `type: STARTING_AT, price: 9` |
| "Up to ₹500 off" | `type: AMOUNT_UPTO, max: 500` |

## Customizing External API Integration

Edit `backend/dealsService.js` → `fetchDealsFromAPI()`:

```javascript
async function fetchDealsFromAPI(company) {
    const response = await axios.get(company.api_endpoint, {
        headers: { 
            'Authorization': `Bearer ${company.api_key}`,
            'Content-Type': 'application/json'
        }
    });
    
    // Transform API response to our format
    return response.data.deals.map(deal => ({
        external_deal_id: deal.id,
        title: deal.title,
        discount_text: deal.discount,
        categories: deal.categories,
        url: deal.link,
        start_date: new Date(deal.start_date),
        end_date: new Date(deal.end_date)
    }));
}
```

## Frontend Integration

The `offerService` automatically loads deals from the synced database:

```javascript
import { offerService } from '../services/apiService';

// Get all offers (includes deals from database)
const offers = await offerService.getAllOfferVendors();

// Get only deals from database
const deals = await offerService.getDealsFromDB({
    category_id: 1,
    min_discount: 50,
    limit: 20
});
```

## Monitoring

Check sync status:
```sql
SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT 10;
```

Check company sync status:
```sql
SELECT name, last_synced_at, sync_interval_minutes 
FROM companies 
WHERE is_active = 1;
```

## Notes

- First sync happens 1 minute after server start
- Subsequent syncs happen every 30 minutes (configurable)
- Deals are stored in database, frontend loads from DB (not directly from API)
- Discount text is parsed automatically but raw text is also stored
- Categories are created automatically if they don't exist
- Supports hierarchical categories with parent-child relationships

