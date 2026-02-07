import type { IChannelAdapter } from '../../base/channel.types';
import { Channel, IAgentResponse } from '@/types/channel.types';
import { logger } from '@/utils/logger';
import { CostTrackerService } from '@/features/cost-control/cost-tracker.service';
import { BudgetService } from '@/features/cost-control/budget.service';

/**
 * WhatsApp Service - Meta Cloud API Integration
 * 
 * Handles:
 * - Sending text messages
 * - Media messages (images, documents)
 * - Template messages
 * - Interactive messages (buttons, lists)
 * - Webhook verification
 */
export class WhatsAppService implements IChannelAdapter {
  readonly channel: Channel = Channel.WHATSAPP;
  
  private apiToken: string;
  private phoneNumberId: string;
  private baseUrl: string;
  private webhookSecret: string;

  constructor() {
    this.apiToken = process.env.META_ACCESS_TOKEN || '';
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    this.webhookSecret = process.env.META_APP_SECRET || '';
    this.baseUrl = 'https://graph.facebook.com/v18.0';
  }

  /**
   * Send WhatsApp message
   * Supports text, media, templates, and interactive messages
   */
  async sendMessage(
    customerIdentifier: { whatsappId?: string; phone?: string },
    content: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const recipientId = customerIdentifier.whatsappId || customerIdentifier.phone;
      if (!recipientId) {
        throw new Error('WhatsApp ID or phone number required');
      }

      const businessId = metadata?.businessId;
      if (!businessId) {
        throw new Error('Business ID required');
      }

      // Check budget (~$0.005 per conversation-based message)
      const estimatedCost = metadata?.templateName ? 0.008 : 0.005;
      
      const budgetCheck = await BudgetService.hasBudgetAvailable(businessId, estimatedCost);
      if (!budgetCheck.allowed) {
        logger.warn({ businessId }, 'WhatsApp message blocked: budget exceeded');
        return { success: false, error: 'Budget exceeded' };
      }

      // Determine message type
      const messageType = metadata?.templateName ? 'template' : 'text';
      let result: { messageId: string };

      if (messageType === 'template') {
        result = await this.sendTemplateMessage(recipientId, metadata);
      } else {
        result = await this.sendTextMessage(recipientId, content, metadata);
      }

      // Log cost
      await CostTrackerService.logExternalCost({
        businessId,
        customerId: metadata?.customerId,
        conversationId: metadata?.conversationId,
        service: 'WHATSAPP_API',
        cost: estimatedCost,
        channel: this.channel,
        metadata: {
          to: recipientId,
          messageId: result.messageId,
          messageType,
          templateName: metadata?.templateName,
        },
      });

      logger.info(
        { 
          businessId, 
          to: recipientId,
          messageType,
          messageId: result.messageId 
        },
        'WhatsApp message sent'
      );

      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (error) {
      logger.error({ error, recipient: customerIdentifier.whatsappId }, 'Failed to send WhatsApp message');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'WhatsApp delivery failed',
      };
    }
  }

  /**
   * Send text message via WhatsApp Cloud API
   */
  private async sendTextMessage(
    to: string,
    text: string,
    metadata?: Record<string, any>
  ): Promise<{ messageId: string }> {
    const url = `${this.baseUrl}/${this.phoneNumberId}/messages`;

    const payload: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.formatPhoneNumber(to),
      type: 'text',
      text: {
        preview_url: true,
        body: text,
      },
    };

    // Add reply context if replying to a message
    if (metadata?.replyToMessageId) {
      payload.context = {
        message_id: metadata.replyToMessageId,
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`WhatsApp API error: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    return { messageId: data.messages?.[0]?.id || `wa-${Date.now()}` };
  }

  /**
   * Send template message (for proactive notifications)
   */
  private async sendTemplateMessage(
    to: string,
    metadata?: Record<string, any>
  ): Promise<{ messageId: string }> {
    const url = `${this.baseUrl}/${this.phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.formatPhoneNumber(to),
      type: 'template',
      template: {
        name: metadata?.templateName,
        language: {
          code: metadata?.languageCode || 'en_US',
        },
        components: metadata?.templateComponents || [],
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`WhatsApp template error: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    return { messageId: data.messages?.[0]?.id };
  }

  /**
   * Validate Meta webhook signature
   * https://developers.facebook.com/docs/messenger-platform/webhooks#verify_signature
   */
  validateWebhook(payload: unknown, signature?: string): boolean {
    // In production, implement proper signature verification
    // X-Hub-Signature-256 header contains HMAC-SHA256 signature
    
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    const data = payload as any;
    // Meta webhooks have 'object' field set to 'whatsapp_business_account'
    return data.object === 'whatsapp_business_account';
  }

  /**
   * Parse WhatsApp webhook payload
   */
  parseWebhook(payload: unknown): {
    businessId: string;
    customerIdentifier: { whatsappId: string; phone?: string };
    content: string;
    metadata: Record<string, any>;
  } | null {
    try {
      const data = payload as any;

      // Extract entry and changes
      const entry = data.entry?.[0];
      if (!entry) {
        return null;
      }

      const changes = entry.changes?.[0];
      if (!changes || changes.field !== 'messages') {
        return null;
      }

      const value = changes.value;
      const messages = value.messages;
      
      if (!messages || messages.length === 0) {
        return null;
      }

      const message = messages[0];
      const contact = value.contacts?.[0];

      // Extract content based on message type
      let content = '';
      const messageType = message.type;

      switch (messageType) {
        case 'text':
          content = message.text?.body || '';
          break;
        case 'image':
          content = '[Image received]';
          break;
        case 'document':
          content = `[Document: ${message.document?.filename || 'file'}]`;
          break;
        case 'audio':
        case 'voice':
          content = '[Voice message]';
          break;
        case 'video':
          content = '[Video received]';
          break;
        case 'location':
          content = `[Location: ${message.location?.latitude}, ${message.location?.longitude}]`;
          break;
        case 'interactive':
          content = message.interactive?.button_reply?.title || 
                   message.interactive?.list_reply?.title || 
                   '[Interactive response]';
          break;
        default:
          content = `[${messageType} message]`;
      }

      if (!content) {
        return null;
      }

      return {
        businessId: value.metadata?.phone_number_id || this.phoneNumberId,
        customerIdentifier: {
          whatsappId: contact?.wa_id || message.from,
          phone: contact?.wa_id || message.from,
        },
        content,
        metadata: {
          messageId: message.id,
          timestamp: message.timestamp,
          type: messageType,
          profileName: contact?.profile?.name,
          businessPhoneNumberId: value.metadata?.phone_number_id,
        },
      };
    } catch (error) {
      logger.error({ error, payload }, 'Failed to parse WhatsApp webhook');
      return null;
    }
  }

  /**
   * Format response for WhatsApp
   * Supports markdown-style formatting
   */
  formatResponse(response: IAgentResponse): string {
    let formatted = response.content;

    // WhatsApp supports limited markdown:
    // *bold*, _italic_, ~strikethrough~, ```code```
    
    // Convert standard markdown to WhatsApp format
    formatted = formatted
      .replace(/\*\*(.+?)\*\*/g, '*$1*')      // Bold
      .replace(/_(.+?)_/g, '_$1_')           // Italic (keep)
      .replace(/`(.+?)`/g, '`$1`')           // Code (keep)
      .replace(/#{1,6}\s/g, '*')             // Headers -> bold
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2'); // Links

    // Limit length (WhatsApp has high limit but keep it reasonable)
    if (formatted.length > 4000) {
      formatted = formatted.substring(0, 3997) + '...';
    }

    return formatted;
  }

  /**
   * Get cost estimate for WhatsApp
   * ~$0.005 per message (conversation-based pricing)
   */
  getCostEstimate(): number {
    return 0.005;
  }

  /**
   * Format phone number for WhatsApp API
   * Must be in E.164 format without + prefix
   */
  private formatPhoneNumber(phone: string): string {
    return phone.replace(/\D/g, '');
  }

  /**
   * Send media message (image, document, audio)
   */
  async sendMediaMessage(
    to: string,
    mediaType: 'image' | 'document' | 'audio' | 'video',
    mediaUrl: string,
    caption?: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const url = `${this.baseUrl}/${this.phoneNumberId}/messages`;

      const payload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: this.formatPhoneNumber(to),
        type: mediaType,
        [mediaType]: {
          link: mediaUrl,
          caption,
        },
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Media message error: ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      
      return {
        success: true,
        messageId: data.messages?.[0]?.id,
      };
    } catch (error) {
      logger.error({ error, to, mediaType }, 'Failed to send WhatsApp media');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Media delivery failed',
      };
    }
  }

  /**
   * Mark message as read
   */
  async markAsRead(messageId: string): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/${this.phoneNumberId}/messages`;

      const payload = {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      return response.ok;
    } catch (error) {
      logger.error({ error, messageId }, 'Failed to mark message as read');
      return false;
    }
  }
}
