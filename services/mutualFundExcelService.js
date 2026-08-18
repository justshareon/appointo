/**
 * Mutual Fund Excel Service
 * Reads mutual fund data from local Excel file (Equity & Mutual Fund Investment Tracker.xlsx)
 * Handles multiple sheets and auto-detects column structure
 */
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const os = require('os');
const LOG = require('../utils/logger');

class MutualFundExcelService {
    constructor() {
        // Default to the Excel file in backend directory
        this.excelFilePath = path.join(__dirname, '../Equity & Mutual Fund Investment Tracker.xlsx');
    }

    /**
     * Get Excel file path
     * @returns {string} Path to Excel file
     */
    getExcelFilePath() {
        const configuredPath = process.env.MUTUAL_FUND_EXCEL_FILE_PATH;
        if (configuredPath && fs.existsSync(configuredPath)) {
            return configuredPath;
        }
        return this.excelFilePath;
    }

    /**
     * Copy file to temp location to avoid locking issues
     */
    async copyToTemp(sourcePath) {
        const tempDir = os.tmpdir();
        const tempFileName = `mutual_fund_data_${Date.now()}_${Math.random().toString(36).substring(7)}.xlsx`;
        const tempPath = path.join(tempDir, tempFileName);
        
        try {
            fs.copyFileSync(sourcePath, tempPath);
            LOG.info(`[Mutual Fund Excel] Copied file to temp location: ${tempPath}`);
            return tempPath;
        } catch (error) {
            LOG.error(`[Mutual Fund Excel] Error copying file to temp: ${error.message}`);
            throw error;
        }
    }

    /**
     * Read file using buffer (handles locked files)
     */
    async readFileWithBuffer(filePath) {
        try {
            const fileBuffer = fs.readFileSync(filePath);
            return XLSX.read(fileBuffer, { type: 'buffer', cellDates: false });
        } catch (error) {
            LOG.warning(`[Mutual Fund Excel] Buffer read failed: ${error.message}`);
            return null;
        }
    }

