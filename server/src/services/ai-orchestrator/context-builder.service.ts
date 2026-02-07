/**
 * Context Builder Service
 * Enhanced context assembly for AI conversations
 * 
 * Builds rich context including:
 * - Customer profile and history
 * - Recent conversation messages
 * - Relevant memories from past interactions
 * - Business configuration and rules
 * - Current session state
 */

import { db } from '@/config/database';
import { MemoryService } from '@/features/memory/memory.service';
import { logger } from '@/utils/logger';
import type { IConversationContext, Channel } from '@/types/channel.types';

export interface ContextBuildOptions {
  customerId: string;
  businessId: string;
  conversationId: string;
  currentQuery: string;
  channel: Channel;
  includeFullHistory?: boolean;
  maxMemories?: number;
  maxMessages?: number;
  timeWindowHours?: number;
}

export interface EnrichedContext extends IConversationContext {
  session: {
    messageCount: number;
    startTime: Date;
    channel: Channel;
    lastMessageAt?: Date;
  };
  customerMetrics: {
    totalConversations: number;
    totalMessages: number;
    firstInteraction: Date;
    lastInteraction: Date;
    avgResponseTime?: number;
  };
  businessRules: {
    operatingHours?: string;
    timezone?: string;
    escalationTriggers?: string[];
    prohibitedTopics?: string[];
  };
}

export class ContextBuilderService {
  /**
   * Build complete enriched context for AI processing
   */
  static async buildContext(options: ContextBuildOptions): Promise<EnrichedContext> {
    const startTime = Date.now();
    
    try {
      // Fetch all context data in parallel
      const [
        customerData,
        businessData,
        recentMessages,
        relevantMemories,
        conversationStats,
        customerMetrics,
      ] = await Promise.all([
        this.fetchCustomerData(options.customerId),
        this.fetchBusinessData(options.businessId),
        this.fetchRecentMessages(options.conversationId, options.maxMessages || 10),
        this.fetchRelevantMemories(options.customerId, options.currentQuery, options.maxMemories || 3),
        this.fetchConversationStats(options.conversationId),
        this.fetchCustomerMetrics(options.customerId, options.businessId),
      ]);

      const buildDuration = Date.now() - startTime;

      logger.debug(
        {
          customerId: options.customerId,
          buildDurationMs: buildDuration,
          memoriesCount: relevantMemories.length,
          messagesCount: recentMessages.length,
        },
        'Context built successfully'
      );

      return {
        customer: customerData,
        recentMessages,
        relevantMemories,
        business: businessData,
        session: {
          messageCount: conversationStats.messageCount,
          startTime: conversationStats.startedAt,
          channel: options.channel,
          lastMessageAt: conversationStats.lastMessageAt,
        },
        customerMetrics,
        businessRules: this.extractBusinessRules(businessData.config),
      };
    } catch (error) {
      logger.error(
        { error, customerId: options.customerId, conversationId: options.conversationId },
        'Failed to build context'
      );
      throw error;
    }
  }

  /**
   * Fetch customer data with essential fields
   */
  private static async fetchCustomerData(customerId: string) {
    const customer = await db.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        preferences: true,
        metadata: true,
        trustScore: true,
        isVerified: true,
        tags: true,
        firstInteraction: true,
        lastInteraction: true,
      },
    });

    if (!customer) {
      throw new Error(`Customer not found: ${customerId}`);
    }

    return {
      id: customer.id,
      name: customer.name || undefined,
      phone: customer.phone || undefined,
      email: customer.email || undefined,
      preferences: (customer.preferences as Record<string, any>) || undefined,
      metadata: (customer.metadata as Record<string, any>) || undefined,
      trustScore: customer.trustScore,
      isVerified: customer.isVerified,
      tags: customer.tags,
      firstInteraction: customer.firstInteraction,
      lastInteraction: customer.lastInteraction,
    };
  }

  /**
   * Fetch business data with configuration
   */
  private static async fetchBusinessData(businessId: string) {
    const business = await db.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
        industry: true,
        phone: true,
        email: true,
        config: true,
      },
    });

    if (!business) {
      throw new Error(`Business not found: ${businessId}`);
    }

    return {
      id: business.id,
      name: business.name,
      industry: business.industry || undefined,
      phone: business.phone || undefined,
      email: business.email || undefined,
      config: (business.config as Record<string, any>) || undefined,
    };
  }

  /**
   * Fetch recent messages from conversation
   */
  private static async fetchRecentMessages(
    conversationId: string,
    limit: number
  ): Promise<IConversationContext['recentMessages']> {
    const messages = await db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        role: true,
        content: true,
        createdAt: true,
        channel: true,
        metadata: true,
      },
    });

    // Reverse to chronological order
    return messages
      .reverse()
      .map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.createdAt,
        channel: m.channel,
        metadata: (m.metadata as Record<string, any>) || undefined,
      }));
  }

  /**
   * Fetch relevant memories using semantic search
   */
  private static async fetchRelevantMemories(
    customerId: string,
    query: string,
    limit: number
  ): Promise<IConversationContext['relevantMemories']> {
    try {
      const memories = await MemoryService.searchMemories(customerId, query, limit);

      return memories.map((m) => ({
        content: m.content,
        source: m.source,
        createdAt: m.createdAt,
        similarity: m.similarity,
      }));
    } catch (error) {
      logger.error({ error, customerId }, 'Failed to fetch relevant memories');
      return [];
    }
  }

  /**
   * Fetch conversation statistics
   */
  private static async fetchConversationStats(conversationId: string) {
    const conversation = await db.conversation.findUnique({
      where: { id: conversationId },
      select: {
        startedAt: true,
        _count: {
          select: { messages: true },
        },
      },
    });

    const lastMessage = await db.message.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    return {
      messageCount: conversation?._count.messages || 0,
      startedAt: conversation?.startedAt || new Date(),
      lastMessageAt: lastMessage?.createdAt,
    };
  }

  /**
   * Fetch customer metrics across all conversations
   */
  private static async fetchCustomerMetrics(customerId: string, businessId: string) {
    const [totalConversations, totalMessages, allMessages] = await Promise.all([
      db.conversation.count({
        where: { customerId, businessId },
      }),
      db.message.count({
        where: { conversation: { customerId, businessId } },
      }),
      db.message.findMany({
        where: {
          conversation: { customerId, businessId },
          role: 'USER',
        },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
        take: 1,
      }),
    ]);

    const customer = await db.customer.findUnique({
      where: { id: customerId },
      select: {
        firstInteraction: true,
        lastInteraction: true,
      },
    });

    return {
      totalConversations,
      totalMessages,
      firstInteraction: customer?.firstInteraction || new Date(),
      lastInteraction: customer?.lastInteraction || new Date(),
    };
  }

  /**
   * Extract business rules from config
   */
  private static extractBusinessRules(config?: Record<string, any>) {
    if (!config) {
      return {};
    }

    return {
      operatingHours: config.operatingHours,
      timezone: config.timezone,
      escalationTriggers: config.escalationTriggers || [],
      prohibitedTopics: config.prohibitedTopics || [],
    };
  }

  /**
   * Build quick context for simple queries (faster, less data)
   */
  static async buildQuickContext(
    customerId: string,
    businessId: string,
    conversationId: string
  ): Promise<Pick<EnrichedContext, 'customer' | 'business' | 'recentMessages'>> {
    const [customer, business, recentMessages] = await Promise.all([
      this.fetchCustomerData(customerId),
      this.fetchBusinessData(businessId),
      this.fetchRecentMessages(conversationId, 5),
    ]);

    return {
      customer,
      business,
      recentMessages,
    };
  }
}
