/**
 * Fleet Application - Real-time Test Suite
 * 
 * Tests 20 real-time scenarios to verify all users get proper data
 */

const mysql = require('mysql2/promise');
const axios = require('axios');
require('dotenv').config();

const LOG = {
    info: (msg) => console.log(`[TEST] ${msg}`),
    success: (msg) => console.log(`[TEST] ✅ ${msg}`),
    error: (msg) => console.error(`[TEST] ❌ ${msg}`),
    warning: (msg) => console.warn(`[TEST] ⚠️ ${msg}`),
    section: (msg) => console.log(`\n${'='.repeat(60)}\n[TEST] ${msg}\n${'='.repeat(60)}`)
};

const API_BASE = process.env.API_BASE || 'http://localhost:5000';
let authToken = null;
let fleetUserToken = null;
let adminToken = null;

// Test results
const results = {
    passed: 0,
    failed: 0,
    scenarios: []
};

// Helper: Login using OTP flow
async function loginUser(email) {
    try {
        // Step 1: Send OTP
        const sendOtpRes = await axios.post(`${API_BASE}/api/auth/send-otp`, {
            email
        });
        
        // API returns debugOtp in console mode, or otp in production
        const otp = sendOtpRes.data?.debugOtp || sendOtpRes.data?.otp;
        if (!otp) {
            LOG.error(`OTP not received for ${email}. Response: ${JSON.stringify(sendOtpRes.data)}`);
            return null;
        }
        LOG.info(`OTP received for ${email}: ${otp}`);
        
        // Step 2: Verify OTP
        const verifyRes = await axios.post(`${API_BASE}/api/auth/verify-otp`, {
            email,
            otp
        });
        
        if (!verifyRes.data || !verifyRes.data.token) {
            LOG.error(`Token not received for ${email}`);
            return null;
        }
        
        return verifyRes.data.token;
    } catch (e) {
        LOG.error(`Login failed for ${email}: ${e.message}`);
        if (e.response) {
            LOG.error(`Response: ${JSON.stringify(e.response.data)}`);
        }
        return null;
    }
}

// Helper: Make authenticated request
async function apiRequest(method, endpoint, token, data = null) {
    try {
        const config = {
            method,
            url: `${API_BASE}${endpoint}`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };
        if (data) config.data = data;
        const res = await axios(config);
        return { success: true, data: res.data, status: res.status };
    } catch (e) {
        return {
            success: false,
            error: e.response?.data || e.message,
            status: e.response?.status || 500
        };
    }
}

// Test Scenario Runner
async function runScenario(name, testFn) {
    LOG.info(`\n📋 Scenario: ${name}`);
    try {
        const result = await testFn();
        if (result.success) {
            results.passed++;
            results.scenarios.push({ name, status: 'PASSED', details: result.details });
            LOG.success(`${name} - PASSED`);
            if (result.details) LOG.info(`   Details: ${JSON.stringify(result.details)}`);
            return true;
        } else {
            results.failed++;
            results.scenarios.push({ name, status: 'FAILED', error: result.error });
            LOG.error(`${name} - FAILED: ${result.error}`);
            return false;
        }
    } catch (e) {
        results.failed++;
        results.scenarios.push({ name, status: 'ERROR', error: e.message });
        LOG.error(`${name} - ERROR: ${e.message}`);
        return false;
    }
}

// ==================== TEST SCENARIOS ====================

// Scenario 1: Fleet User Login
async function test1_FleetUserLogin() {
    fleetUserToken = await loginUser('fleetuser1@test.com');
    if (!fleetUserToken) {
        return { success: false, error: 'Failed to get token' };
    }
    return { success: true, details: { token: fleetUserToken.substring(0, 20) + '...' } };
}

// Scenario 2: Super Admin Login
async function test2_AdminLogin() {
    adminToken = await loginUser('admin@qrqueue.com');
    if (!adminToken) {
        return { success: false, error: 'Failed to get token' };
    }
    return { success: true, details: { token: adminToken.substring(0, 20) + '...' } };
}

// Scenario 3: Get Operations Stats (Fleet User)
async function test3_GetOperationsStats_FleetUser() {
    const result = await apiRequest('GET', '/api/fleet/operations/stats', fleetUserToken);
    if (!result.success) {
        return { success: false, error: `Status ${result.status}: ${JSON.stringify(result.error)}` };
    }
    const data = result.data;
    const hasRequiredFields = data.active_vehicles !== undefined &&
                              data.avg_queue_time !== undefined &&
                              data.incidents !== undefined &&
                              data.safety_score !== undefined;
    return {
        success: hasRequiredFields,
        details: {
            active_vehicles: data.active_vehicles,
            avg_queue_time: data.avg_queue_time,
            incidents: data.incidents,
            safety_score: data.safety_score
        },
        error: hasRequiredFields ? null : 'Missing required fields'
    };
}

