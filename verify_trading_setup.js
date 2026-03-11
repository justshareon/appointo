/**
 * Verify Trading Setup
 * Checks if trading tables are initialized and services are working
 */
const db = require('./database');
const tradingDataService = require('./services/tradingDataService');
const LOG = require('./utils/logger');

async function verifyTradingSetup() {
    console.log('\n=== Verifying Trading Setup ===\n');

    // Check database connection
    const pool = db.getPool();
    if (pool) {
        console.log('✅ MySQL connection available');
        
        // Check if tables exist
        try {
            const [tables] = await pool.query(`
                SELECT TABLE_NAME 
                FROM information_schema.TABLES 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_NAME LIKE 'trading_%'
            `);
            
            const tableNames = tables.map(t => t.TABLE_NAME);
            const expectedTables = [
                'trading_stock_quotes',
                'trading_market_indices',
                'trading_top_stocks'
            ];
            
            console.log('\n📊 Trading Tables:');
            expectedTables.forEach(table => {
                if (tableNames.includes(table)) {
                    console.log(`  ✅ ${table}`);
                } else {
                    console.log(`  ❌ ${table} - NOT FOUND`);
                }
            });
            
            if (tableNames.length === 0) {
                console.log('\n⚠️  No trading tables found. Initializing...');
                await tradingDataService.initializeTables();
                console.log('✅ Tables initialized');
            }
        } catch (error) {
            console.error('❌ Error checking tables:', error.message);
        }
    } else {
        console.log('⚠️  MySQL not available - using in-memory database only');
    }

    // Check in-memory database
    const inMemoryDb = db.inMemoryDb || {};
    if (inMemoryDb.tradingData) {
        console.log('\n✅ In-memory trading data initialized');
        console.log(`   - Market Indices: ${inMemoryDb.tradingData.marketIndices?.length || 0}`);
        console.log(`   - Stock Quotes: ${inMemoryDb.tradingData.stockQuotes?.length || 0}`);
        console.log(`   - Top Gainers: ${inMemoryDb.tradingData.topGainers?.length || 0}`);
        console.log(`   - Top Losers: ${inMemoryDb.tradingData.topLosers?.length || 0}`);
    } else {
        console.log('\n⚠️  In-memory trading data not initialized (will be created on first refresh)');
    }

    // Check Yahoo Finance service
    try {
        const yahooFinanceService = require('./services/yahooFinanceService');
        console.log('\n✅ Yahoo Finance service loaded');
    } catch (error) {
        console.error('\n❌ Yahoo Finance service error:', error.message);
    }

    console.log('\n=== Verification Complete ===\n');
    
    process.exit(0);
}

verifyTradingSetup().catch(error => {
    console.error('Verification failed:', error);
    process.exit(1);
});

