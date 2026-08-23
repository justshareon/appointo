/**
 * Board Meetings Data Service
 * Manages board meetings data in MySQL database
 * Falls back to in-memory storage when MySQL is not available
 */
const db = require('../database');
const LOG = require('../utils/logger');
const { BOARD_CAP, capByDate } = require('../database/featureMemoryManager');

function isHeaderLikeMeeting(meeting) {
    const s = String(meeting?.symbol || meeting?.company_name || '')
        .replace(/^[\s,]+/, '')
        .trim()
        .toUpperCase();
    if (!s) return true;
    return (
        s === 'ATTACHMENT' ||
        s === 'COMPANY NAME' ||
        s === 'DETAILS' ||
        s === 'PURPOSE' ||
        s === 'SYMBOL' ||
        s.includes('BROADCAST') ||
        s.includes('ATTACHMENT')
    );
}

class BoardMeetingsDataService {
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
        if (!inMemoryDb.boardMeetings) {
            inMemoryDb.boardMeetings = [];
        }
        return inMemoryDb.boardMeetings;
    }

    /**
     * Initialize database tables
     * Creates board_meetings table if it doesn't exist
     */
    async initializeTables() {
        const pool = db.getPool();
        if (!pool || pool === null || pool === undefined) {
            LOG.warning('[Board Meetings] MySQL not available, tables cannot be created - will use in-memory storage');
            this.initialized = true; // Mark as initialized even without MySQL
            return;
        }

        try {
            // Create board_meetings table
            await pool.query(`
                CREATE TABLE IF NOT EXISTS board_meetings (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    symbol VARCHAR(50) NOT NULL,
                    company_name VARCHAR(255),
                    series VARCHAR(10),
                    purpose TEXT,
                    meeting_date DATE,
                    meeting_time VARCHAR(50),
                    venue TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_symbol (symbol),
                    INDEX idx_meeting_date (meeting_date)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            // Ensure existing board_meetings table has a wide enough symbol column
            // to avoid "Data too long for column 'symbol'" errors during sync
            await pool.query(`
                ALTER TABLE board_meetings 
                MODIFY COLUMN symbol VARCHAR(50) NOT NULL
            `);

            LOG.success('[Board Meetings] Database tables initialized');
            this.initialized = true;
        } catch (error) {
            LOG.error('[Board Meetings] Error initializing tables:', error.message);
            throw error;
        }
    }

    /**
     * Truncate board_meetings table
     */
    async truncateData() {
        const pool = db.getPool();
        if (!pool) {
            // Use in-memory storage
            const inMemoryDb = this.getInMemoryDb();
            inMemoryDb.length = 0;
            LOG.info('[Board Meetings] Board meetings data truncated in memory');
            return;
        }

        try {
            await pool.query('TRUNCATE TABLE board_meetings');
            LOG.info('[Board Meetings] Board meetings table truncated');
        } catch (error) {
            LOG.error('[Board Meetings] Error truncating data:', error.message);
            throw error;
        }
    }

    /**
     * Insert board meetings data
     * @param {Array} meetingsData - Array of board meeting objects
     * @returns {Promise<number>} Number of records inserted
     */
    async insertData(meetingsData) {
        if (!meetingsData || meetingsData.length === 0) {
            LOG.warning('[Board Meetings] No data to insert');
            return 0;
        }

        const pool = db.getPool();
        if (!pool) {
            const inMemoryDb = this.getInMemoryDb();
            inMemoryDb.length = 0;
            const capped = capByDate(meetingsData, 'meeting_date', BOARD_CAP);
            for (let i = 0; i < capped.length; i += 1) {
                const meeting = capped[i];
                meeting.id = i + 1;
                inMemoryDb.push(meeting);
            }
            if (meetingsData.length > capped.length) {
                LOG.info(`[Board Meetings] Capped in-memory rows ${meetingsData.length} -> ${capped.length}`);
            }
            LOG.success(`[Board Meetings] Inserted ${capped.length} records in memory`);
            return capped.length;
        }
        try {
            const values = meetingsData.map(meeting => [
                meeting.symbol || null,
                meeting.company_name || null,
                meeting.series || null,
                meeting.purpose || null,
                meeting.meeting_date || null,
                meeting.meeting_time || null,
                meeting.venue || null
            ]);

            const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
            const query = `
                INSERT INTO board_meetings 
                (symbol, company_name, series, purpose, meeting_date, meeting_time, venue)
                VALUES ${placeholders}
            `;

            const flatValues = values.flat();
            const [result] = await pool.query(query, flatValues);

            LOG.success(`[Board Meetings] Inserted ${result.affectedRows} records`);
            return result.affectedRows;
        } catch (error) {
            LOG.error('[Board Meetings] Error inserting data:', error.message);
            throw error;
        }
    }

    /**
     * Get all board meetings
     * @param {Object} options - Query options (limit, offset, filters)
     * @returns {Promise<Array>} Array of board meetings
     */
    async getAllMeetings(options = {}) {
        const { limit, offset = 0, symbol, meetingDateFrom, meetingDateTo } = options;

        const pool = db.getPool();
        if (!pool) {
            // Use in-memory storage
            const inMemoryDb = this.getInMemoryDb();
            let filtered = inMemoryDb;

            if (symbol) {
                filtered = inMemoryDb.filter(m => m.symbol === symbol.toUpperCase());
            }
            if (meetingDateFrom) {
                filtered = filtered.filter(m => m.meeting_date && new Date(m.meeting_date) >= new Date(meetingDateFrom));
            }
            if (meetingDateTo) {
                filtered = filtered.filter(m => m.meeting_date && new Date(m.meeting_date) <= new Date(meetingDateTo));
            }

            filtered = filtered.filter((m) => !isHeaderLikeMeeting(m));
            if (limit) {
                return filtered.slice(offset, offset + limit);
            }

            return filtered;
        }
        try {
            let query = `SELECT * FROM board_meetings WHERE 1=1
                AND UPPER(TRIM(BOTH ' ,' FROM COALESCE(symbol,''))) NOT IN (
                    'ATTACHMENT','COMPANY NAME','DETAILS','PURPOSE','SYMBOL',
                    'BROADCAST DATE/TIME','BROADCAST DATE','BROADCAST DATE TIME'
                )
                AND UPPER(COALESCE(symbol,'')) NOT LIKE '%ATTACHMENT%'
                AND UPPER(COALESCE(symbol,'')) NOT LIKE '%BROADCAST%'`;
            const params = [];

            if (symbol) {
                query += ' AND symbol = ?';
                params.push(symbol.toUpperCase());
            }
            if (meetingDateFrom) {
                query += ' AND meeting_date >= ?';
                params.push(meetingDateFrom);
            }
            if (meetingDateTo) {
                query += ' AND meeting_date <= ?';
                params.push(meetingDateTo);
            }

            query += ' ORDER BY meeting_date DESC, symbol ASC';

            if (limit) {
                query += ' LIMIT ? OFFSET ?';
                params.push(limit, offset);
            }

            const [rows] = await pool.query(query, params);
            return rows;
        } catch (error) {
            LOG.error('[Board Meetings] Error getting meetings:', error.message);
            throw error;
        }
    }

    /**
     * Get board meetings by symbol
     * @param {string} symbol - Stock symbol
     * @returns {Promise<Array>} Array of board meetings for the symbol
     */
    async getMeetingsBySymbol(symbol) {
        return this.getAllMeetings({ symbol });
    }

    /**
     * Get count of board meetings
     * @returns {Promise<number>} Total count
     */
    async getCount() {
        const pool = db.getPool();
        if (!pool) {
            return this.getInMemoryDb().length;
        }
        try {
            const [rows] = await pool.query('SELECT COUNT(*) as count FROM board_meetings');
            return rows[0].count;
        } catch (error) {
            LOG.error('[Board Meetings] Error getting count:', error.message);
            return 0;
        }
    }
}

module.exports = new BoardMeetingsDataService();

