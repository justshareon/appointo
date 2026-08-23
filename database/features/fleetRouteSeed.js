/**
 * Demo fleet: Mumbai → Pune (NH48 / Expressway).
 * One vendor, three trucks, six checkpoints. Extra US-port gates are turned off.
 */
const VENDOR_ID = 'v_fleet1';

const FLEET_USERS = [
    { id: 'usr_fleetvendor1', name: 'Rajesh Patil', email: 'fleetvendor1@test.com', mobile: '8000000008', role: 'vendor', location_name: 'Mumbai' },
    { id: 'usr_fleetuser1', name: 'Amit Sharma', email: 'fleetuser1@test.com', mobile: '8000000007', role: 'user', location_name: 'Bhiwandi' },
    { id: 'usr_fleetuser2', name: 'Suresh Jadhav', email: 'fleetuser2@test.com', mobile: '8000000017', role: 'user', location_name: 'Panvel' },
    { id: 'usr_fleetuser3', name: 'Priya Kulkarni', email: 'fleetuser3@test.com', mobile: '8000000027', role: 'user', location_name: 'Pune' },
];

const FLEET_VENDOR = {
    id: VENDOR_ID,
    owner_id: 'usr_fleetvendor1',
    shop_name: 'Western Express Logistics',
    category: 'Fleet',
    location_name: 'Mumbai → Pune',
    latitude: 19.076,
    longitude: 72.8777,
};

const CORRIDOR_GATES = [
    { gate_id: 'gate_1', gate_name: 'Bhiwandi Loading Yard', location_name: 'Bhiwandi, Mumbai', latitude: 19.2813, longitude: 73.0483, wait: 12, active: 1, queue: 1 },
    { gate_id: 'gate_2', gate_name: 'Panvel Toll Plaza', location_name: 'Panvel, Navi Mumbai', latitude: 18.9894, longitude: 73.1175, wait: 18, active: 1, queue: 1 },
    { gate_id: 'gate_3', gate_name: 'Khopoli Ghat', location_name: 'Khopoli (closed)', latitude: 18.7857, longitude: 73.3458, wait: 0, active: 0, queue: 0 },
    { gate_id: 'gate_4', gate_name: 'Lonavala Halt', location_name: 'Lonavala', latitude: 18.7481, longitude: 73.4072, wait: 10, active: 1, queue: 1 },
    { gate_id: 'gate_5', gate_name: 'Talegaon Yard', location_name: 'Talegaon, Pune', latitude: 18.735, longitude: 73.675, wait: 8, active: 1, queue: 0 },
    { gate_id: 'gate_6', gate_name: 'Hinjewadi Delivery Hub', location_name: 'Hinjewadi, Pune', latitude: 18.5912, longitude: 73.738, wait: 15, active: 1, queue: 1 },
];

const CORRIDOR_GATE_IDS = CORRIDOR_GATES.map((g) => g.gate_id);

const QUEUES = [
    { driver_id: 'usr_fleetuser1', gate_id: 'gate_2', position: 1, wait: 18 },
    { driver_id: 'usr_fleetuser2', gate_id: 'gate_4', position: 1, wait: 10 },
    { driver_id: 'usr_fleetuser3', gate_id: 'gate_6', position: 1, wait: 15 },
];

const TRIPS = [
    { driver_id: 'usr_fleetuser1', type: 'transport', origin: 'Bhiwandi Loading Yard', dest: 'Hinjewadi Delivery Hub', lat1: 19.2813, lng1: 73.0483, lat2: 18.5912, lng2: 73.738, km: 148 },
    { driver_id: 'usr_fleetuser2', type: 'transport', origin: 'Panvel Toll Plaza', dest: 'Hinjewadi Delivery Hub', lat1: 18.9894, lng1: 73.1175, lat2: 18.5912, lng2: 73.738, km: 110 },
    { driver_id: 'usr_fleetuser3', type: 'delivery', origin: 'Talegaon Yard', dest: 'Hinjewadi Delivery Hub', lat1: 18.735, lng1: 73.675, lat2: 18.5912, lng2: 73.738, km: 28 },
];

const DRIVER_STATS = [
    { driver_id: 'usr_fleetuser1', trips: 2, km: 148, safe: 0, points: 420, score: 98 },
    { driver_id: 'usr_fleetuser2', trips: 2, km: 110, safe: 1, points: 390, score: 94 },
    { driver_id: 'usr_fleetuser3', trips: 1, km: 28, safe: 0, points: 210, score: 100 },
];

const HAZARDS = [
    { driver_id: 'usr_fleetuser2', type: 'lane_closure', lat: 18.7857, lng: 73.3458, desc: 'Khopoli ghat: one lane closed, use Lonavala Halt', points: 10, minutesAgo: 12 },
    { driver_id: 'usr_fleetuser2', type: 'wet_road', lat: 18.7481, lng: 73.4072, desc: 'Light rain on Lonavala stretch — slow downhill', points: 3, minutesAgo: 6 },
];

