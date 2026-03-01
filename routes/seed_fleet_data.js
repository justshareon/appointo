const mysql = require('mysql2/promise');
require('dotenv').config();

const LOG = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    error: (msg, detail = "") => console.error(`[ERROR] ${msg} ${detail}`),
    success: (msg) => console.log(`[SUCCESS] ${msg}`)
};

const seedFleetData = async () => {
    let connection;
    try {
        // Use local MySQL by default, or cloud if env vars are set
        const dbConfig = {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT) || 3306,
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || 'root',
            database: process.env.DB_NAME || 'qr_queue'
        };
        
        // Only add SSL for cloud databases (non-localhost)
        if (dbConfig.host !== 'localhost' && dbConfig.host !== '127.0.0.1') {
            dbConfig.ssl = { rejectUnauthorized: false };
        }
        
        connection = await mysql.createConnection(dbConfig);

        LOG.info("Connected to MySQL for Fleet data seeding.");

        const driverId = 'usr_fleetuser1';
        const vendorId = 'v_fleet1';
        const today = new Date().toISOString().split('T')[0];

        // 1. Seed Fleet Gates (if not exists) - 8 gates total
        LOG.info("Seeding fleet gates...");
        await connection.query(`
            INSERT IGNORE INTO fleet_gates (gate_id, gate_name, location_name, vendor_id, is_active, current_queue_count, estimated_wait_time)
            VALUES
            ('gate_1', 'Port of Oakland - Gate 1', 'Oakland, CA', ?, TRUE, 0, 10),
            ('gate_2', 'Port of Oakland - Gate 2', 'Oakland, CA', ?, TRUE, 0, 12),
            ('gate_3', 'Port of Oakland - Gate 3', 'Oakland, CA', ?, FALSE, 0, 0),
            ('gate_4', 'Port of Oakland - Gate 4', 'Oakland, CA', ?, TRUE, 0, 8),
            ('gate_5', 'Port of Oakland - Gate 5', 'Oakland, CA', ?, TRUE, 0, 15),
            ('gate_6', 'Port of Oakland - Gate 6', 'Oakland, CA', ?, TRUE, 0, 10),
            ('gate_7', 'Port of Oakland - Gate 7', 'Oakland, CA', ?, TRUE, 0, 18),
            ('gate_8', 'Port of Oakland - Gate 8', 'Oakland, CA', ?, TRUE, 0, 20)
        `, [vendorId, vendorId, vendorId, vendorId, vendorId, vendorId, vendorId, vendorId]);
        LOG.success("Fleet gates seeded (8 gates).");

        // 2. Seed Active Queue Entries (for multiple drivers and gates)
        LOG.info("Seeding active queue entries...");
        // Delete old queue entries
        await connection.query(`
            DELETE FROM fleet_queues WHERE status = 'waiting'
        `);

        // Get all fleet users
        const [fleetUsersForQueue] = await connection.query(`
            SELECT id FROM users WHERE email LIKE '%fleet%' OR role LIKE '%fleet%' LIMIT 15
        `);

        // Get all gates
        const [allGates] = await connection.query(`
            SELECT gate_id, gate_name, estimated_wait_time FROM fleet_gates WHERE is_active = TRUE
        `);

        // Distribute drivers across gates (create 12 queue entries, cycling through users)
        const queueEntries = [];
        const numQueues = 12; // Always create 12 queue entries
        
        for (let i = 0; i < numQueues; i++) {
            const user = fleetUsersForQueue[i % fleetUsersForQueue.length]; // Cycle through users
            const gate = allGates[i % allGates.length];
            const position = Math.floor(i / allGates.length) + 1;
            const waitTime = (gate.estimated_wait_time || 10) + (position - 1) * 3;
            
            queueEntries.push({
                driver_id: user.id,
                gate_id: gate.gate_id,
                gate_name: gate.gate_name,
                position: position,
                wait_time: waitTime
            });
        }

        // Insert queue entries
        for (const entry of queueEntries) {
            await connection.query(`
                INSERT INTO fleet_queues 
                (driver_id, gate_id, gate_name, vendor_id, position, status, joined_at, estimated_wait_time)
                VALUES (?, ?, ?, ?, ?, 'waiting', DATE_SUB(NOW(), INTERVAL ? MINUTE), ?)
            `, [entry.driver_id, entry.gate_id, entry.gate_name, vendorId, entry.position, entry.position * 2, entry.wait_time]);
        }

        // Update gate queue counts
        await connection.query(`
            UPDATE fleet_gates 
            SET current_queue_count = (
                SELECT COUNT(*) 
                FROM fleet_queues 
                WHERE fleet_queues.gate_id = fleet_gates.gate_id 
                AND fleet_queues.status = 'waiting'
            )
        `);

        LOG.success(`Active queue entries seeded for ${queueEntries.length} drivers across ${allGates.length} gates.`);

        // 3. Seed Driver Stats (Today) for multiple drivers
        LOG.info("Seeding driver stats...");
        const [fleetUsersForStats] = await connection.query(`
            SELECT id FROM users WHERE email LIKE '%fleet%' OR role LIKE '%fleet%' LIMIT 10
        `);

        const statsData = [
            { trips: 3, miles: 124.5, safe: 0, points: 450, score: 98 },
            { trips: 5, miles: 198.2, safe: 2, points: 520, score: 95 },
            { trips: 2, miles: 87.3, safe: 0, points: 380, score: 92 },
            { trips: 4, miles: 156.8, safe: 1, points: 480, score: 89 },
            { trips: 6, miles: 245.1, safe: 3, points: 580, score: 96 },
            { trips: 3, miles: 112.4, safe: 0, points: 420, score: 94 },
            { trips: 4, miles: 178.9, safe: 1, points: 490, score: 91 },
            { trips: 5, miles: 203.6, safe: 2, points: 540, score: 97 },
            { trips: 2, miles: 95.7, safe: 0, points: 360, score: 88 },
            { trips: 4, miles: 167.2, safe: 1, points: 470, score: 93 },
        ];

        for (let i = 0; i < statsData.length; i++) {
            const user = fleetUsersForStats[i % fleetUsersForStats.length]; // Cycle through users
            const stats = statsData[i];
            await connection.query(`
                INSERT INTO fleet_driver_stats 
                (driver_id, stat_date, trips_count, miles_driven, safe_events, points_earned, safety_score)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    trips_count = ?,
                    miles_driven = ?,
                    safe_events = ?,
                    points_earned = ?,
                    safety_score = ?
            `, [
                user.id, today, stats.trips, stats.miles, stats.safe, stats.points, stats.score,
                stats.trips, stats.miles, stats.safe, stats.points, stats.score
            ]);
        }
        LOG.success(`Driver stats seeded: ${statsData.length} driver records.`);

        // 4. Seed Active Trips (for multiple drivers to show active vehicles)
        LOG.info("Seeding active trips...");
        // Delete old active trips
        await connection.query(`
            DELETE FROM fleet_trips WHERE status IN ('in_progress', 'scheduled')
        `);

        // Get all fleet users
        const [fleetUsersForTrips] = await connection.query(`
            SELECT id FROM users WHERE email LIKE '%fleet%' OR role LIKE '%fleet%' LIMIT 10
        `);

        // Insert active trips for multiple drivers (use same users multiple times if needed)
        const tripData = [
            { type: 'transport', origin: 'Oakland Port', dest: 'San Francisco Warehouse', lat1: 37.8044, lng1: -122.2711, lat2: 37.7749, lng2: -122.4194, dist: 12.5, status: 'in_progress' },
            { type: 'pickup', origin: 'Los Angeles Port', dest: 'Bakersfield Distribution', lat1: 34.0522, lng1: -118.2437, lat2: 35.3733, lng2: -119.0187, dist: 112.3, status: 'in_progress' },
            { type: 'delivery', origin: 'San Jose Warehouse', dest: 'Fremont Store', lat1: 37.3382, lng1: -121.8863, lat2: 37.5485, lng2: -121.9886, dist: 15.2, status: 'scheduled' },
            { type: 'transport', origin: 'Port of Long Beach', dest: 'Los Angeles Distribution', lat1: 33.7701, lng1: -118.1937, lat2: 34.0522, lng2: -118.2437, dist: 25.8, status: 'in_progress' },
            { type: 'pickup', origin: 'Oakland Port', dest: 'Sacramento Warehouse', lat1: 37.8044, lng1: -122.2711, lat2: 38.5816, lng2: -121.4944, dist: 85.2, status: 'in_progress' },
        ];

        for (let i = 0; i < tripData.length; i++) {
            const trip = tripData[i];
            const userId = fleetUsersForTrips[i % fleetUsersForTrips.length]?.id || driverId; // Cycle through users
            
            if (trip.status === 'in_progress') {
                await connection.query(`
                    INSERT INTO fleet_trips 
                    (driver_id, vendor_id, trip_type, origin, destination, 
                     start_latitude, start_longitude, end_latitude, end_longitude, status, scheduled_start, actual_start, distance_miles)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?)
                `, [
                    userId, vendorId, trip.type, trip.origin, trip.dest,
                    trip.lat1, trip.lng1, trip.lat2, trip.lng2,
                    trip.status, trip.dist
                ]);
            } else {
                await connection.query(`
                    INSERT INTO fleet_trips 
                    (driver_id, vendor_id, trip_type, origin, destination, 
                     start_latitude, start_longitude, end_latitude, end_longitude, status, scheduled_start, actual_start, distance_miles)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NULL, ?)
                `, [
                    userId, vendorId, trip.type, trip.origin, trip.dest,
                    trip.lat1, trip.lng1, trip.lat2, trip.lng2,
                    trip.status, trip.dist
                ]);
            }
        }
        LOG.success(`Active trips seeded: ${tripData.length} trips.`);

        // 5. Seed Road Conditions / Hazards (more comprehensive)
        LOG.info("Seeding road conditions...");
        await connection.query(`
            DELETE FROM fleet_road_conditions WHERE reported_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        `);

        const [fleetUsersForHazards] = await connection.query(`
            SELECT id FROM users WHERE email LIKE '%fleet%' OR role LIKE '%fleet%' LIMIT 8
        `);

        const hazardsData = [
            { type: 'pothole', lat: 37.8044, lng: -122.2711, dist: 0.5, severity: 'medium', desc: 'Large pothole on main road' },
            { type: 'lane_closure', lat: 37.8050, lng: -122.2720, dist: 1.2, severity: 'high', desc: 'Lane closure for construction' },
            { type: 'wet_road', lat: 37.8060, lng: -122.2730, dist: 2.0, severity: 'low', desc: 'Wet road conditions due to recent rain' },
            { type: 'construction', lat: 37.8070, lng: -122.2740, dist: 3.5, severity: 'medium', desc: 'Road construction ahead' },
            { type: 'accident', lat: 37.8080, lng: -122.2750, dist: 4.2, severity: 'high', desc: 'Minor accident blocking right lane' },
            { type: 'pothole', lat: 34.0522, lng: -118.2437, dist: 0.8, severity: 'high', desc: 'Deep pothole on I-880' },
            { type: 'lane_closure', lat: 35.3733, lng: -119.0187, dist: 1.5, severity: 'medium', desc: 'Lane closure for maintenance' },
            { type: 'accident', lat: 37.7749, lng: -122.4194, dist: 2.3, severity: 'critical', desc: 'Multi-vehicle accident on highway' },
        ];

        for (let i = 0; i < hazardsData.length && i < fleetUsersForHazards.length; i++) {
            const hazard = hazardsData[i];
            const reporterId = fleetUsersForHazards[i]?.id || driverId;
            await connection.query(`
                INSERT INTO fleet_road_conditions 
                (type, latitude, longitude, distance_from_location, severity, description, reported_by, is_active, reported_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, DATE_SUB(NOW(), INTERVAL ? MINUTE))
            `, [
                hazard.type, hazard.lat, hazard.lng, hazard.dist, hazard.severity, hazard.desc,
                reporterId, (i + 1) * 3 // Stagger times: 3min, 6min, 9min, etc.
            ]);
        }
        LOG.success(`Road conditions seeded: ${hazardsData.length} hazards.`);

        // 6. Seed Fleet Hazards (reported hazards - for alerts)
        LOG.info("Seeding fleet hazards...");
        // Delete ALL old hazards to ensure fresh data
        await connection.query(`DELETE FROM fleet_hazards`);

        const [fleetUsersForHazardReports] = await connection.query(`
            SELECT id FROM users WHERE email LIKE '%fleet%' OR role LIKE '%fleet%' LIMIT 10
        `);

        const hazardReports = [
            { type: 'pothole', lat: 37.8044, lng: -122.2711, desc: 'Reported large pothole', points: 5, minutesAgo: 2 },
            { type: 'lane_closure', lat: 37.8050, lng: -122.2720, desc: 'Reported lane closure', points: 10, minutesAgo: 5 },
            { type: 'wet_road', lat: 37.8060, lng: -122.2730, desc: 'Reported wet road conditions', points: 3, minutesAgo: 8 },
            { type: 'accident', lat: 37.8080, lng: -122.2750, desc: 'Accident reported - 2 vehicles', points: 15, minutesAgo: 12 },
            { type: 'construction', lat: 37.8070, lng: -122.2740, desc: 'Road construction ahead', points: 8, minutesAgo: 15 },
            { type: 'pothole', lat: 34.0522, lng: -118.2437, desc: 'Deep pothole on I-880', points: 5, minutesAgo: 20 },
            { type: 'accident', lat: 37.7749, lng: -122.4194, desc: 'Multi-vehicle accident', points: 15, minutesAgo: 25 },
            { type: 'lane_closure', lat: 35.3733, lng: -119.0187, desc: 'Highway lane closure', points: 10, minutesAgo: 30 },
            { type: 'pothole', lat: 33.7701, lng: -118.1937, desc: 'Multiple potholes on route', points: 5, minutesAgo: 45 },
        ];

        for (let i = 0; i < hazardReports.length && i < fleetUsersForHazardReports.length; i++) {
            const report = hazardReports[i];
            const reporterId = fleetUsersForHazardReports[i]?.id || driverId;
            await connection.query(`
                INSERT INTO fleet_hazards 
                (driver_id, hazard_type, latitude, longitude, description, points_awarded, status, reported_at)
                VALUES (?, ?, ?, ?, ?, ?, 'reported', DATE_SUB(NOW(), INTERVAL ? MINUTE))
            `, [
                reporterId, report.type, report.lat, report.lng, report.desc, report.points, report.minutesAgo
            ]);
        }
        LOG.success(`Fleet hazards seeded: ${hazardReports.length} hazard reports.`);

        // 7. Update gate queue counts and wait times
        LOG.info("Updating gate queue counts...");
        await connection.query(`
            UPDATE fleet_gates 
            SET 
                current_queue_count = (
                    SELECT COUNT(*) 
                    FROM fleet_queues 
                    WHERE fleet_queues.gate_id = fleet_gates.gate_id 
                    AND fleet_queues.status = 'waiting'
                ),
                estimated_wait_time = (
                    SELECT COALESCE(AVG(estimated_wait_time), 10)
                    FROM fleet_queues
                    WHERE fleet_queues.gate_id = fleet_gates.gate_id
                    AND fleet_queues.status = 'waiting'
                )
        `);
        LOG.success("Gate queue counts and wait times updated.");

        LOG.success("\n✅ All Fleet sample data seeded successfully!");
        LOG.info(`\nDriver ID: ${driverId}`);
        LOG.info(`Vendor ID: ${vendorId}`);
        LOG.info(`Date: ${today}\n`);

    } catch (err) {
        LOG.error("Failed to seed fleet data:", err.message);
        console.error(err);
    } finally {
        if (connection) await connection.end();
    }
};

seedFleetData();

