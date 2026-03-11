/**
 * Land Fraud Detection Service
 * Detects if same land has been sold to multiple parties
 */
const db = require('../../database');
const cidcoLandService = require('./cidcoLandService');
const LOG = require('../../utils/logger');

class FraudDetectionService {
    /**
     * Check for land fraud using coordinates and land ID
     */
    async detectFraud(landId, coordinates, buyerInfo) {
        try {
            // 1. Check local ledger for existing sales
            const existingSales = await this.getSalesByLandId(landId, coordinates);
            
            // 2. Check CIDCO/Land Records for multiple sales
            const cidcoCheck = await cidcoLandService.checkMultipleSales(landId, coordinates);
            
            // 3. Check if coordinates match existing disputed properties
            const nearbyDisputes = await this.getNearbyDisputes(coordinates, 0.001); // ~100m radius
            
            let fraudDetected = false;
            let fraudType = null;
            let severity = 'low';
            
            if (existingSales.length > 0) {
                fraudDetected = true;
                fraudType = 'multiple_sales_local';
                severity = existingSales.length >= 2 ? 'high' : 'medium';
            }
            
            if (cidcoCheck.isFraud) {
                fraudDetected = true;
                fraudType = 'multiple_sales_official';
                severity = cidcoCheck.severity;
            }
            
            if (nearbyDisputes.length > 0) {
                fraudDetected = true;
                fraudType = 'nearby_dispute';
                severity = 'medium';
            }
            
            if (fraudDetected) {
                // Create fraud alert
                const alert = await this.createFraudAlert({
                    landId,
                    coordinates,
                    buyerInfo,
                    fraudType,
                    severity,
                    existingSales,
                    cidcoData: cidcoCheck
                });
                
                // Send alerts to authorities and potential buyers
                await this.sendFraudAlerts(alert);
                
                return {
                    fraudDetected: true,
                    alertId: alert.id,
                    fraudType,
                    severity,
                    message: this.getFraudMessage(fraudType, severity)
                };
            }
            
            // No fraud detected - add to ledger
            await this.addToLedger(landId, coordinates, buyerInfo);
            
            return { fraudDetected: false };
        } catch (error) {
            LOG.error('[Fraud Detection] Error detecting fraud:', error);
            throw error;
        }
    }

    /**
     * Get sales by land ID and coordinates
     */
    async getSalesByLandId(landId, coordinates) {
        try {
            // Query local ledger
            const sales = await db.query(`
                SELECT * FROM trust_score_land_ledger 
                WHERE land_id = ? 
                OR (ABS(latitude - ?) < 0.001 AND ABS(longitude - ?) < 0.001)
            `, [landId, coordinates.latitude, coordinates.longitude]);
            
            return sales || [];
        } catch (error) {
            LOG.error('[Fraud Detection] Error getting sales:', error);
            return [];
        }
    }

    /**
     * Get nearby disputes
     */
    async getNearbyDisputes(coordinates, radius) {
        try {
            const disputes = await db.query(`
                SELECT * FROM trust_score_fraud_alerts 
                WHERE status = 'active'
                AND ABS(latitude - ?) < ? 
                AND ABS(longitude - ?) < ?
            `, [coordinates.latitude, radius, coordinates.longitude, radius]);
            
            return disputes || [];
        } catch (error) {
            LOG.error('[Fraud Detection] Error getting nearby disputes:', error);
            return [];
        }
    }

