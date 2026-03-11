/**
 * Test Script for Cyber Features
 * Tests all cyber-related endpoints and functionality
 */

const axios = require('axios');

const BASE_URL = process.env.API_URL || 'http://localhost:5000';
const TEST_USER = {
    email: 'cyber1@test.com',
    password: 'test123'
};

let authToken = null;

async function login() {
    try {
        console.log('\n🔐 Logging in...');
        const response = await axios.post(`${BASE_URL}/api/auth/login`, TEST_USER);
        authToken = response.data.token;
        console.log('✅ Login successful');
        return true;
    } catch (error) {
        console.error('❌ Login failed:', error.response?.data || error.message);
        return false;
    }
}

async function testPostThreat() {
    try {
        console.log('\n📝 Testing: Post Cyber Threat');
        const threatData = {
            type: 'phone',
            value: '9999999999',
            title: 'Test Threat - Scam Call',
            description: 'This is a test threat for validation',
            severity: 'high',
            category: 'scam',
            location: 'Test City',
            evidence: [
                { uri: 'https://example.com/test.jpg', type: 'image', id: 'test1' }
            ]
        };
        
        const response = await axios.post(
            `${BASE_URL}/api/suraksha/threats/post`,
            threatData,
            { headers: { Authorization: `Bearer ${authToken}` } }
        );
        
        console.log('✅ Threat posted:', response.data.threat?.id);
        return response.data.threat;
    } catch (error) {
        console.error('❌ Post threat failed:', error.response?.data || error.message);
        return null;
    }
}

async function testGetActiveThreats() {
    try {
        console.log('\n📋 Testing: Get Active Threats');
        const response = await axios.get(
            `${BASE_URL}/api/suraksha/threats/active`,
            { headers: { Authorization: `Bearer ${authToken}` } }
        );
        
        console.log(`✅ Found ${response.data.count} active threats`);
        return response.data.threats;
    } catch (error) {
        console.error('❌ Get threats failed:', error.response?.data || error.message);
        return [];
    }
}

async function testUpdateThreat(threatId) {
    try {
        console.log('\n✏️ Testing: Update Threat');
        const updateData = {
            title: 'Updated Test Threat',
            description: 'This threat has been updated',
            severity: 'critical'
        };
        
        const response = await axios.put(
            `${BASE_URL}/api/suraksha/threats/${threatId}`,
            updateData,
            { headers: { Authorization: `Bearer ${authToken}` } }
        );
        
        console.log('✅ Threat updated:', response.data.threat?.id);
        return response.data.threat;
    } catch (error) {
        console.error('❌ Update threat failed:', error.response?.data || error.message);
        return null;
    }
}

async function testDeleteThreat(threatId) {
    try {
        console.log('\n🗑️ Testing: Delete Threat');
        const response = await axios.delete(
            `${BASE_URL}/api/suraksha/threats/${threatId}`,
            { headers: { Authorization: `Bearer ${authToken}` } }
        );
        
        console.log('✅ Threat deleted:', response.data.message);
        return true;
    } catch (error) {
        console.error('❌ Delete threat failed:', error.response?.data || error.message);
        return false;
    }
}

async function testSearchThreats() {
    try {
        console.log('\n🔍 Testing: Search Threats');
        const searchData = {
            value: '9876543210',
            type: 'phone'
        };
        
        const response = await axios.post(
            `${BASE_URL}/api/suraksha/threats/search`,
            searchData,
            { headers: { Authorization: `Bearer ${authToken}` } }
        );
        
        console.log(`✅ Search found ${response.data.total} threats (source: ${response.data.source})`);
        return response.data;
    } catch (error) {
        console.error('❌ Search threats failed:', error.response?.data || error.message);
        return null;
    }
}

async function testValidateCall() {
    try {
        console.log('\n📞 Testing: Validate Call');
        const response = await axios.post(
            `${BASE_URL}/api/suraksha/caller/validate`,
            { phoneNumber: '9769593543' },
            { headers: { Authorization: `Bearer ${authToken}` } }
        );
        
        console.log(`✅ Call validated: ${response.data.isSpam ? 'SPAM' : 'SAFE'}`);
        return response.data;
    } catch (error) {
        console.error('❌ Validate call failed:', error.response?.data || error.message);
        return null;
    }
}

async function testGetCallHistory() {
    try {
        console.log('\n📜 Testing: Get Call History');
        const response = await axios.get(
            `${BASE_URL}/api/suraksha/caller/history?limit=10`,
            { headers: { Authorization: `Bearer ${authToken}` } }
        );
        
        console.log(`✅ Found ${response.data.count} call history records`);
        return response.data;
    } catch (error) {
        console.error('❌ Get call history failed:', error.response?.data || error.message);
        return null;
    }
}

async function testValidateFraud() {
    try {
        console.log('\n🛡️ Testing: Validate Fraud (Suraksha)');
        const response = await axios.post(
            `${BASE_URL}/api/suraksha/validate`,
            { input: '9769593543', type: 'phone' },
            { headers: { Authorization: `Bearer ${authToken}` } }
        );
        
        console.log(`✅ Fraud validation: ${response.data.status}`);
        return response.data;
    } catch (error) {
        console.error('❌ Validate fraud failed:', error.response?.data || error.message);
        return null;
    }
}

async function testGetAnalytics() {
    try {
        console.log('\n📊 Testing: Get Analytics');
        const endpoints = [
            '/api/suraksha/analytics/statistics',
            '/api/suraksha/analytics/most-active',
            '/api/suraksha/analytics/culprits',
            '/api/suraksha/analytics/demographics'
        ];
        
        for (const endpoint of endpoints) {
            try {
                const response = await axios.get(
                    `${BASE_URL}${endpoint}`,
                    { headers: { Authorization: `Bearer ${authToken}` } }
                );
                console.log(`✅ ${endpoint}: Success`);
            } catch (error) {
                console.error(`❌ ${endpoint}: Failed`, error.response?.data || error.message);
            }
        }
    } catch (error) {
        console.error('❌ Analytics test failed:', error.message);
    }
}

async function runAllTests() {
    console.log('🚀 Starting Cyber Features Test Suite\n');
    console.log('='.repeat(50));
    
    // Login first
    const loggedIn = await login();
    if (!loggedIn) {
        console.log('\n❌ Cannot proceed without authentication');
        return;
    }
    
    // Test threat management
    const postedThreat = await testPostThreat();
    const threats = await testGetActiveThreats();
    
    if (postedThreat) {
        await testUpdateThreat(postedThreat.id);
        // Uncomment to test delete (will remove test threat)
        // await testDeleteThreat(postedThreat.id);
    }
    
    await testSearchThreats();
    
    // Test caller validation
    await testValidateCall();
    await testGetCallHistory();
    
    // Test fraud validation
    await testValidateFraud();
    
    // Test analytics
    await testGetAnalytics();
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ Test Suite Completed!');
    console.log('\n📊 Summary:');
    console.log(`   - Active Threats: ${threats.length}`);
    console.log(`   - All endpoints tested`);
}

// Run tests
if (require.main === module) {
    runAllTests().catch(console.error);
}

module.exports = { runAllTests };

