const axios = require('axios');
const LOG = require('../utils/logger');
const settingsService = require('./settingsService');
const db = require('../database');

const toList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
};

const isEnabled = (settings, key, defaultValue = false) => {
  if (!settings || settings[key] === undefined) return defaultValue;
  return settings[key] === true;
};

const buildMessage = (eventKey, payload) => {
  switch (eventKey) {
    case 'order_created':
      return {
        subject: 'New Order Created',
        text: `Order created by user ${payload.userId} for vendor ${payload.vendorId}. Total: ${payload.totalAmount || 0}. Items: ${payload.itemsCount || 0}.`
      };
    case 'appointment_booked':
      return {
        subject: 'New Appointment Booked',
        text: `Appointment booked by user ${payload.userId} for vendor ${payload.vendorId}. Date: ${payload.date || 'N/A'} ${payload.time || ''}.`
      };
    case 'queue_joined':
      return {
        subject: 'Queue Joined',
        text: `User ${payload.userId} joined queue for vendor ${payload.vendorId}.`
      };
    case 'queue_status_updated':
      return {
        subject: 'Queue Status Updated',
        text: `Queue status updated for vendor ${payload.vendorId}. Queue ID: ${payload.queueId}. Status: ${payload.status}.`
      };
    case 'queue_left':
      return {
        subject: 'Queue Left',
        text: `User ${payload.userId} left queue for vendor ${payload.vendorId}.`
      };
    case 'queue_deleted':
      return {
        subject: 'Queue Item Deleted',
        text: `Queue item ${payload.queueId} deleted for vendor ${payload.vendorId}.`
      };
    case 'matchmaking_submitted':
      return {
        subject: 'Matchmaking Submitted',
        text: `User ${payload.userId} submitted matchmaking for vendor ${payload.vendorId}.`
      };
    case 'appointment_status_updated':
      return {
        subject: 'Appointment Status Updated',
        text: `Appointment ${payload.appointmentId} status updated to ${payload.status}.`
      };
    case 'appointment_deleted':
      return {
        subject: 'Appointment Deleted',
        text: `Appointment ${payload.appointmentId} deleted by user ${payload.userId}.`
      };
    case 'vendor_created':
      return {
        subject: 'Vendor Created',
        text: `Vendor profile created by user ${payload.userId}. Vendor ID: ${payload.vendorId || 'N/A'}.`
      };
    case 'vendor_updated':
      return {
        subject: 'Vendor Updated',
        text: `Vendor profile updated by user ${payload.userId}. Vendor ID: ${payload.vendorId || 'N/A'}.`
      };
    case 'product_added':
      return {
        subject: 'Product Added',
        text: `Product added by vendor user ${payload.userId}. Product ID: ${payload.productId || 'N/A'}.`
      };
    case 'product_updated':
      return {
        subject: 'Product Updated',
        text: `Product updated by vendor user ${payload.userId}. Product ID: ${payload.productId || 'N/A'}.`
      };
    case 'subscription_updated':
      return {
        subject: 'Subscription Updated',
        text: `Subscription updated for user ${payload.userId}. Plan: ${payload.plan || 'N/A'}. Status: ${payload.status || 'N/A'}.`
      };
    case 'subscription_canceled':
      return {
        subject: 'Subscription Canceled',
        text: `Subscription ${payload.subscriptionId} canceled by user ${payload.userId}.`
      };
    case 'subscription_auto_renew':
      return {
        subject: 'Subscription Auto-Renew Updated',
        text: `Subscription ${payload.subscriptionId} auto-renew set to ${payload.autoRenew}.`
      };
    default:
      return {
        subject: 'System Notification',
        text: `Event: ${eventKey}`
      };
  }
};

const sendWebhook = async (url, body) => {
  if (!url) return { skipped: true, reason: 'missing_webhook' };
  try {
    await axios.post(url, body, { timeout: 8000 });
    return { success: true };
  } catch (err) {
    LOG.error('[Notification] Webhook failed', err.message);
    return { success: false, error: err.message };
  }
};

const sendResendEmail = async ({ to, from, subject, text }) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { skipped: true, reason: 'missing_resend_key' };
  if (!to || to.length === 0) return { skipped: true, reason: 'missing_recipients' };
  try {
    await axios.post(
      'https://api.resend.com/emails',
      {
        from: from || 'no-reply@resend.dev',
        to,
        subject,
        text
      },
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 8000
      }
    );
    return { success: true };
  } catch (err) {
    LOG.error('[Notification] Resend failed', err.message);
    return { success: false, error: err.message };
  }
};

