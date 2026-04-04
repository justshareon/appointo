/**
 * Excel File Service
 * Reads stock data from local Excel file (India_Stock_Market_Tracker_v1.0.xlsx)
 * Handles file locking and permission issues by copying to temp location
 */
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const os = require('os');
const config = require('../config/tradingConfig');
const LOG = require('../utils/logger');

class ExcelFileService {
    constructor() {
        // Default to the Excel file in backend directory
        this.excelFilePath = path.join(__dirname, '../India_Stock_Market_Tracker_v1.0.xlsx');
    }

    /**
     * Get Excel file path
     * @returns {string} Path to Excel file
     */
    getExcelFilePath() {
        // Use configured path or default
        const configuredPath = config.excelFile?.filePath;
        if (configuredPath && fs.existsSync(configuredPath)) {
            return configuredPath;
        }
        return this.excelFilePath;
    }

    /**
     * Copy file to temp location to avoid locking issues
     * @param {string} sourcePath - Source file path
     * @returns {Promise<string>} Temporary file path
     */
    async copyToTemp(sourcePath) {
        const tempDir = os.tmpdir();
        const tempFileName = `stock_data_${Date.now()}_${Math.random().toString(36).substring(7)}.xlsx`;
        const tempPath = path.join(tempDir, tempFileName);
        
        try {
            // Copy file to temp location
            fs.copyFileSync(sourcePath, tempPath);
            LOG.info(`[Excel File] Copied file to temp location: ${tempPath}`);
            return tempPath;
        } catch (error) {
            LOG.error(`[Excel File] Error copying file to temp: ${error.message}`);
            throw error;
        }
    }

