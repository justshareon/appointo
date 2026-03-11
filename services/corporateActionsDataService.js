/**
 * Corporate Actions Data Service
 * Manages corporate actions data in MySQL database
 * Falls back to in-memory storage when MySQL is not available
 */
const db = require('../database');
const LOG = require('../utils/logger');

class CorporateActionsDataService {
    constructor() {
        this.initialized = false;
    }

    /**
     * Check if MySQL is available
     * @returns {boolean}
     */
    isMySQLAvailable() {
        return db.getPool() !== null;
    }

    /**
     * Get in-memory database instance
     * @returns {Array}
     */
    getInMemoryDb() {
        const inMemoryDb = db.inMemoryDb || {};
        if (!inMemoryDb.corporateActions) {
            inMemoryDb.corporateActions = [];
        }
        return inMemoryDb.corporateActions;
    }

    /**
     * Initialize database tables
     * Creates corporate_actions table if it doesn't exist
     */
    async initializeTables() {
        const pool = db.getPool();
        if (!pool || pool === null || pool === undefined) {
            LOG.warning('[Corporate Actions] MySQL not available, tables cannot be created - will use in-memory storage');
            this.initialized = true; // Mark as initialized even without MySQL
            return;
        }

        try {
            // Create corporate_actions table
            await pool.query(`
                CREATE TABLE IF NOT EXISTS corporate_actions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    symbol VARCHAR(20) NOT NULL,
                    company_name VARCHAR(255),
                    series VARCHAR(10),
                    purpose TEXT,
                    face_value DECIMAL(10, 2),
                    ex_date DATE,
                    record_date DATE,
                    book_closure_start_date DATE,
                    book_closure_end_date DATE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_symbol (symbol),
                    INDEX idx_ex_date (ex_date),
                    INDEX idx_record_date (record_date)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            LOG.success('[Corporate Actions] Database tables initialized');
            this.initialized = true;
        } catch (error) {
            LOG.error('[Corporate Actions] Error initializing tables:', error.message);
            throw error;
        }
    }

    /**
     * Truncate corporate_actions table
     */
    async truncateData() {
        const pool = db.getPool();
        if (!pool || pool === null || pool === undefined) {
            // Use in-memory storage
            const inMemoryDb = this.getInMemoryDb();
            inMemoryDb.length = 0;
            LOG.info('[Corporate Actions] Corporate actions data truncated in memory');
            return;
        }

        try {
            await pool.query('TRUNCATE TABLE corporate_actions');
            LOG.info('[Corporate Actions] Corporate actions table truncated');
        } catch (error) {
            LOG.error('[Corporate Actions] Error truncating data:', error.message);
            throw error;
        }
    }

    /**
     * Insert corporate actions data
     * @param {Array} actionsData - Array of corporate action objects
     * @returns {Promise<number>} Number of records inserted
     */
    async insertData(actionsData) {
        if (!actionsData || actionsData.length === 0) {
            LOG.warning('[Corporate Actions] No data to insert');
            return 0;
        }

        const pool = db.getPool();
        if (!pool || pool === null || pool === undefined) {
            // Use in-memory storage
            const inMemoryDb = this.getInMemoryDb();
            actionsData.forEach(action => {
                inMemoryDb.push({
                    ...action,
                    id: Date.now() + Math.random(),
                    created_at: new Date(),
                    updated_at: new Date()
                });
            });
            LOG.success(`[Corporate Actions] Inserted ${actionsData.length} records in memory`);
            return actionsData.length;
        }

        try {
            const values = actionsData.map(action => [
                action.symbol || null,
                action.company_name || null,
                action.series || null,
                action.purpose || null,
                action.face_value || null,
                action.ex_date || null,
                action.record_date || null,
                action.book_closure_start_date || null,
                action.book_closure_end_date || null
            ]);

            const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
            const query = `
                INSERT INTO corporate_actions 
                (symbol, company_name, series, purpose, face_value, ex_date, record_date, book_closure_start_date, book_closure_end_date)
                VALUES ${placeholders}
            `;

            const flatValues = values.flat();
            const [result] = await pool.query(query, flatValues);

            LOG.success(`[Corporate Actions] Inserted ${result.affectedRows} records`);
            return result.affectedRows;
        } catch (error) {
            LOG.error('[Corporate Actions] Error inserting data:', error.message);
            throw error;
        }
    }

    /**
     * Get all corporate actions
     * @param {Object} options - Query options (limit, offset, filters)
     * @returns {Promise<Array>} Array of corporate actions
     */
    async getAllActions(options = {}) {
        const { limit, offset = 0, symbol, exDateFrom, exDateTo } = options;

        const pool = db.getPool();
        if (!pool || pool === null || pool === undefined) {
            // Use in-memory storage
            const inMemoryDb = this.getInMemoryDb();
            let filtered = [...inMemoryDb];

            if (symbol) {
                filtered = filtered.filter(a => a.symbol === symbol.toUpperCase());
            }
            if (exDateFrom) {
                filtered = filtered.filter(a => a.ex_date && new Date(a.ex_date) >= new Date(exDateFrom));
            }
            if (exDateTo) {
                filtered = filtered.filter(a => a.ex_date && new Date(a.ex_date) <= new Date(exDateTo));
            }

            if (limit) {
                filtered = filtered.slice(offset, offset + limit);
            }

            return filtered;
        }

        try {
            let query = 'SELECT * FROM corporate_actions WHERE 1=1';
            const params = [];

            if (symbol) {
                query += ' AND symbol = ?';
                params.push(symbol.toUpperCase());
            }
            if (exDateFrom) {
                query += ' AND ex_date >= ?';
                params.push(exDateFrom);
            }
            if (exDateTo) {
                query += ' AND ex_date <= ?';
                params.push(exDateTo);
            }

            query += ' ORDER BY ex_date DESC, symbol ASC';

            if (limit) {
                query += ' LIMIT ? OFFSET ?';
                params.push(limit, offset);
            }

            const [rows] = await pool.query(query, params);
            return rows;
        } catch (error) {
            LOG.error('[Corporate Actions] Error getting actions:', error.message);
            throw error;
        }
    }

    /**
     * Get corporate actions by symbol
     * @param {string} symbol - Stock symbol
     * @returns {Promise<Array>} Array of corporate actions for the symbol
     */
    async getActionsBySymbol(symbol) {
        return this.getAllActions({ symbol });
    }

    /**
     * Get count of corporate actions
     * @returns {Promise<number>} Total count
     */
    async getCount() {
        const pool = db.getPool();
        if (!pool || pool === null || pool === undefined) {
            // Use in-memory storage
            return this.getInMemoryDb().length;
        }

        try {
            const [rows] = await pool.query('SELECT COUNT(*) as count FROM corporate_actions');
            return rows[0].count;
        } catch (error) {
            LOG.error('[Corporate Actions] Error getting count:', error.message);
            return 0;
        }
    }
}

module.exports = new CorporateActionsDataService();