const sendTextbeltSms = async ({ to, text }) => {
  const apiKey = process.env.TEXTBELT_API_KEY || 'textbelt';
  if (!to || to.length === 0) return { skipped: true, reason: 'missing_recipients' };
  try {
    const results = [];
    for (const phone of to) {
      const res = await axios.post(
        'https://textbelt.com/text',
        { phone, message: text, key: apiKey },
        { timeout: 8000 }
      );
      results.push(res.data);
    }
    return { success: true, results };
  } catch (err) {
    LOG.error('[Notification] Textbelt failed', err.message);
    return { success: false, error: err.message };
  }
};

class NotificationService {
  constructor() {
    this.io = null;
  }

  setIO(io) {
    this.io = io;
  }

  async notify(eventKey, payload = {}) {
    const settings = await settingsService.getSettings();
    const isEmailEnabled = isEnabled(settings, 'enable_email_notifications', true);
    const isSmsEnabled = isEnabled(settings, 'enable_sms_notifications', true);
    const isInAppEnabled = isEnabled(settings, 'enable_in_app_notifications', true);

    const featureFlagMap = {
      order_created: 'notify_on_orders',
      appointment_booked: 'notify_on_appointments',
      appointment_status_updated: 'notify_on_appointment_status',
      queue_joined: 'notify_on_queue',
      queue_status_updated: 'notify_on_queue_status',
      queue_left: 'notify_on_queue_leave',
      queue_deleted: 'notify_on_queue_delete',
      matchmaking_submitted: 'notify_on_matchmaking',
      subscription_updated: 'notify_on_subscriptions',
      subscription_canceled: 'notify_on_subscription_cancel',
      subscription_auto_renew: 'notify_on_subscription_auto_renew',
      vendor_created: 'notify_on_vendor_profile',
      vendor_updated: 'notify_on_vendor_profile',
      product_added: 'notify_on_product_updates',
      product_updated: 'notify_on_product_updates',
      appointment_deleted: 'notify_on_appointment_delete'
    };

    const featureKey = featureFlagMap[eventKey];
    if (featureKey && !isEnabled(settings, featureKey, true)) {
      return { skipped: true, reason: 'feature_disabled' };
    }

    const message = buildMessage(eventKey, payload);
    const emailRecipients = toList(settings.notify_email_recipients);
    const smsRecipients = toList(settings.notify_sms_recipients);

    if (isInAppEnabled) {
      const targetIds = new Set();
      if (payload.userId) targetIds.add(String(payload.userId));
      if (payload.targetUserId) targetIds.add(String(payload.targetUserId));
      if (payload.vendorId) {
        try {
          const vendor = await db.getVendorById(payload.vendorId);
          if (vendor?.owner_id) targetIds.add(String(vendor.owner_id));
        } catch (e) {
          LOG.error('[Notification] Vendor lookup failed', e.message);
        }
      }

      const now = new Date();
      for (const uid of targetIds) {
        const record = await db.addNotification({
          user_id: uid,
          title: message.subject,
          message: message.text,
          type: eventKey,
          data: payload,
          created_at: now
        });
        if (this.io) {
          this.io.to(`user_${uid}`).emit('app_notification', record);
        }
      }
    }

    let emailResult = { skipped: true, reason: 'email_disabled' };
    if (isEmailEnabled) {
      if (settings.notify_email_webhook_url) {
        emailResult = await sendWebhook(settings.notify_email_webhook_url, {
          channel: 'email',
          to: emailRecipients,
          from: settings.notify_email_from || '',
          subject: message.subject,
          text: message.text,
          payload
        });
      } else if ((settings.notify_email_provider || 'resend') === 'resend') {
        emailResult = await sendResendEmail({
          to: emailRecipients,
          from: settings.notify_email_from || '',
          subject: message.subject,
          text: message.text
        });
      } else {
        emailResult = { skipped: true, reason: 'email_provider_disabled' };
      }
    }

    let smsResult = { skipped: true, reason: 'sms_disabled' };
    if (isSmsEnabled) {
      if (settings.notify_sms_webhook_url) {
        smsResult = await sendWebhook(settings.notify_sms_webhook_url, {
          channel: 'sms',
          to: smsRecipients,
          from: settings.notify_sms_from || '',
          text: message.text,
          payload
        });
      } else if ((settings.notify_sms_provider || 'textbelt') === 'textbelt') {
        smsResult = await sendTextbeltSms({
          to: smsRecipients,
          text: message.text
        });
      } else {
        smsResult = { skipped: true, reason: 'sms_provider_disabled' };
      }
    }

    if (!isEmailEnabled && !isSmsEnabled) {
      LOG.info(`[Notification] All channels disabled for ${eventKey}`);
    }

    return { email: emailResult, sms: smsResult };
  }
}

module.exports = new NotificationService();

