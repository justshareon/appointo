/**
 * Board Meetings CSV Service
 * Reads and parses board meetings from CSV file
 */
const fs = require('fs').promises;
const path = require('path');
const LOG = require('../utils/logger');

class BoardMeetingsCsvService {
    constructor() {
        // Default CSV file path in backend directory
        this.csvFilePath = path.join(__dirname, '..', 'CF-BM-equities-05-03-2025-to-05-03-2026.csv');
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
            // Handle format: "05-Mar-2026" or "18-Feb-2026 14:58:23"
            const datePart = dateStr.split(' ')[0]; // Get date part if there's time
            const date = new Date(datePart);
            if (isNaN(date.getTime())) {
                return null;
            }
            return date;
        } catch (error) {
            LOG.warning(`[Board Meetings CSV] Invalid date format: ${dateStr}`);
            return null;
        }
    }

    /**
     * Extract time from date/time string
     * @param {string} dateTimeStr - Date/time string
     * @returns {string|null}
     */
    extractTime(dateTimeStr) {
        if (!dateTimeStr || dateTimeStr.trim() === '' || dateTimeStr === '-') {
            return null;
        }

        try {
            // Handle format: "18-Feb-2026 14:58:23"
            const parts = dateTimeStr.split(' ');
            if (parts.length > 1) {
                return parts[1]; // Return time part
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Transform CSV rows to board meetings data objects
     * @param {Array} rows - 2D array from CSV
     * @returns {Array} Array of board meeting objects
     */
    transformToBoardMeetings(rows) {
        if (rows.length < 2) {
            LOG.warning('[Board Meetings CSV] Not enough rows in CSV (need at least header + 1 data row)');
            return [];
        }

        // Find header row (first row that has "SYMBOL" in it)
        // The CSV header might span multiple lines in the file but should be one row after parsing
        let headerRowIndex = -1;
        let headerRow = null;
        
        for (let i = 0; i < Math.min(5, rows.length); i++) {
            const rowStr = rows[i].join(' ').toUpperCase().replace(/\s+/g, ' ');
            if (rowStr.includes('SYMBOL') && (rowStr.includes('COMPANY NAME') || rowStr.includes('COMPANYNAME'))) {
                headerRowIndex = i;
                headerRow = rows[i];
                break;
            }
        }

        if (!headerRow) {
            // Fallback: use first row as header
            headerRow = rows[0];
            headerRowIndex = 0;
            LOG.warning('[Board Meetings CSV] Could not find proper header row, using first row');
        }

        const dataRows = rows.slice(headerRowIndex + 1);

        // Map column indices - handle headers with spaces/newlines
        const columnMap = {};
        headerRow.forEach((header, index) => {
            const headerName = String(header || '').trim().toUpperCase().replace(/\s+/g, ' ');
            // Map common variations
            if (headerName.includes('SYMBOL')) {
                columnMap['SYMBOL'] = index;
            } else if (headerName.includes('COMPANY NAME')) {
                columnMap['COMPANY_NAME'] = index;
            } else if (headerName.includes('PURPOSE')) {
                columnMap['PURPOSE'] = index;
            } else if (headerName.includes('DETAILS')) {
                columnMap['DETAILS'] = index;
            } else if (headerName.includes('MEETING DATE')) {
                columnMap['MEETING_DATE'] = index;
            } else if (headerName.includes('ATTACHMENT')) {
                columnMap['ATTACHMENT'] = index;
            } else if (headerName.includes('BROADCAST DATE') || headerName.includes('BROADCAST DATE/TIME')) {
                columnMap['BROADCAST_DATETIME'] = index;
            } else if (headerName.includes('EXCHANGE DISSEMINATION')) {
                columnMap['EXCHANGE_DISSEMINATION'] = index;
            } else if (headerName.includes('TIME TAKEN')) {
                columnMap['TIME_TAKEN'] = index;
            }
        });

        LOG.info('[Board Meetings CSV] Column mapping:', columnMap);

        const meetings = [];
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
                const headerish = /attachment|broadcast|company name|^details$|^purpose$|^symbol$/i;
                if (headerish.test(symbol.replace(/^[\s,]+/, ''))) {
                    invalidCount++;
                    return;
                }

                const companyName = row[columnMap['COMPANY_NAME']] ? String(row[columnMap['COMPANY_NAME']]).trim() : null;
                const purpose = row[columnMap['PURPOSE']] ? String(row[columnMap['PURPOSE']]).trim() : null;
                const details = row[columnMap['DETAILS']] ? String(row[columnMap['DETAILS']]).trim() : null;
                const meetingDateStr = row[columnMap['MEETING_DATE']] ? String(row[columnMap['MEETING_DATE']]).trim() : null;
                const attachment = row[columnMap['ATTACHMENT']] ? String(row[columnMap['ATTACHMENT']]).trim() : null;
                const broadcastDateTimeStr = row[columnMap['BROADCAST_DATETIME']] ? String(row[columnMap['BROADCAST_DATETIME']]).trim() : null;

                const meetingDate = this.parseDate(meetingDateStr);
                const meetingTime = this.extractTime(meetingDateStr) || this.extractTime(broadcastDateTimeStr);

                const meeting = {
                    symbol: symbol.toUpperCase(),
                    company_name: companyName || null,
                    series: 'EQ', // Default to EQ for equities
                    purpose: purpose || details || null,
                    meeting_date: meetingDate,
                    meeting_time: meetingTime || null,
                    venue: attachment || null // Store attachment URL as venue for now
                };

                meetings.push(meeting);
                validCount++;
            } catch (error) {
                LOG.warning(`[Board Meetings CSV] Error processing row ${rowIndex + headerRowIndex + 2}: ${error.message}`);
                invalidCount++;
            }
        });

        LOG.info(`[Board Meetings CSV] Transformed ${validCount} valid meetings, ${invalidCount} invalid rows`);
        return meetings;
    }

    /**
     * Read CSV file and return parsed data
     * @returns {Promise<Array>} Array of board meeting objects
     */
    async readCsvFile() {
        try {
            const filePath = this.getCsvFilePath();
            LOG.info(`[Board Meetings CSV] Reading CSV file: ${filePath}`);

            const csvData = await fs.readFile(filePath, 'utf-8');
            LOG.info(`[Board Meetings CSV] Read ${csvData.length} characters from CSV file`);

            const rows = this.parseCSV(csvData);
            LOG.info(`[Board Meetings CSV] Parsed ${rows.length} rows from CSV`);

            if (rows.length < 2) {
                throw new Error('CSV file must have at least a header row and one data row');
            }

            const meetings = this.transformToBoardMeetings(rows);
            LOG.success(`[Board Meetings CSV] Successfully processed ${meetings.length} board meetings`);

            return meetings;
        } catch (error) {
            if (error.code === 'ENOENT') {
                LOG.error(`[Board Meetings CSV] CSV file not found: ${this.getCsvFilePath()}`);
                throw new Error(`CSV file not found: ${this.getCsvFilePath()}`);
            }
            LOG.error('[Board Meetings CSV] Error reading CSV file:', error.message);
            throw error;
        }
    }
}

module.exports = new BoardMeetingsCsvService();

