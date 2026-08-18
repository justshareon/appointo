/**
 * Mutual Fund Data Service
 * Manages mutual fund data in MySQL database
 * Falls back to in-memory storage when MySQL is not available
 */
const db = require('../database');
const LOG = require('../utils/logger');

class MutualFundDataService {
    constructor() {
        this.initialized = false;
        this.inMemoryData = {
            mutual_funds: [],
            mutual_fund_history: []
        };
    }

    /**
     * Check if MySQL is available
     */
    isMySQLAvailable() {
        return !!db.getPool();
    }

    /**
     * Get in-memory database
     */
    getInMemoryDb() {
        const inMemoryDb = db.inMemoryDb || {};
        if (!inMemoryDb.mutualFundData) {
            inMemoryDb.mutualFundData = {
                mutual_funds: [],
                mutual_fund_history: []
            };
        }
        return inMemoryDb.mutualFundData;
    }

    /**
     * Initialize database tables
     */
    async initializeTables() {
        const pool = db.getPool();
        if (!pool) {
            LOG.warning('[Mutual Fund Data] MySQL not available, tables cannot be created');
            return false;
        }

        try {
            // Create mutual_funds table
            await pool.query(`
                CREATE TABLE IF NOT EXISTS mutual_funds (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    fund_name VARCHAR(255) NOT NULL,
                    category VARCHAR(100),
                    nav DECIMAL(15, 4),
                    returns DECIMAL(10, 4),
                    aum BIGINT,
                    expense_ratio DECIMAL(10, 4),
                    rating DECIMAL(3, 1),
                    risk VARCHAR(50),
                    sheet_name VARCHAR(100),
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_fund_name (fund_name),
                    INDEX idx_category (category),
                    INDEX idx_sheet_name (sheet_name),
                    INDEX idx_last_updated (last_updated)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            // Create mutual_fund_history table
            await pool.query(`
                CREATE TABLE IF NOT EXISTS mutual_fund_history (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    fund_name VARCHAR(255) NOT NULL,
                    category VARCHAR(100),
                    nav DECIMAL(15, 4),
                    returns DECIMAL(10, 4),
                    aum BIGINT,
                    expense_ratio DECIMAL(10, 4),
                    rating DECIMAL(3, 1),
                    risk VARCHAR(50),
                    sheet_name VARCHAR(100),
                    archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_fund_name (fund_name),
                    INDEX idx_sheet_name (sheet_name),
                    INDEX idx_archived_at (archived_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            // Ensure existing tables have a wide enough expense_ratio column
            // to avoid "Out of range value for column 'expense_ratio'" errors
            await pool.query(`
                ALTER TABLE mutual_funds 
                MODIFY COLUMN expense_ratio DECIMAL(10, 4) NULL
            `);

            await pool.query(`
                ALTER TABLE mutual_fund_history 
                MODIFY COLUMN expense_ratio DECIMAL(10, 4) NULL
            `);

            this.initialized = true;
            LOG.success('[Mutual Fund Data] Database tables initialized successfully');
            return true;
        } catch (error) {
            LOG.error('[Mutual Fund Data] Error initializing tables:', error.message);
            throw error;
        }
    }

    /**
     * Archive current mutual_funds to mutual_fund_history
     */
    async archiveCurrentData() {
        if (!this.isMySQLAvailable()) {
            const inMemoryDb = this.getInMemoryDb();
            const liveData = [...inMemoryDb.mutual_funds];
            inMemoryDb.mutual_fund_history.push(...liveData.map(item => ({
                ...item,
                archived_at: new Date()
            })));
            const { HISTORY_CAP, capArray } = require('../database/featureMemoryManager');
            capArray(inMemoryDb.mutual_fund_history, HISTORY_CAP * Math.max(liveData.length, 1));
            LOG.info(`[Mutual Fund Data] Archived ${liveData.length} records to in-memory history (capped)`);
            return liveData.length;
        }

        const pool = db.getPool();
        try {
            const [liveData] = await pool.query('SELECT * FROM mutual_funds');
            
            if (liveData.length === 0) {
                LOG.info('[Mutual Fund Data] No live data to archive');
                return 0;
            }

            const archiveValues = liveData.map(row => [
                row.fund_name,
                row.category,
                row.nav,
                row.returns,
                row.aum,
                row.expense_ratio,
                row.rating,
                row.risk,
                row.sheet_name
            ]);

            const placeholders = archiveValues.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
            const query = `
                INSERT INTO mutual_fund_history 
                (fund_name, category, nav, returns, aum, expense_ratio, rating, risk, sheet_name)
                VALUES ${placeholders}
            `;

            const flatValues = archiveValues.flat();
            await pool.query(query, flatValues);

            LOG.success(`[Mutual Fund Data] Archived ${liveData.length} records to history table`);
            return liveData.length;
        } catch (error) {
            LOG.error('[Mutual Fund Data] Error archiving data:', error.message);
            throw error;
        }
    }

    /**
     * Truncate mutual_funds table
     */
    async truncateLiveData() {
        if (!this.isMySQLAvailable()) {
            const inMemoryDb = this.getInMemoryDb();
            inMemoryDb.mutual_funds = [];
            LOG.info('[Mutual Fund Data] Live mutual fund data truncated in memory');
            return;
        }

        const pool = db.getPool();
        try {
            await pool.query('TRUNCATE TABLE mutual_funds');
            LOG.info('[Mutual Fund Data] Live mutual fund data table truncated');
        } catch (error) {
            LOG.error('[Mutual Fund Data] Error truncating live data:', error.message);
            throw error;
        }
    }

    /**
     * Insert mutual fund data
     */
    async insertLiveData(fundData) {
        if (!fundData || fundData.length === 0) {
            LOG.warning('[Mutual Fund Data] No mutual fund data to insert');
            return 0;
        }

        if (!this.isMySQLAvailable()) {
            const inMemoryDb = this.getInMemoryDb();
            inMemoryDb.mutual_funds = fundData.map(fund => ({
                ...fund,
                id: Date.now() + Math.random(),
                last_updated: new Date()
            }));
            LOG.success(`[Mutual Fund Data] Inserted ${fundData.length} records in memory`);
            return fundData.length;
        }

        const pool = db.getPool();
        try {
            const values = fundData.map(fund => [
                fund.fund_name,
                fund.category,
                fund.nav,
                fund.returns,
                fund.aum,
                fund.expense_ratio,
                fund.rating,
                fund.risk,
                fund.sheet_name
            ]);

            const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
            const query = `
                INSERT INTO mutual_funds 
                (fund_name, category, nav, returns, aum, expense_ratio, rating, risk, sheet_name)
                VALUES ${placeholders}
                ON DUPLICATE KEY UPDATE
                    category = VALUES(category),
                    nav = VALUES(nav),
                    returns = VALUES(returns),
                    aum = VALUES(aum),
                    expense_ratio = VALUES(expense_ratio),
                    rating = VALUES(rating),
                    risk = VALUES(risk),
                    sheet_name = VALUES(sheet_name),
                    last_updated = CURRENT_TIMESTAMP
            `;

            const flatValues = values.flat();
            const [result] = await pool.query(query, flatValues);

            LOG.success(`[Mutual Fund Data] Inserted/updated ${fundData.length} records in mutual_funds`);
            return result.affectedRows || fundData.length;
        } catch (error) {
            LOG.error('[Mutual Fund Data] Error inserting live data:', error.message);
            throw error;
        }
    }

    /**
     * Get all mutual funds
     */
    async getAllFunds(limit = 1000) {
        if (!this.isMySQLAvailable()) {
            const inMemoryDb = this.getInMemoryDb();
            return inMemoryDb.mutual_funds
                .slice(0, limit)
                .map(fund => this.formatFundData(fund));
        }

        const pool = db.getPool();
        try {
            const [rows] = await pool.query(
                'SELECT * FROM mutual_funds ORDER BY fund_name LIMIT ?',
                [limit]
            );
            return rows.map(row => this.formatFundData(row));
        } catch (error) {
            LOG.error('[Mutual Fund Data] Error getting all funds:', error.message);
            return [];
        }
    }

    /**
     * Get mutual funds by category
     */
    async getFundsByCategory(category, limit = 100) {
        if (!this.isMySQLAvailable()) {
            const inMemoryDb = this.getInMemoryDb();
            return inMemoryDb.mutual_funds
                .filter(f => f.category && f.category.toLowerCase() === category.toLowerCase())
                .slice(0, limit)
                .map(fund => this.formatFundData(fund));
        }

        const pool = db.getPool();
        try {
            const [rows] = await pool.query(
                'SELECT * FROM mutual_funds WHERE category = ? ORDER BY fund_name LIMIT ?',
                [category, limit]
            );
            return rows.map(row => this.formatFundData(row));
        } catch (error) {
            LOG.error('[Mutual Fund Data] Error getting funds by category:', error.message);
            return [];
        }
    }

    /**
     * Get mutual funds by sheet name
     */
    async getFundsBySheet(sheetName, limit = 100) {
        if (!this.isMySQLAvailable()) {
            const inMemoryDb = this.getInMemoryDb();
            return inMemoryDb.mutual_funds
                .filter(f => f.sheet_name === sheetName)
                .slice(0, limit)
                .map(fund => this.formatFundData(fund));
        }

        const pool = db.getPool();
        try {
            const [rows] = await pool.query(
                'SELECT * FROM mutual_funds WHERE sheet_name = ? ORDER BY fund_name LIMIT ?',
                [sheetName, limit]
            );
            return rows.map(row => this.formatFundData(row));
        } catch (error) {
            LOG.error('[Mutual Fund Data] Error getting funds by sheet:', error.message);
            return [];
        }
    }

    /**
     * Get all unique categories
     */
    async getCategories() {
        if (!this.isMySQLAvailable()) {
            const inMemoryDb = this.getInMemoryDb();
            const categories = [...new Set(inMemoryDb.mutual_funds
                .map(f => f.category)
                .filter(Boolean))];
            return categories.sort();
        }

        const pool = db.getPool();
        try {
            const [rows] = await pool.query(
                'SELECT DISTINCT category FROM mutual_funds WHERE category IS NOT NULL ORDER BY category'
            );
            return rows.map(row => row.category);
        } catch (error) {
            LOG.error('[Mutual Fund Data] Error getting categories:', error.message);
            return [];
        }
    }

    /**
     * Get all unique sheet names
     */
    async getSheetNames() {
        if (!this.isMySQLAvailable()) {
            const inMemoryDb = this.getInMemoryDb();
            const sheets = [...new Set(inMemoryDb.mutual_funds
                .map(f => f.sheet_name)
                .filter(Boolean))];
            return sheets.sort();
        }

        const pool = db.getPool();
        try {
            const [rows] = await pool.query(
                'SELECT DISTINCT sheet_name FROM mutual_funds WHERE sheet_name IS NOT NULL ORDER BY sheet_name'
            );
            return rows.map(row => row.sheet_name);
        } catch (error) {
            LOG.error('[Mutual Fund Data] Error getting sheet names:', error.message);
            return [];
        }
    }

    /**
     * Format database row to application format
     */
    formatFundData(row) {
        if (!row) return null;
        
        return {
            id: row.id,
            fundName: row.fund_name,
            name: row.fund_name, // Alias for frontend compatibility
            category: row.category,
            nav: parseFloat(row.nav || 0) || 0,
            returns: parseFloat(row.returns || 0) || 0,
            aum: parseInt(row.aum || 0) || 0,
            expenseRatio: parseFloat(row.expense_ratio || 0) || 0,
            rating: parseFloat(row.rating || 0) || 0,
            risk: row.risk,
            sheetName: row.sheet_name,
            lastUpdated: row.last_updated || row.lastUpdated
        };
    }
}

module.exports = new MutualFundDataService();

