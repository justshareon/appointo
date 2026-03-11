/**
 * Database Module - Main Entry Point (Optimized)
 * 
 * This module provides a backward-compatible interface to the database.
 * It loads the original database.js and re-exports it, allowing for
 * gradual migration to a modular structure.
 * 
 * For now, it simply re-exports from the original database.js file.
 * Feature modules can be added later for lazy loading.
 */

// Load the original database.js (backward compatible)
// This ensures all existing code continues to work
const originalDb = require('../database');

// Re-export everything from original database.js
module.exports = originalDb;

