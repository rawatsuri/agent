import { Router } from 'express';
import { VoiceWebhook } from '../channels/voice/voice.webhook';
import { EmailWebhook } from '../channels/email/email.webhook';
import { SmsWebhook } from '../channels/sms/sms.webhook';
import { WhatsAppWebhook } from '../channels/social/whatsapp/whatsapp.webhook';
import { TelegramWebhook } from '../channels/social/telegram/telegram.webhook';
import { InstagramWebhook } from '../channels/social/instagram/instagram.webhook';
import { WebhookValidators } from '@/middleware/webhook-validation.middleware';
import { logger } from '@/utils/logger';

/**
 * Webhook Routes - All external webhook endpoints
 * 
 * Mounted at: /webhooks
 * 
 * SECURITY: All routes are protected by signature validation
 * 
 * Routes:
 * - /webhooks/exotel/voice - Exotel voice calls
 * - /webhooks/exotel/sms - Exotel SMS
 * - /webhooks/sendgrid/inbound - SendGrid incoming emails
 * - /webhooks/sendgrid/events - SendGrid delivery events
 * - /webhooks/meta/whatsapp - Meta WhatsApp messages
 * - /webhooks/meta/instagram - Meta Instagram DMs
 * - /webhooks/telegram - Telegram bot updates
 */
const router = Router();

// Initialize webhook handlers
const voiceWebhook = new VoiceWebhook();
const emailWebhook = new EmailWebhook();
const smsWebhook = new SmsWebhook();
const whatsappWebhook = new WhatsAppWebhook();
const telegramWebhook = new TelegramWebhook();
const instagramWebhook = new InstagramWebhook();

/**
 * Middleware to log all webhook requests
 */
router.use((req, res, next) => {
  logger.debug(
    {
      method: req.method,
      path: req.path,
      contentType: req.headers['content-type'],
      ip: req.ip
    },
    'Webhook request received'
  );
  next();
});

// ============================================
// VOICE WEBHOOKS (Exotel) - SECURED
// ============================================

// Incoming voice call - SIGNATURE VALIDATED
router.post('/exotel/voice', WebhookValidators.exotel(), (req, res, next) =>
  voiceWebhook.handleIncomingCall(req, res, next)
);

// Voice call status updates - SIGNATURE VALIDATED
router.post('/exotel/voice/status', WebhookValidators.exotel(), (req, res) =>
  voiceWebhook.handleCallStatus(req, res)
);

// Voice recording availability - SIGNATURE VALIDATED
router.post('/exotel/voice/recording', WebhookValidators.exotel(), (req, res) =>
  voiceWebhook.handleRecording(req, res)
);

// ============================================
// SMS WEBHOOKS (Exotel) - SECURED
// ============================================

// Incoming SMS - SIGNATURE VALIDATED
router.post('/exotel/sms', WebhookValidators.exotel(), (req, res, next) =>
  smsWebhook.handleIncomingSms(req, res, next)
);

// SMS delivery status - SIGNATURE VALIDATED
router.post('/exotel/sms/status', WebhookValidators.exotel(), (req, res) =>
  smsWebhook.handleStatusUpdate(req, res)
);

// ============================================
// EMAIL WEBHOOKS (SendGrid) - SECURED
// ============================================

// Incoming email (inbound parse) - SIGNATURE VALIDATED
router.post('/sendgrid/inbound', WebhookValidators.sendgrid(), (req, res, next) =>
  emailWebhook.handleInboundEmail(req, res, next)
);

// Email delivery/engagement events - SIGNATURE VALIDATED
router.post('/sendgrid/events', WebhookValidators.sendgrid(), (req, res) =>
  emailWebhook.handleEvents(req, res)
);

// ============================================
// WHATSAPP WEBHOOKS (Meta) - SECURED
// ============================================

// Webhook verification (GET) - No signature for GET
router.get('/meta/whatsapp', (req, res) =>
  whatsappWebhook.handleVerification(req, res)
);

// Incoming messages and status updates (POST) - SIGNATURE VALIDATED
router.post('/meta/whatsapp', WebhookValidators.meta(), (req, res, next) =>
  whatsappWebhook.handleIncomingMessage(req, res, next)
);

// ============================================
// INSTAGRAM WEBHOOKS (Meta) - SECURED
// ============================================

// Webhook verification (GET) - No signature for GET
router.get('/meta/instagram', (req, res) =>
  instagramWebhook.handleVerification(req, res)
);

// Incoming DMs and events (POST) - SIGNATURE VALIDATED
router.post('/meta/instagram', WebhookValidators.meta(), (req, res, next) =>
  instagramWebhook.handleIncomingMessage(req, res, next)
);

// ============================================
// TELEGRAM WEBHOOKS - SECURED
// ============================================

// Incoming bot updates - TOKEN VALIDATED
router.post('/telegram', WebhookValidators.telegram, (req, res, next) =>
  telegramWebhook.handleUpdate(req, res, next)
);

// Webhook setup (manual endpoint) - No validation (internal use)
router.get('/telegram/setup', (req, res) =>
  telegramWebhook.setupWebhook(req, res)
);

// Webhook removal - No validation (internal use)
router.delete('/telegram/setup', (req, res) =>
  telegramWebhook.removeWebhook(req, res)
);

// ============================================
// HEALTH CHECK
// ============================================

// Webhook health check
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'webhooks',
    timestamp: new Date().toISOString(),
    activeChannels: [
      'voice',
      'sms',
      'email',
      'whatsapp',
      'instagram',
      'telegram',
    ],
  });
});

export default router;
