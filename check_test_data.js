/**
 * Quick script to check if test data is loaded
 */
require('dotenv').config();
process.env.DB_TYPE = 'inmemory';

const db = require('./database');

console.log('\n=== Checking Test Data ===\n');

console.log('Cyber Threats:', db.cyberThreats?.length || 0);
console.log('Spam Numbers:', db.spamNumbers?.length || 0);
console.log('Call History:', db.callHistory?.length || 0);
console.log('Community Reports:', db.communityReports?.length || 0);
console.log('Suraksha Validations:', db.surakshaValidations?.length || 0);
console.log('Suraksha Reports:', db.surakshaReports?.length || 0);
console.log('Suraksha Devices:', db.surakshaDevices?.length || 0);
console.log('Threat Alerts:', db.threatAlerts?.length || 0);

console.log('\n=== Sample Data ===\n');

if (db.cyberThreats && db.cyberThreats.length > 0) {
    console.log('Sample Cyber Threat:');
    console.log(JSON.stringify(db.cyberThreats[0], null, 2));
}

if (db.spamNumbers && db.spamNumbers.length > 0) {
    console.log('\nSample Spam Number:');
    console.log(JSON.stringify(db.spamNumbers[0], null, 2));
}

console.log('\n=== Search Test ===\n');
console.log('Search for phone "9876543210":');
const phoneThreat = db.cyberThreats?.find(t => t.value === '9876543210');
if (phoneThreat) {
    console.log('Found:', phoneThreat.title);
} else {
    console.log('Not found');
}

console.log('\nDone!\n');

