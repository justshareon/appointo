/**
 * Search Test Data Script (Direct Database Access)
 * Run this script to search and display test data by type directly from database
 * 
 * Usage:
 *   node search_test_data_direct.js phone
 *   node search_test_data_direct.js upi
 *   node search_test_data_direct.js url
 *   node search_test_data_direct.js email
 *   node search_test_data_direct.js phone "9876543210"
 */

require('dotenv').config();
process.env.DB_TYPE = 'inmemory';

const db = require('./database');
const LOG = require('./utils/logger');

function searchTestData(type, searchTerm = null) {
    try {
        console.log('\n🔍 Searching test data...');
        console.log(`Type: ${type}`);
        if (searchTerm) {
            console.log(`Search term: ${searchTerm}`);
        }
        console.log('');

        // Get all threats of this type
        let threats = (db.cyberThreats || []).filter(t => 
            t.status === 'active' && t.type === type
        );

        // Apply search filter if provided
        if (searchTerm) {
            const searchLower = searchTerm.toLowerCase();
            threats = threats.filter(t => 
                t.value?.toLowerCase().includes(searchLower) ||
                t.title?.toLowerCase().includes(searchLower) ||
                t.description?.toLowerCase().includes(searchLower) ||
                t.tags?.some(tag => tag.toLowerCase().includes(searchLower))
            );
        }

        // Also include spam numbers for phone type
        let additionalData = [];
        
        if (type === 'phone' && db.spamNumbers) {
            additionalData = db.spamNumbers.map(spam => ({
                id: spam.id,
                type: 'phone',
                value: spam.phone_number,
                title: spam.caller_name || 'Spam Number',
                description: `Reported ${spam.report_count || 0} times`,
                severity: spam.is_scam ? 'high' : 'medium',
                category: spam.is_scam ? 'scam' : (spam.is_telemarketing ? 'telemarketing' : 'spam'),
                tags: spam.tags || [],
                report_count: spam.report_count || 0,
                source: 'spam_database',
                is_spam: spam.is_spam,
                is_scam: spam.is_scam,
                is_telemarketing: spam.is_telemarketing,
                created_at: spam.created_at,
                updated_at: spam.updated_at
            }));
        }

        // Combine and deduplicate by value
        const allData = [...threats];
        additionalData.forEach(item => {
            if (!allData.find(t => t.value === item.value && t.type === item.type)) {
                allData.push(item);
            }
        });

        // Sort by severity and report count
        allData.sort((a, b) => {
            const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
            const severityDiff = (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
            if (severityDiff !== 0) return severityDiff;
            return (b.report_count || 0) - (a.report_count || 0);
        });

        // Display results
        console.log('='.repeat(80));
        console.log(`📊 Test Data Results for Type: ${type.toUpperCase()}`);
        console.log('='.repeat(80));
        console.log(`Total entries: ${allData.length}`);
        
        // Summary
        const summary = {
            bySeverity: {
                critical: allData.filter(t => t.severity === 'critical').length,
                high: allData.filter(t => t.severity === 'high').length,
                medium: allData.filter(t => t.severity === 'medium').length,
                low: allData.filter(t => t.severity === 'low').length
            },
            byCategory: allData.reduce((acc, t) => {
                acc[t.category] = (acc[t.category] || 0) + 1;
                return acc;
            }, {})
        };

        console.log('\n📈 Summary:');
        console.log(`  By Severity:`);
        console.log(`    Critical: ${summary.bySeverity.critical}`);
        console.log(`    High: ${summary.bySeverity.high}`);
        console.log(`    Medium: ${summary.bySeverity.medium}`);
        console.log(`    Low: ${summary.bySeverity.low}`);
        
        if (Object.keys(summary.byCategory).length > 0) {
            console.log(`  By Category:`);
            Object.entries(summary.byCategory).forEach(([cat, count]) => {
                console.log(`    ${cat}: ${count}`);
            });
        }

        if (allData.length > 0) {
            console.log('\n📋 Details:\n');
            allData.forEach((item, index) => {
                console.log(`${index + 1}. ${item.value || item.phone_number || 'N/A'}`);
                console.log(`   Title: ${item.title || 'N/A'}`);
                console.log(`   Severity: ${item.severity || 'N/A'} | Category: ${item.category || 'N/A'}`);
                if (item.description) {
                    const desc = item.description.length > 100 
                        ? item.description.substring(0, 100) + '...' 
                        : item.description;
                    console.log(`   Description: ${desc}`);
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
                if (item.is_scam !== undefined) {
                    console.log(`   Is Scam: ${item.is_scam}`);
                }
                if (item.is_telemarketing !== undefined) {
                    console.log(`   Is Telemarketing: ${item.is_telemarketing}`);
                }
                console.log('');
            });
        } else {
            console.log('\n⚠️  No test data found for this type.');
        }

        console.log('='.repeat(80));
        console.log('\n✅ Search complete!\n');

        return allData;

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Get command line arguments
const type = process.argv[2];
const searchTerm = process.argv[3];

if (!type) {
    console.log('🔍 Test Data Search Tool (Direct Database)');
    console.log('='.repeat(80));
    console.log('\nUsage:');
    console.log('  node search_test_data_direct.js <type> [search_term]');
    console.log('\nTypes:');
    console.log('  phone      - Search phone numbers');
    console.log('  upi        - Search UPI IDs');
    console.log('  url        - Search URLs');
    console.log('  email      - Search email addresses');
    console.log('  bank_account - Search bank accounts');
    console.log('\nExamples:');
    console.log('  node search_test_data_direct.js phone');
    console.log('  node search_test_data_direct.js upi');
    console.log('  node search_test_data_direct.js phone "9876543210"');
    console.log('  node search_test_data_direct.js url "sbi"');
    console.log('\n');
    process.exit(0);
}

// Validate type
const validTypes = ['phone', 'upi', 'url', 'email', 'bank_account'];
if (!validTypes.includes(type)) {
    console.error('❌ Invalid type:', type);
    console.error(`Valid types: ${validTypes.join(', ')}`);
    process.exit(1);
}

// Run the search
searchTestData(type, searchTerm);

