const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com',
            port: process.env.DB_PORT || 4000,
            user: process.env.DB_USER || '45gthaydhVD1pM3.root',
            password: process.env.DB_PASSWORD || 'XHSYhumyCXkvaj9m',
            database: process.env.DB_NAME || 'qr_queue',
            ssl: { rejectUnauthorized: false }
        });

        console.log('\n=== Verifying Fleet Tables ===\n');

        // Check tables
        const [tables] = await connection.query("SHOW TABLES LIKE 'fleet_%'");
        console.log(`✅ Found ${tables.length} fleet tables:`);
        tables.forEach(t => {
            console.log(`   - ${Object.values(t)[0]}`);
        });

        // Check gates
        const [gates] = await connection.query('SELECT gate_id, gate_name, location_name FROM fleet_gates LIMIT 5');
        console.log(`\n✅ Found ${gates.length} gates:`);
        gates.forEach(g => {
            console.log(`   - ${g.gate_id}: ${g.gate_name} (${g.location_name})`);
        });

        console.log('\n✅ Fleet setup verified successfully!\n');

    } catch (err) {
        console.error('❌ Verification failed:', err.message);
    } finally {
        if (connection) await connection.end();
    }
})();

