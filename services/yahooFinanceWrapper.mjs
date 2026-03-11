/**
 * ES Module wrapper for yahoo-finance2
 * This file is an ES module that imports yahoo-finance2 and exports an instance
 * for use in CommonJS files via dynamic import
 */
import YahooFinanceClass from 'yahoo-finance2';

// The module exports a CLASS, so we need to instantiate it
// Create and export an instance
const yahooFinance = new YahooFinanceClass();

// Verify the instance has the quote method
if (!yahooFinance || typeof yahooFinance.quote !== 'function') {
    throw new Error('yahoo-finance2 instance is not properly initialized');
}

export default yahooFinance;

