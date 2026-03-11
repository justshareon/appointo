/**
 * Verify Trust Score Feature Status
 */
const db = require('./database');
const data = require('./database/data');

async function verifyTrustScore() {
    console.log('\n=== Trust Score Feature Status ===\n');
    
    try {
        // Check in-memory database (data.js)
        console.log('1. In-memory Database (data.js):');
        console.log('   enable_trust_score:', data.settings?.enable_trust_score);
        
        // Check database getSettings
        console.log('\n2. Database getSettings():');
        const settings = await db.getSettings();
        console.log('   enable_trust_score:', settings.enable_trust_score);
        console.log('   Type:', typeof settings.enable_trust_score);
        
        // Check database type
        console.log('\n3. Database Type:');
        console.log('   Type:', db.getType());
        
        // Summary
        console.log('\n=== Summary ===');
        const isEnabled = settings.enable_trust_score === true;
        if (isEnabled) {
            console.log('✓ Trust Score is ENABLED');
            console.log('✓ Ready to use');
        } else {
            console.log('✗ Trust Score is DISABLED');
            console.log('  Run: node enable_trust_score.js');
        }
        console.log('');
        
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

verifyTrustScore().then(() => {
    process.exit(0);
}).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

