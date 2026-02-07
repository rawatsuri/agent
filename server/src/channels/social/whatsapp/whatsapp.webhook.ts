import type { Request, Response, NextFunction } from 'express';
import { WhatsAppService } from './whatsapp.service';
import { ConversationOrchestrator } from '@/services/conversation.orchestrator';
import { logger } from '@/utils/logger';
import type { Channel } from '@/types/channel.types';

/**
 * WhatsApp Webhook Handler
 * 
 * Handles webhooks from Meta for:
 * - Incoming messages
 * - Message status updates (sent, delivered, read)
 * - Webhook verification (challenge-response)
 */
export class WhatsAppWebhook {
  private whatsappService: WhatsAppService;

  constructor() {
    this.whatsappService = new WhatsAppService();
  }

  /**
   * GET /webhooks/meta/whatsapp
   * Handle webhook verification (challenge-response)
   * Meta sends this when configuring the webhook
   */
  async handleVerification(req: Request, res: Response): Promise<void> {
    try {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      // Verify token matches our configured token
      const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

      if (mode === 'subscribe' && token === verifyToken) {
        logger.info('WhatsApp webhook verified successfully');
        // Return the challenge to verify
        res.status(200).send(challenge);
      } else {
        logger.warn({ mode, token }, 'WhatsApp webhook verification failed');
        res.status(403).json({ error: 'Verification failed' });
      }
    } catch (error) {
      logger.error({ error }, 'Webhook verification error');
      res.status(500).json({ error: 'Verification error' });
    }
  }

  /**
   * POST /webhooks/meta/whatsapp
   * Handle incoming messages and status updates
   */
  async handleIncomingMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = req.body;

      logger.debug({ payload }, 'WhatsApp webhook received');

      // Validate webhook
      if (!this.whatsappService.validateWebhook(payload)) {
        logger.warn({ payload }, 'Invalid WhatsApp webhook received');
        // Still return 200 to prevent Meta from retrying
        res.status(200).json({ success: true });
        return;
      }

      // Parse webhook
      const parsed = this.whatsappService.parseWebhook(payload);
      
      if (!parsed) {
        // Could be a status update, not a message
        await this.handleStatusUpdate(payload);
        res.status(200).json({ success: true });
        return;
      }

      logger.info(
        { 
          from: parsed.customerIdentifier.whatsappId,
          businessId: parsed.businessId,
          type: parsed.metadata.type,
          content: parsed.content.substring(0, 50) + '...'
        },
        'WhatsApp message received'
      );

      // Mark message as read immediately (best practice)
      if (parsed.metadata.messageId) {
        await this.whatsappService.markAsRead(parsed.metadata.messageId);
      }

      // Process through orchestrator
      const response = await ConversationOrchestrator.processMessage({
        businessId: parsed.businessId,
        customerIdentifier: parsed.customerIdentifier,
        content: parsed.content,
        channel: 'WHATSAPP' as Channel,
        metadata: {
          messageId: parsed.metadata.messageId,
          type: parsed.metadata.type,
          profileName: parsed.metadata.profileName,
        },
        timestamp: new Date(),
      });

      // Send WhatsApp response
      const waResult = await this.whatsappService.sendMessage(
        parsed.customerIdentifier,
        response.content,
        {
          businessId: parsed.businessId,
          customerId: response.metadata?.customerId,
          conversationId: response.metadata?.conversationId,
          replyToMessageId: parsed.metadata.messageId, // Reply in thread
        }
      );

      if (!waResult.success) {
        logger.error(
          { error: waResult.error },
          'Failed to send WhatsApp response'
        );
      }

      // Always return 200 to Meta quickly
      res.status(200).json({ success: true });

    } catch (error) {
      logger.error({ error, body: req.body }, 'WhatsApp webhook error');
      // Always return 200 to prevent Meta retries
      res.status(200).json({ success: true });
    }
  }

  /**
   * Handle message status updates (sent, delivered, read, failed)
   */
  private async handleStatusUpdate(payload: any): Promise<void> {
    try {
      const entry = payload.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const statuses = value?.statuses;

      if (!statuses || statuses.length === 0) {
        return;
      }

      for (const status of statuses) {
        const { id, status: statusType, timestamp, recipient_id, conversation } = status;

        logger.debug(
          { 
            messageId: id, 
            status: statusType, 
            recipient: recipient_id,
            timestamp 
          },
          'WhatsApp status update'
        );

        // Handle different status types
        switch (statusType) {
          case 'sent':
            // Message sent to Meta servers
            break;
          case 'delivered':
            // Message delivered to user's device
            break;
          case 'read':
            // User read the message
            break;
          case 'failed':
            logger.error(
              { 
                messageId: id, 
                recipient: recipient_id,
                error: status.errors 
              },
              'WhatsApp message failed'
            );
            break;
        }

        // Track conversation pricing category
        if (conversation) {
          logger.info(
            { 
              messageId: id,
              category: conversation.category,
              isBillable: conversation.is_billable
            },
            'WhatsApp conversation pricing info'
          );
        }
      }
    } catch (error) {
      logger.error({ error }, 'Status update handling error');
    }
  }
}
