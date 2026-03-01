/**
 * Quick script to verify and fix fleet gates
 */

const db = require('./database');
require('dotenv').config();

async function verifyAndFixGates() {
    try {
        const dbType = db.getType();
        console.log(`\n[VERIFY] Database type: ${dbType}\n`);
        
        if (dbType !== 'mysql') {
            console.log('❌ Fleet gates only work with MySQL. Current mode:', dbType);
            return;
        }

        const pool = db.getPool();
        if (!pool) {
            console.log('❌ MySQL connection pool not available');
            return;
        }

        // Check existing gates
        const [existingGates] = await pool.query(`
            SELECT gate_id, gate_name, vendor_id, is_active 
            FROM fleet_gates 
            ORDER BY gate_name
        `);
        
        console.log(`[VERIFY] Existing gates in database: ${existingGates.length}`);
        if (existingGates.length > 0) {
            console.log('Gates found:');
            existingGates.forEach(gate => {
                console.log(`  - ${gate.gate_name} (${gate.gate_id}) - vendor: ${gate.vendor_id || 'NULL'} - active: ${gate.is_active}`);
            });
        }

        // If no gates, seed them
        if (existingGates.length === 0) {
            console.log('\n[FIX] No gates found. Seeding gates...');
            const vendorId = 'v_fleet1';
            
            await pool.query(`
                INSERT INTO fleet_gates (gate_id, gate_name, location_name, vendor_id, is_active, current_queue_count, estimated_wait_time)
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
            
            console.log('✅ Seeded 8 gates');
        } else {
            // Check if gates are active
            const [activeGates] = await pool.query(`
                SELECT COUNT(*) as count FROM fleet_gates WHERE is_active = TRUE
            `);
            console.log(`\n[VERIFY] Active gates: ${activeGates[0].count}`);
            
            if (activeGates[0].count === 0) {
                console.log('\n[FIX] No active gates found. Activating gates...');
                await pool.query(`UPDATE fleet_gates SET is_active = TRUE WHERE gate_id IN ('gate_1', 'gate_2', 'gate_4', 'gate_5', 'gate_6', 'gate_7', 'gate_8')`);
                console.log('✅ Activated gates');
            }
        }

        // Final check
        const [finalGates] = await pool.query(`
            SELECT gate_id, gate_name, vendor_id, is_active 
            FROM fleet_gates 
            WHERE is_active = TRUE
            ORDER BY gate_name
        `);
        
        console.log(`\n✅ Final result: ${finalGates.length} active gates available`);
        if (finalGates.length > 0) {
            console.log('Active gates:');
            finalGates.forEach(gate => {
                console.log(`  ✓ ${gate.gate_name}`);
            });
        }
        
        console.log('\n✅ Verification complete!\n');
        
    } catch (err) {
        console.error('❌ Error:', err.message);
        console.error(err);
        process.exit(1);
    }
}

verifyAndFixGates()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });

