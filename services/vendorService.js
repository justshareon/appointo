const db = require('../database');
const jwt = require('jsonwebtoken');
const LOG = require('../utils/logger');

/**
 * Vendor Service
 * Handles vendor-related business logic
 */
class VendorService {
    /**
     * Get all vendors with optional filtering
     */
    async getVendors(req) {
        const includeTradeOffer = req.query.include_trade_offer === 'true';
        const includeCyber = req.query.include_cyber === 'true';
        const includeTrustScore = req.query.include_trust_score === 'true';
        LOG.info(`[API /vendors] Request received - include_trade_offer: ${includeTradeOffer}, include_cyber: ${includeCyber}, include_trust_score: ${includeTrustScore}`);

        const vendors = await db.getVendors(true, 1, 1000, 'newest', '', includeTradeOffer || includeCyber || includeTrustScore);
        LOG.info(`[API /vendors] Returning ${vendors.length} vendors`);

        // Debug logging
        const offerVendors = vendors.filter(v => v.features_offer === true || v.features_offer === 1 || v.features_offer === '1');
        const tradeVendors = vendors.filter(v => v.features_trade === true || v.features_trade === 1 || v.features_trade === '1');
        const qlessVendors = vendors.filter(v => v.features_qless === true || v.features_qless === 1 || v.features_qless === '1');
        const fleetVendors = vendors.filter(v => v.features_fleet === true || v.features_fleet === 1 || v.features_fleet === '1');
        const realestateVendors = vendors.filter(v => v.features_realestate === true || v.features_realestate === 1 || v.features_realestate === '1');
        const cyberVendors = vendors.filter(v => v.features_cyber === true || v.features_cyber === 1 || v.features_cyber === '1');
        const trustScoreVendors = vendors.filter(v => v.features_trust_score === true || v.features_trust_score === 1 || v.features_trust_score === '1');
        const regularVendors = vendors.filter(v => 
            (v.features_offer !== true && v.features_offer !== 1 && v.features_offer !== '1') && 
            (v.features_trade !== true && v.features_trade !== 1 && v.features_trade !== '1') &&
            (v.features_qless !== true && v.features_qless !== 1 && v.features_qless !== '1') &&
            (v.features_fleet !== true && v.features_fleet !== 1 && v.features_fleet !== '1') &&
            (v.features_realestate !== true && v.features_realestate !== 1 && v.features_realestate !== '1') &&
            (v.features_cyber !== true && v.features_cyber !== 1 && v.features_cyber !== '1') &&
            (v.features_trust_score !== true && v.features_trust_score !== 1 && v.features_trust_score !== '1')
        );

        LOG.info(`[API /vendors] Vendor breakdown: ${regularVendors.length} regular, ${offerVendors.length} offer, ${tradeVendors.length} trade, ${qlessVendors.length} qless, ${fleetVendors.length} fleet, ${realestateVendors.length} realestate, ${cyberVendors.length} cyber, ${trustScoreVendors.length} trust_score`);
        if (qlessVendors.length > 0) {
            LOG.info(`[API /vendors] QLess vendors:`, qlessVendors.map(v => ({ id: v.id, shop_name: v.shop_name, features_qless: v.features_qless })));
        }
        if (fleetVendors.length > 0) {
            LOG.info(`[API /vendors] Fleet vendors:`, fleetVendors.map(v => ({ id: v.id, shop_name: v.shop_name, features_fleet: v.features_fleet })));
        }
        if (realestateVendors.length > 0) {
            LOG.info(`[API /vendors] Realestate vendors:`, realestateVendors.map(v => ({ id: v.id, shop_name: v.shop_name, features_realestate: v.features_realestate })));
        }
        if (trustScoreVendors.length > 0) {
            LOG.info(`[API /vendors] Trust Score vendors:`, trustScoreVendors.map(v => ({ id: v.id, shop_name: v.shop_name, features_trust_score: v.features_trust_score, owner_id: v.owner_id })));
        }

        // If user is logged in, mark which queues they've joined
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        let userId = null;
        if (token) {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
                userId = decoded.id;
            } catch (e) {}
        }

