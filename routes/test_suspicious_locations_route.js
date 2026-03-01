/**
 * Quick test script to verify suspicious locations route
 */

const axios = require('axios');

const API_BASE = process.env.API_URL || 'http://localhost:5000';

async function testSuspiciousLocationsRoute() {
    try {
        console.log('\n[TEST] Testing suspicious locations route...\n');
        
        // You'll need to provide a valid token
        const token = process.argv[2];
        
        if (!token) {
            console.log('Usage: node test_suspicious_locations_route.js <JWT_TOKEN>');
            console.log('\nTo get a token, login via API first.');
            return;
        }
        
        const url = `${API_BASE}/api/fleet/operations/suspicious-locations?limit=50`;
        console.log(`[TEST] URL: ${url}`);
        console.log(`[TEST] Method: GET`);
        console.log(`[TEST] Token: ${token.substring(0, 20)}...\n`);
        
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log(`[TEST] ✅ Status: ${response.status}`);
        console.log(`[TEST] ✅ Response:`, JSON.stringify(response.data, null, 2));
        console.log(`\n[TEST] ✅ Route is working! Found ${response.data.length} suspicious locations.\n`);
        
    } catch (error) {
        if (error.response) {
            console.error(`[TEST] ❌ Status: ${error.response.status}`);
            console.error(`[TEST] ❌ Error:`, error.response.data);
            
            if (error.response.status === 404) {
                console.error('\n[TEST] ❌ Route not found! Make sure:');
                console.error('  1. Server is running');
                console.error('  2. Server was restarted after adding the route');
                console.error('  3. Route is correctly defined in fleetRoutes.js');
            } else if (error.response.status === 403) {
                console.error('\n[TEST] ❌ Access denied! Make sure:');
                console.error('  1. User has fleet email or super_admin role');
                console.error('  2. Token includes email in payload');
            }
        } else {
            console.error(`[TEST] ❌ Network error:`, error.message);
            console.error('\n[TEST] Make sure backend server is running on', API_BASE);
        }
    }
}

testSuspiciousLocationsRoute();

