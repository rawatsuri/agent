import type { IChannelAdapter } from '../../base/channel.types';
import { Channel, IAgentResponse } from '@/types/channel.types';
import { logger } from '@/utils/logger';
import { CostTrackerService } from '@/features/cost-control/cost-tracker.service';
import { BudgetService } from '@/features/cost-control/budget.service';

/**
 * Telegram Service - Telegram Bot API Integration
 * 
 * Handles:
 * - Sending text messages
 * - Markdown/HTML formatting
 * - Media messages
 * - Inline keyboards
 * - Webhook setup
 */
export class TelegramService implements IChannelAdapter {
  readonly channel: Channel = Channel.TELEGRAM;
  
  private botToken: string;
  private baseUrl: string;
  private webhookSecret: string;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    this.webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  /**
   * Send Telegram message
   */
  async sendMessage(
    customerIdentifier: { telegramId?: string },
    content: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const chatId = customerIdentifier.telegramId;
      if (!chatId) {
        throw new Error('Telegram ID (chat_id) required');
      }

      const businessId = metadata?.businessId;
      if (!businessId) {
        throw new Error('Business ID required');
      }

      // Telegram is free! Just need to track AI costs
      const budgetCheck = await BudgetService.hasBudgetAvailable(businessId, 0);
      if (!budgetCheck.allowed) {
        logger.warn({ businessId }, 'Telegram message blocked: budget exceeded');
        return { success: false, error: 'Budget exceeded' };
      }

      // Send via Telegram Bot API
      const result = await this.sendViaTelegram(chatId, content, metadata);

      // Log minimal cost (Telegram is free, just track for analytics)
      await CostTrackerService.logAICost({
        businessId,
        customerId: metadata?.customerId,
        conversationId: metadata?.conversationId,
        service: 'OPENAI_GPT',
        cost: 0,
        channel: this.channel,
        metadata: {
          to: chatId,
          messageId: result.messageId,
          platform: 'TELEGRAM',
        },
      });

      logger.info(
        { 
          businessId, 
          chatId,
          messageId: result.messageId 
        },
        'Telegram message sent'
      );

      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (error) {
      logger.error({ error, chatId: customerIdentifier.telegramId }, 'Failed to send Telegram message');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Telegram delivery failed',
      };
    }
  }

  /**
   * Send message via Telegram Bot API
   */
  private async sendViaTelegram(
    chatId: string,
    text: string,
    metadata?: Record<string, any>
  ): Promise<{ messageId: string }> {
    const url = `${this.baseUrl}/sendMessage`;

    const payload: any = {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
      disable_notification: false,
    };

    // Add reply to specific message
    if (metadata?.replyToMessageId) {
      payload.reply_to_message_id = metadata.replyToMessageId;
    }

    // Add inline keyboard if provided
    if (metadata?.inlineKeyboard) {
      payload.reply_markup = {
        inline_keyboard: metadata.inlineKeyboard,
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Telegram API error: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    return { messageId: data.result?.message_id?.toString() };
  }

  /**
   * Validate Telegram webhook
   * Telegram doesn't use signatures, we validate by checking update structure
   */
  validateWebhook(payload: unknown, signature?: string): boolean {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    const data = payload as any;
    // Telegram updates have 'update_id' field
    return typeof data.update_id === 'number';
  }

  /**
   * Parse Telegram webhook payload
   */
  parseWebhook(payload: unknown): {
    businessId: string;
    customerIdentifier: { telegramId: string };
    content: string;
    metadata: Record<string, any>;
  } | null {
    try {
      const data = payload as any;

      // Extract message from various update types
      const message = data.message || data.edited_message || data.callback_query?.message;
      if (!message) {
        return null;
      }

      const chat = message.chat;
      const from = message.from;

      // Extract content based on message type
      let content = '';
      const messageType = this.getMessageType(message);

      switch (messageType) {
        case 'text':
          content = message.text || '';
          break;
        case 'photo':
          content = message.caption || '[Photo]';
          break;
        case 'document':
          content = message.caption || `[Document: ${message.document?.file_name || 'file'}]`;
          break;
        case 'voice':
        case 'audio':
          content = message.caption || '[Voice message]';
          break;
        case 'video':
          content = message.caption || '[Video]';
          break;
        case 'location':
          content = `[Location: ${message.location?.latitude}, ${message.location?.longitude}]`;
          break;
        case 'callback_query':
          content = data.callback_query?.data || '[Button click]';
          break;
        default:
          content = `[${messageType} message]`;
      }

      if (!content) {
        return null;
      }

      return {
        businessId: data.businessId || 'default', // Telegram doesn't provide this, map by bot token
        customerIdentifier: {
          telegramId: chat.id.toString(),
        },
        content,
        metadata: {
          messageId: message.message_id?.toString(),
          chatId: chat.id?.toString(),
          chatType: chat.type,
          fromId: from?.id?.toString(),
          fromUsername: from?.username,
          fromFirstName: from?.first_name,
          fromLastName: from?.last_name,
          timestamp: message.date,
          type: messageType,
          updateId: data.update_id,
        },
      };
    } catch (error) {
      logger.error({ error, payload }, 'Failed to parse Telegram webhook');
      return null;
    }
  }

  /**
   * Get message type from Telegram message object
   */
  private getMessageType(message: any): string {
    if (message.text) return 'text';
    if (message.photo) return 'photo';
    if (message.document) return 'document';
    if (message.voice) return 'voice';
    if (message.audio) return 'audio';
    if (message.video) return 'video';
    if (message.location) return 'location';
    if (message.contact) return 'contact';
    if (message.sticker) return 'sticker';
    return 'unknown';
  }

  /**
   * Format response for Telegram
   * Telegram supports Markdown and HTML
   */
  formatResponse(response: IAgentResponse): string {
    let formatted = response.content;

    // Telegram MarkdownV2 requires escaping special chars
    // But standard Markdown is supported for most cases
    formatted = formatted
      .replace(/\*\*(.+?)\*\*/g, '*$1*')     // Bold
      .replace(/_(.+?)_/g, '_$1_')           // Italic (keep)
      .replace(/`(.+?)`/g, '`$1`')           // Code (keep)
      .replace(/#{1,6}\s(.+)/g, '*$1*')      // Headers -> bold
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '[$1]($2)'); // Links (keep)

    // Escape special chars for Telegram MarkdownV2
    // Characters to escape: _ * [ ] ( ) ~ ` > # + - = | { } . !
    const escapeChars = '_*[]()~`>#+-=|{}.!';
    let escaped = '';
    for (const char of formatted) {
      if (escapeChars.includes(char)) {
        escaped += '\\' + char;
      } else {
        escaped += char;
      }
    }

    // Limit length (Telegram limit is 4096)
    if (escaped.length > 4096) {
      escaped = escaped.substring(0, 4093) + '...';
    }

    return escaped;
  }

  /**
   * Get cost estimate for Telegram
   * Telegram Bot API is FREE!
   */
  getCostEstimate(): number {
    return 0;
  }

  /**
   * Set webhook URL for this bot
   */
  async setWebhook(webhookUrl: string): Promise<{ success: boolean; error?: string }> {
    try {
      const url = `${this.baseUrl}/setWebhook`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: webhookUrl,
          max_connections: 40,
          allowed_updates: ['message', 'edited_message', 'callback_query'],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Webhook setup error: ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      
      if (data.ok) {
        logger.info({ webhookUrl }, 'Telegram webhook set successfully');
        return { success: true };
      } else {
        return { success: false, error: data.description };
      }
    } catch (error) {
      logger.error({ error, webhookUrl }, 'Failed to set Telegram webhook');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Webhook setup failed',
      };
    }
  }

  /**
   * Remove webhook (switch to polling)
   */
  async removeWebhook(): Promise<{ success: boolean; error?: string }> {
    try {
      const url = `${this.baseUrl}/deleteWebhook`;

      const response = await fetch(url, {
        method: 'POST',
      });

      const data = await response.json();
      
      if (data.ok) {
        logger.info('Telegram webhook removed');
        return { success: true };
      } else {
        return { success: false, error: data.description };
      }
    } catch (error) {
      logger.error({ error }, 'Failed to remove Telegram webhook');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Webhook removal failed',
      };
    }
  }

  /**
   * Send typing indicator
   */
  async sendChatAction(chatId: string, action: 'typing' | 'upload_photo' | 'upload_document'): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/sendChatAction`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          action,
        }),
      });

      return response.ok;
    } catch (error) {
      logger.error({ error, chatId }, 'Failed to send chat action');
      return false;
    }
  }

  /**
   * Send media group (multiple photos/documents)
   */
  async sendMediaGroup(
    chatId: string,
    media: Array<{ type: 'photo' | 'video' | 'document'; media: string; caption?: string }>
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const url = `${this.baseUrl}/sendMediaGroup`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          media,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Media group error: ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      return { success: true, messageId: data.result?.[0]?.message_id?.toString() };
    } catch (error) {
      logger.error({ error, chatId }, 'Failed to send media group');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Media group failed',
      };
    }
  }
}
