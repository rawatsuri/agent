import { Channel } from '../../types/channel.types';
import type { IAgentResponse } from '../../types/channel.types';

/**
 * Base interface that all channel adapters must implement
 * This ensures consistent behavior across all 7 channels
 */
export interface IChannelAdapter {
  /** Unique identifier for this channel */
  readonly channel: Channel;

  /**
   * Send a message to a customer through this channel
   * @param customerIdentifier - How to reach the customer (phone, email, etc.)
   * @param content - Message content
   * @param metadata - Channel-specific metadata
   * @returns Promise resolving to delivery status
   */
  sendMessage(
    customerIdentifier: {
      phone?: string;
      email?: string;
      telegramId?: string;
      whatsappId?: string;
      instagramId?: string;
      sessionToken?: string;
    },
    content: string,
    metadata?: Record<string, any>
  ): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
  }>;

  /**
   * Validate incoming webhook request
   * @param payload - Raw webhook payload
   * @param signature - Signature for verification
   * @returns Boolean indicating if request is valid
   */
  validateWebhook(payload: unknown, signature?: string): boolean;

  /**
   * Parse incoming webhook payload into standardized format
   * @param payload - Raw webhook payload
   * @returns Parsed and normalized data
   */
  parseWebhook(payload: unknown): {
    businessId: string;
    customerIdentifier: {
      phone?: string;
      email?: string;
      telegramId?: string;
      whatsappId?: string;
      instagramId?: string;
      sessionToken?: string;
    };
    content: string;
    metadata: Record<string, any>;
  } | null;

  /**
   * Format response for this specific channel
   * Each channel has different formatting requirements:
   * - SMS: Short, concise
   * - Voice: Natural speech patterns
   * - Email: Full formatting
   */
  formatResponse(response: IAgentResponse): string;

  /**
   * Get channel-specific cost per message/call
   */
  getCostEstimate(): number;
}

/**
 * Configuration for a channel adapter
 */
export interface IChannelConfig {
  enabled: boolean;
  apiKey?: string;
  apiSecret?: string;
  webhookSecret?: string;
  webhookUrl?: string;
  phoneNumber?: string; // For voice/SMS
  botToken?: string; // For Telegram
  businessAccountId?: string; // For Meta platforms
}

/**
 * Delivery status for sent messages
 */
export interface IMessageDeliveryStatus {
  success: boolean;
  messageId?: string;
  timestamp: Date;
  error?: string;
  retryCount?: number;
}

/**
 * Webhook event types
 */
export enum WebhookEventType {
  MESSAGE_RECEIVED = 'MESSAGE_RECEIVED',
  MESSAGE_DELIVERED = 'MESSAGE_DELIVERED',
  MESSAGE_READ = 'MESSAGE_READ',
  CALL_STARTED = 'CALL_STARTED',
  CALL_ENDED = 'CALL_ENDED',
  OPT_IN = 'OPT_IN',
  OPT_OUT = 'OPT_OUT',
  ERROR = 'ERROR',
}

/**
 * Standardized webhook payload
 */
export interface IWebhookPayload {
  eventType: WebhookEventType;
  channel: Channel;
  timestamp: Date;
  businessId: string;
  customerIdentifier: {
    phone?: string;
    email?: string;
    telegramId?: string;
    whatsappId?: string;
    instagramId?: string;
    sessionToken?: string;
  };
  content?: string;
  metadata: Record<string, any>;
}
