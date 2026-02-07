import type { IChannelAdapter, IChannelConfig } from './channel.types';
import { Channel } from '../../types/channel.types';
import { VoiceService } from '../voice/voice.service';
import { ChatService } from '../chat/chat.service';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';
import { WhatsAppService } from '../social/whatsapp/whatsapp.service';
import { TelegramService } from '../social/telegram/telegram.service';
import { InstagramService } from '../social/instagram/instagram.service';

/**
 * Channel Factory - Routes messages to the correct channel adapter
 * 
 * Implements the Factory pattern to manage all 7 channel adapters:
 * - Voice (Exotel)
 * - Chat (Socket.io)
 * - Email (SendGrid)
 * - SMS (Exotel)
 * - WhatsApp (Meta)
 * - Telegram (Bot API)
 * - Instagram (Meta)
 */
export class ChannelFactory {
  private static adapters: Map<Channel, IChannelAdapter> = new Map();
  private static configs: Map<Channel, IChannelConfig> = new Map();

  /**
   * Initialize all channel adapters with their configurations
   * Called once at application startup
   */
  static initialize(): void {
    // Voice - Exotel
    this.registerAdapter(Channel.VOICE, VoiceService, {
      enabled: true,
      apiKey: process.env.EXOTEL_API_KEY,
      apiSecret: process.env.EXOTEL_API_TOKEN,
      phoneNumber: process.env.EXOTEL_PHONE_NUMBER,
    });

    // Chat - Socket.io (no external API needed)
    this.registerAdapter(Channel.CHAT, ChatService, {
      enabled: true,
    });

    // Email - SendGrid
    this.registerAdapter(Channel.EMAIL, EmailService, {
      enabled: true,
      apiKey: process.env.SENDGRID_API_KEY,
      webhookSecret: process.env.SENDGRID_WEBHOOK_SECRET,
    });

    // SMS - Exotel
    this.registerAdapter(Channel.SMS, SmsService, {
      enabled: true,
      apiKey: process.env.EXOTEL_API_KEY,
      apiSecret: process.env.EXOTEL_API_TOKEN,
      phoneNumber: process.env.EXOTEL_PHONE_NUMBER,
    });

    // WhatsApp - Meta
    this.registerAdapter(Channel.WHATSAPP, WhatsAppService, {
      enabled: true,
      apiKey: process.env.META_ACCESS_TOKEN,
      apiSecret: process.env.META_APP_SECRET,
      businessAccountId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    });

    // Telegram - Bot API
    this.registerAdapter(Channel.TELEGRAM, TelegramService, {
      enabled: true,
      botToken: process.env.TELEGRAM_BOT_TOKEN,
    });

    // Instagram - Meta
    this.registerAdapter(Channel.INSTAGRAM, InstagramService, {
      enabled: true,
      apiKey: process.env.META_ACCESS_TOKEN,
      apiSecret: process.env.META_APP_SECRET,
    });
  }

  /**
   * Register a channel adapter
   */
  private static registerAdapter(
    channel: Channel,
    AdapterClass: new () => IChannelAdapter,
    config: IChannelConfig
  ): void {
    if (config.enabled) {
      const adapter = new AdapterClass();
      this.adapters.set(channel, adapter);
      this.configs.set(channel, config);
    }
  }

  /**
   * Get the adapter for a specific channel
   */
  static getAdapter(channel: Channel): IChannelAdapter | null {
    return this.adapters.get(channel) || null;
  }

  /**
   * Check if a channel is enabled
   */
  static isChannelEnabled(channel: Channel): boolean {
    return this.adapters.has(channel);
  }

  /**
   * Get all enabled channels
   */
  static getEnabledChannels(): Channel[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Send a message through the specified channel
   * Convenience method that uses the appropriate adapter
   */
  static async sendMessage(
    channel: Channel,
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
  }> {
    const adapter = this.getAdapter(channel);
    
    if (!adapter) {
      return {
        success: false,
        error: `Channel ${channel} is not enabled or configured`,
      };
    }

    try {
      return await adapter.sendMessage(customerIdentifier, content, metadata);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get configuration for a channel
   */
  static getConfig(channel: Channel): IChannelConfig | null {
    return this.configs.get(channel) || null;
  }
}
