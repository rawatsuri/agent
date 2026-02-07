import type { Request, Response, NextFunction } from 'express';
import { SmsService } from './sms.service';
import { ConversationOrchestrator } from '@/services/conversation.orchestrator';
import { logger } from '@/utils/logger';
import type { Channel } from '@/types/channel.types';

/**
 * SMS Webhook Handler
 * 
 * Handles webhooks from Exotel for:
 * - Incoming SMS
 * - Delivery status updates
 */
export class SmsWebhook {
  private smsService: SmsService;

  constructor() {
    this.smsService = new SmsService();
  }

  /**
   * POST /webhooks/exotel/sms
   * Handle incoming SMS
   */
  async handleIncomingSms(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = req.body;

      logger.debug({ payload }, 'Incoming SMS received');

      // Validate webhook
      if (!this.smsService.validateWebhook(payload)) {
        logger.warn({ payload }, 'Invalid SMS webhook received');
        res.status(400).json({ error: 'Invalid webhook' });
        return;
      }

      // Parse webhook
      const parsed = this.smsService.parseWebhook(payload);
      if (!parsed || !parsed.businessId) {
        logger.warn({ payload }, 'Failed to parse SMS webhook or missing business ID');
        res.status(400).json({ error: 'Invalid SMS format' });
        return;
      }

      logger.info(
        { 
          from: parsed.customerIdentifier.phone,
          businessId: parsed.businessId,
          content: parsed.content.substring(0, 50) + '...' 
        },
        'Incoming SMS received'
      );

      // Process through orchestrator
      const response = await ConversationOrchestrator.processMessage({
        businessId: parsed.businessId,
        customerIdentifier: parsed.customerIdentifier,
        content: parsed.content,
        channel: 'SMS' as Channel,
        metadata: {
          smsSid: parsed.metadata.smsSid,
          to: parsed.metadata.to,
        },
        timestamp: new Date(),
      });

      // Send SMS response (only if not from cache - to save costs)
      // For SMS, we might skip responses to simple acknowledgments
      const shouldRespond = this.shouldSendSmsResponse(parsed.content, response);

      if (shouldRespond) {
        const smsResult = await this.smsService.sendMessage(
          parsed.customerIdentifier,
          response.content,
          {
            businessId: parsed.businessId,
            customerId: response.metadata?.customerId,
            conversationId: response.metadata?.conversationId,
          }
        );

        if (!smsResult.success) {
          logger.error(
            { error: smsResult.error },
            'Failed to send SMS response'
          );
        }
      } else {
        logger.info(
          { phone: parsed.customerIdentifier.phone },
          'SMS response suppressed (simple query or stop message)'
        );
      }

      res.status(200).json({ 
        success: true,
        responseSent: shouldRespond,
      });

    } catch (error) {
      logger.error({ error, body: req.body }, 'SMS webhook error');
      next(error);
    }
  }

  /**
   * POST /webhooks/exotel/sms/status
   * Handle delivery status updates
   */
  async handleStatusUpdate(req: Request, res: Response): Promise<void> {
    try {
      const { SmsSid, SmsStatus, To, From, ErrorCode, ErrorMessage } = req.body;

      logger.info(
        { 
          smsSid: SmsSid, 
          status: SmsStatus, 
          to: To,
          errorCode: ErrorCode 
        },
        'SMS status update'
      );

      // Handle failed deliveries
      if (SmsStatus === 'failed' || SmsStatus === 'undelivered') {
        logger.error(
          { 
            smsSid: SmsSid, 
            to: To,
            errorCode: ErrorCode,
            errorMessage: ErrorMessage 
          },
          'SMS delivery failed'
        );

        // TODO: Implement retry logic or alert
      }

      // Always return 200 to Exotel
      res.status(200).json({ success: true });
    } catch (error) {
      logger.error({ error }, 'SMS status webhook error');
      res.status(200).json({ success: true });
    }
  }

  /**
   * Determine if we should send an SMS response
   * Skip responses to:
   * - STOP/UNSUBSCRIBE messages
   * - Very short acknowledgments ("ok", "thanks")
   * - If the query was answered from cache (already known answer)
   */
  private shouldSendSmsResponse(
    incomingContent: string,
    response: { content: string; metadata?: Record<string, any> }
  ): boolean {
    const normalizedContent = incomingContent.toLowerCase().trim();

    // Check for opt-out keywords
    const optOutKeywords = ['stop', 'unsubscribe', 'cancel', 'end', 'quit'];
    if (optOutKeywords.some(keyword => normalizedContent === keyword)) {
      return false;
    }

    // Check for simple acknowledgments
    const acknowledgments = ['ok', 'okay', 'thanks', 'thank you', 'got it', 'cool', 'k'];
    if (acknowledgments.some(ack => normalizedContent.includes(ack))) {
      // Still respond but with brief acknowledgment
      return true;
    }

    // Always respond to questions or substantive messages
    return true;
  }
}
