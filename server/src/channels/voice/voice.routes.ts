import { Router } from 'express';
import { VoiceWebhook } from './voice.webhook';

/**
 * Voice Routes - Express routes for voice webhooks
 */
const router = Router();
const voiceWebhook = new VoiceWebhook();

// Incoming call webhook
router.post('/exotel/voice', (req, res, next) => voiceWebhook.handleIncomingCall(req, res, next));

// Call status updates
router.post('/exotel/voice/status', (req, res) => voiceWebhook.handleCallStatus(req, res));

// Recording availability
router.post('/exotel/voice/recording', (req, res) => voiceWebhook.handleRecording(req, res));

export default router;