    /**
     * Cleanup temporary file
     */
    cleanupTemp(tempPath) {
        try {
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
                LOG.info(`[Mutual Fund Excel] Cleaned up temp file: ${tempPath}`);
            }
        } catch (error) {
            LOG.warning(`[Mutual Fund Excel] Error cleaning up temp file: ${error.message}`);
        }
    }

    /**
     * Read all sheets from Excel file
     * Returns data organized by sheet name
     */
    async readAllSheets() {
        const filePath = this.getExcelFilePath();
        
        if (!fs.existsSync(filePath)) {
            LOG.warning(`[Mutual Fund Excel] File not found: ${filePath}`);
            return {};
        }

        let workbook;
        let tempPath = null;

        try {
            // Try to read file using multiple strategies
            workbook = await this.readFileWithBuffer(filePath);
            if (!workbook) {
                workbook = XLSX.readFile(filePath, { cellDates: false });
            }
        } catch (error) {
            LOG.warning(`[Mutual Fund Excel] Buffer read failed, trying temp copy: ${error.message}`);
            try {
                tempPath = await this.copyToTemp(filePath);
                workbook = XLSX.readFile(tempPath, { cellDates: false });
            } catch (tempError) {
                LOG.error(`[Mutual Fund Excel] All read strategies failed: ${tempError.message}`);
                return {};
            }
        } finally {
            if (tempPath) {
                this.cleanupTemp(tempPath);
            }
        }

        const result = {};
        LOG.info(`[Mutual Fund Excel] Available sheets: ${workbook.SheetNames.join(', ')}`);

        // Read each sheet
        for (const sheetName of workbook.SheetNames) {
            // Skip info/readme sheets
            const lowerName = sheetName.toLowerCase().trim();
            if (lowerName.includes('info') || 
                lowerName.includes('readme') ||
                lowerName.includes('instruction') ||
                lowerName.includes('help') ||
                lowerName.includes('about')) {
                LOG.info(`[Mutual Fund Excel] Skipping info sheet: "${sheetName}"`);
                continue;
            }

            try {
                const worksheet = workbook.Sheets[sheetName];
                const rows = XLSX.utils.sheet_to_json(worksheet, { 
                    header: 1,
                    defval: '',
                    raw: false
                });

                const nonEmptyRows = rows.filter(row => 
                    row && row.length > 0 && row.some(cell => cell && String(cell).trim() !== '')
                );

                if (nonEmptyRows.length >= 2) {
                    // Transform rows to mutual fund data
                    const fundData = this.transformToMutualFundData(nonEmptyRows, sheetName);
                    result[sheetName] = fundData;
                    LOG.success(`[Mutual Fund Excel] Read ${fundData.length} records from "${sheetName}"`);
                } else {
                    LOG.warning(`[Mutual Fund Excel] Sheet "${sheetName}" has insufficient data (${nonEmptyRows.length} rows)`);
                }
            } catch (error) {
                LOG.error(`[Mutual Fund Excel] Error reading sheet "${sheetName}": ${error.message}`);
            }
        }

        // Log summary
        const totalRecords = Object.values(result).reduce((sum, arr) => sum + arr.length, 0);
        LOG.info(`[Mutual Fund Excel] Summary: ${Object.keys(result).length} sheets, ${totalRecords} total records`);

        return result;
    }

    /**
     * Auto-detect column indices from header row
     */
    detectColumnMapping(headerRow) {
        if (!headerRow || headerRow.length === 0) {
            LOG.warning('[Mutual Fund Excel] No header row found, using default mapping');
            return this.getDefaultMapping();
        }

        const headerLower = headerRow.map(h => String(h || '').toLowerCase().trim());
        const mapping = {};

        // Common header variations for mutual funds
        const nameHeaders = ['fund name', 'name', 'scheme name', 'mutual fund', 'mf name', 'fund'];
        const categoryHeaders = ['category', 'type', 'fund category', 'scheme category', 'category type'];
        const navHeaders = ['nav', 'net asset value', 'current nav', 'price', 'unit price'];
        const returnHeaders = ['returns', 'return', '1y return', '1 year return', 'annual return', 'ytd return'];
        const aumHeaders = ['aum', 'assets under management', 'total aum', 'fund size'];
        const expenseHeaders = ['expense ratio', 'expense', 'ter', 'total expense ratio'];
        const ratingHeaders = ['rating', 'star rating', 'morningstar rating', 'crisil rating'];
        const riskHeaders = ['risk', 'risk level', 'risk rating', 'risk profile'];

        // Find columns
        for (let i = 0; i < headerLower.length; i++) {
            const header = headerLower[i];
            
            if (!mapping.fundName && nameHeaders.some(h => header.includes(h))) {
                mapping.fundName = i;
            }
            if (!mapping.category && categoryHeaders.some(h => header.includes(h))) {
                mapping.category = i;
            }
            if (!mapping.nav && navHeaders.some(h => header.includes(h))) {
                mapping.nav = i;
            }
            if (!mapping.returns && returnHeaders.some(h => header.includes(h))) {
                mapping.returns = i;
            }
            if (!mapping.aum && aumHeaders.some(h => header.includes(h))) {
                mapping.aum = i;
            }
            if (!mapping.expenseRatio && expenseHeaders.some(h => header.includes(h))) {
                mapping.expenseRatio = i;
            }
            if (!mapping.rating && ratingHeaders.some(h => header.includes(h))) {
                mapping.rating = i;
            }
            if (!mapping.risk && riskHeaders.some(h => header.includes(h))) {
                mapping.risk = i;
            }
        }

        // Fallback to default mapping
        const defaultMapping = this.getDefaultMapping();
        const finalMapping = {
            fundName: mapping.fundName !== undefined ? mapping.fundName : defaultMapping.fundName,
            category: mapping.category !== undefined ? mapping.category : defaultMapping.category,
            nav: mapping.nav !== undefined ? mapping.nav : defaultMapping.nav,
            returns: mapping.returns !== undefined ? mapping.returns : defaultMapping.returns,
            aum: mapping.aum !== undefined ? mapping.aum : defaultMapping.aum,
            expenseRatio: mapping.expenseRatio !== undefined ? mapping.expenseRatio : defaultMapping.expenseRatio,
            rating: mapping.rating !== undefined ? mapping.rating : defaultMapping.rating,
            risk: mapping.risk !== undefined ? mapping.risk : defaultMapping.risk,
        };

        LOG.info(`[Mutual Fund Excel] Detected column mapping for headers (${headerRow.length} cols)`);

        return finalMapping;
    }

    /**
     * Get default column mapping
     */
    getDefaultMapping() {
        return {
            fundName: 0,      // Column A
            category: 1,      // Column B
            nav: 2,           // Column C
            returns: 3,       // Column D
            aum: 4,           // Column E
            expenseRatio: 5,  // Column F
            rating: 6,        // Column G
            risk: 7,          // Column H
        };
    }

    /**
     * Transform Excel rows to mutual fund data objects
     */
    transformToMutualFundData(rows, sheetName) {
        if (rows.length === 0) {
            return [];
        }

        // First row is header
        const headerRow = rows[0];
        const dataRows = rows.slice(1);

        // Auto-detect column mapping
        const mapping = this.detectColumnMapping(headerRow);
        const fundData = [];

        for (const row of dataRows) {
            if (!row || row.length === 0) {
                continue;
            }

            try {
                const fundName = String(row[mapping.fundName] || '').trim();
                
                // Skip if no fund name
                if (!fundName || fundName === '' || fundName.toLowerCase() === 'fund name') {
                    continue;
                }

                const fund = {
                    fund_name: fundName,
                    category: String(row[mapping.category] || '').trim() || null,
                    nav: this.parseDecimal(row[mapping.nav]),
                    returns: this.parseDecimal(row[mapping.returns]),
                    aum: this.parseBigInt(row[mapping.aum]),
                    expense_ratio: this.parseDecimal(row[mapping.expenseRatio]),
                    rating: this.parseDecimal(row[mapping.rating]),
                    risk: String(row[mapping.risk] || '').trim() || null,
                    sheet_name: sheetName,
                };

                fundData.push(fund);
            } catch (error) {
                LOG.warning(`[Mutual Fund Excel] Error parsing row: ${row.join(', ')} - ${error.message}`);
                continue;
            }
        }

        LOG.info(`[Mutual Fund Excel] Transformed ${fundData.length} rows to mutual fund data from "${sheetName}"`);
        return fundData;
    }

    /**
     * Parse decimal value from string or number
     */
    parseDecimal(value) {
        if (value === null || value === undefined || value === '') return null;
        if (typeof value === 'number') {
            return isNaN(value) ? null : value;
        }
        
        let cleaned = String(value).replace(/[₹$€£,\s]/g, '').trim();
        
        // Handle percentage values
        if (cleaned.includes('%')) {
            cleaned = cleaned.replace('%', '');
            const parsed = parseFloat(cleaned);
            return isNaN(parsed) ? null : parsed;
        }
        
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? null : parsed;
    }

    /**
     * Parse big integer value from string or number
     */
    parseBigInt(value) {
        if (value === null || value === undefined || value === '') return null;
        if (typeof value === 'number') {
            return isNaN(value) ? null : Math.floor(value);
        }
        
        let cleaned = String(value).replace(/[₹$€£,\s]/g, '').trim().toLowerCase();
        
        // Handle Indian number system
        let multiplier = 1;
        if (cleaned.includes('cr') || cleaned.includes('crore')) {
            multiplier = 10000000;
            cleaned = cleaned.replace(/cr|crore/g, '');
        } else if (cleaned.includes('l') || cleaned.includes('lakh')) {
            multiplier = 100000;
            cleaned = cleaned.replace(/l|lakh/g, '');
        } else if (cleaned.includes('k') || cleaned.includes('thousand')) {
            multiplier = 1000;
            cleaned = cleaned.replace(/k|thousand/g, '');
        }
        
        const parsed = parseFloat(cleaned);
        if (isNaN(parsed)) return null;
        
        return Math.floor(parsed * multiplier);
    }
}

module.exports = new MutualFundExcelService();

