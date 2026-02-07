import type { IChannelAdapter, IChannelConfig } from '../base/channel.types';
import { Channel, IAgentResponse } from '@/types/channel.types';
import { ChatGateway } from './chat.gateway';
import { logger } from '@/utils/logger';
import { CostTrackerService } from '@/features/cost-control/cost-tracker.service';

/**
 * Chat Service - Socket.io Implementation
 * 
 * Handles:
 * - WebSocket message delivery
 * - Session management
 * - Chat room operations
 */
export class ChatService implements IChannelAdapter {
  readonly channel: Channel = Channel.CHAT;
  
  private gateway: ChatGateway | null = null;

  /**
   * Set the gateway instance (called during initialization)
   */
  setGateway(gateway: ChatGateway): void {
    this.gateway = gateway;
  }

  /**
   * Send message to a chat session
   */
  async sendMessage(
    customerIdentifier: { sessionToken?: string },
    content: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      if (!this.gateway) {
        throw new Error('Chat gateway not initialized');
      }

      const { sessionToken } = customerIdentifier;
      if (!sessionToken) {
        throw new Error('Session token required for chat');
      }

      // TODO: Store message and deliver via Socket.io
      // For now, just log
      logger.info(
        { sessionToken, content: content.substring(0, 100) },
        'Chat message sent'
      );

      // Log cost (Chat is free - no external API)
      if (metadata?.businessId) {
        await CostTrackerService.logAICost({
          businessId: metadata.businessId,
          customerId: metadata?.customerId,
          conversationId: metadata?.conversationId,
          service: 'OPENAI_GPT',
          cost: 0, // No additional cost for chat delivery
          channel: this.channel,
          metadata: {
            delivered: true,
            channel: 'CHAT',
          },
        });
      }

      return {
        success: true,
        messageId: sessionToken,
      };
    } catch (error) {
      logger.error({ error, sessionToken: customerIdentifier.sessionToken }, 'Failed to send chat message');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Chat delivery failed',
      };
    }
  }

  /**
   * Webhook validation (not applicable for WebSocket)
   */
  validateWebhook(payload: unknown, signature?: string): boolean {
    // Chat uses WebSocket, not webhooks
    return true;
  }

  /**
   * Webhook parsing (not applicable for WebSocket)
   */
  parseWebhook(payload: unknown): {
    businessId: string;
    customerIdentifier: { sessionToken: string };
    content: string;
    metadata: Record<string, any>;
  } | null {
    // Chat uses WebSocket, not webhooks
    return null;
  }

  /**
   * Format response for chat
   * Supports markdown and rich formatting
   */
  formatResponse(response: IAgentResponse): string {
    // Chat supports full formatting including markdown
    // Just return as-is, frontend will render markdown
    return response.content;
  }

  /**
   * Get cost estimate (Chat is essentially free)
   */
  getCostEstimate(): number {
    return 0;
  }

  /**
   * Get active session statistics
   */
  getStats(): { activeSessions: number } {
    if (!this.gateway) {
      return { activeSessions: 0 };
    }
    
    return {
      activeSessions: this.gateway.getActiveSessionCount(),
    };
  }
}
