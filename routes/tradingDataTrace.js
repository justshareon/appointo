/**
 * Trading Data Trace Routes
 * Shows complete data flow: Excel → Transform → Store → Fetch → API → UI
 */
const express = require('express');
const router = express.Router();
const excelFileService = require('../services/excelFileService');
const stockDataService = require('../services/stockDataService');
const db = require('../database');
const LOG = require('../utils/logger');

/**
 * GET /api/trading/data-trace
 * Complete trace of data from Excel to UI
 * No authentication required - diagnostic endpoint
 */
router.get('/data-trace', async (req, res) => {
    // Set CORS headers explicitly
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    const trace = {
        timestamp: new Date().toISOString(),
        steps: {}
    };

    try {
        LOG.info('[Data Trace] ========================================');
        LOG.info('[Data Trace] Starting complete data trace...');

        // STEP 1: Read Raw Excel Data
        LOG.info('[Data Trace] STEP 1: Reading raw Excel data...');
        let rawExcelData = null;
        try {
            const sheetsData = await excelFileService.readAllSheetsByType();
            trace.steps.step1_rawExcel = {
                name: 'Raw Excel Data',
                success: true,
                data: {
                    gainers: {
                        count: sheetsData.gainers?.length || 0,
                        first5Rows: sheetsData.gainers?.slice(0, 5) || []
                    },
                    decliners: {
                        count: sheetsData.decliners?.length || 0,
                        first5Rows: sheetsData.decliners?.slice(0, 5) || []
                    },
                    actives: {
                        count: sheetsData.actives?.length || 0,
                        first5Rows: sheetsData.actives?.slice(0, 5) || []
                    },
                    data: {
                        count: sheetsData.data?.length || 0,
                        first5Rows: sheetsData.data?.slice(0, 5) || []
                    }
                }
            };
            rawExcelData = sheetsData;
        } catch (error) {
            trace.steps.step1_rawExcel = {
                name: 'Raw Excel Data',
                success: false,
                error: error.message,
                stack: error.stack
            };
        }

        // STEP 2: Check What's in Database (Before any transformation)
        LOG.info('[Data Trace] STEP 2: Checking database contents...');
        let dbData = null;
        try {
            if (stockDataService.isMySQLAvailable()) {
                const pool = db.getPool();
                const [allRows] = await pool.query('SELECT * FROM live_stock_data LIMIT 20');
                dbData = allRows;
                
                // Count by type
                const [typeCounts] = await pool.query(`
                    SELECT data_type, COUNT(*) as count 
                    FROM live_stock_data 
                    GROUP BY data_type
                `);
                
                trace.steps.step2_database = {
                    name: 'Database Contents',
                    success: true,
                    source: 'MySQL',
                    data: {
                        totalRecords: allRows.length,
                        typeCounts: typeCounts,
                        sampleRecords: allRows.slice(0, 10).map(row => ({
                            symbol: row.symbol,
                            company_name: row.company_name,
                            last_price: row.last_price,
                            per_change: row.per_change,
                            data_type: row.data_type,
                            volume: row.volume,
                            market_cap: row.market_cap
                        }))
                    }
                };
            } else {
                const inMemoryDb = stockDataService.getInMemoryDb();
                const stocks = inMemoryDb.live_stock_data || [];
                
                const typeCounts = {};
                stocks.forEach(stock => {
                    const type = stock.data_type || 'unknown';
                    typeCounts[type] = (typeCounts[type] || 0) + 1;
                });
                
                trace.steps.step2_database = {
                    name: 'Database Contents',
                    success: true,
                    source: 'In-Memory',
                    data: {
                        totalRecords: stocks.length,
                        typeCounts: typeCounts,
                        sampleRecords: stocks.slice(0, 10).map(stock => ({
                            symbol: stock.symbol,
                            company_name: stock.company_name,
                            last_price: stock.last_price,
                            per_change: stock.per_change,
                            data_type: stock.data_type,
                            volume: stock.volume,
                            market_cap: stock.market_cap
                        }))
                    }
                };
                dbData = stocks;
            }
        } catch (error) {
            trace.steps.step2_database = {
                name: 'Database Contents',
                success: false,
                error: error.message
            };
        }

        // STEP 3: Fetch Data Using Service Methods (What API uses)
        LOG.info('[Data Trace] STEP 3: Fetching data using service methods...');
        let fetchedGainers = [];
        let fetchedLosers = [];
        try {
            fetchedGainers = await stockDataService.getTopGainers(5);
            fetchedLosers = await stockDataService.getTopLosers(5);
            
            trace.steps.step3_serviceFetch = {
                name: 'Service Method Fetch',
                success: true,
                data: {
                    gainers: {
                        count: fetchedGainers.length,
                        records: fetchedGainers.map(g => ({
                            symbol: g.symbol,
                            name: g.name,
                            companyName: g.companyName,
                            price: g.price,
                            pchange: g.pchange,
                            changePercent: g.changePercent,
                            volume: g.volume,
                            marketCap: g.marketCap,
                            dataType: g.dataType
                        }))
                    },
                    losers: {
                        count: fetchedLosers.length,
                        records: fetchedLosers.map(l => ({
                            symbol: l.symbol,
                            name: l.name,
                            companyName: l.companyName,
                            price: l.price,
                            pchange: l.pchange,
                            changePercent: l.changePercent,
                            volume: l.volume,
                            marketCap: l.marketCap,
                            dataType: l.dataType
                        }))
                    }
                }
            };
        } catch (error) {
            trace.steps.step3_serviceFetch = {
                name: 'Service Method Fetch',
                success: false,
                error: error.message
            };
        }

        // STEP 4: Simulate API Response (What gets sent to frontend)
        LOG.info('[Data Trace] STEP 4: Simulating API response...');
        const apiResponse = {
            success: true,
            data: fetchedGainers
        };
        
        trace.steps.step4_apiResponse = {
            name: 'API Response Structure',
            success: true,
            data: {
                structure: {
                    hasSuccess: apiResponse.hasOwnProperty('success'),
                    hasData: apiResponse.hasOwnProperty('data'),
                    dataIsArray: Array.isArray(apiResponse.data),
                    dataLength: apiResponse.data.length
                },
                sampleResponse: JSON.parse(JSON.stringify(apiResponse)),
                fullResponse: apiResponse
            }
        };

        // STEP 5: Compare Excel vs Database
        LOG.info('[Data Trace] STEP 5: Comparing Excel vs Database...');
        const comparison = {
            excelGainersCount: rawExcelData?.gainers?.length || 0,
            dbGainersCount: 0,
            excelDeclinersCount: rawExcelData?.decliners?.length || 0,
            dbDeclinersCount: 0,
            matches: []
        };

        if (dbData && rawExcelData) {
            // Count by type in DB
            if (Array.isArray(dbData)) {
                dbData.forEach(row => {
                    if (row.data_type === 'gainers') comparison.dbGainersCount++;
                    if (row.data_type === 'decliners') comparison.dbDeclinersCount++;
                });
            }

            // Compare first few records
            if (rawExcelData.gainers && rawExcelData.gainers.length > 0) {
                const excelFirst = rawExcelData.gainers[0];
                const dbFirst = dbData.find(r => r.data_type === 'gainers');
                
                comparison.matches.push({
                    type: 'gainers',
                    excel: {
                        symbol: excelFirst.symbol,
                        company_name: excelFirst.company_name,
                        last_price: excelFirst.last_price,
                        per_change: excelFirst.per_change
                    },
                    database: dbFirst ? {
                        symbol: dbFirst.symbol,
                        company_name: dbFirst.company_name,
                        last_price: dbFirst.last_price,
                        per_change: dbFirst.per_change
                    } : null,
                    match: dbFirst && dbFirst.symbol === excelFirst.symbol
                });
            }
        }

        trace.steps.step5_comparison = {
            name: 'Excel vs Database Comparison',
            success: true,
            data: comparison
        };

        // STEP 6: Check Formatting
        LOG.info('[Data Trace] STEP 6: Checking data formatting...');
        const formattingCheck = {
            gainersFormatted: fetchedGainers.map(g => ({
                hasSymbol: !!g.symbol,
                hasName: !!(g.name || g.companyName),
                hasPrice: g.price !== undefined && g.price !== null,
                hasChangePercent: g.changePercent !== undefined && g.changePercent !== null,
                nameSource: g.name ? 'name' : (g.companyName ? 'companyName' : 'none'),
                rawData: g
            })),
            losersFormatted: fetchedLosers.map(l => ({
                hasSymbol: !!l.symbol,
                hasName: !!(l.name || l.companyName),
                hasPrice: l.price !== undefined && l.price !== null,
                hasChangePercent: l.changePercent !== undefined && l.changePercent !== null,
                nameSource: l.name ? 'name' : (l.companyName ? 'companyName' : 'none'),
                rawData: l
            }))
        };

        trace.steps.step6_formatting = {
            name: 'Data Formatting Check',
            success: true,
            data: formattingCheck
        };

        // Summary
        trace.summary = {
            excelHasData: (rawExcelData?.gainers?.length || 0) > 0,
            databaseHasData: (dbData?.length || 0) > 0,
            serviceReturnsData: fetchedGainers.length > 0,
            dataFlowComplete: fetchedGainers.length > 0 && fetchedLosers.length > 0,
            issues: []
        };

        if (!trace.summary.excelHasData) {
            trace.summary.issues.push('Excel file has no data');
        }
        if (!trace.summary.databaseHasData) {
            trace.summary.issues.push('Database has no data');
        }
        if (!trace.summary.serviceReturnsData) {
            trace.summary.issues.push('Service methods return no data');
        }
        if (trace.summary.excelHasData && !trace.summary.databaseHasData) {
            trace.summary.issues.push('Data not synced from Excel to database');
        }
        if (trace.summary.databaseHasData && !trace.summary.serviceReturnsData) {
            trace.summary.issues.push('Service methods not fetching data correctly');
        }

        LOG.info('[Data Trace] ========================================');
        LOG.info(`[Data Trace] Summary: ${trace.summary.dataFlowComplete ? '✅ COMPLETE' : '❌ BROKEN'}`);
        LOG.info(`[Data Trace] Issues: ${trace.summary.issues.length}`);
        trace.summary.issues.forEach((issue, idx) => {
            LOG.warning(`[Data Trace] Issue ${idx + 1}: ${issue}`);
        });

        // Always return JSON, never redirect
        res.status(200).json(trace);
    } catch (error) {
        LOG.error('[Data Trace] Error during trace:', error);
        // Return error as JSON, never redirect
        res.status(500).json({
            timestamp: new Date().toISOString(),
            error: true,
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            steps: trace.steps || {}
        });
    }
});