    /**
     * Clean up temporary file
     * @param {string} tempPath - Temporary file path
     */
    cleanupTemp(tempPath) {
        try {
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
                LOG.info(`[Excel File] Cleaned up temp file: ${tempPath}`);
            }
        } catch (error) {
            LOG.warning(`[Excel File] Could not delete temp file: ${error.message}`);
        }
    }

    /**
     * Check if file is accessible (not locked)
     * @param {string} filePath - File path to check
     * @returns {Promise<boolean>} True if accessible
     */
    async isFileAccessible(filePath) {
        return new Promise((resolve) => {
            try {
                // Try to open file in read mode
                const fd = fs.openSync(filePath, 'r');
                fs.closeSync(fd);
                resolve(true);
            } catch (error) {
                resolve(false);
            }
        });
    }

    /**
     * Read file using buffer/stream approach (alternative method)
     * @param {string} filePath - File path
     * @returns {Promise<Object>} Workbook object
     */
    async readFileWithBuffer(filePath) {
        return new Promise((resolve, reject) => {
            try {
                // Read file as buffer first
                const fileBuffer = fs.readFileSync(filePath);
                // Parse from buffer instead of file path
                const workbook = XLSX.read(fileBuffer, { 
                    type: 'buffer',
                    cellDates: false,
                    cellNF: false,
                    cellText: false,
                    sheetStubs: false
                });
                resolve(workbook);
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Read data from Excel file
     * Uses multiple strategies to handle file locking and permission issues:
     * 1. Direct read
     * 2. Buffer-based read (avoids file locking)
     * 3. Temp copy read (if file is locked)
     * @param {string} sheetName - Name of the sheet to read (default: first sheet)
     * @returns {Promise<Array>} Array of rows (2D array)
     */
    async readData(sheetName = null) {
        const filePath = this.getExcelFilePath();
        let tempPath = null;
        
        try {
            if (!fs.existsSync(filePath)) {
                LOG.warning(`[Excel File] File not found at: ${filePath}`);
                LOG.warning('[Excel File] Returning empty array - server will continue running');
                return []; // Return empty array instead of throwing
            }

            LOG.info(`[Excel File] Reading data from: ${filePath}`);

            // Check file accessibility first
            const isAccessible = await this.isFileAccessible(filePath);
            if (!isAccessible) {
                LOG.warning('[Excel File] File appears to be locked, will try alternative methods...');
            }

            let workbook;
            let readMethod = 'unknown';

            // Strategy 1: Try buffer-based read first (best for locked files)
            try {
                LOG.info('[Excel File] Attempting buffer-based read (handles locked files)...');
                workbook = await this.readFileWithBuffer(filePath);
                readMethod = 'buffer';
                LOG.success('[Excel File] Successfully read file using buffer method');
            } catch (bufferError) {
                LOG.warning(`[Excel File] Buffer read failed: ${bufferError.message}`);
                
                // Strategy 2: Try direct file read
                try {
                    LOG.info('[Excel File] Attempting direct file read...');
                    workbook = XLSX.readFile(filePath, { 
                        cellDates: false,
                        cellNF: false,
                        cellText: false,
                        sheetStubs: false
                    });
                    readMethod = 'direct';
                    LOG.success('[Excel File] Successfully read file directly');
                } catch (directReadError) {
                    LOG.warning(`[Excel File] Direct read failed: ${directReadError.message}`);
                    
                    // Strategy 3: Copy to temp and read (last resort)
                    LOG.info('[Excel File] Attempting temp copy method...');
                    tempPath = await this.copyToTemp(filePath);
                    
                    // Try buffer read from temp
                    try {
                        workbook = await this.readFileWithBuffer(tempPath);
                        readMethod = 'temp-buffer';
                        LOG.success('[Excel File] Successfully read from temp copy using buffer');
                    } catch (tempBufferError) {
                        // Last attempt: direct read from temp
                        workbook = XLSX.readFile(tempPath, { 
                            cellDates: false,
                            cellNF: false,
                            cellText: false,
                            sheetStubs: false
                        });
                        readMethod = 'temp-direct';
                        LOG.success('[Excel File] Successfully read from temp copy directly');
                    }
                }
            }
            
            // Log all available sheets
            LOG.info(`[Excel File] Available sheets: ${workbook.SheetNames.join(', ')}`);
            
            // Always search for sheet with data (don't use first sheet blindly)
            let targetSheetName = sheetName || config.excelFile?.sheetName;
            let rows = [];
            let nonEmptyRows = [];
            
            // If sheet name is explicitly specified, try it first
            if (targetSheetName && workbook.Sheets[targetSheetName]) {
                LOG.info(`[Excel File] Using specified sheet: "${targetSheetName}"`);
                const worksheet = workbook.Sheets[targetSheetName];
                rows = XLSX.utils.sheet_to_json(worksheet, { 
                    header: 1,
                    defval: '',
                    raw: false
                });
                nonEmptyRows = rows.filter(row => 
                    row && row.length > 0 && row.some(cell => cell && String(cell).trim() !== '')
                );
                
                // If specified sheet has data, use it
                if (nonEmptyRows.length >= 2) {
                    LOG.success(`[Excel File] Specified sheet "${targetSheetName}" has ${nonEmptyRows.length} rows`);
                } else {
                    LOG.warning(`[Excel File] Specified sheet "${targetSheetName}" has only ${nonEmptyRows.length} rows, searching for other sheets...`);
                    targetSheetName = null; // Will search for sheet with data
                    rows = [];
                    nonEmptyRows = [];
                }
            } else if (targetSheetName) {
                LOG.warning(`[Excel File] Specified sheet "${targetSheetName}" not found. Available: ${workbook.SheetNames.join(', ')}`);
                targetSheetName = null;
            }
            
            // If no sheet specified or specified sheet is empty, search for sheet with data
            if (!targetSheetName || nonEmptyRows.length < 2) {
                LOG.info('[Excel File] Searching for sheet with data...');
                
                // Try common sheet names first
                const commonNames = ['Sheet1', 'Data', 'Stocks', 'Stock Data', 'Market Data', 'Trading Data', 'Main', 'Sheet'];
                for (const name of commonNames) {
                    if (workbook.SheetNames.includes(name)) {
                        const worksheet = workbook.Sheets[name];
                        const testRows = XLSX.utils.sheet_to_json(worksheet, { 
                            header: 1,
                            defval: '',
                            raw: false
                        });
                        const testNonEmpty = testRows.filter(row => 
                            row && row.length > 0 && row.some(cell => cell && String(cell).trim() !== '')
                        );
                        
                        if (testNonEmpty.length >= 2) {
                            targetSheetName = name;
                            rows = testRows;
                            nonEmptyRows = testNonEmpty;
                            LOG.success(`[Excel File] Found common sheet with data: "${targetSheetName}" (${testNonEmpty.length} rows)`);
                            break;
                        }
                    }
                }
                
                // If still not found, try all sheets (skip info/readme sheets)
                if (!targetSheetName || nonEmptyRows.length < 2) {
                    LOG.info('[Excel File] Trying all sheets to find one with data...');
                    for (const testSheetName of workbook.SheetNames) {
                        const lowerName = testSheetName.toLowerCase();
                        
                        // Skip info/readme/instruction sheets
                        if (lowerName.includes('info') || 
                            lowerName.includes('readme') ||
                            lowerName.includes('instruction') ||
                            lowerName.includes('help') ||
                            lowerName.includes('about')) {
                            LOG.info(`[Excel File] Skipping info sheet: "${testSheetName}"`);
                            continue;
                        }
                        
                        const worksheet = workbook.Sheets[testSheetName];
                        const testRows = XLSX.utils.sheet_to_json(worksheet, { 
                            header: 1,
                            defval: '',
                            raw: false
                        });
                        
                        const testNonEmpty = testRows.filter(row => 
                            row && row.length > 0 && row.some(cell => cell && String(cell).trim() !== '')
                        );
                        
                        LOG.info(`[Excel File] Sheet "${testSheetName}": ${testRows.length} total rows, ${testNonEmpty.length} non-empty rows`);
                        
                        // If sheet has more than just headers (at least 2 rows), use it
                        if (testNonEmpty.length >= 2) {
                            targetSheetName = testSheetName;
                            rows = testRows;
                            nonEmptyRows = testNonEmpty;
                            LOG.success(`[Excel File] ✓ Found sheet with data: "${targetSheetName}" (${testNonEmpty.length} rows)`);
                            break;
                        }
                    }
                }
            }
            
            // If we still don't have rows, read from the selected sheet
            if (rows.length === 0 && targetSheetName) {
                if (!workbook.Sheets[targetSheetName]) {
                    LOG.error(`[Excel File] Sheet "${targetSheetName}" not found. Available sheets: ${workbook.SheetNames.join(', ')}`);
                    return [];
                }
                
                // Convert sheet to JSON (array of arrays)
                const worksheet = workbook.Sheets[targetSheetName];
                rows = XLSX.utils.sheet_to_json(worksheet, { 
                    header: 1, // Use array format (not objects)
                    defval: '', // Default value for empty cells
                    raw: false // Convert numbers to strings for consistency
                });

                // Filter out completely empty rows
                nonEmptyRows = rows.filter(row => 
                    row && row.length > 0 && row.some(cell => cell && String(cell).trim() !== '')
                );
            }
            
            if (!targetSheetName) {
                LOG.error(`[Excel File] Could not find any sheet with data. Available sheets: ${workbook.SheetNames.join(', ')}`);
                return [];
            }

            LOG.success(`[Excel File] Read ${nonEmptyRows.length} rows from sheet "${targetSheetName}"`);
            
            if (nonEmptyRows.length === 0) {
                LOG.warning(`[Excel File] Sheet "${targetSheetName}" is empty or has no data`);
                LOG.warning(`[Excel File] Available sheets: ${workbook.SheetNames.join(', ')}`);
                LOG.warning(`[Excel File] Try setting EXCEL_SHEET_NAME environment variable to specify the correct sheet`);
            }
            
            return nonEmptyRows;
        } catch (error) {
            LOG.error('[Excel File] Error reading Excel file:', error.message);
            LOG.error(`[Excel File] Error details: ${error.stack ? error.stack.split('\n').slice(0, 3).join('\n') : 'No stack'}`);
            
            // If it's a permission/locking error, suggest solutions
            if (error.message.includes('EBUSY') || error.message.includes('locked') || error.message.includes('permission')) {
                LOG.warning('[Excel File] File appears to be locked or has permission issues');
                LOG.warning('[Excel File] Solutions:');
                LOG.warning('[Excel File]   1. Close Excel if the file is open');
                LOG.warning('[Excel File]   2. Check file permissions');
                LOG.warning('[Excel File]   3. Ensure file is not read-only');
            }
            
            // Return empty array instead of throwing to allow server to continue
            return [];
        } finally {
            // Clean up temp file if it was created
            if (tempPath) {
                this.cleanupTemp(tempPath);
            }
        }
    }

    /**
     * Read all sheets by type (GAINERS, DECLINERS, ACTIVES, DATA)
     * @returns {Promise<Object>} Object with keys: gainers, decliners, actives, data
     */
    async readAllSheetsByType() {
        const filePath = this.getExcelFilePath();
        
        if (!fs.existsSync(filePath)) {
            LOG.warning(`[Excel File] File not found: ${filePath}`);
            return {
                gainers: [],
                decliners: [],
                actives: [],
                data: []
            };
        }

        let workbook;
        let tempPath = null;

        try {
            // Try to read file using multiple strategies
            workbook = await this.readFileWithBuffer(filePath);
            if (!workbook) {
                // Try direct read
                workbook = XLSX.readFile(filePath, { cellDates: false });
            }
        } catch (error) {
            LOG.warning(`[Excel File] Buffer read failed, trying temp copy: ${error.message}`);
            try {
                tempPath = await this.copyToTemp(filePath);
                workbook = XLSX.readFile(tempPath, { cellDates: false });
            } catch (tempError) {
                LOG.error(`[Excel File] All read strategies failed: ${tempError.message}`);
                return {
                    gainers: [],
                    decliners: [],
                    actives: [],
                    data: []
                };
            }
        } finally {
            if (tempPath) {
                this.cleanupTemp(tempPath);
            }
        }

        const result = {
            gainers: [],
            decliners: [],
            actives: [],
            data: []
        };

        // Map sheet names to data types
        // Case-insensitive matching with various name patterns
        const sheetTypeMap = {
            'gainers': 'gainers',
            'gainer': 'gainers',
            'top gainers': 'gainers',
            'top gainer': 'gainers',
            'gain': 'gainers',
            'decliners': 'decliners',
            'decliner': 'decliners',
            'losers': 'decliners',
            'loser': 'decliners',
            'top losers': 'decliners',
            'top loser': 'decliners',
            'decline': 'decliners',
            'actives': 'actives',
            'active': 'actives',
            'most active': 'actives',
            'most actives': 'actives',
            'active stocks': 'actives',
            'data': 'data',
            'all data': 'data',
            'stocks': 'data',
            'stock data': 'data',
            'all stocks': 'data',
            'stock': 'data'
        };

        LOG.info(`[Excel File] Available sheets: ${workbook.SheetNames.join(', ')}`);

        // Read each sheet and categorize by type
        for (const sheetName of workbook.SheetNames) {
            const lowerName = sheetName.toLowerCase().trim();
            
            // Skip info/readme sheets
            if (lowerName.includes('info') || 
                lowerName.includes('readme') ||
                lowerName.includes('instruction') ||
                lowerName.includes('help') ||
                lowerName.includes('about')) {
                LOG.info(`[Excel File] Skipping info sheet: "${sheetName}"`);
                continue;
            }

            // Determine sheet type
            let sheetType = null;
            for (const [key, type] of Object.entries(sheetTypeMap)) {
                if (lowerName.includes(key)) {
                    sheetType = type;
                    break;
                }
            }

            // If no match, try exact match
            if (!sheetType && sheetTypeMap[lowerName]) {
                sheetType = sheetTypeMap[lowerName];
            }

            // If still no match, default to 'data'
            if (!sheetType) {
                sheetType = 'data';
                LOG.info(`[Excel File] Sheet "${sheetName}" not matched to type, defaulting to 'data'`);
            }

            // Read sheet data
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
                    // Log raw Excel data before transformation
                    LOG.info(`[Excel File] ========================================`);
                    LOG.info(`[Excel File] Sheet: "${sheetName}" (type: ${sheetType})`);
                    LOG.info(`[Excel File] Raw rows count: ${nonEmptyRows.length}`);
                    LOG.info(`[Excel File] Header row:`, nonEmptyRows[0]);
                    LOG.info(`[Excel File] First 3 data rows (raw):`);
                    nonEmptyRows.slice(1, 4).forEach((row, idx) => {
                        LOG.info(`[Excel File]   Row ${idx + 1}:`, row);
                    });
                    
                    // Transform rows to stock data
                    const stockData = this.transformToStockData(nonEmptyRows, sheetType);
                    
                    // Log transformed data
                    LOG.info(`[Excel File] Transformed records: ${stockData.length}`);
                    if (stockData.length > 0) {
                        LOG.info(`[Excel File] First 3 transformed records:`);
                        stockData.slice(0, 3).forEach((stock, idx) => {
                            LOG.info(`[Excel File]   Stock ${idx + 1}:`, {
                                symbol: stock.symbol,
                                company_name: stock.company_name,
                                last_price: stock.last_price,
                                per_change: stock.per_change,
                                data_type: stock.data_type
                            });
                        });
                    }
                    LOG.info(`[Excel File] ========================================`);
                    
                    result[sheetType] = result[sheetType].concat(stockData);
                    LOG.success(`[Excel File] Read ${stockData.length} records from "${sheetName}" (type: ${sheetType})`);
                } else {
                    LOG.warning(`[Excel File] Sheet "${sheetName}" has insufficient data (${nonEmptyRows.length} rows)`);
                }
            } catch (error) {
                LOG.error(`[Excel File] Error reading sheet "${sheetName}": ${error.message}`);
            }
        }

        // Log summary
        LOG.info(`[Excel File] Summary: Gainers: ${result.gainers.length}, Decliners: ${result.decliners.length}, Actives: ${result.actives.length}, Data: ${result.data.length}`);

        return result;
    }

    /**
     * Auto-detect column indices from header row using fuzzy matching
     * @param {Array} headerRow - First row (header) from Excel
     * @returns {Object} Column mapping object
     */
    detectColumnMapping(headerRow) {
        if (!headerRow || headerRow.length === 0) {
            LOG.warning('[Excel File] No header row found, using default mapping');
            return config.columnMapping;
        }

        const headerLower = headerRow.map(h => String(h || '').toLowerCase().trim());
        const mapping = {};

        // Helper function to find column by contains/like matching
        const findColumn = (patterns, excludePatterns = []) => {
            for (let i = 0; i < headerLower.length; i++) {
                const cell = headerLower[i];
                // Skip if matches exclude patterns
                if (excludePatterns.some(exclude => cell.includes(exclude))) {
                    continue;
                }
                // Check if cell contains any of the patterns
                for (const pattern of patterns) {
                    if (cell.includes(pattern) || pattern.includes(cell)) {
                        return i;
                    }
                }
            }
            return null;
        };

        // Define search patterns for each field (using contains/like matching)
        const symbolPatterns = ['ticker', 'symbol', 'stock symbol', 'code', 'scrip'];
        const namePatterns = ['name', 'company name', 'company', 'stock name'];
        const pricePatterns = ['price', 'ltp', 'last price', 'last traded price', 'current price', 'close'];
        const changePatterns = ['pchange'];
        const percentChangePatterns = ['pchange %', 'pchange%', '% pchange', 'percent pchange', 'pchange percent', 'pct pchange'];
        const volumePatterns = ['volume', 'traded volume', 'qty', 'quantity'];
        const marketCapPatterns = ['market cap', 'market capitalization', 'mcap', 'marketcap'];
        const peRatioPatterns = ['pe ratio', 'pe', 'p/e', 'price to earnings', 'price earnings', 'p/e ratio'];
        const weekLowPatterns = ['52 week low', '52w low', 'week low', '52 week l', '52w l', 'low'];
        const weekHighPatterns = ['52 week high', '52w high', 'week high', '52 week h', '52w h', 'high'];
        const weekRangePatterns = ['52 week range', '52w range', 'week range', '52 week rang', '52w rang', 'range'];

        // Find symbol column - Skip "No." column (row numbers)
        // Must check percent pchange BEFORE pchange to avoid confusion
        mapping.percentChange = findColumn(percentChangePatterns);
        if (mapping.percentChange !== null) {
            LOG.info(`[Excel File] Found percent pchange column at index ${mapping.percentChange}: "${headerRow[mapping.percentChange]}"`);
        }

        // Find pchange column (not percent) - exclude percent patterns
        mapping.pchange = findColumn(changePatterns, ['%', 'percent', 'pct']);
        if (mapping.pchange !== null) {
            LOG.info(`[Excel File] Found pchange column at index ${mapping.pchange}: "${headerRow[mapping.pchange]}"`);
        }

        // Find symbol column - Skip "No." column (row numbers)
        mapping.symbol = findColumn(symbolPatterns, ['no.', 'no', 'number', '#', 'row']);
        if (mapping.symbol !== null) {
            LOG.info(`[Excel File] Found symbol column at index ${mapping.symbol}: "${headerRow[mapping.symbol]}"`);
        }

        // Find company name column
        mapping.companyName = findColumn(namePatterns);
        if (mapping.companyName !== null) {
            LOG.info(`[Excel File] Found company name column at index ${mapping.companyName}: "${headerRow[mapping.companyName]}"`);
        }

        // Find price column
        mapping.lastPrice = findColumn(pricePatterns);
        if (mapping.lastPrice !== null) {
            LOG.info(`[Excel File] Found price column at index ${mapping.lastPrice}: "${headerRow[mapping.lastPrice]}"`);
        }

        // Find volume column
        mapping.volume = findColumn(volumePatterns);
        if (mapping.volume !== null) {
            LOG.info(`[Excel File] Found volume column at index ${mapping.volume}: "${headerRow[mapping.volume]}"`);
        }

        // Find market cap column
        mapping.marketCap = findColumn(marketCapPatterns);
        if (mapping.marketCap !== null) {
            LOG.info(`[Excel File] Found market cap column at index ${mapping.marketCap}: "${headerRow[mapping.marketCap]}"`);
        }

        // Find PE Ratio column
        mapping.peRatio = findColumn(peRatioPatterns);
        if (mapping.peRatio !== null) {
            LOG.info(`[Excel File] Found PE Ratio column at index ${mapping.peRatio}: "${headerRow[mapping.peRatio]}"`);
        }

        // Find 52 Week Low column
        mapping.week52Low = findColumn(weekLowPatterns);
        if (mapping.week52Low !== null) {
            LOG.info(`[Excel File] Found 52 Week Low column at index ${mapping.week52Low}: "${headerRow[mapping.week52Low]}"`);
        }

        // Find 52 Week High column
        mapping.week52High = findColumn(weekHighPatterns);
        if (mapping.week52High !== null) {
            LOG.info(`[Excel File] Found 52 Week High column at index ${mapping.week52High}: "${headerRow[mapping.week52High]}"`);
        }

        // Find 52 Week Range column (may contain both low and high)
        mapping.week52Range = findColumn(weekRangePatterns);
        if (mapping.week52Range !== null) {
            LOG.info(`[Excel File] Found 52 Week Range column at index ${mapping.week52Range}: "${headerRow[mapping.week52Range]}"`);
        }

        // Build final mapping with fallbacks
        const finalMapping = {
            symbol: mapping.symbol !== null && mapping.symbol !== undefined ? mapping.symbol : config.columnMapping.symbol,
            companyName: mapping.companyName !== null && mapping.companyName !== undefined ? mapping.companyName : config.columnMapping.companyName,
            lastPrice: mapping.lastPrice !== null && mapping.lastPrice !== undefined ? mapping.lastPrice : config.columnMapping.lastPrice,
            pchange: mapping.pchange !== null && mapping.pchange !== undefined ? mapping.pchange : config.columnMapping.pchange,
            percentChange: mapping.percentChange !== null && mapping.percentChange !== undefined ? mapping.percentChange : config.columnMapping.percentChange,
            volume: mapping.volume !== null && mapping.volume !== undefined ? mapping.volume : config.columnMapping.volume,
            marketCap: mapping.marketCap !== null && mapping.marketCap !== undefined ? mapping.marketCap : config.columnMapping.marketCap,
            peRatio: mapping.peRatio !== null && mapping.peRatio !== undefined ? mapping.peRatio : null,
            week52Low: mapping.week52Low !== null && mapping.week52Low !== undefined ? mapping.week52Low : null,
            week52High: mapping.week52High !== null && mapping.week52High !== undefined ? mapping.week52High : null,
            week52Range: mapping.week52Range !== null && mapping.week52Range !== undefined ? mapping.week52Range : null,
        };
        
        // Ensure symbol is never column 0 (No. column)
        if (finalMapping.symbol === 0) {
            LOG.warning('[Excel File] Symbol column detected as 0 (No. column), adjusting to 1');
            finalMapping.symbol = 1;
        }

        // Log detected mapping with header names
        LOG.info(`[Excel File] ========================================`);
        LOG.info(`[Excel File] Column Mapping Detection Results:`);
        LOG.info(`[Excel File] Header Row:`, headerRow);
        LOG.info(`[Excel File] Detected Mapping:`);
        LOG.info(`[Excel File]   Symbol (Ticker): Column ${finalMapping.symbol} = "${headerRow[finalMapping.symbol] || 'NOT FOUND'}"`);
        LOG.info(`[Excel File]   Company Name: Column ${finalMapping.companyName} = "${headerRow[finalMapping.companyName] || 'NOT FOUND'}"`);
        LOG.info(`[Excel File]   Price: Column ${finalMapping.lastPrice} = "${headerRow[finalMapping.lastPrice] || 'NOT FOUND'}"`);
        LOG.info(`[Excel File]   Change: Column ${finalMapping.pchange} = "${headerRow[finalMapping.pchange] || 'NOT FOUND'}"`);
        LOG.info(`[Excel File]   Change %: Column ${finalMapping.percentChange} = "${headerRow[finalMapping.percentChange] || 'NOT FOUND'}"`);
        LOG.info(`[Excel File]   Volume: Column ${finalMapping.volume} = "${headerRow[finalMapping.volume] || 'NOT FOUND'}"`);
        LOG.info(`[Excel File]   Market Cap: Column ${finalMapping.marketCap} = "${headerRow[finalMapping.marketCap] || 'NOT FOUND'}"`);
        if (finalMapping.peRatio !== null) {
            LOG.info(`[Excel File]   PE Ratio: Column ${finalMapping.peRatio} = "${headerRow[finalMapping.peRatio] || 'NOT FOUND'}"`);
        }
        if (finalMapping.week52Low !== null) {
            LOG.info(`[Excel File]   52 Week Low: Column ${finalMapping.week52Low} = "${headerRow[finalMapping.week52Low] || 'NOT FOUND'}"`);
        }
        if (finalMapping.week52High !== null) {
            LOG.info(`[Excel File]   52 Week High: Column ${finalMapping.week52High} = "${headerRow[finalMapping.week52High] || 'NOT FOUND'}"`);
        }
        if (finalMapping.week52Range !== null) {
            LOG.info(`[Excel File]   52 Week Range: Column ${finalMapping.week52Range} = "${headerRow[finalMapping.week52Range] || 'NOT FOUND'}"`);
        }
        LOG.info(`[Excel File] ========================================`);

        return finalMapping;
    }

    /**
     * Transform Excel rows to stock data objects
     * Assumes first row is header, subsequent rows are data
     * @param {Array} rows - 2D array from Excel
     * @param {string} dataType - Type of data (gainers, decliners, actives, data)
     * @returns {Array} Array of stock data objects
     */
    transformToStockData(rows, dataType = 'data') {
        if (rows.length === 0) {
            return [];
        }

        // Find header row (first row that looks like headers)
        let headerRowIndex = 0;
        let headerRow = rows[0];
        
        // Check if first row looks like data (has numbers) - if so, search for header
        const firstRowStr = rows[0]?.map(c => String(c || '').toLowerCase()).join(' ') || '';
        const hasHeaderKeywords = firstRowStr.includes('symbol') || 
                                  firstRowStr.includes('ticker') || 
                                  firstRowStr.includes('company') ||
                                  firstRowStr.includes('price') ||
                                  firstRowStr.includes('pchange');
        
        // If first row doesn't look like header, try to find it
        if (!hasHeaderKeywords && rows.length > 1) {
            for (let i = 0; i < Math.min(5, rows.length); i++) {
                const rowStr = rows[i]?.map(c => String(c || '').toLowerCase()).join(' ') || '';
                if (rowStr.includes('symbol') || rowStr.includes('ticker') || rowStr.includes('company')) {
                    headerRowIndex = i;
                    headerRow = rows[i];
                    LOG.info(`[Excel File] Found header row at index ${i}`);
                    break;
                }
            }
        }

        // Data rows start after header
        const dataRows = rows.slice(headerRowIndex + 1);

        // Auto-detect column mapping from header
        const mapping = this.detectColumnMapping(headerRow);
        
        LOG.info(`[Excel File] Using column mapping:`, mapping);
        LOG.info(`[Excel File] Header row:`, headerRow);

        const stockData = [];

        // Log first few data rows for debugging
        if (dataRows.length > 0) {
            LOG.info(`[Excel File] Sample data rows (first 3):`);
            dataRows.slice(0, 3).forEach((row, idx) => {
                LOG.info(`[Excel File] Row ${idx + 1}:`, row);
            });
        }

        for (const row of dataRows) {
            // Skip empty rows
            if (!row || row.length === 0) {
                continue;
            }

            try {
                // Use detected mapping for symbol, but ensure it's not column 0
                const symbolColumn = mapping.symbol !== null && mapping.symbol !== undefined ? mapping.symbol : 1;
                let symbol = String(row[symbolColumn] || '').trim();
                
                // Remove exchange prefixes like "NSE:", "BSE:", "NSE-", "BSE-", "NSE ", "BSE "
                symbol = symbol.replace(/^(NSE|BSE)[:\-\s]+\s*/i, '').trim();
                
                // Convert to uppercase after removing prefix
                symbol = symbol.toUpperCase();
                
                // Log for debugging first few rows
                if (stockData.length < 3) {
                    LOG.info(`[Excel File] Row data - Column 0: "${row[0]}", Column 1 (Ticker): "${row[symbolColumn]}" -> "${symbol}", Column 2: "${row[2]}"`);
                }
                
                // Skip if symbol is empty, or looks like a header/row number
                if (!symbol || 
                    symbol === '' || 
                    symbol === 'SYMBOL' || 
                    symbol === 'TICKER' ||
                    symbol === 'NO.' ||
                    symbol === 'NO' ||
                    /^\d+$/.test(symbol) || // Skip if symbol is just an integer
                    /^\d+\.\d+$/.test(symbol) || // Skip if symbol is a decimal number like "24765.9"
                    /^\d+\.\d*$/.test(symbol) || // Skip if symbol starts with number and has decimal point
                    symbol.toLowerCase().includes('row') ||
                    symbol.toLowerCase().includes('header')) {
                    if (symbol) {
                        LOG.warning(`[Excel File] Skipping row with invalid symbol: "${symbol}" (from column ${symbolColumn})`);
                    }
                    continue;
                }
                
                // Validate symbol looks like a stock symbol (must contain letters, not just numbers)
                if (!/[A-Z]/.test(symbol) || symbol.length < 2) {
                    LOG.warning(`[Excel File] Skipping invalid symbol (no letters): "${symbol}"`);
                    continue;
                }
                
                const companyName = String(row[mapping.companyName] || '').trim();
                const lastPrice = this.parseDecimal(row[mapping.lastPrice]);
                const pchange = this.parseDecimal(row[mapping.pchange]);
                let percentChange = this.parsePercentChange(row[mapping.percentChange], lastPrice, pchange);
                const volume = this.parseBigInt(row[mapping.volume]);
                const marketCap = this.parseBigInt(row[mapping.marketCap]);
                const peRatio = this.parseDecimal(row[mapping.peRatio]);
                
                // Parse 52 week low/high - check individual columns first, then range column
                let week52Low = this.parseDecimal(row[mapping.week52Low]);
                let week52High = this.parseDecimal(row[mapping.week52High]);
                
                // If we have a range column, parse it (format: "100-200" or "100 to 200" or "100 - 200")
                if (mapping.week52Range !== null && row[mapping.week52Range]) {
                    const rangeValue = String(row[mapping.week52Range] || '').trim();
                    if (rangeValue) {
                        // Try to parse range formats: "100-200", "100 to 200", "100 - 200", "100/200"
                        const rangeMatch = rangeValue.match(/(\d+\.?\d*)\s*[-/to]+\s*(\d+\.?\d*)/i);
                        if (rangeMatch) {
                            const low = parseFloat(rangeMatch[1]);
                            const high = parseFloat(rangeMatch[2]);
                            if (!isNaN(low) && !isNaN(high)) {
                                // Only use range values if individual columns are not set
                                if (week52Low === null) week52Low = low;
                                if (week52High === null) week52High = high;
                            }
                        }
                    }
                }

                // Validate data - skip rows with invalid data
                // Must have at least symbol and one of: price, per_change, or volume
                if (!lastPrice && !percentChange && !volume) {
                    LOG.warning(`[Excel File] Skipping row with no valid data for symbol: ${symbol}`);
                    continue;
                }
                
                // Skip if per_change is unrealistic (>10000% or <-100%)
                if (percentChange !== null && (percentChange > 10000 || percentChange < -100)) {
                    LOG.warning(`[Excel File] Skipping row with unrealistic per_change (${percentChange}%) for symbol: ${symbol}`);
                    continue;
                }

                // Store ALL columns from Excel with their header names
                const allColumns = {};
                headerRow.forEach((header, index) => {
                    const headerName = String(header || '').trim();
                    if (headerName) {
                        // Store the raw value from the row
                        allColumns[headerName] = row[index] !== undefined && row[index] !== null 
                            ? String(row[index]).trim() 
                            : null;
                    } else {
                        // If header is empty, use column index
                        allColumns[`Column_${index}`] = row[index] !== undefined && row[index] !== null 
                            ? String(row[index]).trim() 
                            : null;
                    }
                });

                const stock = {
                    symbol: symbol,
                    company_name: companyName || symbol, // Fallback to symbol if no company name
                    last_price: lastPrice || 0,
                    pchange: pchange || 0,
                    per_change: percentChange || 0,
                    data_type: dataType,
                    volume: volume || 0,
                    market_cap: marketCap || 0,
                    pe_ratio: peRatio || null,
                    week_52_low: week52Low || null,
                    week_52_high: week52High || null,
                    additional_data: allColumns, // Store ALL columns as JSON
                };
                
                // Log transformation details for first few records
                if (stockData.length < 3) {
                    LOG.info(`[Excel File] Transforming row to stock:`, {
                        rawRow: row,
                        rowLength: row.length,
                        mapping: {
                            symbol: mapping.symbol,
                            companyName: mapping.companyName,
                            lastPrice: mapping.lastPrice,
                            percentChange: mapping.percentChange,
                            volume: mapping.volume
                        },
                        extracted: {
                            symbol: symbol,
                            companyName: companyName,
                            lastPrice: lastPrice,
                            percentChange: percentChange,
                            volume: volume
                        },
                        finalStock: stock
                    });
                }

                // Log sample stock for debugging
                if (stockData.length < 2) {
                    LOG.info(`[Excel File] Sample stock ${stockData.length + 1}:`, {
                        symbol: stock.symbol,
                        company_name: stock.company_name,
                        last_price: stock.last_price,
                        pchange: stock.pchange,
                        per_change: stock.per_change,
                        volume: stock.volume
                    });
                }

                // Log if company name is missing for debugging
                if (!companyName) {
                    LOG.warning(`[Excel File] Missing company name for symbol: ${symbol}`);
                }
                
                stockData.push(stock);
            } catch (error) {
                LOG.warning(`[Excel File] Error parsing row: ${row.join(', ')} - ${error.message}`);
                LOG.warning(`[Excel File] Row data:`, row);
                continue;
            }
        }

        LOG.info(`[Excel File] Transformed ${stockData.length} rows to stock data`);
        return stockData;
    }

    /**
     * Parse percentage pchange value from string or number
     * Handles various formats: "31.35%", "31.35", "-5.2%", etc.
     * If value is missing or invalid, calculates from pchange and lastPrice
     */
    parsePercentChange(value, lastPrice, pchange) {
        // First try to parse the value directly
        if (value !== null && value !== undefined && value !== '') {
            let cleaned = String(value).replace(/[₹$€£,\s]/g, '').trim();
            const hasPercent = cleaned.includes('%');
            
            if (hasPercent) {
                cleaned = cleaned.replace('%', '');
            }
            
            const parsed = parseFloat(cleaned);
            if (!isNaN(parsed)) {
                // If it has % sign, it's already a percentage (e.g., "31.35%" = 31.35%)
                // If no % sign and value is > 1, it might be a percentage already (e.g., "31.35" = 31.35%)
                // If no % sign and value is < 1, it might be a decimal (e.g., "0.3135" = 31.35%)
                if (hasPercent) {
                    return parsed; // Already a percentage
                } else if (Math.abs(parsed) > 1) {
                    return parsed; // Likely already a percentage (e.g., 31.35)
                } else {
                    return parsed * 100; // Convert decimal to percentage (e.g., 0.3135 -> 31.35)
                }
            }
        }
        
        // If value is missing or invalid, calculate from pchange and lastPrice
        if (lastPrice && lastPrice > 0 && pchange !== null && pchange !== undefined) {
            const calculated = (pchange / lastPrice) * 100;
            return isNaN(calculated) ? null : calculated;
        }
        
        return null;
    }

    /**
     * Parse decimal value from string or number
     * Handles various formats: "1,234.56", "₹1,234.56", "1234.56", etc.
     * NOTE: Does NOT handle percentages - use parsePercentChange for that
     */
    parseDecimal(value) {
        if (value === null || value === undefined || value === '') return null;
        if (typeof value === 'number') {
            return isNaN(value) ? null : value;
        }
        
        // Remove currency symbols, commas, and other non-numeric characters except decimal point and minus
        let cleaned = String(value).replace(/[₹$€£,\s]/g, '').trim();
        
        // Do NOT handle percentages here - that's for parsePercentChange
        // Just remove % if present but don't divide by 100
        cleaned = cleaned.replace('%', '');
        
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? null : parsed;
    }

    /**
     * Parse big integer value from string or number
     * Handles various formats: "1,234,567", "₹1.23 Cr", "1234567", etc.
     */
    parseBigInt(value) {
        if (value === null || value === undefined || value === '') return null;
        if (typeof value === 'number') {
            return isNaN(value) ? null : Math.floor(value);
        }
        
        let cleaned = String(value).replace(/[₹$€£,\s]/g, '').trim().toLowerCase();
        
        // Handle Indian number system (Cr = Crores, L = Lakhs)
        let multiplier = 1;
        if (cleaned.includes('cr') || cleaned.includes('crore')) {
            multiplier = 10000000; // 1 Crore = 10 Million
            cleaned = cleaned.replace(/cr|crore/g, '');
        } else if (cleaned.includes('l') || cleaned.includes('lakh')) {
            multiplier = 100000; // 1 Lakh = 100 Thousand
            cleaned = cleaned.replace(/l|lakh/g, '');
        } else if (cleaned.includes('k') || cleaned.includes('thousand')) {
            multiplier = 1000;
            cleaned = cleaned.replace(/k|thousand/g, '');
        }
        
        const parsed = parseFloat(cleaned);
        if (isNaN(parsed)) return null;
        
        return Math.floor(parsed * multiplier);
    }

    /**
     * Get list of available sheets in the Excel file
     * Uses same multi-strategy approach as readData
     * @returns {Promise<Array>} Array of sheet names
     */
    async getSheetNames() {
        const filePath = this.getExcelFilePath();
        let tempPath = null;
        
        try {
            if (!fs.existsSync(filePath)) {
                LOG.warning(`[Excel File] File not found at: ${filePath}`);
                return [];
            }

            let workbook;
            
            // Try buffer-based read first (handles locked files)
            try {
                workbook = await this.readFileWithBuffer(filePath);
            } catch (bufferError) {
                // Try direct read
                try {
                    workbook = XLSX.readFile(filePath);
                } catch (directError) {
                    // Try temp copy
                    tempPath = await this.copyToTemp(filePath);
                    try {
                        workbook = await this.readFileWithBuffer(tempPath);
                    } catch (tempError) {
                        workbook = XLSX.readFile(tempPath);
                    }
                }
            }

            return workbook.SheetNames || [];
        } catch (error) {
            LOG.error('[Excel File] Error getting sheet names:', error.message);
            return [];
        } finally {
            if (tempPath) {
                this.cleanupTemp(tempPath);
            }
        }
    }
}

module.exports = new ExcelFileService();

