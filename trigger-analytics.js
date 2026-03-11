/**
 * Script to manually trigger feature engineering
 * Usage: node trigger-analytics.js
 */
require('dotenv').config();
const db = require('./database');
const featureEngineeringService = require('./services/featureEngineeringService');
const LOG = require('./utils/logger');

// Wait for database to initialize
async function waitForDatabase() {
    return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
            const pool = db.getPool();
            if (pool) {
                clearInterval(checkInterval);
                resolve();
            }
        }, 100);
        
        // Timeout after 5 seconds
        setTimeout(() => {
            clearInterval(checkInterval);
            resolve();
        }, 5000);
    });
}

async function triggerFeatureEngineering() {
    console.log('='.repeat(60));
    console.log('🚀 Triggering Feature Engineering...');
    console.log('='.repeat(60));
    
    // Wait for database to be ready
    console.log('⏳ Waiting for database connection...');
    await waitForDatabase();
    
    const pool = db.getPool();
    if (!pool) {
        console.error('❌ MySQL database is not available!');
        console.error('Please check your database configuration in .env file');
        process.exit(1);
    }
    
    console.log('✅ Database connection ready');
    console.log('');
    
    try {
        const result = await featureEngineeringService.generateFeaturesForML();
        
        console.log('\n' + '='.repeat(60));
        console.log('📊 Feature Engineering Results:');
        console.log('='.repeat(60));
        console.log(JSON.stringify(result, null, 2));
        console.log('='.repeat(60));
        
        if (result.success) {
            console.log(`✅ Success! Processed ${result.success} stocks`);
            if (result.failed > 0) {
                console.log(`⚠️  ${result.failed} stocks failed`);
            }
        } else {
            console.log(`❌ Failed: ${result.message || result.error}`);
        }
        
        process.exit(0);
    } catch (error) {
        console.error('\n' + '='.repeat(60));
        console.error('❌ Error:', error.message);
        console.error('Stack:', error.stack);
        console.error('='.repeat(60));
        process.exit(1);
    }
}

triggerFeatureEngineering();

