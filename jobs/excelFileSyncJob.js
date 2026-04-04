/**
 * Excel File Sync Job (FINAL VERSION)
 * - Reads multiple Google Sheet tabs via published CSV
 * - Archives old data
 * - Inserts fresh data
 * - Fully production safe
 */

const cron = require('node-cron');
const config = require('../config/tradingConfig');
const excelFileService = require('../services/excelFileService');
const stockDataService = require('../services/stockDataService');
const featureEngineeringService = require('../services/featureEngineeringService');
const LOG = require('../utils/logger');
require('dotenv').config();

class ExcelFileSyncJob {
    constructor() {
        this.isRunning = false;
        this.initialized = false;

        // ✅ BASE PUBLISHED URL (NO gid here)
        this.BASE_URL = process.env.GOOGLE_PUBLISHED_CSV_URL 
            || 'https://docs.google.com/spreadsheets/d/e/2PACX-XXXX/pub';

        // ✅ MULTIPLE SHEETS (UPDATE GIDs FROM YOUR SHEET)
        this.SHEETS = [
            { name: 'Gainers', gid: '0' },
            { name: 'Decliners', gid: '111111111' },
            { name: 'Actives', gid: '222222222' },
            { name: 'Data', gid: '333333333' }
        ];

        this.CRON_EXPRESSION = process.env.SYNC_CRON || '*/35 * * * *';
        this.ENABLE_LOCAL_FALLBACK = process.env.ENABLE_LOCAL_FALLBACK === 'true';

        LOG.info('[Excel Sync] ✅ Initialized');
    }

    // ✅ Build proper Google CSV URL
    buildUrl(gid) {
        return `${this.BASE_URL}?gid=${gid}&single=true&output=csv&_=${Date.now()}`;
    }

    // ✅ Fetch single sheet
    async fetchSheet(sheet) {
        const url = this.buildUrl(sheet.gid);

        LOG.info(`[Excel Sync] Fetching ${sheet.name}...`);

        const res = await fetch(url, {
            headers: { 'Cache-Control': 'no-cache' }
        });

        if (!res.ok) {
            throw new Error(`${sheet.name} HTTP ${res.status}`);
        }

        const text = await res.text();

        LOG.info(`[Excel Sync] ${sheet.name} bytes: ${text.length}`);
        LOG.info(`[Excel Sync] ${sheet.name} preview: ${text.substring(0, 100)}`);

        if (!text.trim()) {
            throw new Error(`${sheet.name} CSV EMPTY`);
        }

        return this.parseCSV(text, sheet.name);
    }

    // ✅ Parse CSV
    parseCSV(csvText, type) {
        const lines = csvText.split('\n').filter(l => l.trim());
        const headers = this.parseLine(lines[0]);

        const data = [];

        for (let i = 1; i < lines.length; i++) {
            const values = this.parseLine(lines[i]);
            const obj = {};

            headers.forEach((h, idx) => {
                const key = h.toLowerCase().replace(/\s/g, '_');
                obj[key] = values[idx] || '';
            });

            const symbol = obj.symbol || obj.name || obj.scrip_name;

            if (symbol) {
                obj.symbol = symbol.trim();
                obj.data_type = type.toLowerCase();
                data.push(obj);
            }
        }

        LOG.success(`[Excel Sync] ${type}: ${data.length} records`);
        return data;
    }

    // ✅ CSV line parser
    parseLine(line) {
        const result = [];
        let cur = '';
        let inQuotes = false;

        for (let ch of line) {
            if (ch === '"') inQuotes = !inQuotes;
            else if (ch === ',' && !inQuotes) {
                result.push(cur);
                cur = '';
            } else cur += ch;
        }
        result.push(cur);

        return result.map(v => v.replace(/^"|"$/g, '').trim());
    }

    // ✅ Read all sheets
    async readFromGoogleSheets() {
        const all = [];

        for (const sheet of this.SHEETS) {
            try {
                const data = await this.fetchSheet(sheet);
                all.push(...data);
            } catch (err) {
                LOG.error(`[Excel Sync] ${sheet.name} FAILED:`, err.message);
            }
        }

        if (all.length === 0) {
            throw new Error('❌ All sheets failed');
        }

        return all;
    }

    // ✅ MAIN SYNC
    async sync(force = false) {
        if (this.isRunning) {
            LOG.warning('[Excel Sync] Already running');
            return;
        }

        this.isRunning = true;
        const start = Date.now();

        LOG.info('[Excel Sync] 🔄 START');

        try {
            let data;

            try {
                data = await this.readFromGoogleSheets();
            } catch (err) {
                LOG.warning('[Excel Sync] Google failed, fallback...');
                if (!this.ENABLE_LOCAL_FALLBACK) throw err;

                const fallback = await excelFileService.readAllSheetsByType();
                data = [
                    ...(fallback.gainers || []),
                    ...(fallback.decliners || []),
                    ...(fallback.actives || []),
                    ...(fallback.data || [])
                ];
            }

            if (!data.length) {
                throw new Error('No data found');
            }

            // ✅ CLEAN DATA
            const cleaned = data.map(s => ({
                symbol: (s.symbol || '').substring(0, 20),
                company_name: (s.company_name || '').substring(0, 255),
                last_price: parseFloat(s.last_price || s.price || 0),
                pchange: parseFloat(s.change || 0),
                per_change: parseFloat(s.percent_change || 0),
                volume: parseFloat(s.volume || 0),
                data_type: s.data_type || 'data'
            }));

            LOG.info(`[Excel Sync] Cleaned: ${cleaned.length}`);

            // ✅ DB OPERATIONS
            await stockDataService.archiveCurrentData();
            await stockDataService.truncateLiveData();
            const inserted = await stockDataService.insertLiveData(cleaned);

            LOG.success(`[Excel Sync] ✅ DONE: ${inserted} records`);

            // ✅ ML Feature generation
            try {
                await featureEngineeringService.generateFeaturesForML();
            } catch {
                LOG.warning('[Excel Sync] Feature generation failed');
            }

            LOG.success(`[Excel Sync] ⏱ Time: ${Date.now() - start} ms`);

        } catch (err) {
            LOG.error('[Excel Sync] ❌ FAILED:', err.message);
        } finally {
            this.isRunning = false;
        }
    }

    // ✅ START CRON
    start() {
        if (this.initialized) return;

        this.cronJob = cron.schedule(this.CRON_EXPRESSION, () => {
            this.sync();
        });

        setTimeout(() => this.sync(true), 5000);

        this.initialized = true;

        LOG.success('[Excel Sync] 🚀 Started');
    }

    stop() {
        if (this.cronJob) this.cronJob.stop();
        this.initialized = false;
    }
}

module.exports = ExcelFileSyncJob;