/**
 * GET /api/trading-data-trace/simple
 * Simple test endpoint to verify route is accessible
 */
router.get('/simple', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.json({
        success: true,
        message: 'Data trace endpoint is accessible',
        timestamp: new Date().toISOString(),
        path: '/api/trading/data-trace',
        instructions: [
            'Access this endpoint directly via:',
            '1. Browser: http://localhost:YOUR_PORT/api/trading/data-trace',
            '2. curl: curl http://localhost:YOUR_PORT/api/trading/data-trace',
            '3. Postman: GET http://localhost:YOUR_PORT/api/trading/data-trace',
            '',
            'Note: This is a backend API endpoint, not a frontend route.',
            'If you see redirects, you may be accessing it through the frontend app.',
            'Use a REST client or browser directly to the backend URL.'
        ]
    });
});

/**
 * GET /api/trading/excel-structure
 * Show raw Excel file structure to help debug column mapping
 */
router.get('/excel-structure', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    
    try {
        LOG.info('[Excel Structure] Reading Excel file structure...');
        
        const XLSX = require('xlsx');
        const fs = require('fs');
        const excelFilePath = excelFileService.getExcelFilePath();
        
        if (!fs.existsSync(excelFilePath)) {
            return res.status(404).json({
                error: 'Excel file not found',
                path: excelFilePath
            });
        }
        
        const workbook = XLSX.readFile(excelFilePath);
        const structure = {
            filePath: excelFilePath,
            sheetNames: workbook.SheetNames,
            sheets: {}
        };
        
        // Read each sheet
        for (const sheetName of workbook.SheetNames) {
            const worksheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(worksheet, { 
                header: 1,
                defval: '',
                raw: false
            });
            
            const nonEmptyRows = rows.filter(row => 
                row && row.length > 0 && row.some(cell => cell && String(cell).trim() !== '')
            );
            
            structure.sheets[sheetName] = {
                totalRows: rows.length,
                nonEmptyRows: nonEmptyRows.length,
                first10Rows: nonEmptyRows.slice(0, 10).map((row, idx) => ({
                    rowIndex: idx,
                    cells: row.map((cell, colIdx) => ({
                        columnIndex: colIdx,
                        columnLetter: String.fromCharCode(65 + colIdx), // A, B, C...
                        value: cell,
                        type: typeof cell
                    })),
                    rowString: row.join(' | ')
                })),
                detectedHeaders: nonEmptyRows.length > 0 ? nonEmptyRows[0] : [],
                columnCount: nonEmptyRows.length > 0 ? nonEmptyRows[0].length : 0
            };
        }
        
        res.json({
            success: true,
            structure: structure,
            instructions: [
                'This shows the raw Excel structure.',
                'Check the "detectedHeaders" to see what columns exist.',
                'Compare with the column mapping in the trace to see if mapping is correct.',
                'If headers are wrong, the Excel file may need to be reformatted.'
            ]
        });
    } catch (error) {
        LOG.error('[Excel Structure] Error:', error);
        res.status(500).json({
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

module.exports = router;