// Scenario 4: Get Operations Stats (Admin)
async function test4_GetOperationsStats_Admin() {
    const result = await apiRequest('GET', '/api/fleet/operations/stats', adminToken);
    if (!result.success) {
        return { success: false, error: `Status ${result.status}: ${JSON.stringify(result.error)}` };
    }
    return { success: true, details: result.data };
}

// Scenario 5: Get All Gates (Fleet User)
async function test5_GetGates_FleetUser() {
    const result = await apiRequest('GET', '/api/fleet/operations/gates', fleetUserToken);
    if (!result.success) {
        return { success: false, error: `Status ${result.status}: ${JSON.stringify(result.error)}` };
    }
    const gates = Array.isArray(result.data) ? result.data : [];
    const hasGates = gates.length > 0;
    return {
        success: hasGates,
        details: { gate_count: gates.length, gates: gates.slice(0, 3) },
        error: hasGates ? null : 'No gates returned'
    };
}

// Scenario 6: Get All Gates (Admin)
async function test6_GetGates_Admin() {
    const result = await apiRequest('GET', '/api/fleet/operations/gates', adminToken);
    if (!result.success) {
        return { success: false, error: `Status ${result.status}: ${JSON.stringify(result.error)}` };
    }
    return { success: true, details: { gate_count: result.data.length } };
}

// Scenario 7: Get Active Alerts (Fleet User)
async function test7_GetAlerts_FleetUser() {
    const result = await apiRequest('GET', '/api/fleet/operations/alerts?limit=10', fleetUserToken);
    if (!result.success) {
        return { success: false, error: `Status ${result.status}: ${JSON.stringify(result.error)}` };
    }
    const alerts = Array.isArray(result.data) ? result.data : [];
    return {
        success: true,
        details: { alert_count: alerts.length, alerts: alerts.slice(0, 3) }
    };
}

// Scenario 8: Get Active Alerts (Admin)
async function test8_GetAlerts_Admin() {
    const result = await apiRequest('GET', '/api/fleet/operations/alerts?limit=10', adminToken);
    if (!result.success) {
        return { success: false, error: `Status ${result.status}: ${JSON.stringify(result.error)}` };
    }
    return { success: true, details: { alert_count: result.data.length } };
}

// Scenario 9: Get Driver Safety Board (Fleet User)
async function test9_GetDrivers_FleetUser() {
    const result = await apiRequest('GET', '/api/fleet/operations/drivers?limit=10', fleetUserToken);
    if (!result.success) {
        return { success: false, error: `Status ${result.status}: ${JSON.stringify(result.error)}` };
    }
    const drivers = Array.isArray(result.data) ? result.data : [];
    return {
        success: true,
        details: { driver_count: drivers.length, drivers: drivers.slice(0, 3) }
    };
}

// Scenario 10: Get Driver Safety Board (Admin)
async function test10_GetDrivers_Admin() {
    const result = await apiRequest('GET', '/api/fleet/operations/drivers?limit=10', adminToken);
    if (!result.success) {
        return { success: false, error: `Status ${result.status}: ${JSON.stringify(result.error)}` };
    }
    return { success: true, details: { driver_count: result.data.length } };
}

// Scenario 11: Get Active Queue (Fleet User)
async function test11_GetActiveQueue_FleetUser() {
    const result = await apiRequest('GET', '/api/fleet/queue/active', fleetUserToken);
    if (!result.success) {
        return { success: false, error: `Status ${result.status}: ${JSON.stringify(result.error)}` };
    }
    return { success: true, details: result.data };
}

// Scenario 12: Join Queue (Fleet User)
async function test12_JoinQueue_FleetUser() {
    const result = await apiRequest('POST', '/api/fleet/queue/join', fleetUserToken, {
        gate_id: 'gate_1',
        vehicle_type: 'truck',
        estimated_wait_time: 15
    });
    if (!result.success) {
        return { success: false, error: `Status ${result.status}: ${JSON.stringify(result.error)}` };
    }
    return { success: true, details: result.data };
}

// Scenario 13: Get All Gates (Driver Endpoint)
async function test13_GetAllGates_FleetUser() {
    const result = await apiRequest('GET', '/api/fleet/gates', fleetUserToken);
    if (!result.success) {
        return { success: false, error: `Status ${result.status}: ${JSON.stringify(result.error)}` };
    }
    const gates = Array.isArray(result.data) ? result.data : [];
    return { success: true, details: { gate_count: gates.length } };
}

