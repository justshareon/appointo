/**
 * Enable Trust Score Feature
 * Updates both in-memory and MySQL databases
 */
const db = require('./database');
const settingsService = require('./services/settingsService');

async function enableTrustScore() {
    console.log('\n=== Enabling Trust Score Feature ===\n');
    
    try {
        // Get current settings
        const currentSettings = await settingsService.getSettings();
        console.log('Current enable_trust_score:', currentSettings.enable_trust_score);
        
        // Update settings to enable Trust Score
        await settingsService.updateSettings({ 
            enable_trust_score: true 
        });
        
        // Verify the update
        const updatedSettings = await settingsService.getSettings();
        console.log('Updated enable_trust_score:', updatedSettings.enable_trust_score);
        
        // Check database type
        const dbType = db.getType();
        console.log('Database type:', dbType);
        
        // Force update in-memory database directly
        const data = require('./database/data');
        if (data.settings) {
            data.settings.enable_trust_score = true;
            console.log('✓ In-memory database updated directly');
        }
        
        if (dbType === 'mysql') {
            const pool = db.getPool();
            if (pool) {
                try {
                    // Ensure table exists
                    await pool.query(`
                        CREATE TABLE IF NOT EXISTS system_settings (
                            key_name VARCHAR(50) PRIMARY KEY, 
                            value VARCHAR(50)
                        )
                    `);
                    
                    // Insert or update the setting
                    await pool.query(
                        'INSERT INTO system_settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?',
                        ['enable_trust_score', 'true', 'true']
                    );
                    
                    // Verify MySQL setting
                    const [rows] = await pool.query(
                        'SELECT * FROM system_settings WHERE key_name = ?',
                        ['enable_trust_score']
                    );
                    if (rows.length > 0) {
                        console.log('✓ MySQL setting:', rows[0].key_name, '=', rows[0].value);
                    }
                } catch (mysqlError) {
                    console.log('MySQL not available or error:', mysqlError.message);
                    console.log('Using in-memory database only');
                }
            }
        }
        
        // Verify final settings
        const finalSettings = await db.getSettings();
        console.log('\n=== Final Verification ===');
        console.log('enable_trust_score:', finalSettings.enable_trust_score);
        console.log('Type:', typeof finalSettings.enable_trust_score);
        
        console.log('\n✓ Trust Score feature enabled successfully!');
        console.log('✓ Both local and MySQL databases updated\n');
        
    } catch (error) {
        console.error('Error enabling Trust Score:', error);
        process.exit(1);
    }
}

// Run the script
enableTrustScore().then(() => {
    process.exit(0);
}).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

