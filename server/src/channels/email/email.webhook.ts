import type { Request, Response, NextFunction } from 'express';
import { EmailService } from './email.service';
import { ConversationOrchestrator } from '@/services/conversation.orchestrator';
import { logger } from '@/utils/logger';
import type { Channel } from '@/types/channel.types';

/**
 * Email Webhook Handler
 * 
 * Handles webhooks from SendGrid:
 * - Inbound parse (incoming emails)
 * - Delivery events
 * - Engagement events (open, click)
 */
export class EmailWebhook {
  private emailService: EmailService;

  constructor() {
    this.emailService = new EmailService();
  }

  /**
   * POST /webhooks/sendgrid/inbound
   * Handle incoming emails (inbound parse)
   */
  async handleInboundEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = req.body;

      logger.debug({ payload }, 'Inbound email received');

      // Validate webhook
      if (!this.emailService.validateWebhook(payload)) {
        logger.warn({ payload }, 'Invalid email webhook received');
        res.status(400).json({ error: 'Invalid webhook' });
        return;
      }

      // Parse webhook
      const parsed = this.emailService.parseWebhook(payload);
      if (!parsed || !parsed.businessId) {
        logger.warn({ payload }, 'Failed to parse email webhook or missing business ID');
        res.status(400).json({ error: 'Invalid email format' });
        return;
      }

      // Skip auto-replies and bounces
      if (this.isAutoReply(payload)) {
        logger.info({ email: parsed.customerIdentifier.email }, 'Skipping auto-reply email');
        res.status(200).json({ success: true, skipped: true });
        return;
      }

      logger.info(
        { 
          from: parsed.customerIdentifier.email,
          businessId: parsed.businessId,
          subject: parsed.metadata.subject 
        },
        'Incoming email received'
      );

      // Process through orchestrator
      const response = await ConversationOrchestrator.processMessage({
        businessId: parsed.businessId,
        customerIdentifier: parsed.customerIdentifier,
        content: parsed.content,
        channel: 'EMAIL' as Channel,
        metadata: {
          subject: parsed.metadata.subject,
          messageId: parsed.metadata.messageId,
          threadId: parsed.metadata.messageId, // Use message ID as thread ID
          headers: parsed.metadata.headers,
        },
        timestamp: new Date(),
      });

      // Send email response
      const emailResult = await this.emailService.sendMessage(
        parsed.customerIdentifier,
        response.content,
        {
          businessId: parsed.businessId,
          customerId: response.metadata?.customerId,
          conversationId: response.metadata?.conversationId,
          subject: `Re: ${parsed.metadata.subject}`,
          threadId: parsed.metadata.messageId,
        }
      );

      if (!emailResult.success) {
        logger.error(
          { error: emailResult.error },
          'Failed to send email response'
        );
      }

      res.status(200).json({ 
        success: true,
        responseSent: emailResult.success,
      });

    } catch (error) {
      logger.error({ error, body: req.body }, 'Email inbound webhook error');
      next(error);
    }
  }

  /**
   * POST /webhooks/sendgrid/events
   * Handle delivery and engagement events
   */
  async handleEvents(req: Request, res: Response): Promise<void> {
    try {
      // SendGrid sends events as an array
      const events = Array.isArray(req.body) ? req.body : [req.body];

      for (const event of events) {
        await this.processEvent(event);
      }

      // Always return 200 to SendGrid
      res.status(200).json({ success: true });
    } catch (error) {
      logger.error({ error }, 'Email events webhook error');
      res.status(200).json({ success: true });
    }
  }

  /**
   * Process individual SendGrid event
   */
  private async processEvent(event: any): Promise<void> {
    const { event: eventType, email, sg_message_id, timestamp, reason, response } = event;

    switch (eventType) {
      case 'delivered':
        logger.debug({ messageId: sg_message_id, email }, 'Email delivered');
        break;

      case 'bounce':
        logger.warn({ 
          messageId: sg_message_id, 
          email, 
          reason,
          bounceType: event.bounce_type 
        }, 'Email bounced');
        // TODO: Mark email as invalid in customer record
        break;

      case 'dropped':
        logger.warn({ 
          messageId: sg_message_id, 
          email, 
          reason 
        }, 'Email dropped');
        break;

      case 'deferred':
        logger.debug({ 
          messageId: sg_message_id, 
          email, 
          response 
        }, 'Email deferred');
        break;

      case 'open':
        logger.debug({ 
          messageId: sg_message_id, 
          email 
        }, 'Email opened');
        // TODO: Track email engagement analytics
        break;

      case 'click':
        logger.info({ 
          messageId: sg_message_id, 
          email,
          url: event.url 
        }, 'Email link clicked');
        break;

      case 'spamreport':
        logger.warn({ 
          messageId: sg_message_id, 
          email 
        }, 'Email marked as spam');
        // TODO: Flag customer, potentially block
        break;

      case 'unsubscribe':
        logger.info({ 
          messageId: sg_message_id, 
          email 
        }, 'Customer unsubscribed');
        // TODO: Update customer preferences
        break;

      case 'group_unsubscribe':
      case 'group_resubscribe':
        logger.info({ 
          messageId: sg_message_id, 
          email,
          asm_group_id: event.asm_group_id 
        }, `Customer ${eventType === 'group_unsubscribe' ? 'unsubscribed from' : 'resubscribed to'} group`);
        break;

      default:
        logger.debug({ eventType, email }, 'Unknown email event');
    }
  }

  /**
   * Check if email is an auto-reply (out-of-office, bounce, etc.)
   */
  private isAutoReply(payload: any): boolean {
    const headers = payload.headers || {};
    const subject = (payload.subject || '').toLowerCase();

    // Check auto-reply headers
    const autoReplyHeaders = [
      'X-Auto-Response-Suppress',
      'Auto-Submitted',
      'X-Autoreply',
    ];

    for (const header of autoReplyHeaders) {
      if (headers[header] && headers[header] !== 'no') {
        return true;
      }
    }

    // Check auto-reply keywords in subject
    const autoReplySubjects = [
      'out of office',
      'auto-reply',
      'autoreply',
      'away from office',
      'on vacation',
    ];

    return autoReplySubjects.some(keyword => subject.includes(keyword));
  }
}