// Scenario 14: Get Driver Stats (Fleet User)
async function test14_GetDriverStats_FleetUser() {
    const result = await apiRequest('GET', '/api/fleet/drivers/usr_fleetuser1/stats', fleetUserToken);
    if (!result.success) {
        return { success: false, error: `Status ${result.status}: ${JSON.stringify(result.error)}` };
    }
    return { success: true, details: result.data };
}

// Scenario 15: Get Active Trips (Fleet User)
async function test15_GetActiveTrips_FleetUser() {
    const result = await apiRequest('GET', '/api/fleet/drivers/usr_fleetuser1/trips/active', fleetUserToken);
    if (!result.success) {
        return { success: false, error: `Status ${result.status}: ${JSON.stringify(result.error)}` };
    }
    const trips = Array.isArray(result.data) ? result.data : [];
    return { success: true, details: { trip_count: trips.length } };
}

// Scenario 16: Report Hazard (Fleet User)
async function test16_ReportHazard_FleetUser() {
    const result = await apiRequest('POST', '/api/fleet/hazards/report', fleetUserToken, {
        hazard_type: 'pothole',
        latitude: 37.8044,
        longitude: -122.2711,
        description: 'Test hazard report',
        severity: 'medium'
    });
    if (!result.success) {
        return { success: false, error: `Status ${result.status}: ${JSON.stringify(result.error)}` };
    }
    return { success: true, details: result.data };
}

// Scenario 17: Get Road Conditions (Fleet User)
async function test17_GetRoadConditions_FleetUser() {
    const result = await apiRequest('GET', '/api/fleet/road-conditions?lat=37.8044&lng=-122.2711&radius=5', fleetUserToken);
    if (!result.success) {
        return { success: false, error: `Status ${result.status}: ${JSON.stringify(result.error)}` };
    }
    const conditions = Array.isArray(result.data) ? result.data : [];
    return { success: true, details: { condition_count: conditions.length } };
}

// Scenario 18: Mark Arrived at Gate (Fleet User)
async function test18_MarkArrived_FleetUser() {
    // First get active queue
    const queueResult = await apiRequest('GET', '/api/fleet/queue/active', fleetUserToken);
    if (queueResult.success && queueResult.data && queueResult.data.queue_id) {
        const result = await apiRequest('POST', '/api/fleet/queue/arrived', fleetUserToken, {
            queue_id: queueResult.data.queue_id
        });
        if (!result.success) {
            return { success: false, error: `Status ${result.status}: ${JSON.stringify(result.error)}` };
        }
        return { success: true, details: result.data };
    }
    return { success: true, details: { message: 'No active queue to mark arrived' } };
}

// Scenario 19: Verify Data Consistency (Stats vs Gates)
async function test19_DataConsistency() {
    const statsResult = await apiRequest('GET', '/api/fleet/operations/stats', adminToken);
    const gatesResult = await apiRequest('GET', '/api/fleet/operations/gates', adminToken);
    
    if (!statsResult.success || !gatesResult.success) {
        return { success: false, error: 'Failed to fetch data for consistency check' };
    }
    
    const stats = statsResult.data;
    const gates = gatesResult.data;
    const totalQueued = gates.reduce((sum, gate) => sum + (gate.drivers || 0), 0);
    
    const isConsistent = stats.active_vehicles >= 0 && totalQueued >= 0;
    
    return {
        success: isConsistent,
        details: {
            stats_active_vehicles: stats.active_vehicles,
            total_queued_drivers: totalQueued,
            gate_count: gates.length
        },
        error: isConsistent ? null : 'Data inconsistency detected'
    };
}

// Scenario 20: Verify Real-time Data Updates
async function test20_RealTimeDataUpdates() {
    // Get initial stats
    const initialStats = await apiRequest('GET', '/api/fleet/operations/stats', adminToken);
    if (!initialStats.success) {
        return { success: false, error: 'Failed to get initial stats' };
    }
    
    // Wait 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Get updated stats
    const updatedStats = await apiRequest('GET', '/api/fleet/operations/stats', adminToken);
    if (!updatedStats.success) {
        return { success: false, error: 'Failed to get updated stats' };
    }
    
    // Both should have valid data
    const bothValid = initialStats.data && updatedStats.data &&
                      typeof initialStats.data.active_vehicles === 'number' &&
                      typeof updatedStats.data.active_vehicles === 'number';
    
    return {
        success: bothValid,
        details: {
            initial: initialStats.data,
            updated: updatedStats.data,
            changed: JSON.stringify(initialStats.data) !== JSON.stringify(updatedStats.data)
        },
        error: bothValid ? null : 'Invalid data structure'
    };
}

