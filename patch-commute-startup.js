const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'server.js');
let s = fs.readFileSync(file, 'utf8');

if (s.includes('Commute schedule tables ready')) {
  console.log('[patch] server.js already has commute startup');
  process.exit(0);
}

const needle = `    } catch (e) {
        LOG.warning('[Server] persistNewsSettings/persistUiChromeSettings failed: ' + (e.message || e));
    }
    if (dbMode === 'inmemory') {`;

const insert = `    } catch (e) {
        LOG.warning('[Server] persistNewsSettings/persistUiChromeSettings failed: ' + (e.message || e));
    }
    if (dbMode === 'mysql') {
        try {
            const commuteService = require('./services/rDetectorCommuteService');
            await commuteService.ensureCommuteTables();
            LOG.info('[R-Detector] Commute schedule tables ready');
        } catch (e) {
            LOG.warning('[R-Detector] Commute tables setup failed: ' + (e.message || e));
        }
    }
    if (dbMode === 'inmemory') {`;

if (!s.includes(needle)) {
  console.error('[patch] needle not found in server.js');
  process.exit(1);
}

fs.writeFileSync(file, s.replace(needle, insert));
console.log('[patch] server.js commute startup added');