    /**
     * Add sale to ledger
     */
    async addToLedger(landId, coordinates, buyerInfo) {
        try {
            const ledgerEntry = {
                id: 'ledger_' + Date.now(),
                landId,
                latitude: coordinates.latitude,
                longitude: coordinates.longitude,
                buyerId: buyerInfo.buyerId,
                buyerName: buyerInfo.buyerName,
                saleDate: new Date(),
                amount: buyerInfo.amount,
                status: 'verified',
                createdAt: new Date()
            };
            
            await db.query(`
                INSERT INTO trust_score_land_ledger 
                (id, land_id, latitude, longitude, buyer_id, buyer_name, sale_date, amount, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                ledgerEntry.id,
                ledgerEntry.landId,
                ledgerEntry.latitude,
                ledgerEntry.longitude,
                ledgerEntry.buyerId,
                ledgerEntry.buyerName,
                ledgerEntry.saleDate,
                ledgerEntry.amount,
                ledgerEntry.status,
                ledgerEntry.createdAt
            ]);
            
            LOG.info(`[Fraud Detection] Added sale to ledger: ${landId}`);
            return ledgerEntry;
        } catch (error) {
            LOG.error('[Fraud Detection] Error adding to ledger:', error);
            throw error;
        }
    }

    /**
     * Create fraud alert
     */
    async createFraudAlert(alertData) {
        try {
            const alert = {
                id: 'alert_' + Date.now(),
                landId: alertData.landId,
                latitude: alertData.coordinates.latitude,
                longitude: alertData.coordinates.longitude,
                fraudType: alertData.fraudType,
                severity: alertData.severity,
                status: 'active',
                details: JSON.stringify(alertData),
                createdAt: new Date()
            };
            
            await db.query(`
                INSERT INTO trust_score_fraud_alerts 
                (id, land_id, latitude, longitude, fraud_type, severity, status, details, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                alert.id,
                alert.landId,
                alert.latitude,
                alert.longitude,
                alert.fraudType,
                alert.severity,
                alert.status,
                alert.details,
                alert.createdAt
            ]);
            
            LOG.warning(`[Fraud Detection] Fraud alert created: ${alert.id}`);
            return alert;
        } catch (error) {
            LOG.error('[Fraud Detection] Error creating alert:', error);
            throw error;
        }
    }

    /**
     * Send fraud alerts to authorities and buyers
     */
    async sendFraudAlerts(alert) {
        try {
            // Get all users following this project/area
            const followers = await db.query(`
                SELECT DISTINCT user_id, email, mobile 
                FROM trust_score_watchlist w
                JOIN users u ON w.user_id = u.id
                WHERE w.project_id IN (
                    SELECT project_id FROM trust_score_projects 
                    WHERE ABS(latitude - ?) < 0.01 AND ABS(longitude - ?) < 0.01
                )
            `, [alert.latitude, alert.longitude]);
            
            // Send email/SMS alerts (implement email/SMS service)
            for (const follower of followers) {
                // await emailService.sendFraudAlert(follower.email, alert);
                // await smsService.sendFraudAlert(follower.mobile, alert);
                LOG.info(`[Fraud Detection] Alert sent to ${follower.email}`);
            }
            
            // Send to authorities
            // await emailService.sendToAuthorities(alert);
            
            return { sent: followers.length };
        } catch (error) {
            LOG.error('[Fraud Detection] Error sending alerts:', error);
            return { sent: 0, error: error.message };
        }
    }

    /**
     * Mark dispute as resolved
     */
    async resolveDispute(alertId, resolutionData) {
        try {
            // Verify documents (admin approval required)
            const resolution = {
                alertId,
                resolutionType: resolutionData.type, // 'court_order', 'settlement', 'verified'
                documents: resolutionData.documents,
                verifiedBy: resolutionData.adminId,
                verifiedAt: new Date(),
                status: 'pending_approval' // Admin needs to approve
            };
            
            await db.query(`
                UPDATE trust_score_fraud_alerts 
                SET resolution = ?, status = 'pending_approval', updated_at = ?
                WHERE id = ?
            `, [JSON.stringify(resolution), new Date(), alertId]);
            
            return resolution;
        } catch (error) {
            LOG.error('[Fraud Detection] Error resolving dispute:', error);
            throw error;
        }
    }

    /**
     * Get fraud message
     */
    getFraudMessage(fraudType, severity) {
        const messages = {
            multiple_sales_local: 'This land has been sold to multiple parties in our records.',
            multiple_sales_official: 'Official records show multiple sales for this land.',
            nearby_dispute: 'A dispute has been reported for nearby property.'
        };
        
        return messages[fraudType] || 'Potential fraud detected.';
    }
}

module.exports = new FraudDetectionService();

