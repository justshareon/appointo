/**
 * Report Controller
 * Handles fraud complaint filing
 */
const i4cService = require('../../services/suraksha/i4cService');
const LOG = require('../../utils/logger');

class ReportController {
    /**
     * Save a fraud complaint (draft/saved)
     * POST /api/suraksha/report
     */
    async fileComplaint(req, res) {
        try {
            const userId = req.user?.id || req.body.userId || req.userId;
            
            if (!userId) {
                return res.status(401).json({ 
                    success: false,
                    error: 'User authentication required' 
                });
            }
            
            const {
                input,
                type,
                amount,
                description,
                beneficiary,
                transactionDate,
                evidence
            } = req.body;
            
            if (!input || !type) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Input and type are required' 
                });
            }
            
            // Save complaint to database first (draft status)
            const reportId = await this._saveReport(userId, null, {
                input,
                type,
                amount: amount || 0,
                description: description || 'Fraud complaint filed via Suraksha app',
                beneficiary: beneficiary || input,
                transactionDate: transactionDate || new Date().toISOString(),
                evidence: evidence || {},
                status: 'saved', // saved, sent, sent_with_reminder
                govtSent: false,
                govtComplaintId: null,
                reminderCount: 0,
                lastReminderAt: null
            });
            
            // Get the saved report
            const db = require('../../database');
            const savedReport = db.surakshaReports?.find(r => r.id === reportId);
            
            res.json({
                success: true,
                message: 'Complaint saved successfully. You can now send it to government.',
                reportId,
                report: savedReport,
                status: 'saved'
            });
        } catch (error) {
            LOG.error('[Report Controller] Error:', error);
            res.status(500).json({ 
                error: 'Failed to save complaint',
                message: error.message 
            });
        }
    }

    /**
     * Send complaint to government API
     * POST /api/suraksha/report/:reportId/send
     */
    async sendToGovernment(req, res) {
        try {
            const userId = req.user?.id || req.userId;
            const { reportId } = req.params;
            
            const db = require('../../database');
            const report = db.surakshaReports?.find(r => r.id === reportId && r.user_id === userId);
            
            if (!report) {
                return res.status(404).json({ 
                    error: 'Report not found' 
                });
            }
            
            // Prepare complaint data for I4C
            const complaintData = {
                userId,
                input: report.input,
                type: report.type,
                amount: report.amount,
                description: report.description,
                beneficiary: report.beneficiary,
                transactionDate: report.transaction_date,
                evidence: report.evidence || {}
            };
            
            // Send to I4C API
            const result = await i4cService.fileComplaint(complaintData);
            
            if (result.success) {
                // Update report status
                report.govtSent = true;
                report.govtComplaintId = result.complaintId;
                report.status = 'sent';
                report.sentAt = new Date();
                report.updated_at = new Date();
                
                // Emit notification via WebSocket
                if (req.io && req.userRoom) {
                    req.io.to(req.userRoom).emit('complaint_sent', {
                        reportId: report.id,
                        complaintId: result.complaintId,
                        status: result.status,
                        message: result.message,
                        timestamp: new Date().toISOString()
                    });
                }
                
                res.json({
                    success: true,
                    message: 'Complaint sent to government successfully',
                    complaintId: result.complaintId,
                    report: report
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: 'Failed to send to government',
                    message: result.error || 'Unknown error'
                });
            }
        } catch (error) {
            LOG.error('[Report Controller] Send error:', error);
            res.status(500).json({ 
                error: 'Failed to send complaint',
                message: error.message 
            });
        }
    }

    /**
     * Send reminder to government
     * POST /api/suraksha/report/:reportId/reminder
     */
    async sendReminder(req, res) {
        try {
            const userId = req.user?.id || req.userId;
            const { reportId } = req.params;
            
            const db = require('../../database');
            const report = db.surakshaReports?.find(r => r.id === reportId && r.user_id === userId);
            
            if (!report) {
                return res.status(404).json({ 
                    error: 'Report not found' 
                });
            }
            
            if (!report.govtSent) {
                return res.status(400).json({ 
                    error: 'Complaint must be sent to government first' 
                });
            }
            
            // Send reminder via I4C (if they support reminders)
            // For now, we'll just update the reminder count
            report.reminderCount = (report.reminderCount || 0) + 1;
            report.lastReminderAt = new Date();
            report.status = 'sent_with_reminder';
            report.updated_at = new Date();
            
            res.json({
                success: true,
                message: `Reminder sent (${report.reminderCount} time${report.reminderCount > 1 ? 's' : ''})`,
                reminderCount: report.reminderCount,
                report: report
            });
        } catch (error) {
            LOG.error('[Report Controller] Reminder error:', error);
            res.status(500).json({ 
                error: 'Failed to send reminder',
                message: error.message 
            });
        }
    }

    /**
     * Get reported fraud cases
     * GET /api/suraksha/reports
     */
    async getReports(req, res) {
        try {
            const db = require('../../database');
            const userId = req.user?.id || req.userId;
            const limit = parseInt(req.query.limit) || 50;

            const users = typeof db.getUsers === 'function' ? await db.getUsers() : [];
            const nameById = {};
            (users || []).forEach((u) => { nameById[String(u.id)] = u.name; });

            if (db.surakshaReports) {
                const reports = [...db.surakshaReports]
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                    .slice(0, limit)
                    .map((r) => ({
                        ...r,
                        reporter_name: nameById[String(r.user_id)] || r.user_id,
                        is_mine: r.user_id === userId,
                    }));

                return res.json({
                    success: true,
                    count: reports.length,
                    reports
                });
            }
            
            res.json({
                success: true,
                count: 0,
                reports: []
            });
        } catch (error) {
            LOG.error('[Report Controller] Get reports error:', error);
            res.status(500).json({ 
                error: 'Failed to fetch reports',
                message: error.message 
            });
        }
    }

    /**
     * Save report to database (both in-memory and MySQL)
     * @private
     */
    async _saveReport(userId, complaintId, data) {
        const db = require('../../database');
        if (!db.surakshaReports) {
            db.surakshaReports = [];
        }
        
        const reportId = `report_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const report = {
            id: reportId,
            user_id: userId,
            complaint_id: complaintId,
            input: data.input,
            type: data.type,
            amount: data.amount || 0,
            beneficiary: data.beneficiary || data.input,
            description: data.description,
            transaction_date: data.transactionDate,
            evidence: data.evidence || {},
            status: data.status || 'saved',
            govt_sent: data.govtSent || false,
            govt_complaint_id: data.govtComplaintId || null,
            reminder_count: data.reminderCount || 0,
            last_reminder_at: data.lastReminderAt || null,
            sent_at: data.sentAt || null,
            created_at: new Date(),
            updated_at: new Date()
        };
        
        // Save to in-memory database
        db.surakshaReports.push(report);
        
        // Save to MySQL if available
        if (db.mysql && db.mysql.connection) {
            try {
                await db.mysql.query(
                    `INSERT INTO suraksha_reports 
                    (id, user_id, complaint_id, input, type, amount, beneficiary, description, transaction_date, evidence, status, govt_sent, govt_complaint_id, reminder_count, last_reminder_at, sent_at, created_at, updated_at) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        report.id,
                        report.user_id,
                        report.complaint_id,
                        report.input,
                        report.type,
                        report.amount,
                        report.beneficiary,
                        report.description,
                        report.transaction_date,
                        JSON.stringify(report.evidence),
                        report.status,
                        report.govt_sent ? 1 : 0,
                        report.govt_complaint_id,
                        report.reminder_count,
                        report.last_reminder_at,
                        report.sent_at,
                        report.created_at,
                        report.updated_at
                    ]
                );
                LOG.info(`[Report Controller] Saved report ${reportId} to MySQL`);
            } catch (mysqlError) {
                LOG.warning(`[Report Controller] Failed to save to MySQL: ${mysqlError.message}`);
                // Continue even if MySQL save fails
            }
        }
        
        return reportId;
    }
}

module.exports = new ReportController();

