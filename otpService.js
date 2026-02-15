require('dotenv').config();
const axios = require('axios');

const otpService = {
    // Delivery Configuration: 'console' | 'whatsapp'
    deliveryMode: process.env.OTP_DELIVERY_MODE || 'console',

    sendOTP: async (mobile, otp) => {
        console.log(`[OTP Service] Initiating delivery to ${mobile} via ${otpService.deliveryMode}`);

        try {
            if (otpService.deliveryMode === 'console') {
                return otpService.sendViaConsole(mobile, otp);
            } else if (otpService.deliveryMode === 'whatsapp') {
                return await otpService.sendViaWhatsApp(mobile, otp);
            } else {
                throw new Error(`Unsupported delivery mode: ${otpService.deliveryMode}`);
            }
        } catch (error) {
            console.error(`[OTP Service ERROR] Failed to send OTP to ${mobile}:`, error.message);
            return { success: false, error: error.message };
        }
    },

    sendViaConsole: (mobile, otp) => {
        console.log("-------------------------------");
        console.log(`Verification Code for ${mobile}`);
        console.log(`OTP: ${otp}`);
        console.log("-------------------------------");
        return { success: true, channel: 'console' };
    },

    sendViaWhatsApp: async (mobile, otp) => {
        try {
            // Check if WhatsApp configuration exists if in production mode
            if (!process.env.WHATSAPP_API_URL && !process.env.WHATSAPP_API_TOKEN) {
                console.warn("[OTP Service WARNING] WhatsApp API details missing in .env. Falling back to console log for safety.");
                return otpService.sendViaConsole(mobile, otp);
            }

            const message = `Your QR Queue verification code is: ${otp}. Valid for 5 minutes.`;
            
            // Example using a real WhatsApp API provider
            const response = await axios.post(process.env.WHATSAPP_API_URL, {
                to: mobile,
                body: message,
                token: process.env.WHATSAPP_API_TOKEN
            }, { timeout: 5000 }); // Added timeout for reliability

            if (response.status === 200 || response.status === 201) {
                console.log(`[OTP Service SUCCESS] WhatsApp sent to ${mobile}`);
                return { success: true, channel: 'whatsapp', response: response.data };
            } else {
                throw new Error(`WhatsApp provider returned status ${response.status}`);
            }
        } catch (error) {
            // Capture specific failure reasons
            let errorMsg = error.message;
            if (error.response) {
                errorMsg = `API Error: ${JSON.stringify(error.response.data)}`;
            } else if (error.request) {
                errorMsg = "No response from WhatsApp API provider (Network Timeout)";
            }
            
            console.error(`[OTP Service CRITICAL] WhatsApp delivery failed for ${mobile}:`, errorMsg);
            throw new Error(errorMsg); // Rethrow to be caught by sendOTP
        }
    }
};

module.exports = otpService;
