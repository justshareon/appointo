/**
 * Centralized logging utility
 */
const LOG = {
    error: (msg, detail = "") => {
        const errorMsg = `[ERROR] ${new Date().toLocaleTimeString()} | ${msg} | ${detail}`;
        console.error("\x1b[31m%s\x1b[0m", errorMsg);
    },
    info: (msg) => {
        const infoMsg = `[INFO] ${new Date().toLocaleTimeString()} | ${msg}`;
        console.log("\x1b[36m%s\x1b[0m", infoMsg);
    },
    success: (msg) => {
        const successMsg = `[SUCCESS] ${new Date().toLocaleTimeString()} | ${msg}`;
        console.log("\x1b[32m%s\x1b[0m", successMsg);
    },
    warning: (msg) => {
        const warnMsg = `[WARN] ${new Date().toLocaleTimeString()} | ${msg}`;
        console.log("\x1b[33m%s\x1b[0m", warnMsg);
    }
};

module.exports = LOG;

