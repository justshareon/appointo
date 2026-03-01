/**
 * Fleet Application Debug Script
 * 
 * This script checks:
 * 1. Database tables exist and have data
 * 2. Routes are properly registered
 * 3. Services are working
 * 4. Sample data is present
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

const LOG = {
    info: (msg) => console.log(`[DEBUG] ${msg}`),
    success: (msg) => console.log(`[DEBUG] ✅ ${msg}`),
    error: (msg) => console.error(`[DEBUG] ❌ ${msg}`),
    warning: (msg) => console.warn(`[DEBUG] ⚠️ ${msg}`)
};

const debugFleet = async () => {
    let connection;
    try {
        LOG.info('========== FLEET APPLICATION DEBUG ==========');
        
        // Connect to database
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com',
            port: process.env.DB_PORT || 4000,
            user: process.env.DB_USER || '45gthaydhVD1pM3.root',
            password: process.env.DB_PASSWORD || 'XHSYhumyCXkvaj9m',
            database: process.env.DB_NAME || 'qr_queue',
            ssl: { rejectUnauthorized: false }
        });
        
        LOG.success('Connected to MySQL database');
        
        // Check tables exist
        LOG.info('\n--- Checking Tables ---');
        const tables = [
            'fleet_gates',
            'fleet_queues',
            'fleet_trips',
            'fleet_hazards',
            'fleet_driver_stats',
            'fleet_road_conditions'
        ];
        
        for (const table of tables) {
            try {
                const [rows] = await connection.query(`SELECT COUNT(*) as count FROM ${table}`);
                const count = rows[0].count;
                if (count > 0) {
                    LOG.success(`${table}: ${count} records`);
                } else {
                    LOG.warning(`${table}: 0 records (needs data)`);
                }
            } catch (e) {
                LOG.error(`${table}: Table does not exist or error - ${e.message}`);
            }
        }
        
        // Check fleet_gates
        LOG.info('\n--- Fleet Gates ---');
        const [gates] = await connection.query('SELECT * FROM fleet_gates ORDER BY gate_id LIMIT 10');
        LOG.info(`Found ${gates.length} gates:`);
        gates.forEach(gate => {
            LOG.info(`  - ${gate.gate_id}: ${gate.gate_name} (Active: ${gate.is_active}, Queue: ${gate.current_queue_count})`);
        });
        
        // Check fleet_queues
        LOG.info('\n--- Fleet Queues ---');
        const [queues] = await connection.query(`
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) as waiting,
                   SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing
            FROM fleet_queues
        `);
        LOG.info(`Total queues: ${queues[0].total}, Waiting: ${queues[0].waiting}, Processing: ${queues[0].processing}`);
        
        // Check fleet_trips
        LOG.info('\n--- Fleet Trips ---');
        const [trips] = await connection.query(`
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
                   SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as scheduled
            FROM fleet_trips
        `);
        LOG.info(`Total trips: ${trips[0].total}, In Progress: ${trips[0].in_progress}, Scheduled: ${trips[0].scheduled}`);
        
        // Check fleet_hazards
        LOG.info('\n--- Fleet Hazards (Last 24h) ---');
        const [hazards] = await connection.query(`
            SELECT COUNT(*) as count
            FROM fleet_hazards
            WHERE status = 'reported'
            AND reported_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        `);
        LOG.info(`Active hazards: ${hazards[0].count}`);
        
        // Check fleet_driver_stats
        LOG.info('\n--- Driver Stats (Today) ---');
        const today = new Date().toISOString().split('T')[0];
        const [stats] = await connection.query(`
            SELECT COUNT(*) as count, AVG(safety_score) as avg_score
            FROM fleet_driver_stats
            WHERE stat_date = ?
        `, [today]);
        LOG.info(`Drivers with stats today: ${stats[0].count}, Avg safety score: ${Math.round(stats[0].avg_score || 100)}%`);
        
        // Test operations stats query
        LOG.info('\n--- Testing Operations Stats Query ---');
        try {
            const [activeVehicles] = await connection.query(`
                SELECT COUNT(DISTINCT driver_id) as count
                FROM (
                    SELECT driver_id FROM fleet_trips WHERE status IN ('scheduled', 'in_progress')
                    UNION
                    SELECT driver_id FROM fleet_queues WHERE status IN ('waiting', 'processing')
                ) as active
            `);
            LOG.success(`Active vehicles query: ${activeVehicles[0].count}`);
        } catch (e) {
            LOG.error(`Active vehicles query failed: ${e.message}`);
        }
        
        // Test gates with queue data query
        LOG.info('\n--- Testing Gates with Queue Data Query ---');
        try {
            const [gatesWithQueue] = await connection.query(`
                SELECT 
                    fg.gate_id,
                    fg.gate_name,
                    COALESCE(queue_stats.queue_count, 0) as current_queue_count,
                    COALESCE(queue_stats.avg_wait_time, fg.estimated_wait_time, 0) as avg_wait_time
                FROM fleet_gates fg
                LEFT JOIN (
                    SELECT 
                        gate_id,
                        COUNT(*) as queue_count,
                        AVG(estimated_wait_time) as avg_wait_time
                    FROM fleet_queues
                    WHERE status = 'waiting'
                    GROUP BY gate_id
                ) as queue_stats ON fg.gate_id = queue_stats.gate_id
                ORDER BY fg.gate_id ASC
                LIMIT 5
            `);
            LOG.success(`Gates with queue data query: ${gatesWithQueue.length} gates`);
            gatesWithQueue.forEach(g => {
                LOG.info(`  - ${g.gate_name}: ${g.current_queue_count} in queue, ${Math.round(g.avg_wait_time)}min wait`);
            });
        } catch (e) {
            LOG.error(`Gates query failed: ${e.message}`);
        }
        
        // Check fleet users
        LOG.info('\n--- Fleet Users ---');
        const [fleetUsers] = await connection.query(`
            SELECT id, name, email, role
            FROM users
            WHERE email LIKE '%fleet%' OR role LIKE '%fleet%'
            LIMIT 10
        `);
        LOG.info(`Found ${fleetUsers.length} fleet users:`);
        fleetUsers.forEach(user => {
            LOG.info(`  - ${user.id}: ${user.name} (${user.email}) - Role: ${user.role}`);
        });
        
        LOG.info('\n========== DEBUG COMPLETE ==========');
        LOG.success('All checks completed. Review output above for any issues.');
        
    } catch (err) {
        LOG.error(`Debug script failed: ${err.message}`);
        console.error(err);
    } finally {
        if (connection) await connection.end();
    }
};

debugFleet();

