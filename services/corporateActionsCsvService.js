/**
 * Corporate Actions CSV Service
 * Reads and parses corporate actions from CSV file
 */
const fs = require('fs').promises;
const path = require('path');
const LOG = require('../utils/logger');

class CorporateActionsCsvService {
    constructor() {
        // Default CSV file path in backend directory
        this.csvFilePath = path.join(__dirname, '..', 'CF-CA-equities-05-03-2025-to-05-03-2026.csv');
    }

    /**
     * Get CSV file path
     * @returns {string}
     */
    getCsvFilePath() {
        return this.csvFilePath;
    }

    /**
     * Set CSV file path
     * @param {string} filePath
     */
    setCsvFilePath(filePath) {
        this.csvFilePath = filePath;
    }

    /**
     * Parse CSV string to array of rows
     * @param {string} csvData - CSV content as string
     * @returns {Array} Array of rows (2D array)
     */
    parseCSV(csvData) {
        const lines = csvData.split('\n').filter(line => line.trim());
        return lines.map(line => {
            // Handle quoted CSV values
            const result = [];
            let current = '';
            let inQuotes = false;
            
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    result.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            result.push(current.trim());
            
            return result;
        });
    }

    /**
     * Parse date string (DD-MMM-YYYY format)
     * @param {string} dateStr - Date string
     * @returns {Date|null}
     */
    parseDate(dateStr) {
        if (!dateStr || dateStr.trim() === '' || dateStr === '-') {
            return null;
        }

        try {
            // Handle format: "05-Mar-2025"
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) {
                return null;
            }
            return date;
        } catch (error) {
            LOG.warning(`[Corporate Actions CSV] Invalid date format: ${dateStr}`);
            return null;
        }
    }

    /**
     * Transform CSV rows to corporate actions data objects
     * @param {Array} rows - 2D array from CSV
     * @returns {Array} Array of corporate action objects
     */
    transformToCorporateActions(rows) {
        if (rows.length < 2) {
            LOG.warning('[Corporate Actions CSV] Not enough rows in CSV (need at least header + 1 data row)');
            return [];
        }

        const headerRow = rows[0];
        const dataRows = rows.slice(1);

        // Map column indices
        const columnMap = {};
        headerRow.forEach((header, index) => {
            const headerName = String(header || '').trim().toUpperCase();
            columnMap[headerName] = index;
        });

        LOG.info('[Corporate Actions CSV] Column mapping:', columnMap);

        const actions = [];
        let validCount = 0;
        let invalidCount = 0;

        dataRows.forEach((row, rowIndex) => {
            try {
                // Skip empty rows
                if (!row || row.length === 0 || row.every(cell => !cell || String(cell).trim() === '')) {
                    return;
                }

                const symbol = row[columnMap['SYMBOL']] ? String(row[columnMap['SYMBOL']]).trim() : null;
                if (!symbol || symbol === '') {
                    invalidCount++;
                    return;
                }

                const companyName = row[columnMap['COMPANY NAME']] ? String(row[columnMap['COMPANY NAME']]).trim() : null;
                const series = row[columnMap['SERIES']] ? String(row[columnMap['SERIES']]).trim() : null;
                const purpose = row[columnMap['PURPOSE']] ? String(row[columnMap['PURPOSE']]).trim() : null;
                const faceValue = row[columnMap['FACE VALUE']] ? parseFloat(row[columnMap['FACE VALUE']]) : null;
                const exDateStr = row[columnMap['EX-DATE']] ? String(row[columnMap['EX-DATE']]).trim() : null;
                const recordDateStr = row[columnMap['RECORD DATE']] ? String(row[columnMap['RECORD DATE']]).trim() : null;
                const bookClosureStartStr = row[columnMap['BOOK CLOSURE START DATE']] ? String(row[columnMap['BOOK CLOSURE START DATE']]).trim() : null;
                const bookClosureEndStr = row[columnMap['BOOK CLOSURE END DATE']] ? String(row[columnMap['BOOK CLOSURE END DATE']]).trim() : null;

                const action = {
                    symbol: symbol.toUpperCase(),
                    company_name: companyName || null,
                    series: series || null,
                    purpose: purpose || null,
                    face_value: faceValue || null,
                    ex_date: this.parseDate(exDateStr),
                    record_date: this.parseDate(recordDateStr),
                    book_closure_start_date: this.parseDate(bookClosureStartStr),
                    book_closure_end_date: this.parseDate(bookClosureEndStr)
                };

                actions.push(action);
                validCount++;
            } catch (error) {
                LOG.warning(`[Corporate Actions CSV] Error processing row ${rowIndex + 2}: ${error.message}`);
                invalidCount++;
            }
        });

        LOG.info(`[Corporate Actions CSV] Transformed ${validCount} valid actions, ${invalidCount} invalid rows`);
        return actions;
    }

    /**
     * Read CSV file and return parsed data
     * @returns {Promise<Array>} Array of corporate action objects
     */
    async readCsvFile() {
        try {
            const filePath = this.getCsvFilePath();
            LOG.info(`[Corporate Actions CSV] Reading CSV file: ${filePath}`);

            const csvData = await fs.readFile(filePath, 'utf-8');
            LOG.info(`[Corporate Actions CSV] Read ${csvData.length} characters from CSV file`);

            const rows = this.parseCSV(csvData);
            LOG.info(`[Corporate Actions CSV] Parsed ${rows.length} rows from CSV`);

            if (rows.length < 2) {
                throw new Error('CSV file must have at least a header row and one data row');
            }

            const actions = this.transformToCorporateActions(rows);
            LOG.success(`[Corporate Actions CSV] Successfully processed ${actions.length} corporate actions`);

            return actions;
        } catch (error) {
            if (error.code === 'ENOENT') {
                LOG.error(`[Corporate Actions CSV] CSV file not found: ${this.getCsvFilePath()}`);
                throw new Error(`CSV file not found: ${this.getCsvFilePath()}`);
            }
            LOG.error('[Corporate Actions CSV] Error reading CSV file:', error.message);
            throw error;
        }
    }
}

module.exports = new CorporateActionsCsvService();

