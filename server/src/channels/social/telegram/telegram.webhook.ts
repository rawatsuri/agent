import type { Request, Response, NextFunction } from 'express';
import { TelegramService } from './telegram.service';
import { ConversationOrchestrator } from '@/services/conversation.orchestrator';
import { logger } from '@/utils/logger';
import type { Channel } from '@/types/channel.types';

/**
 * Telegram Webhook Handler
 * 
 * Handles webhooks from Telegram for:
 * - Incoming messages
 * - Edited messages
 * - Callback queries (button clicks)
 * - Chat member updates
 */
export class TelegramWebhook {
  private telegramService: TelegramService;

  constructor() {
    this.telegramService = new TelegramService();
  }

  /**
   * POST /webhooks/telegram
   * Handle all incoming Telegram updates
   */
  async handleUpdate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = req.body;

      logger.debug({ payload }, 'Telegram webhook received');

      // Validate webhook
      if (!this.telegramService.validateWebhook(payload)) {
        logger.warn({ payload }, 'Invalid Telegram webhook received');
        res.status(400).json({ error: 'Invalid webhook' });
        return;
      }

      // Parse webhook
      const parsed = this.telegramService.parseWebhook(payload);
      if (!parsed) {
        // Could be a different update type (chat member, etc.)
        await this.handleOtherUpdates(payload);
        res.status(200).json({ success: true });
        return;
      }

      // Send typing indicator
      await this.telegramService.sendChatAction(parsed.metadata.chatId, 'typing');

      logger.info(
        { 
          chatId: parsed.metadata.chatId,
          username: parsed.metadata.fromUsername,
          type: parsed.metadata.type,
          content: parsed.content.substring(0, 50) + '...'
        },
        'Telegram message received'
      );

      // Process through orchestrator
      const response = await ConversationOrchestrator.processMessage({
        businessId: parsed.businessId,
        customerIdentifier: parsed.customerIdentifier,
        content: parsed.content,
        channel: 'TELEGRAM' as Channel,
        metadata: {
          chatId: parsed.metadata.chatId,
          messageId: parsed.metadata.messageId,
          fromUsername: parsed.metadata.fromUsername,
          fromName: `${parsed.metadata.fromFirstName || ''} ${parsed.metadata.fromLastName || ''}`.trim(),
        },
        timestamp: new Date(),
      });

      // Send Telegram response
      const tgResult = await this.telegramService.sendMessage(
        parsed.customerIdentifier,
        response.content,
        {
          businessId: parsed.businessId,
          customerId: response.metadata?.customerId,
          conversationId: response.metadata?.conversationId,
          replyToMessageId: parsed.metadata.messageId,
        }
      );

      if (!tgResult.success) {
        logger.error(
          { error: tgResult.error },
          'Failed to send Telegram response'
        );
      }

      // Always return 200 to Telegram quickly
      res.status(200).json({ success: true });

    } catch (error) {
      logger.error({ error, body: req.body }, 'Telegram webhook error');
      // Always return 200 to prevent Telegram retries
      res.status(200).json({ success: true });
    }
  }

  /**
   * Handle other update types
   */
  private async handleOtherUpdates(payload: any): Promise<void> {
    // Handle chat member updates
    if (payload.my_chat_member) {
      const { chat, new_chat_member } = payload.my_chat_member;
      logger.info(
        { 
          chatId: chat.id,
          status: new_chat_member.status 
        },
        'Telegram chat member status updated'
      );
    }

    // Handle channel posts
    if (payload.channel_post) {
      logger.debug({ channelId: payload.channel_post.chat.id }, 'Channel post received');
    }

    // Handle edited messages
    if (payload.edited_message) {
      logger.debug(
        { 
          chatId: payload.edited_message.chat.id,
          messageId: payload.edited_message.message_id 
        },
        'Message edited'
      );
    }
  }

  /**
   * GET /webhooks/telegram/setup
   * Setup webhook for this bot
   */
  async setupWebhook(req: Request, res: Response): Promise<void> {
    try {
      const webhookUrl = `${process.env.BASE_URL}/webhooks/telegram`;
      
      const result = await this.telegramService.setWebhook(webhookUrl);

      if (result.success) {
        res.status(200).json({ 
          success: true, 
          message: 'Webhook set successfully',
          url: webhookUrl 
        });
      } else {
        res.status(400).json({ 
          success: false, 
          error: result.error 
        });
      }
    } catch (error) {
      logger.error({ error }, 'Webhook setup error');
      res.status(500).json({ 
        success: false, 
        error: 'Webhook setup failed' 
      });
    }
  }

  /**
   * DELETE /webhooks/telegram/setup
   * Remove webhook (switch to polling)
   */
  async removeWebhook(req: Request, res: Response): Promise<void> {
    try {
      const result = await this.telegramService.removeWebhook();

      if (result.success) {
        res.status(200).json({ 
          success: true, 
          message: 'Webhook removed successfully' 
        });
      } else {
        res.status(400).json({ 
          success: false, 
          error: result.error 
        });
      }
    } catch (error) {
      logger.error({ error }, 'Webhook removal error');
      res.status(500).json({ 
        success: false, 
        error: 'Webhook removal failed' 
      });
    }
  }
}
