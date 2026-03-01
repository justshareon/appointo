const jwt = require('jsonwebtoken');
const db = require('../database');
const otpService = require('../otpService');
const LOG = require('../utils/logger');

/**
 * Authentication Service
 * Handles OTP generation, verification, user registration, and profile updates
 */
class AuthService {
    /**
     * Send OTP to user's mobile or email
     */
    async sendOTP(mobile, email) {
        // Normalize inputs
        if (mobile === undefined || mobile === null || mobile === '') {
            mobile = undefined;
        }
        if (email === undefined || email === null || email === '') {
            email = undefined;
        }

        LOG.info(`[send-otp] Received request - email: ${email || 'none'}, mobile: ${mobile || 'none'}`);

        // Support email login - lookup mobile from email
        if (email && email.trim && email.trim().length > 0) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email.trim())) {
                LOG.warning(`[send-otp] Invalid email format: ${email}`);
                throw new Error("Please enter a valid email address.");
            }

            const user = await db.getUserByEmail(email.trim().toLowerCase());
            if (!user) {
                LOG.warning(`[send-otp] Email not found: ${email}`);
                throw new Error("No account found with this email. Please register first or use mobile number.");
            }
            if (!user.mobile || user.mobile.toString().trim().length === 0) {
                LOG.warning(`[send-otp] User found but no mobile: ${email}`);
                throw new Error("This account doesn't have a mobile number. Please use mobile number login or contact support.");
            }
            mobile = user.mobile;
            LOG.info(`[send-otp] Email login: ${email} mapped to mobile ${mobile}`);
        }

        if (!mobile) {
            throw new Error("Mobile number or email is required");
        }

        // Normalize mobile
        const cleanMobile = mobile.toString().replace(/\D/g, '').slice(-10);
        if (cleanMobile.length < 10) {
            throw new Error("Invalid mobile number. Please enter a valid 10-digit mobile number or use email login.");
        }

        const isConsoleMode = (process.env.OTP_DELIVERY_MODE || 'console') === 'console';
        const otp = isConsoleMode ? '1234' : Math.floor(1000 + Math.random() * 9000).toString();
        const expiresAt = Date.now() + 5 * 60 * 1000;

        await db.addOtp({ mobile: cleanMobile, otp, expires_at: expiresAt, created_at: new Date() });
        LOG.info(`Generated OTP ${otp} for ${cleanMobile}${email ? ` (via email: ${email})` : ''}`);

        const result = await otpService.sendOTP(cleanMobile, otp);
        if (!result.success) {
            LOG.error(`OTP delivery failed for ${cleanMobile}`, result.error);
            throw new Error("OTP delivery failed");
        }

        const responsePayload = { success: true, channel: result.channel };
        if (result.channel === 'console') {
            responsePayload.debugOtp = otp;
        }
        return responsePayload;
    }

    /**
     * Verify OTP and return user token or new user flag
     */
    async verifyOTP(mobile, email, otp) {
        if ((!mobile && !email) || !otp) {
            throw new Error("Mobile/Email and OTP are required");
        }

        // Support email login - lookup mobile from email
        if (email && !mobile) {
            const user = await db.getUserByEmail(email);
            if (!user || !user.mobile) {
                throw new Error("No account found with this email.");
            }
            mobile = user.mobile;
            LOG.info(`Email login verification: ${email} mapped to mobile ${mobile}`);
        }

        // Normalize
        mobile = mobile.toString().replace(/\D/g, '').slice(-10);
        otp = otp.toString().trim();

        LOG.info(`Verification attempt for ${mobile}${email ? ` (via email: ${email})` : ''} with code ${otp}`);

        const isConsoleMode = (process.env.OTP_DELIVERY_MODE || 'console') === 'console';
        let validOtp = await db.getValidOtp(mobile, otp);

        if (isConsoleMode && !validOtp) {
            const latestValid = await db.getLatestValidOtpByMobile(mobile);
            if (latestValid) {
                validOtp = latestValid;
                LOG.warning(`OTP fallback used for ${mobile}. Entered=${otp}, LatestValid=${latestValid.otp}`);
            }
        }

        if (!validOtp) {
            throw new Error("Invalid or expired OTP");
        }

        await db.deleteOtpsByMobile(mobile);
        LOG.success(`OTP verified for ${mobile}${email ? ` (via email: ${email})` : ''}`);

        const user = await db.getUserByMobile(mobile);
        if (user) {
            const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, process.env.JWT_SECRET || 'secret');
            LOG.success(`User logged in: ${user.name}`);
            return { success: true, isNewUser: false, token, user };
        } else {
            return { success: true, isNewUser: true, mobile };
        }
    }

    /**
     * Register a new user
     */
    async register(userData) {
        let { name, email, mobile, location_name, role } = userData;

        // Normalize mobile
        if (mobile) mobile = mobile.toString().replace(/\D/g, '').slice(-10);

        const userId = 'usr_' + Math.random().toString(36).substring(2, 11);
        const newUser = { id: userId, name, email, mobile, location_name, role: role || 'user', created_at: new Date() };

        await db.addUser(newUser);
        const token = jwt.sign({ id: userId, role: newUser.role, email: newUser.email }, process.env.JWT_SECRET || 'secret');

        LOG.success(`New user registered: ${email}`);
        return { token, user: newUser };
    }

    /**
     * Update user role
     */
    async updateRole(userId, role) {
        await db.updateUserRole(userId, role);
        LOG.info(`Role updated for user ${userId}`);
        return { success: true };
    }

    /**
     * Update user profile
     */
    async updateProfile(userId, profileData) {
        const { name, email, location_name } = profileData;

        // Check if email is already taken by another user
        if (email) {
            const existing = await db.getUserByEmail(email);
            if (existing && existing.id !== userId) {
                LOG.error("Profile update conflict", `Email ${email} already used by ${existing.id}`);
                throw new Error("This email address is already registered with another account.");
            }
        }

        await db.updateUserProfile(userId, { name, email, location_name });
        const updated = await db.getUserById(userId);
        LOG.success(`Profile updated for user: ${updated.email}`);
        return { success: true, user: updated };
    }
}

module.exports = new AuthService();

