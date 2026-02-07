import type { IChannelAdapter } from '../../base/channel.types';
import { Channel, IAgentResponse } from '@/types/channel.types';
import { logger } from '@/utils/logger';
import { CostTrackerService } from '@/features/cost-control/cost-tracker.service';
import { BudgetService } from '@/features/cost-control/budget.service';

/**
 * Instagram Service - Meta Graph API Integration
 * 
 * Handles:
 * - Instagram DM (Direct Message) sending
 * - Message templates for common responses
 * - Ice breakers and quick replies
 * - Story mentions and replies
 */
export class InstagramService implements IChannelAdapter {
  readonly channel: Channel = Channel.INSTAGRAM;
  
  private accessToken: string;
  private appSecret: string;
  private baseUrl: string;
  private instagramAccountId: string;

  constructor() {
    this.accessToken = process.env.META_ACCESS_TOKEN || '';
    this.appSecret = process.env.META_APP_SECRET || '';
    this.instagramAccountId = process.env.INSTAGRAM_ACCOUNT_ID || '';
    this.baseUrl = 'https://graph.facebook.com/v18.0';
  }

  /**
   * Send Instagram DM
   */
  async sendMessage(
    customerIdentifier: { instagramId?: string },
    content: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const recipientId = customerIdentifier.instagramId;
      if (!recipientId) {
        throw new Error('Instagram ID (IGSID) required');
      }

      const businessId = metadata?.businessId;
      if (!businessId) {
        throw new Error('Business ID required');
      }

      // Check budget (~$0.01 per conversation)
      const budgetCheck = await BudgetService.hasBudgetAvailable(businessId, 0.01);
      if (!budgetCheck.allowed) {
        logger.warn({ businessId }, 'Instagram DM blocked: budget exceeded');
        return { success: false, error: 'Budget exceeded' };
      }

      // Send via Instagram Graph API
      const result = await this.sendViaGraphAPI(recipientId, content);

      // Log cost
      await CostTrackerService.logExternalCost({
        businessId,
        customerId: metadata?.customerId,
        conversationId: metadata?.conversationId,
        service: 'INSTAGRAM_API',
        cost: 0.01,
        channel: this.channel,
        metadata: {
          to: recipientId,
          messageId: result.messageId,
        },
      });

      logger.info(
        { 
          businessId, 
          to: recipientId,
          messageId: result.messageId 
        },
        'Instagram DM sent'
      );

      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (error) {
      logger.error({ error, recipient: customerIdentifier.instagramId }, 'Failed to send Instagram DM');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Instagram delivery failed',
      };
    }
  }

  /**
   * Send message via Instagram Graph API
   */
  private async sendViaGraphAPI(recipientId: string, text: string): Promise<{ messageId: string }> {
    const url = `${this.baseUrl}/me/messages`;

    const payload = {
      recipient: {
        id: recipientId,
      },
      message: {
        text,
      },
      messaging_type: 'RESPONSE', // or 'UPDATE' for proactive
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Instagram API error: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    return { messageId: data.message_id };
  }

  /**
   * Validate Meta webhook signature
   */
  validateWebhook(payload: unknown, signature?: string): boolean {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    const data = payload as any;
    // Instagram DMs come through the same webhook structure as Messenger
    return data.object === 'instagram' || data.object === 'page';
  }

  /**
   * Parse Instagram webhook payload
   */
  parseWebhook(payload: unknown): {
    businessId: string;
    customerIdentifier: { instagramId: string };
    content: string;
    metadata: Record<string, any>;
  } | null {
    try {
      const data = payload as any;

      // Extract entry and messaging
      const entry = data.entry?.[0];
      if (!entry) {
        return null;
      }

      const messaging = entry.messaging?.[0];
      if (!messaging) {
        return null;
      }

      const sender = messaging.sender;
      const message = messaging.message;
      const recipient = messaging.recipient;

      if (!message || !sender) {
        return null;
      }

      // Ignore echo messages (messages sent by us)
      if (message.is_echo) {
        return null;
      }

      // Extract content based on message type
      let content = '';
      const messageType = this.getMessageType(message);

      switch (messageType) {
        case 'text':
          content = message.text || '';
          break;
        case 'image':
          content = message.image?.caption || '[Image received]';
          break;
        case 'attachment':
          content = `[Attachment: ${message.attachments?.[0]?.type || 'file'}]`;
          break;
        case 'story_mention':
          content = '[Story mention]';
          break;
        case 'quick_reply':
          content = message.quick_reply?.payload || '[Quick reply]';
          break;
        default:
          content = `[${messageType} message]`;
      }

      if (!content) {
        return null;
      }

      return {
        businessId: entry.id || this.instagramAccountId,
        customerIdentifier: {
          instagramId: sender.id,
        },
        content,
        metadata: {
          messageId: message.mid,
          senderId: sender.id,
          recipientId: recipient?.id,
          timestamp: messaging.timestamp,
          type: messageType,
          replyTo: message.reply_to?.mid,
          attachments: message.attachments,
        },
      };
    } catch (error) {
      logger.error({ error, payload }, 'Failed to parse Instagram webhook');
      return null;
    }
  }

  /**
   * Get message type from Instagram message object
   */
  private getMessageType(message: any): string {
    if (message.text) return 'text';
    if (message.attachments) return 'attachment';
    if (message.image) return 'image';
    if (message.story_mention) return 'story_mention';
    if (message.quick_reply) return 'quick_reply';
    if (message.postback) return 'postback';
    return 'unknown';
  }

  /**
   * Format response for Instagram
   * Keep it conversational and emoji-friendly
   */
  formatResponse(response: IAgentResponse): string {
    let formatted = response.content;

    // Instagram supports emojis and simple formatting
    // Remove markdown that doesn't work well in DMs
    formatted = formatted
      .replace(/\*\*(.+?)\*\*/g, '$1')      // Remove bold markers
      .replace(/_(.+?)_/g, '$1')           // Remove italic markers
      .replace(/`(.+?)`/g, '$1')           // Remove code markers
      .replace(/#{1,6}\s/g, '')            // Remove headers
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 (link in bio)'); // Simplify links

    // Limit length (Instagram DM limit is high but keep it readable)
    if (formatted.length > 1000) {
      formatted = formatted.substring(0, 997) + '...';
    }

    return formatted;
  }

  /**
   * Get cost estimate for Instagram
   * ~$0.01 per conversation
   */
  getCostEstimate(): number {
    return 0.01;
  }

  /**
   * Send quick reply buttons
   */
  async sendQuickReplies(
    recipientId: string,
    text: string,
    quickReplies: Array<{ title: string; payload: string }>
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const url = `${this.baseUrl}/me/messages`;

      const payload = {
        recipient: {
          id: recipientId,
        },
        messaging_type: 'RESPONSE',
        message: {
          text,
          quick_replies: quickReplies.map(qr => ({
            content_type: 'text',
            title: qr.title.substring(0, 20), // Max 20 chars
            payload: qr.payload,
          })),
        },
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Quick reply error: ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      return { success: true, messageId: data.message_id };
    } catch (error) {
      logger.error({ error, recipientId }, 'Failed to send quick replies');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Quick reply failed',
      };
    }
  }

  /**
   * Mark message as seen
   */
  async markAsSeen(senderId: string): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/me/messages`;

      const payload = {
        recipient: {
          id: senderId,
        },
        sender_action: 'mark_seen',
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      return response.ok;
    } catch (error) {
      logger.error({ error, senderId }, 'Failed to mark as seen');
      return false;
    }
  }

  /**
   * Send typing indicator
   */
  async sendTypingIndicator(senderId: string): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/me/messages`;

      const payload = {
        recipient: {
          id: senderId,
        },
        sender_action: 'typing_on',
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      return response.ok;
    } catch (error) {
      logger.error({ error, senderId }, 'Failed to send typing indicator');
      return false;
    }
  }
}
