import type { Request, Response, NextFunction } from 'express';
import { VoiceService } from './voice.service';
import { ConversationOrchestrator } from '@/services/conversation.orchestrator';
import { logger } from '@/utils/logger';
import type { Channel } from '@/types/channel.types';

/**
 * Voice Webhook Handlers
 * 
 * Handles webhooks from Exotel for:
 * - Incoming call events
 * - Call status updates
 * - Recording availability
 * - DTMF/key press events
 */
export class VoiceWebhook {
  private voiceService: VoiceService;

  constructor() {
    this.voiceService = new VoiceService();
  }

  /**
   * POST /webhooks/exotel/voice
   * Handle incoming call webhook from Exotel
   * 
   * Flow:
   * 1. Customer calls business number
   * 2. Exotel forwards to this webhook
   * 3. We identify customer and get AI response
   * 4. Response sent to Vocode bridge for voice synthesis
   */
  async handleIncomingCall(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = req.body;

      // Validate webhook
      if (!this.voiceService.validateWebhook(payload)) {
        logger.warn({ payload }, 'Invalid voice webhook received');
        res.status(400).json({ error: 'Invalid webhook' });
        return;
      }

      // Parse webhook
      const parsed = this.voiceService.parseWebhook(payload);
      if (!parsed) {
        res.status(400).json({ error: 'Failed to parse webhook' });
        return;
      }

      logger.info(
        { 
          phone: parsed.customerIdentifier.phone,
          businessId: parsed.businessId,
          callSid: parsed.metadata.callSid 
        },
        'Incoming voice call received'
      );

      // If this is initial call (no speech yet), just acknowledge
      if (!parsed.content && parsed.metadata.status === 'in-progress') {
        // Return Vocode/TwiML to gather speech
        const twiml = this.generateGatherTwiml(parsed.businessId);
        res.set('Content-Type', 'text/xml');
        res.send(twiml);
        return;
      }

      // Process the message through orchestrator
      const response = await ConversationOrchestrator.processMessage({
        businessId: parsed.businessId,
        customerIdentifier: parsed.customerIdentifier,
        content: parsed.content,
        channel: 'VOICE' as Channel,
        metadata: {
          callSid: parsed.metadata.callSid,
          channel: 'VOICE',
        },
        timestamp: new Date(),
      });

      // Format for voice
      const voiceResponse = this.voiceService.formatResponse(response);

      // Return Vocode/TwiML response
      const twiml = this.generateResponseTwiml(voiceResponse, response.needsHumanTransfer);
      
      res.set('Content-Type', 'text/xml');
      res.send(twiml);

    } catch (error) {
      logger.error({ error, body: req.body }, 'Voice webhook error');
      
      // Return friendly error in voice format
      const errorTwiml = this.generateResponseTwiml(
        "I'm sorry, I'm having trouble right now. Please try again later.",
        true
      );
      
      res.set('Content-Type', 'text/xml');
      res.status(200).send(errorTwiml); // Always return 200 to Exotel
    }
  }

  /**
   * POST /webhooks/exotel/voice/status
   * Handle call status updates (completed, failed, etc.)
   */
  async handleCallStatus(req: Request, res: Response): Promise<void> {
    try {
      const payload = req.body;
      const { CallSid, CallStatus, CallDuration, RecordingUrl, businessId, customerId } = payload;

      logger.info(
        { 
          callSid: CallSid, 
          status: CallStatus, 
          duration: CallDuration,
          businessId 
        },
        'Voice call status update'
      );

      // If call completed, save recording info
      if (CallStatus === 'completed' && RecordingUrl && customerId) {
        // Save to CallRecording table
        // This will be implemented in conversation orchestrator
      }

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error({ error }, 'Call status webhook error');
      res.status(200).json({ success: true }); // Always return 200
    }
  }

  /**
   * POST /webhooks/exotel/voice/recording
   * Handle recording availability
   */
  async handleRecording(req: Request, res: Response): Promise<void> {
    try {
      const { RecordingUrl, CallSid, Duration } = req.body;

      logger.info(
        { callSid: CallSid, recordingUrl: RecordingUrl, duration: Duration },
        'Call recording available'
      );

      // Trigger transcription in background
      // TODO: Queue transcription job

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error({ error }, 'Recording webhook error');
      res.status(200).json({ success: true });
    }
  }

  /**
   * Generate TwiML to gather speech input
   */
  private generateGatherTwiml(businessId: string): string {
    // Vocode uses a different format than raw TwiML
    // This is sent to the Vocode bridge which handles the actual voice interaction
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Welcome! How can I help you today?</Say>
  <Gather input="speech" action="${process.env.BASE_URL}/webhooks/exotel/voice" method="POST" speechTimeout="auto">
    <Say>Please tell me how I can assist you.</Say>
  </Gather>
</Response>`;
  }

  /**
   * Generate TwiML response with AI message
   */
  private generateResponseTwiml(message: string, needsHumanTransfer: boolean = false): string {
    let twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${this.escapeXml(message)}</Say>`;

    if (needsHumanTransfer) {
      twiml += `
  <Say>I'm transferring you to a human agent. Please hold.</Say>
  <Dial>${process.env.HUMAN_TRANSFER_NUMBER || ''}</Dial>`;
    } else {
      twiml += `
  <Gather input="speech" action="${process.env.BASE_URL}/webhooks/exotel/voice" method="POST" speechTimeout="auto">
    <Say>Is there anything else I can help you with?</Say>
  </Gather>`;
    }

    twiml += `
</Response>`;
    return twiml;
  }

  /**
   * Escape XML special characters
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
