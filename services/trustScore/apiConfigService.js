/**
 * API Configuration Service
 * Manages API URLs, keys, and secrets for different development authorities
 * Stored in database instead of .env file
 */
const db = require('../../database');
const LOG = require('../../utils/logger');

class APIConfigService {
    /**
     * Initialize API configs table
     */
    async initializeTable() {
        const pool = db.getPool();
        if (pool) {
            try {
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS trust_score_api_configs (
                        id VARCHAR(50) PRIMARY KEY,
                        authority_name VARCHAR(100) NOT NULL,
                        authority_type ENUM('RERA', 'CIDCO', 'LAND_RECORDS', 'COURT_CASES', 'OTHER') NOT NULL,
                        base_url VARCHAR(500),
                        api_key VARCHAR(500),
                        api_secret VARCHAR(500),
                        auth_type ENUM('Bearer', 'API_Key', 'Basic', 'None') DEFAULT 'Bearer',
                        auth_header VARCHAR(100) DEFAULT 'Authorization',
                        is_enabled BOOLEAN DEFAULT TRUE,
                        use_api BOOLEAN DEFAULT TRUE,
                        description TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        INDEX idx_authority_type (authority_type),
                        INDEX idx_is_enabled (is_enabled)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                `);
                LOG.success('[API Config Service] Table initialized');
            } catch (error) {
                LOG.error('[API Config Service] Failed to initialize table:', error.message);
            }
        } else {
            // In-memory: Initialize array
            if (!db.trustScoreApiConfigs) {
                db.trustScoreApiConfigs = [];
            }
        }
    }

    /**
     * Get all API configurations
     */
    async getAllConfigs() {
        try {
            const pool = db.getPool();
            if (pool) {
                const [rows] = await pool.query(`
                    SELECT id, authority_name, authority_type, base_url, 
                           CASE WHEN api_key IS NOT NULL THEN CONCAT('***', RIGHT(api_key, 4)) ELSE NULL END as api_key_masked,
                           CASE WHEN api_secret IS NOT NULL THEN CONCAT('***', RIGHT(api_secret, 4)) ELSE NULL END as api_secret_masked,
                           auth_type, auth_header, is_enabled, use_api, description,
                           created_at, updated_at
                    FROM trust_score_api_configs
                    ORDER BY authority_type, authority_name
                `);
                return rows;
            } else {
                // In-memory: Return array with masked keys
                return (db.trustScoreApiConfigs || []).map(config => ({
                    ...config,
                    api_key: config.api_key ? `***${config.api_key.slice(-4)}` : null,
                    api_secret: config.api_secret ? `***${config.api_secret.slice(-4)}` : null
                }));
            }
        } catch (error) {
            LOG.error('[API Config Service] Error getting configs:', error);
            return [];
        }
    }

    /**
     * Get API configuration by ID (with full keys for internal use)
     */
    async getConfigById(id) {
        try {
            const pool = db.getPool();
            if (pool) {
                const [rows] = await pool.query(`
                    SELECT * FROM trust_score_api_configs WHERE id = ?
                `, [id]);
                return rows[0] || null;
            } else {
                // In-memory
                return (db.trustScoreApiConfigs || []).find(c => c.id === id) || null;
            }
        } catch (error) {
            LOG.error('[API Config Service] Error getting config:', error);
            return null;
        }
    }

    /**
     * Get API configuration by authority type (for service use)
     */
    async getConfigByType(authorityType) {
        try {
            const pool = db.getPool();
            if (pool) {
                const [rows] = await pool.query(`
                    SELECT * FROM trust_score_api_configs 
                    WHERE authority_type = ? AND is_enabled = TRUE
                    ORDER BY created_at DESC
                    LIMIT 1
                `, [authorityType]);
                return rows[0] || null;
            } else {
                // In-memory
                return (db.trustScoreApiConfigs || [])
                    .filter(c => c.authority_type === authorityType && c.is_enabled)
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
            }
        } catch (error) {
            LOG.error('[API Config Service] Error getting config by type:', error);
            return null;
        }
    }

    /**
     * Create new API configuration
     */
    async createConfig(configData) {
        try {
            const {
                id,
                authority_name,
                authority_type,
                base_url,
                api_key,
                api_secret,
                auth_type = 'Bearer',
                auth_header = 'Authorization',
                is_enabled = true,
                use_api = true,
                description = ''
            } = configData;

            if (!id || !authority_name || !authority_type) {
                throw new Error('id, authority_name, and authority_type are required');
            }

            const pool = db.getPool();
            if (pool) {
                await pool.query(`
                    INSERT INTO trust_score_api_configs 
                    (id, authority_name, authority_type, base_url, api_key, api_secret, 
                     auth_type, auth_header, is_enabled, use_api, description)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    id, authority_name, authority_type, base_url, api_key, api_secret,
                    auth_type, auth_header, is_enabled, use_api, description
                ]);
                LOG.success(`[API Config Service] Created config: ${id}`);
            } else {
                // In-memory
                if (!db.trustScoreApiConfigs) {
                    db.trustScoreApiConfigs = [];
                }
                db.trustScoreApiConfigs.push({
                    id,
                    authority_name,
                    authority_type,
                    base_url,
                    api_key,
                    api_secret,
                    auth_type,
                    auth_header,
                    is_enabled,
                    use_api,
                    description,
                    created_at: new Date(),
                    updated_at: new Date()
                });
                LOG.success(`[API Config Service] Created config: ${id}`);
            }

            return { success: true, id };
        } catch (error) {
            LOG.error('[API Config Service] Error creating config:', error);
            throw error;
        }
    }

    /**
     * Update API configuration
     */
    async updateConfig(id, configData) {
        try {
            const {
                authority_name,
                authority_type,
                base_url,
                api_key,
                api_secret,
                auth_type,
                auth_header,
                is_enabled,
                use_api,
                description
            } = configData;

            const pool = db.getPool();
            if (pool) {
                const updates = [];
                const values = [];

                if (authority_name !== undefined) {
                    updates.push('authority_name = ?');
                    values.push(authority_name);
                }
                if (authority_type !== undefined) {
                    updates.push('authority_type = ?');
                    values.push(authority_type);
                }
                if (base_url !== undefined) {
                    updates.push('base_url = ?');
                    values.push(base_url);
                }
                if (api_key !== undefined) {
                    updates.push('api_key = ?');
                    values.push(api_key);
                }
                if (api_secret !== undefined) {
                    updates.push('api_secret = ?');
                    values.push(api_secret);
                }
                if (auth_type !== undefined) {
                    updates.push('auth_type = ?');
                    values.push(auth_type);
                }
                if (auth_header !== undefined) {
                    updates.push('auth_header = ?');
                    values.push(auth_header);
                }
                if (is_enabled !== undefined) {
                    updates.push('is_enabled = ?');
                    values.push(is_enabled);
                }
                if (use_api !== undefined) {
                    updates.push('use_api = ?');
                    values.push(use_api);
                }
                if (description !== undefined) {
                    updates.push('description = ?');
                    values.push(description);
                }

                if (updates.length === 0) {
                    throw new Error('No fields to update');
                }

                values.push(id);
                await pool.query(`
                    UPDATE trust_score_api_configs 
                    SET ${updates.join(', ')}
                    WHERE id = ?
                `, values);

                LOG.success(`[API Config Service] Updated config: ${id}`);
            } else {
                // In-memory
                const index = (db.trustScoreApiConfigs || []).findIndex(c => c.id === id);
                if (index >= 0) {
                    db.trustScoreApiConfigs[index] = {
                        ...db.trustScoreApiConfigs[index],
                        ...configData,
                        updated_at: new Date()
                    };
                    LOG.success(`[API Config Service] Updated config: ${id}`);
                } else {
                    throw new Error('Config not found');
                }
            }

            return { success: true, id };
        } catch (error) {
            LOG.error('[API Config Service] Error updating config:', error);
            throw error;
        }
    }

    /**
     * Delete API configuration
     */
    async deleteConfig(id) {
        try {
            const pool = db.getPool();
            if (pool) {
                const [result] = await pool.query(`
                    DELETE FROM trust_score_api_configs WHERE id = ?
                `, [id]);
                
                if (result.affectedRows === 0) {
                    throw new Error('Config not found');
                }
                LOG.success(`[API Config Service] Deleted config: ${id}`);
            } else {
                // In-memory
                const index = (db.trustScoreApiConfigs || []).findIndex(c => c.id === id);
                if (index >= 0) {
                    db.trustScoreApiConfigs.splice(index, 1);
                    LOG.success(`[API Config Service] Deleted config: ${id}`);
                } else {
                    throw new Error('Config not found');
                }
            }

            return { success: true, id };
        } catch (error) {
            LOG.error('[API Config Service] Error deleting config:', error);
            throw error;
        }
    }

    /**
     * Toggle enable/disable
     */
    async toggleEnabled(id, isEnabled) {
        return await this.updateConfig(id, { is_enabled: isEnabled });
    }
}

// Initialize table on module load
const service = new APIConfigService();
if (db.getPool()) {
    service.initializeTable().catch(err => {
        LOG.error('[API Config Service] Failed to initialize:', err);
    });
}

module.exports = service;

