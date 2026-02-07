import type { Request, Response, NextFunction } from 'express';
import { InstagramService } from './instagram.service';
import { ConversationOrchestrator } from '@/services/conversation.orchestrator';
import { logger } from '@/utils/logger';
import type { Channel } from '@/types/channel.types';

/**
 * Instagram Webhook Handler
 * 
 * Handles webhooks from Meta for:
 * - Instagram DMs (messages)
 * - Message reactions
 * - Story mentions and replies
 * - Ice breakers
 */
export class InstagramWebhook {
  private instagramService: InstagramService;

  constructor() {
    this.instagramService = new InstagramService();
  }

  /**
   * GET /webhooks/meta/instagram
   * Handle webhook verification (challenge-response)
   */
  async handleVerification(req: Request, res: Response): Promise<void> {
    try {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

      if (mode === 'subscribe' && token === verifyToken) {
        logger.info('Instagram webhook verified successfully');
        res.status(200).send(challenge);
      } else {
        logger.warn({ mode, token }, 'Instagram webhook verification failed');
        res.status(403).json({ error: 'Verification failed' });
      }
    } catch (error) {
      logger.error({ error }, 'Instagram webhook verification error');
      res.status(500).json({ error: 'Verification error' });
    }
  }

  /**
   * POST /webhooks/meta/instagram
   * Handle incoming Instagram events
   */
  async handleIncomingMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = req.body;

      logger.debug({ payload }, 'Instagram webhook received');

      // Validate webhook
      if (!this.instagramService.validateWebhook(payload)) {
        logger.warn({ payload }, 'Invalid Instagram webhook received');
        res.status(200).json({ success: true });
        return;
      }

      // Parse webhook
      const parsed = this.instagramService.parseWebhook(payload);
      
      if (!parsed) {
        // Could be other event types
        await this.handleOtherEvents(payload);
        res.status(200).json({ success: true });
        return;
      }

      logger.info(
        { 
          from: parsed.customerIdentifier.instagramId,
          businessId: parsed.businessId,
          type: parsed.metadata.type,
          content: parsed.content.substring(0, 50) + '...'
        },
        'Instagram DM received'
      );

      // Send typing indicator
      await this.instagramService.sendTypingIndicator(parsed.customerIdentifier.instagramId);

      // Process through orchestrator
      const response = await ConversationOrchestrator.processMessage({
        businessId: parsed.businessId,
        customerIdentifier: parsed.customerIdentifier,
        content: parsed.content,
        channel: 'INSTAGRAM' as Channel,
        metadata: {
          messageId: parsed.metadata.messageId,
          type: parsed.metadata.type,
          replyTo: parsed.metadata.replyTo,
        },
        timestamp: new Date(),
      });

      // Mark as seen
      await this.instagramService.markAsSeen(parsed.customerIdentifier.instagramId);

      // Send Instagram response
      const igResult = await this.instagramService.sendMessage(
        parsed.customerIdentifier,
        response.content,
        {
          businessId: parsed.businessId,
          customerId: response.metadata?.customerId,
          conversationId: response.metadata?.conversationId,
        }
      );

      if (!igResult.success) {
        logger.error(
          { error: igResult.error },
          'Failed to send Instagram response'
        );
      }

      // Always return 200 to Meta quickly
      res.status(200).json({ success: true });

    } catch (error) {
      logger.error({ error, body: req.body }, 'Instagram webhook error');
      res.status(200).json({ success: true });
    }
  }

  /**
   * Handle other Instagram events
   */
  private async handleOtherEvents(payload: any): Promise<void> {
    const entry = payload.entry?.[0];
    const messaging = entry?.messaging?.[0];

    if (!messaging) return;

    // Handle message reactions
    if (messaging.reaction) {
      logger.info(
        { 
          senderId: messaging.sender?.id,
          reaction: messaging.reaction.emoji,
          messageId: messaging.reaction.mid 
        },
        'Instagram message reaction'
      );
    }

    // Handle story mentions
    if (messaging.message?.story_mention) {
      logger.info(
        { 
          senderId: messaging.sender?.id,
          storyId: messaging.message.story_mention?.id 
        },
        'Instagram story mention'
      );
    }

    // Handle postbacks (ice breakers, quick replies)
    if (messaging.postback) {
      logger.info(
        { 
          senderId: messaging.sender?.id,
          payload: messaging.postback.payload,
          title: messaging.postback.title 
        },
        'Instagram postback received'
      );
    }
  }
}
