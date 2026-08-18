/**
 * Matchmaking feature DB — in-memory first, MySQL when DB_TYPE=mysql.
 * Connected from backend/database.js via dbContext.
 */
module.exports = function createMatchmakingFeature(ctx) {
    const getPool = () => ctx.getPool();
    const LOG = ctx.LOG;
    const mem = () => ctx.inMemoryDb;

    return {
        feature: 'matchmaking',
        getMatchmakingPresets: async () => ctx.deepClone(ctx.MATCHMAKING_PRESETS),

        getVendorMatchmakingTemplate: async (vendorId) => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    await ctx.ensureMatchmakingTables();
                    const [rows] = await getPool().query(
                        'SELECT * FROM matchmaking_templates WHERE vendor_id = ? LIMIT 1',
                        [vendorId]
                    );
                    if (rows && rows.length) {
                        const row = rows[0];
                        return {
                            vendor_id: row.vendor_id,
                            template_name: row.template_name,
                            selected_preset: row.selected_preset,
                            questions: JSON.parse(row.template_json || '[]'),
                            scoring: JSON.parse(row.scoring_json || '{"pass":50,"good":70,"best":90}'),
                            is_active: row.is_active !== 0
                        };
                    }
                }
            } catch (err) {
                LOG.error(`MySQL getVendorMatchmakingTemplate failed for ${vendorId}, falling back to local`, err.message);
            }
            return inMemoryDb.matchmaking_templates.find((x) => x.vendor_id === vendorId) || null;
        },

        saveVendorMatchmakingTemplate: async (vendorId, payload) => {
            const inMemoryDb = mem();
            const normalized = ctx.normalizeTemplate(payload || {});
            const finalTemplate = {
                vendor_id: vendorId,
                template_name: normalized.template_name,
                selected_preset: normalized.selected_preset,
                questions: normalized.questions,
                scoring: normalized.scoring,
                is_active: payload?.is_active !== false
            };
            try {
                if (getPool()) {
                    await ctx.ensureMatchmakingTables();
                    await getPool().query(
                        `INSERT INTO matchmaking_templates (vendor_id, template_name, selected_preset, template_json, scoring_json, is_active)
                         VALUES (?, ?, ?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE
                         template_name = VALUES(template_name),
                         selected_preset = VALUES(selected_preset),
                         template_json = VALUES(template_json),
                         scoring_json = VALUES(scoring_json),
                         is_active = VALUES(is_active)`,
                        [
                            vendorId,
                            finalTemplate.template_name,
                            finalTemplate.selected_preset,
                            JSON.stringify(finalTemplate.questions || []),
                            JSON.stringify(finalTemplate.scoring || { pass: 50, good: 70, best: 90 }),
                            finalTemplate.is_active ? 1 : 0
                        ]
                    );
                    return finalTemplate;
                }
            } catch (err) {
                LOG.error(`MySQL saveVendorMatchmakingTemplate failed for ${vendorId}, falling back to local`, err.message);
            }
            const idx = inMemoryDb.matchmaking_templates.findIndex((x) => x.vendor_id === vendorId);
            if (idx >= 0) inMemoryDb.matchmaking_templates[idx] = finalTemplate;
            else inMemoryDb.matchmaking_templates.push(finalTemplate);
            return finalTemplate;
        },

        submitMatchmakingAnswers: async ({ vendor_id, user_id, answers, user_name }) => {
            const inMemoryDb = mem();
            const db = ctx.db;
            const tpl = await db.getVendorMatchmakingTemplate(vendor_id);
            if (!tpl || tpl.is_active === false || !Array.isArray(tpl.questions) || !tpl.questions.length) {
                throw new Error('Matchmaking template not configured for this vendor');
            }

            const computed = ctx.calculateMatchmakingScore(tpl, answers || {});
            const allSubs = await db.getVendorMatchmakingResults(vendor_id, { includeInsights: false });
            const insight = ctx.buildAiInsight({
                score: computed.totalScore,
                percentage: computed.percentage,
                band: computed.band,
                tags: computed.tags,
                currentUserId: user_id,
                allSubmissions: allSubs
            });

            const payload = {
                vendor_id,
                user_id,
                user_name: user_name || '',
                answers: answers || {},
                score: computed.totalScore,
                percentage: computed.percentage,
                band: computed.band,
                tags: computed.tags,
                insight
            };

            try {
                if (getPool()) {
                    await ctx.ensureMatchmakingTables();
                    await getPool().query(
                        `INSERT INTO matchmaking_submissions (vendor_id, user_id, answers_json, score, percentage, band, tags_json, insight_json)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE
                         answers_json = VALUES(answers_json),
                         score = VALUES(score),
                         percentage = VALUES(percentage),
                         band = VALUES(band),
                         tags_json = VALUES(tags_json),
                         insight_json = VALUES(insight_json)`,
                        [
                            payload.vendor_id,
                            payload.user_id,
                            JSON.stringify(payload.answers || {}),
                            payload.score,
                            payload.percentage,
                            payload.band,
                            JSON.stringify(payload.tags || []),
                            JSON.stringify(payload.insight || {})
                        ]
                    );
                    return payload;
                }
            } catch (err) {
                LOG.error(`MySQL submitMatchmakingAnswers failed for vendor ${vendor_id}, falling back to local`, err.message);
            }

            const idx = inMemoryDb.matchmaking_submissions.findIndex((x) => x.vendor_id === vendor_id && x.user_id === user_id);
            if (idx >= 0) inMemoryDb.matchmaking_submissions[idx] = payload;
            else inMemoryDb.matchmaking_submissions.push(payload);
            return payload;
        },

        getUserMatchmakingSubmissions: async (userId) => {
            const inMemoryDb = mem();
            try {
                if (getPool()) {
                    await ctx.ensureMatchmakingTables();
                    const [rows] = await getPool().query(
                        `SELECT s.*, v.shop_name
                         FROM matchmaking_submissions s
                         LEFT JOIN vendors v ON v.id = s.vendor_id
                         WHERE s.user_id = ?
                         ORDER BY s.updated_at DESC`,
                        [userId]
                    );
                    return (rows || []).map((r) => ({
                        id: r.id,
                        vendor_id: r.vendor_id,
                        shop_name: r.shop_name || 'Vendor',
                        user_id: r.user_id,
                        answers: JSON.parse(r.answers_json || '{}'),
                        score: Number(r.score || 0),
                        percentage: Number(r.percentage || 0),
                        band: r.band || 'needs_improvement',
                        tags: JSON.parse(r.tags_json || '[]'),
                        insight: JSON.parse(r.insight_json || '{}'),
                    }));
                }
            } catch (err) {
                LOG.error(`MySQL getUserMatchmakingSubmissions failed for ${userId}, falling back to local`, err.message);
            }

            return inMemoryDb.matchmaking_submissions
                .filter((s) => s.user_id === userId)
                .map((s, index) => ({
                    id: index + 1,
                    ...s,
                    shop_name: inMemoryDb.vendors.find((v) => v.id === s.vendor_id)?.shop_name || 'Vendor'
                }));
        },

        getVendorMatchmakingResults: async (vendorId, options = {}) => {
            const inMemoryDb = mem();
            const includeInsights = options?.includeInsights !== false;
            try {
                if (getPool()) {
                    await ctx.ensureMatchmakingTables();
                    const [rows] = await getPool().query(
                        `SELECT s.*, u.name as user_name, u.mobile as user_mobile
                         FROM matchmaking_submissions s
                         LEFT JOIN users u ON u.id = s.user_id
                         WHERE s.vendor_id = ?
                         ORDER BY s.percentage DESC, s.updated_at DESC`,
                        [vendorId]
                    );
                    return (rows || []).map((r) => ({
                        id: r.id,
                        vendor_id: r.vendor_id,
                        user_id: r.user_id,
                        user_name: r.user_name || 'User',
                        user_mobile: r.user_mobile || '',
                        answers: JSON.parse(r.answers_json || '{}'),
                        score: Number(r.score || 0),
                        percentage: Number(r.percentage || 0),
                        band: r.band || 'needs_improvement',
                        tags: JSON.parse(r.tags_json || '[]'),
                        insight: includeInsights ? JSON.parse(r.insight_json || '{}') : {}
                    }));
                }
            } catch (err) {
                LOG.error(`MySQL getVendorMatchmakingResults failed for ${vendorId}, falling back to local`, err.message);
            }

            return inMemoryDb.matchmaking_submissions
                .filter((s) => s.vendor_id === vendorId)
                .map((s, index) => {
                    const user = inMemoryDb.users.find((u) => u.id === s.user_id) || {};
                    return {
                        id: index + 1,
                        ...s,
                        user_name: user.name || s.user_name || 'User',
                        user_mobile: user.mobile || ''
                    };
                })
                .sort((a, b) => (b.percentage || 0) - (a.percentage || 0));
        },
    };
};