async function applyMumbaiPuneFleetSeed(pool) {
    if (!pool) return;

    for (const user of FLEET_USERS) {
        await pool.query(
            `INSERT INTO users (id, name, email, mobile, role, location_name, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE
               name = VALUES(name),
               mobile = VALUES(mobile),
               role = VALUES(role),
               location_name = VALUES(location_name)`,
            [user.id, user.name, user.email, user.mobile, user.role, user.location_name]
        );
    }

    await pool.query(
        `UPDATE vendors SET
            shop_name = ?, category = ?, location_name = ?, latitude = ?, longitude = ?,
            features_fleet = 1, is_active = 1
         WHERE id = ?`,
        [FLEET_VENDOR.shop_name, FLEET_VENDOR.category, FLEET_VENDOR.location_name,
            FLEET_VENDOR.latitude, FLEET_VENDOR.longitude, VENDOR_ID]
    );

    try {
        for (const user of FLEET_USERS.filter((u) => u.role === 'user')) {
            await pool.query(
                `INSERT IGNORE INTO user_vendor_mappings (user_id, vendor_id, created_at) VALUES (?, ?, NOW())`,
                [user.id, VENDOR_ID]
            );
        }
    } catch (err) {
        // mapping table may not exist yet
    }

    for (const gate of CORRIDOR_GATES) {
        await pool.query(
            `INSERT INTO fleet_gates (
                gate_id, gate_name, location_name, latitude, longitude, vendor_id,
                is_active, current_queue_count, estimated_wait_time
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                gate_name = VALUES(gate_name),
                location_name = VALUES(location_name),
                latitude = VALUES(latitude),
                longitude = VALUES(longitude),
                vendor_id = VALUES(vendor_id),
                is_active = VALUES(is_active),
                current_queue_count = VALUES(current_queue_count),
                estimated_wait_time = VALUES(estimated_wait_time)`,
            [
                gate.gate_id, gate.gate_name, gate.location_name, gate.latitude, gate.longitude,
                VENDOR_ID, gate.active, gate.queue, gate.wait,
            ]
        );
    }

    await pool.query(
        `UPDATE fleet_gates SET is_active = 0
         WHERE (vendor_id = ? OR vendor_id IS NULL)
           AND gate_id NOT IN (?, ?, ?, ?, ?, ?)`,
        [VENDOR_ID, ...CORRIDOR_GATE_IDS]
    );

    await pool.query(
        `DELETE FROM fleet_queues WHERE vendor_id = ? AND status IN ('waiting', 'processing')`,
        [VENDOR_ID]
    );
    for (const q of QUEUES) {
        const gate = CORRIDOR_GATES.find((g) => g.gate_id === q.gate_id);
        await pool.query(
            `INSERT INTO fleet_queues
                (gate_id, gate_name, driver_id, vendor_id, position, status, estimated_wait_time, joined_at)
             VALUES (?, ?, ?, ?, ?, 'waiting', ?, DATE_SUB(NOW(), INTERVAL 8 MINUTE))`,
            [q.gate_id, gate?.gate_name || q.gate_id, q.driver_id, VENDOR_ID, q.position, q.wait]
        );
    }

    await pool.query(
        `DELETE FROM fleet_trips WHERE vendor_id = ? AND status IN ('in_progress', 'scheduled')`,
        [VENDOR_ID]
    );
    for (const trip of TRIPS) {
        await pool.query(
            `INSERT INTO fleet_trips
                (driver_id, vendor_id, trip_type, origin, destination,
                 start_latitude, start_longitude, end_latitude, end_longitude,
                 status, scheduled_start, actual_start, distance_miles)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_progress', NOW(), NOW(), ?)`,
            [trip.driver_id, VENDOR_ID, trip.type, trip.origin, trip.dest,
                trip.lat1, trip.lng1, trip.lat2, trip.lng2, trip.km]
        );
    }

    const today = new Date().toISOString().split('T')[0];
    for (const stats of DRIVER_STATS) {
        await pool.query(
            `INSERT INTO fleet_driver_stats
                (driver_id, stat_date, trips_count, miles_driven, safe_events, points_earned, safety_score)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                trips_count = VALUES(trips_count),
                miles_driven = VALUES(miles_driven),
                safe_events = VALUES(safe_events),
                points_earned = VALUES(points_earned),
                safety_score = VALUES(safety_score)`,
            [stats.driver_id, today, stats.trips, stats.km, stats.safe, stats.points, stats.score]
        );
    }

    const driverIds = DRIVER_STATS.map((d) => d.driver_id);
    await pool.query(
        `DELETE FROM fleet_hazards WHERE driver_id IN (?, ?, ?)`,
        driverIds
    );
    for (const h of HAZARDS) {
        await pool.query(
            `INSERT INTO fleet_hazards
                (driver_id, hazard_type, latitude, longitude, description, points_awarded, status, reported_at)
             VALUES (?, ?, ?, ?, ?, ?, 'reported', DATE_SUB(NOW(), INTERVAL ? MINUTE))`,
            [h.driver_id, h.type, h.lat, h.lng, h.desc, h.points, h.minutesAgo]
        );
    }

    try {
        await pool.query(
            `DELETE FROM fleet_road_conditions
             WHERE reported_by IN (?, ?, ?) OR (latitude BETWEEN 33 AND 40 AND longitude BETWEEN -123 AND -117)`,
            driverIds
        );
        await pool.query(
            `INSERT INTO fleet_road_conditions
                (type, latitude, longitude, distance_from_location, severity, description, reported_by, is_active, reported_at)
             VALUES
                ('lane_closure', 18.7857, 73.3458, 0.4, 'high', 'Khopoli ghat one-lane closure', 'usr_fleetuser2', TRUE, DATE_SUB(NOW(), INTERVAL 12 MINUTE)),
                ('wet_road', 18.7481, 73.4072, 1.0, 'low', 'Wet tarmac after rain, Lonavala', 'usr_fleetuser2', TRUE, DATE_SUB(NOW(), INTERVAL 6 MINUTE))`
        );
    } catch (err) {
        // table may not exist yet on a fresh install
    }
}

module.exports = {
    VENDOR_ID,
    FLEET_USERS,
    FLEET_VENDOR,
    CORRIDOR_GATES,
    CORRIDOR_GATE_IDS,
    applyMumbaiPuneFleetSeed,
};
