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
    
    console.log('\n=== Checking QLess Vendor ===\n');
    
    // Check user
    const [users] = await conn.query('SELECT * FROM users WHERE id = ?', ['usr_qlessvendor1']);
    console.log('User (usr_qlessvendor1):', users.length > 0 ? 'EXISTS' : 'NOT FOUND');
    if (users.length > 0) {
        console.log('  Name:', users[0].name);
        console.log('  Email:', users[0].email);
        console.log('  Role:', users[0].role);
    }
    
    // Check vendor
    const [vendors] = await conn.query('SELECT * FROM vendors WHERE owner_id = ? OR id = ?', ['usr_qlessvendor1', 'v_qless1']);
    console.log('\nVendor Shop:', vendors.length > 0 ? 'EXISTS' : 'NOT FOUND');
    if (vendors.length > 0) {
        vendors.forEach(v => {
            console.log(`  ID: ${v.id}`);
            console.log(`  Owner: ${v.owner_id}`);
            console.log(`  Shop Name: ${v.shop_name}`);
            console.log(`  Category: ${v.category}`);
            console.log(`  Features QLess: ${v.features_qless}`);
        });
    } else {
        console.log('\n⚠️  Vendor shop NOT FOUND! This is why "No Shop Found" is showing.');
    }
    
    await conn.end();
})();