        if (userId) {
            const history = await db.getUserHistory(userId);
            const activeQueueVendorIds = history
                .filter(h => h.status === 'waiting')
                .map(h => h.vendor_id);

            return vendors.map(v => ({
                ...v,
                is_joined: activeQueueVendorIds.includes(v.id)
            }));
        }

        return vendors;
    }

    /**
     * Get vendor profile for logged-in user
     * Supports pattern matching for service-based vendors (offer, trade, qless, fleet, realestate)
     */
    async getMyVendorProfile(userId, userEmail) {
        LOG.info(`[API /vendors/me] Request from user: ${userEmail || 'NO_EMAIL'} (id: ${userId})`);

        // First, try to find vendor by owner_id (normal case)
        let vendor = await db.getVendorByOwnerId(userId);
        LOG.info(`[API /vendors/me] Vendor by owner_id: ${vendor ? vendor.id : 'NOT FOUND'}`);

        // If not found, try pattern matching for service-based vendors
        if (!vendor && userId) {
            vendor = await this._findVendorByPattern(userId, userEmail);
        }

        if (vendor) {
            LOG.info(`[API /vendors/me] Returning vendor: ${vendor.id} - ${vendor.shop_name}`);
        } else {
            LOG.warning(`[API /vendors/me] No vendor found for user ${userEmail || userId}, returning empty object`);
        }

        return vendor || {};
    }

    /**
     * Find vendor by user ID or email pattern
     * Supports: offer, trade, qless, fleet, realestate
     */
    async _findVendorByPattern(userId, userEmail) {
        // Try user ID pattern matching
        // Handles: usr_qlessuser1, usr_qlessvendor1, qlessuser1, qlessvendor1, etc.
        if (userId) {
            LOG.info(`[API /vendors/me] Attempting user ID pattern match for: ${userId}`);
            // Pattern 1: usr_qlessuser1, usr_qlessvendor1, usr_offer1, usr_cyber1, etc.
            let userIdMatch = userId.match(/(?:usr_)?(offer|trade|qless|fleet|realestate|real|cyber)(?:user|vendor)?(\d+)/);
            if (!userIdMatch) {
                // Pattern 2: qless1, offer1, cyber1, etc. (direct service + number)
                userIdMatch = userId.match(/(offer|trade|qless|fleet|realestate|real|cyber)(\d+)/);
            }

            if (userIdMatch) {
                const serviceName = userIdMatch[1] === 'real' ? 'realestate' : userIdMatch[1];
                const vendorId = `v_${serviceName}${userIdMatch[2]}`;
                LOG.info(`[API /vendors/me] Pattern matched: ${userId} -> looking for vendor ${vendorId}`);

                let vendor = await db.getVendorById(vendorId);
                if (vendor) {
                    LOG.info(`[API /vendors/me] ✓ Found vendor ${vendor.id} (${vendor.shop_name}) by direct lookup`);
                    return vendor;
                }

                // Fallback: search in all vendors
                const allVendors = await db.getVendors(true, 1, 1000, 'newest', '', true);
                vendor = allVendors.find(v => v.id === vendorId);
                if (vendor) {
                    LOG.info(`[API /vendors/me] ✓ Found vendor ${vendor.id} (${vendor.shop_name}) by user ID pattern`);
                    return vendor;
                }
            } else {
                LOG.warning(`[API /vendors/me] Pattern match failed for userId: ${userId}`);
            }
        }

        // Try email pattern matching
        // Handles: qlessuser1@test.com, qlessvendor1@test.com, offer1@test.com, etc.
        if (userEmail) {
            const email = userEmail.toLowerCase();
            LOG.info(`[API /vendors/me] User email: ${email}, checking for service pattern...`);

            if (email.includes('offer') || email.includes('trade') || email.includes('qless') || 
                email.includes('fleet') || email.includes('real') || email.includes('cyber')) {
                const allVendors = await db.getVendors(true, 1, 1000, 'newest', '', true);
                // Pattern: qlessuser1, qlessvendor1, offer1, cyber1, etc.
                const emailMatch = email.match(/(offer|trade|qless|fleet|realestate|real|cyber)(?:user|vendor)?(\d+)/);
                
                if (emailMatch) {
                    const serviceName = emailMatch[1] === 'real' ? 'realestate' : emailMatch[1];
                    const vendorId = `v_${serviceName}${emailMatch[2]}`;
                    LOG.info(`[API /vendors/me] Email pattern matched: ${email} -> looking for vendor ${vendorId}`);
                    const vendor = allVendors.find(v => v.id === vendorId);
                    
                    if (vendor) {
                        LOG.info(`[API /vendors/me] ✓ Found associated vendor ${vendor.id} (${vendor.shop_name}) for service user ${userEmail}`);
                        return vendor;
                    } else {
                        LOG.warning(`[API /vendors/me] Vendor ${vendorId} not found in vendor list`);
                    }
                } else {
                    LOG.warning(`[API /vendors/me] Email pattern match failed for: ${email}`);
                }
            }
        }

        return null;
    }

    /**
     * Create vendor shop for user
     */
    async createMyShop(userId, shopData) {
        const user = await db.getUserById(userId);
        if (!user) {
            throw new Error('User not found. Please login again.');
        }

        const existing = await db.getVendorByOwnerId(userId);
        if (existing) {
            return { success: true, vendor: existing, created: false };
        }

        const shopName = shopData.shop_name || `${user?.name || 'My'} Shop`;
        const vendor = {
            id: 'v_' + Math.random().toString(36).substring(2, 10),
            owner_id: userId,
            shop_name: shopName,
            category: shopData.category || 'General',
            is_active: true,
            is_promoted: false,
            latitude: 0,
            longitude: 0,
            features_matchmaking: false
        };
        await db.addVendor(vendor);
        LOG.success(`Vendor profile created for user ${userId}`);
        return { success: true, vendor, created: true };
    }

    /**
     * Update vendor profile
     */
    async updateMyProfile(userId, profileData) {
        const vendor = await db.getVendorByOwnerId(userId);
        if (!vendor) {
            throw new Error('Vendor profile not found');
        }

        const allowedFields = [
            'shop_name', 'category', 'google_link', 'instagram_handle', 'facebook_link',
            'features_products', 'features_payments', 'features_appointments', 'features_queue',
            'features_matchmaking', 'features_trade', 'features_offer', 'features_qless',
            'features_fleet', 'features_realestate', 'features_cyber', 'features_trust_score',
            'gateway_razorpay', 'gateway_sabpaisa',
            'visibility_top_rated', 'visibility_list', 'visibility_feed'
        ];

        for (const field of allowedFields) {
            if (Object.prototype.hasOwnProperty.call(profileData, field)) {
                await db.updateVendor(vendor.id, field, profileData[field]);
            }
        }

        const updated = await db.getVendorByOwnerId(userId);
        return { success: true, vendor: updated };
    }

    /**
     * Get vendor by ID
     */
    async getVendorById(vendorId) {
        const vendor = await db.getVendorById(vendorId);
        if (!vendor) {
            throw new Error("Vendor not found");
        }
        return vendor;
    }

    /**
     * Get vendor queue
     */
    async getVendorQueue(vendorId) {
        return await db.getQueueByVendor(vendorId);
    }

    /**
     * Get vendor products
     */
    async getVendorProducts(vendorId) {
        const vendor = await db.getVendorById(vendorId);
        if (!vendor || vendor.features_products === false) {
            return [];
        }
        return await db.getProductsByVendor(vendorId) || [];
    }

    /**
     * Get my products (for logged-in vendor)
     */
    async getMyProducts(userId) {
        const vendor = await db.getVendorByOwnerId(userId);
        if (!vendor) return [];
        return await db.getProductsByVendor(vendor.id) || [];
    }

    /**
     * Get my appointments (for logged-in vendor)
     */
    async getMyAppointments(userId) {
        const vendor = await db.getVendorByOwnerId(userId);
        if (!vendor) return [];

        // Return appointments for ALL vendors owned by this user
        const ownedVendors = await db.getVendors(false);
        const myVendorIds = ownedVendors.filter(v => v.owner_id === userId).map(v => v.id);

        let allAppointments = [];
        for (const vId of myVendorIds) {
            const apps = await db.getAppointmentsByVendor(vId);
            allAppointments = [...allAppointments, ...apps];
        }

        return allAppointments || [];
    }
}

module.exports = new VendorService();