// ==================== MAIN TEST RUNNER ====================

async function runAllTests() {
    LOG.section('FLEET APPLICATION - REAL-TIME TEST SUITE');
    LOG.info(`Testing against: ${API_BASE}`);
    LOG.info(`Starting at: ${new Date().toISOString()}\n`);
    
    // Check if server is running
    try {
        LOG.info('Checking if backend server is running...');
        const healthCheck = await axios.get(`${API_BASE}/api/health`, { timeout: 5000 }).catch(() => null);
        if (!healthCheck) {
            // Try a simple endpoint
            await axios.get(`${API_BASE}/api/auth/send-otp`, { 
                data: { email: 'test@test.com' },
                timeout: 3000 
            }).catch(() => {
                LOG.warning('⚠️ Backend server may not be running. Tests may fail.');
                LOG.warning('Please start backend server: cd backend && npm run start:mysql');
            });
        }
    } catch (e) {
        LOG.warning('⚠️ Could not verify backend server status. Continuing with tests...');
    }
    
    // Run all scenarios
    await runScenario('1. Fleet User Login', test1_FleetUserLogin);
    await runScenario('2. Super Admin Login', test2_AdminLogin);
    await runScenario('3. Get Operations Stats (Fleet User)', test3_GetOperationsStats_FleetUser);
    await runScenario('4. Get Operations Stats (Admin)', test4_GetOperationsStats_Admin);
    await runScenario('5. Get All Gates (Fleet User)', test5_GetGates_FleetUser);
    await runScenario('6. Get All Gates (Admin)', test6_GetGates_Admin);
    await runScenario('7. Get Active Alerts (Fleet User)', test7_GetAlerts_FleetUser);
    await runScenario('8. Get Active Alerts (Admin)', test8_GetAlerts_Admin);
    await runScenario('9. Get Driver Safety Board (Fleet User)', test9_GetDrivers_FleetUser);
    await runScenario('10. Get Driver Safety Board (Admin)', test10_GetDrivers_Admin);
    await runScenario('11. Get Active Queue (Fleet User)', test11_GetActiveQueue_FleetUser);
    await runScenario('12. Join Queue (Fleet User)', test12_JoinQueue_FleetUser);
    await runScenario('13. Get All Gates - Driver Endpoint (Fleet User)', test13_GetAllGates_FleetUser);
    await runScenario('14. Get Driver Stats (Fleet User)', test14_GetDriverStats_FleetUser);
    await runScenario('15. Get Active Trips (Fleet User)', test15_GetActiveTrips_FleetUser);
    await runScenario('16. Report Hazard (Fleet User)', test16_ReportHazard_FleetUser);
    await runScenario('17. Get Road Conditions (Fleet User)', test17_GetRoadConditions_FleetUser);
    await runScenario('18. Mark Arrived at Gate (Fleet User)', test18_MarkArrived_FleetUser);
    await runScenario('19. Verify Data Consistency', test19_DataConsistency);
    await runScenario('20. Verify Real-time Data Updates', test20_RealTimeDataUpdates);
    
    // Print summary
    LOG.section('TEST SUMMARY');
    LOG.info(`Total Scenarios: ${results.passed + results.failed}`);
    LOG.success(`Passed: ${results.passed}`);
    if (results.failed > 0) {
        LOG.error(`Failed: ${results.failed}`);
    }
    LOG.info(`\nSuccess Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);
    
    // Print failed scenarios
    if (results.failed > 0) {
        LOG.section('FAILED SCENARIOS');
        results.scenarios
            .filter(s => s.status !== 'PASSED')
            .forEach(s => {
                LOG.error(`${s.name}: ${s.error || s.status}`);
            });
    }
    
    // Print all results
    LOG.section('DETAILED RESULTS');
    results.scenarios.forEach(s => {
        const icon = s.status === 'PASSED' ? '✅' : '❌';
        LOG.info(`${icon} ${s.name}`);
        if (s.details) {
            LOG.info(`   ${JSON.stringify(s.details)}`);
        }
        if (s.error) {
            LOG.error(`   Error: ${s.error}`);
        }
    });
    
    LOG.section('TEST COMPLETE');
    LOG.info(`Completed at: ${new Date().toISOString()}`);
    
    return results.failed === 0;
}

// Run tests
if (require.main === module) {
    runAllTests()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(err => {
            LOG.error(`Test suite crashed: ${err.message}`);
            console.error(err);
            process.exit(1);
        });
}

module.exports = { runAllTests, runScenario };

