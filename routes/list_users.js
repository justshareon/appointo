const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com',
        port: process.env.DB_PORT || 4000,
        user: process.env.DB_USER || '45gthaydhVD1pM3.root',
        password: process.env.DB_PASSWORD || 'XHSYhumyCXkvaj9m',
        database: process.env.DB_NAME || 'qr_queue',
        ssl: { rejectUnauthorized: false }
    });
    
    const [rows] = await conn.query('SELECT id, name, email, mobile, role, location_name FROM users ORDER BY name');
    
    console.log('\n=== ALL USERS IN DATABASE ===\n');
    console.log(`Total Users: ${rows.length}\n`);
    
    rows.forEach((u, i) => {
        console.log(`${(i+1).toString().padStart(2, ' ')}. ${u.name}`);
        console.log(`    Role: ${u.role}`);
        console.log(`    Email: ${u.email || 'N/A'}`);
        console.log(`    Mobile: ${u.mobile || 'N/A'}`);
        console.log(`    Location: ${u.location_name || 'N/A'}`);
        console.log(`    ID: ${u.id}`);
        console.log('');
    });
    
    await conn.end();
})();

