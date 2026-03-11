/**
 * Search Test Data Script
 * Run this script to search and display test data by type
 * 
 * Usage:
 *   node search_test_data.js phone
 *   node search_test_data.js upi
 *   node search_test_data.js url
 *   node search_test_data.js email
 *   node search_test_data.js phone "9876543210"
 */

require('dotenv').config();
process.env.DB_TYPE = 'inmemory';

const axios = require('axios');
const API_BASE = process.env.API_BASE || 'http://localhost:3000';

async function searchTestData(type, searchTerm = null) {
    try {
        const url = `${API_BASE}/api/suraksha/test-data?type=${type}${searchTerm ? `&search=${encodeURIComponent(searchTerm)}` : ''}`;
        
        console.log('\n🔍 Searching test data...');
        console.log(`Type: ${type}`);
        if (searchTerm) {
            console.log(`Search term: ${searchTerm}`);
        }
        console.log(`URL: ${url}\n`);

        const response = await axios.get(url);
        const data = response.data;

        if (!data.success) {
            console.error('❌ Error:', data.error);
            console.error('Message:', data.message);
            return;
        }

        console.log('='.repeat(80));
        console.log(`📊 Test Data Results for Type: ${type.toUpperCase()}`);
        console.log('='.repeat(80));
        console.log(`Total entries: ${data.count}`);
        
        if (data.summary) {
            console.log('\n📈 Summary:');
            console.log(`  By Severity:`);
            console.log(`    Critical: ${data.summary.bySeverity.critical}`);
            console.log(`    High: ${data.summary.bySeverity.high}`);
            console.log(`    Medium: ${data.summary.bySeverity.medium}`);
            console.log(`    Low: ${data.summary.bySeverity.low}`);
            
            if (Object.keys(data.summary.byCategory).length > 0) {
                console.log(`  By Category:`);
                Object.entries(data.summary.byCategory).forEach(([cat, count]) => {
                    console.log(`    ${cat}: ${count}`);
                });
            }
        }

        if (data.data && data.data.length > 0) {
            console.log('\n📋 Details:\n');
            data.data.forEach((item, index) => {
                console.log(`${index + 1}. ${item.value || item.phone_number || 'N/A'}`);
                console.log(`   Title: ${item.title || 'N/A'}`);
                console.log(`   Severity: ${item.severity || 'N/A'} | Category: ${item.category || 'N/A'}`);
                if (item.description) {
                    console.log(`   Description: ${item.description.substring(0, 100)}${item.description.length > 100 ? '...' : ''}`);
                }
                if (item.report_count) {
                    console.log(`   Reports: ${item.report_count}`);
                }
                if (item.location) {
                    console.log(`   Location: ${item.location}`);
                }
                if (item.tags && item.tags.length > 0) {
                    console.log(`   Tags: ${item.tags.join(', ')}`);
                }
                if (item.source) {
                    console.log(`   Source: ${item.source}`);
                }
                console.log('');
            });
        } else {
            console.log('\n⚠️  No test data found for this type.');
        }

        console.log('='.repeat(80));
        console.log('\n✅ Search complete!\n');

    } catch (error) {
        if (error.response) {
            console.error('❌ API Error:');
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Message: ${error.response.data?.message || error.response.data?.error || 'Unknown error'}`);
            if (error.response.data?.message && error.response.data.message.includes('Type parameter')) {
                console.error('\n💡 Usage:');
                console.error('   node search_test_data.js <type> [search_term]');
                console.error('   Types: phone, upi, url, email, bank_account');
                console.error('   Example: node search_test_data.js phone');
                console.error('   Example: node search_test_data.js phone "9876543210"');
            }
        } else if (error.code === 'ECONNREFUSED') {
            console.error('❌ Connection Error:');
            console.error(`   Cannot connect to ${API_BASE}`);
            console.error('   Make sure the backend server is running on port 3000');
        } else {
            console.error('❌ Error:', error.message);
        }
        process.exit(1);
    }
}

// Get command line arguments
const type = process.argv[2];
const searchTerm = process.argv[3];

if (!type) {
    console.log('🔍 Test Data Search Tool');
    console.log('='.repeat(80));
    console.log('\nUsage:');
    console.log('  node search_test_data.js <type> [search_term]');
    console.log('\nTypes:');
    console.log('  phone      - Search phone numbers');
    console.log('  upi        - Search UPI IDs');
    console.log('  url        - Search URLs');
    console.log('  email      - Search email addresses');
    console.log('  bank_account - Search bank accounts');
    console.log('\nExamples:');
    console.log('  node search_test_data.js phone');
    console.log('  node search_test_data.js upi');
    console.log('  node search_test_data.js phone "9876543210"');
    console.log('  node search_test_data.js url "sbi"');
    console.log('\n');
    process.exit(0);
}

// Run the search
searchTestData(type, searchTerm);

