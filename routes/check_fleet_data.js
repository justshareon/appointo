/**
 * Quick script to check if fleet data exists in database
 */

const db = require('./database');
require('dotenv').config();

async function checkFleetData() {
    try {
        const dbType = db.getType();
        console.log(`\n[CHECK] Database type: ${dbType}\n`);
        
        if (dbType !== 'mysql') {
            console.log('❌ Fleet data only works with MySQL. Current mode:', dbType);
            return;
        }

        const pool = db.getPool();
        if (!pool) {
            console.log('❌ MySQL connection pool not available');
            return;
        }

        console.log('[CHECK] Checking fleet data...\n');

        // Check gates
        const [gates] = await pool.query(`SELECT COUNT(*) as count FROM fleet_gates WHERE is_active = TRUE`);
        console.log(`✅ Active Gates: ${gates[0].count}`);

        // Check queues
        const [queues] = await pool.query(`SELECT COUNT(*) as count FROM fleet_queues WHERE status = 'waiting'`);
        console.log(`✅ Active Queues: ${queues[0].count}`);

        // Check drivers (users with fleet in email)
        const [drivers] = await pool.query(`SELECT COUNT(*) as count FROM users WHERE email LIKE '%fleet%'`);
        console.log(`✅ Fleet Users: ${drivers[0].count}`);

        // Check trips
        const [trips] = await pool.query(`SELECT COUNT(*) as count FROM fleet_trips WHERE status IN ('scheduled', 'in_progress')`);
        console.log(`✅ Active Trips: ${trips[0].count}`);

        // Check hazards
        const [hazards] = await pool.query(`SELECT COUNT(*) as count FROM fleet_hazards WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`);
        console.log(`✅ Recent Hazards (24h): ${hazards[0].count}`);

        // Check driver stats
        const [stats] = await pool.query(`SELECT COUNT(*) as count FROM fleet_driver_stats WHERE stat_date = CURDATE()`);
        console.log(`✅ Driver Stats (today): ${stats[0].count}`);

        console.log('\n[CHECK] Summary:');
        if (gates[0].count === 0) {
            console.log('⚠️  No gates found! Run: npm run seed:fleet');
        }
        if (queues[0].count === 0) {
            console.log('⚠️  No active queues found! Run: npm run seed:fleet');
        }
        if (drivers[0].count === 0) {
            console.log('⚠️  No fleet users found! Check user creation.');
        }

        // Test operations stats query
        console.log('\n[CHECK] Testing Operations Stats Query...');
        const [activeVehicles] = await pool.query(`
            SELECT COUNT(DISTINCT driver_id) as count
            FROM (
                SELECT driver_id FROM fleet_trips WHERE status IN ('scheduled', 'in_progress')
                UNION
                SELECT driver_id FROM fleet_queues WHERE status IN ('waiting', 'processing')
            ) as active
        `);
        console.log(`✅ Active Vehicles Query Result: ${activeVehicles[0].count}`);

        // Test gates with queue data
        const [gatesWithQueue] = await pool.query(`
            SELECT 
                g.gate_id,
                g.gate_name,
                g.location_name,
                g.is_active,
                COUNT(DISTINCT q.driver_id) as queue_length,
                AVG(q.estimated_wait_time) as avg_wait_time
            FROM fleet_gates g
            LEFT JOIN fleet_queues q ON q.gate_id = g.gate_id AND q.status = 'waiting'
            WHERE g.is_active = TRUE
            GROUP BY g.gate_id, g.gate_name, g.location_name, g.is_active
            ORDER BY g.gate_name
        `);
        console.log(`✅ Gates with Queue Data: ${gatesWithQueue.length} gates`);
        if (gatesWithQueue.length > 0) {
            console.log('   Sample gate:', gatesWithQueue[0].gate_name, '- Queue:', gatesWithQueue[0].queue_length);
        }

        console.log('\n✅ Data check complete!\n');
        
    } catch (err) {
        console.error('❌ Error:', err.message);
        console.error(err);
        process.exit(1);
    }
}

checkFleetData()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });

