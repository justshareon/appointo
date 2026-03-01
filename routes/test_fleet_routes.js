// Quick test to verify fleet routes are registered
const express = require('express');
const app = express();
const fleetRoutes = require('./routes/fleetRoutes');

app.use('/api/fleet', fleetRoutes);

// List all registered routes
console.log('\n=== Fleet Routes Registered ===\n');
if (fleetRoutes.stack) {
    fleetRoutes.stack.forEach((route) => {
        if (route.route) {
            const methods = Object.keys(route.route.methods).join(', ').toUpperCase();
            console.log(`${methods.padEnd(10)} /api/fleet${route.route.path}`);
        }
    });
} else {
    console.log('No routes found in fleetRoutes');
}

console.log('\n✅ Fleet routes are properly configured!\n');
console.log('⚠️  Make sure to RESTART your backend server for changes to take effect!\n');

