/**
 * Test Script for Offer and Trade Services
 * Run this to verify everything is set up correctly
 * 
 * Usage: node backend/test_offer_trade.js
 */

const db = require('./database');

async function testOfferTrade() {
    console.log('\n=== Testing Offer and Trade Services ===\n');

    // Test 1: Check vendors via getVendors
    console.log('1. Checking vendors via getVendors (include all)...');
    try {
        const allVendors = await db.getVendors(false, 1, 100, 'newest', '', true);
        const offerVendor = allVendors.find(v => v.id === 'v_offer1');
        const tradeVendor = allVendors.find(v => v.id === 'v_trade1');
        
        console.log(`   - Total vendors: ${allVendors.length}`);
        console.log(`   - Offer vendor (v_offer1): ${offerVendor ? '✓ Found' : '✗ Missing'}`);
        if (offerVendor) {
            console.log(`     Shop: ${offerVendor.shop_name}, features_offer: ${offerVendor.features_offer}`);
        }
        
        console.log(`   - Trade vendor (v_trade1): ${tradeVendor ? '✓ Found' : '✗ Missing'}`);
        if (tradeVendor) {
            console.log(`     Shop: ${tradeVendor.shop_name}, features_trade: ${tradeVendor.features_trade}`);
        }
    } catch (e) {
        console.error('   ✗ Error:', e.message);
    }

    // Test 2: Check getVendors with includeTradeOffer=false (should exclude)
    console.log('\n2. Testing getVendors (exclude trade/offer)...');
    try {
        const vendorsExcluded = await db.getVendors(true, 1, 100, 'newest', '', false);
        const hasOffer = vendorsExcluded.some(v => v.features_offer === true || v.features_offer === 1);
        const hasTrade = vendorsExcluded.some(v => v.features_trade === true || v.features_trade === 1);
        console.log(`   - Total vendors: ${vendorsExcluded.length}`);
        console.log(`   - Has offer vendors: ${hasOffer ? '✗ Should be excluded' : '✓ Correctly excluded'}`);
        console.log(`   - Has trade vendors: ${hasTrade ? '✗ Should be excluded' : '✓ Correctly excluded'}`);
    } catch (e) {
        console.error('   ✗ Error:', e.message);
    }

    // Test 3: Check getVendors with includeTradeOffer=true (should include)
    console.log('\n3. Testing getVendors (include trade/offer)...');
    try {
        const vendorsIncluded = await db.getVendors(true, 1, 100, 'newest', '', true);
        const offerVendors = vendorsIncluded.filter(v => v.features_offer === true || v.features_offer === 1);
        const tradeVendors = vendorsIncluded.filter(v => v.features_trade === true || v.features_trade === 1);
        console.log(`   - Total vendors: ${vendorsIncluded.length}`);
        console.log(`   - Offer vendors found: ${offerVendors.length} ${offerVendors.length > 0 ? '✓' : '✗'}`);
        if (offerVendors.length > 0) {
            offerVendors.forEach(v => console.log(`     - ${v.id}: ${v.shop_name} (features_offer: ${v.features_offer})`));
        }
        console.log(`   - Trade vendors found: ${tradeVendors.length} ${tradeVendors.length > 0 ? '✓' : '✗'}`);
        if (tradeVendors.length > 0) {
            tradeVendors.forEach(v => console.log(`     - ${v.id}: ${v.shop_name} (features_trade: ${v.features_trade})`));
        }
    } catch (e) {
        console.error('   ✗ Error:', e.message);
    }

    // Test 4: Check settings
    console.log('\n4. Testing settings...');
    try {
        const settings = await db.getSettings();
        console.log(`   - enable_offer: ${settings.enable_offer} ${settings.enable_offer ? '✓' : '✗ Should be enabled'}`);
        console.log(`   - enable_trade: ${settings.enable_trade} ${settings.enable_trade ? '✓' : '✗ Should be enabled'}`);
    } catch (e) {
        console.error('   ✗ Error:', e.message);
    }

    // Test 5: Check users
    console.log('\n5. Testing users...');
    try {
        const users = await db.getUsers();
        const offerUser = users.find(u => u.email === 'offer1@test.com');
        const tradeUser = users.find(u => u.email === 'trade1@test.com');
        console.log(`   - Offer user (offer1@test.com): ${offerUser ? '✓ Found' : '✗ Missing'}`);
        console.log(`   - Trade user (trade1@test.com): ${tradeUser ? '✓ Found' : '✗ Missing'}`);
    } catch (e) {
        console.error('   ✗ Error:', e.message);
    }

    console.log('\n=== Test Complete ===\n');
    console.log('If all tests pass, the system should work correctly.');
    console.log('If tests fail, check:');
    console.log('  1. Database sync: node backend/sync_db.js');
    console.log('  2. Backend server is running');
    console.log('  3. Settings are enabled in Super Admin');
}

// Run tests
testOfferTrade().catch(console.error);

