/**
 * Trading Diagnostics Routes
 * Step-by-step validation of data flow: Read -> Save -> Fetch -> Send to UI
 */
const express = require('express');
const router = express.Router();
const excelFileService = require('../services/excelFileService');
const stockDataService = require('../services/stockDataService');
const db = require('../database');
const LOG = require('../utils/logger');
const fs = require('fs');
const path = require('path');

/**
 * GET /api/trading/diagnostics
 * Comprehensive step-by-step validation of data flow
 */
router.get('/diagnostics', async (req, res) => {
    const diagnostics = {
        timestamp: new Date().toISOString(),
        steps: {},
        summary: {
            allStepsPassed: false,
            issues: []
        }
    };

    try {
        // STEP 1: Check Excel File Exists
        LOG.info('[Diagnostics] ========================================');
        LOG.info('[Diagnostics] STEP 1: Checking Excel file...');
        const excelFilePath = excelFileService.getExcelFilePath();
        const fileExists = fs.existsSync(excelFilePath);
        
        diagnostics.steps.step1_fileCheck = {
            name: 'Excel File Check',
            passed: fileExists,
            details: {
                filePath: excelFilePath,
                exists: fileExists,
                absolutePath: path.resolve(excelFilePath)
            }
        };

        if (!fileExists) {
            diagnostics.summary.issues.push('Excel file not found at: ' + excelFilePath);
            diagnostics.steps.step1_fileCheck.error = 'File does not exist';
        } else {
            const stats = fs.statSync(excelFilePath);
            diagnostics.steps.step1_fileCheck.details.fileSize = stats.size;
            diagnostics.steps.step1_fileCheck.details.lastModified = stats.mtime;
        }

        // STEP 2: Read Excel File
        LOG.info('[Diagnostics] STEP 2: Reading Excel file...');
        let sheetsData = null;
        let readError = null;
        
        try {
            sheetsData = await excelFileService.readAllSheetsByType();
            diagnostics.steps.step2_readExcel = {
                name: 'Read Excel File',
                passed: true,
                details: {
                    gainers: sheetsData.gainers?.length || 0,
                    decliners: sheetsData.decliners?.length || 0,
                    actives: sheetsData.actives?.length || 0,
                    data: sheetsData.data?.length || 0,
                    total: (sheetsData.gainers?.length || 0) + 
                           (sheetsData.decliners?.length || 0) + 
                           (sheetsData.actives?.length || 0) + 
                           (sheetsData.data?.length || 0)
                }
            };

            if (diagnostics.steps.step2_readExcel.details.total === 0) {
                diagnostics.steps.step2_readExcel.passed = false;
                diagnostics.steps.step2_readExcel.error = 'No data read from Excel file';
                diagnostics.summary.issues.push('Excel file read but returned 0 records');
            } else {
                // Log sample data
                const sampleGainer = sheetsData.gainers?.[0];
                const sampleDecliner = sheetsData.decliners?.[0];
                diagnostics.steps.step2_readExcel.details.sampleGainer = sampleGainer ? {
                    symbol: sampleGainer.symbol,
                    company_name: sampleGainer.company_name,
                    last_price: sampleGainer.last_price,
                    percent_change: sampleGainer.percent_change
                } : null;
                diagnostics.steps.step2_readExcel.details.sampleDecliner = sampleDecliner ? {
                    symbol: sampleDecliner.symbol,
                    company_name: sampleDecliner.company_name,
                    last_price: sampleDecliner.last_price,
                    percent_change: sampleDecliner.percent_change
                } : null;
            }
        } catch (error) {
            readError = error;
            diagnostics.steps.step2_readExcel = {
                name: 'Read Excel File',
                passed: false,
                error: error.message,
                stack: error.stack
            };
            diagnostics.summary.issues.push('Failed to read Excel file: ' + error.message);
        }

        // STEP 3: Check Database Connection
        LOG.info('[Diagnostics] STEP 3: Checking database connection...');
        const pool = db.getPool();
        const isMySQLAvailable = !!pool;
        
        diagnostics.steps.step3_databaseCheck = {
            name: 'Database Connection',
            passed: isMySQLAvailable,
            details: {
                mysqlAvailable: isMySQLAvailable,
                usingInMemory: !isMySQLAvailable
            }
        };

        if (!isMySQLAvailable) {
            diagnostics.summary.issues.push('MySQL not available, using in-memory storage');
        }

        // STEP 4: Check Database Tables
        LOG.info('[Diagnostics] STEP 4: Checking database tables...');
        let tableCheck = { exists: false, recordCount: 0 };
        
        if (isMySQLAvailable) {
            try {
                const [tables] = await pool.query(`
                    SELECT COUNT(*) as count 
                    FROM information_schema.tables 
                    WHERE table_schema = DATABASE() 
                    AND table_name = 'live_stock_data'
                `);
                tableCheck.exists = tables[0].count > 0;
                
                if (tableCheck.exists) {
                    const [countResult] = await pool.query('SELECT COUNT(*) as count FROM live_stock_data');
                    tableCheck.recordCount = countResult[0].count;
                }
            } catch (error) {
                tableCheck.error = error.message;
            }
        } else {
            const inMemoryDb = stockDataService.getInMemoryDb();
            tableCheck.exists = true;
            tableCheck.recordCount = inMemoryDb.live_stock_data?.length || 0;
        }

        diagnostics.steps.step4_tableCheck = {
            name: 'Database Tables',
            passed: tableCheck.exists,
            details: {
                tableExists: tableCheck.exists,
                recordCount: tableCheck.recordCount,
                error: tableCheck.error
            }
        };

        if (!tableCheck.exists) {
            diagnostics.summary.issues.push('live_stock_data table does not exist');
        } else if (tableCheck.recordCount === 0) {
            diagnostics.summary.issues.push('live_stock_data table exists but is empty');
        }

        // STEP 5: Fetch Data from Database
        LOG.info('[Diagnostics] STEP 5: Fetching data from database...');
        let fetchedGainers = [];
        let fetchedLosers = [];
        let fetchError = null;

        try {
            fetchedGainers = await stockDataService.getTopGainers(10);
            fetchedLosers = await stockDataService.getTopLosers(10);
            
            diagnostics.steps.step5_fetchData = {
                name: 'Fetch from Database',
                passed: true,
                details: {
                    gainersCount: fetchedGainers.length,
                    losersCount: fetchedLosers.length,
                    sampleGainer: fetchedGainers[0] || null,
                    sampleLoser: fetchedLosers[0] || null
                }
            };

            if (fetchedGainers.length === 0 && fetchedLosers.length === 0) {
                diagnostics.steps.step5_fetchData.passed = false;
                diagnostics.steps.step5_fetchData.error = 'No data returned from database';
                diagnostics.summary.issues.push('Database fetch returned 0 records');
            }
        } catch (error) {
            fetchError = error;
            diagnostics.steps.step5_fetchData = {
                name: 'Fetch from Database',
                passed: false,
                error: error.message,
                stack: error.stack
            };
            diagnostics.summary.issues.push('Failed to fetch from database: ' + error.message);
        }

        // STEP 6: Format Data for API
        LOG.info('[Diagnostics] STEP 6: Formatting data for API...');
        let formattedGainers = [];
        let formattedLosers = [];
        
        try {
            formattedGainers = fetchedGainers.map(stock => stockDataService.formatStockData(stock));
            formattedLosers = fetchedLosers.map(stock => stockDataService.formatStockData(stock));
            
            diagnostics.steps.step6_formatData = {
                name: 'Format Data for API',
                passed: true,
                details: {
                    gainersFormatted: formattedGainers.length,
                    losersFormatted: formattedLosers.length,
                    sampleFormattedGainer: formattedGainers[0] || null,
                    sampleFormattedLoser: formattedLosers[0] || null
                }
            };

            if (formattedGainers.length === 0 && formattedLosers.length === 0) {
                diagnostics.steps.step6_formatData.passed = false;
                diagnostics.steps.step6_formatData.error = 'No formatted data';
            }
        } catch (error) {
            diagnostics.steps.step6_formatData = {
                name: 'Format Data for API',
                passed: false,
                error: error.message
            };
            diagnostics.summary.issues.push('Failed to format data: ' + error.message);
        }

        // STEP 7: Check API Response Structure
        LOG.info('[Diagnostics] STEP 7: Validating API response structure...');
        const apiResponse = {
            success: true,
            data: formattedGainers
        };

        diagnostics.steps.step7_apiResponse = {
            name: 'API Response Structure',
            passed: true,
            details: {
                hasSuccess: apiResponse.hasOwnProperty('success'),
                hasData: apiResponse.hasOwnProperty('data'),
                dataIsArray: Array.isArray(apiResponse.data),
                dataLength: apiResponse.data.length,
                sampleResponse: {
                    success: apiResponse.success,
                    dataLength: apiResponse.data.length,
                    firstItem: apiResponse.data[0] || null
                }
            }
        };

        // STEP 8: Check Sync Job Status
        LOG.info('[Diagnostics] STEP 8: Checking sync job status...');
        const syncJob = global.excelFileSyncJob;
        let syncStatus = null;

        if (syncJob) {
            syncStatus = syncJob.getStatus();
            diagnostics.steps.step8_syncJob = {
                name: 'Sync Job Status',
                passed: syncStatus.lastSyncStatus === 'success',
                details: syncStatus
            };

            if (syncStatus.lastSyncStatus !== 'success') {
                diagnostics.summary.issues.push(`Sync job status: ${syncStatus.lastSyncStatus} - ${syncStatus.lastSyncError || 'Unknown error'}`);
            }
        } else {
            diagnostics.steps.step8_syncJob = {
                name: 'Sync Job Status',
                passed: false,
                error: 'Sync job not initialized'
            };
            diagnostics.summary.issues.push('Excel sync job not initialized');
        }

        // Summary
        const allStepsPassed = Object.values(diagnostics.steps).every(step => step.passed === true);
        diagnostics.summary.allStepsPassed = allStepsPassed;
        diagnostics.summary.totalIssues = diagnostics.summary.issues.length;

        LOG.info('[Diagnostics] ========================================');
        LOG.info(`[Diagnostics] Summary: ${allStepsPassed ? 'ALL STEPS PASSED' : 'ISSUES FOUND'}`);
        LOG.info(`[Diagnostics] Issues: ${diagnostics.summary.issues.length}`);
        diagnostics.summary.issues.forEach((issue, idx) => {
            LOG.warning(`[Diagnostics] Issue ${idx + 1}: ${issue}`);
        });

        res.json(diagnostics);
    } catch (error) {
        LOG.error('[Diagnostics] Error during diagnostics:', error);
        diagnostics.summary.error = error.message;
        diagnostics.summary.stack = error.stack;
        res.status(500).json(diagnostics);
    }
});

module.exports = router;

