import { db } from '@/config/database';
import { logger } from '@/utils/logger';
import type { Channel } from '@prisma/client';

// Type definitions
interface DashboardOverview {
  totalCustomers: number;
  totalConversations: number;
  totalMessages: number;
  activeConversations: number;
}

interface DashboardToday {
  newCustomers: number;
  newConversations: number;
  messagesSent: number;
}

interface ChannelStat {
  channel: Channel;
  conversationCount: number;
  messageCount: number;
}

interface DashboardTrends {
  customersGrowth: number;
  conversationsGrowth: number;
  messagesGrowth: number;
}

interface CostServiceBreakdown {
  service: string;
  cost: number;
  count: number;
}

interface CostChannelBreakdown {
  channel: Channel | null;
  cost: number;
  count: number;
}

interface DailyCost {
  date: string;
  cost: number;
}

interface StatusStat {
  status: string;
  count: number;
}

interface ConversationTrend {
  date: string;
  newConversations: number;
  closedConversations: number;
}

interface QueryTypeStat {
  queryType: string;
  hits: number;
  misses: number;
}

interface TopQuery {
  query: string;
  hits: number;
}

interface CacheStatsResult {
  totalCached: number;
  hitRate: number;
  byQueryType: QueryTypeStat[];
  savings: {
    estimatedAiCalls: number;
    estimatedCostSaved: number;
  };
  topQueries: TopQuery[];
}

interface AbuseReasonStat {
  reason: string;
  count: number;
}

interface AbuseTrend {
  date: string;
  blocked: number;
  throttled: number;
}

interface TopBlockedCustomer {
  customerId: string;
  count: number;
}

interface TrustScoreRange {
  range: string;
  count: number;
}

interface TopCustomer {
  id: string;
  name: string;
  conversationCount: number;
  messageCount: number;
}

interface CustomerAnalyticsResult {
  total: number;
  new: number;
  active: number;
  verified: number;
  blocked: number;
  byTrustScore: TrustScoreRange[];
  topCustomers: TopCustomer[];
}

/**
 * AnalyticsService - Calculates analytics data for dashboard
 */
export class AnalyticsService {
  /**
   * Get main dashboard metrics
   */
  static async getDashboardMetrics(businessId: string): Promise<{
    overview: DashboardOverview;
    today: DashboardToday;
    channels: ChannelStat[];
    trends: DashboardTrends;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Get current stats
    const [totalCustomers, totalConversations, totalMessages, activeConversations] = await Promise.all([
      db.customer.count({ where: { businessId } }),
      db.conversation.count({ where: { businessId } }),
      db.message.count({ where: { conversation: { businessId } } }),
      db.conversation.count({ where: { businessId, status: 'ACTIVE' } }),
    ]);

    // Get today's stats
    const [newCustomers, newConversations, messagesSent] = await Promise.all([
      db.customer.count({
        where: { businessId, createdAt: { gte: today } },
      }),
      db.conversation.count({
        where: { businessId, createdAt: { gte: today } },
      }),
      db.message.count({
        where: {
          conversation: { businessId },
          createdAt: { gte: today },
        },
      }),
    ]);

    // Get channel breakdown
    const channelStats = await db.conversation.groupBy({
      by: ['channel'],
      where: { businessId },
      _count: { id: true },
    });

    // Get message counts per channel
    const messageStats = await db.$queryRaw<{ channel: Channel; count: number }[]>`
      SELECT c.channel, COUNT(m.id) as count
      FROM "Conversation" c
      JOIN "Message" m ON m."conversationId" = c.id
      WHERE c."businessId" = ${businessId}
      GROUP BY c.channel
    `;

    const channels: ChannelStat[] = channelStats.map((stat) => ({
      channel: stat.channel,
      conversationCount: stat._count.id,
      messageCount: messageStats.find((m) => m.channel === stat.channel)?.count || 0,
    }));

    // Calculate growth (compare today vs yesterday)
    const [yesterdayCustomers, yesterdayConversations, yesterdayMessages] = await Promise.all([
      db.customer.count({
        where: {
          businessId,
          createdAt: { gte: yesterday, lt: today },
        },
      }),
      db.conversation.count({
        where: {
          businessId,
          createdAt: { gte: yesterday, lt: today },
        },
      }),
      db.message.count({
        where: {
          conversation: { businessId },
          createdAt: { gte: yesterday, lt: today },
        },
      }),
    ]);

    const trends: DashboardTrends = {
      customersGrowth: yesterdayCustomers > 0 ? ((newCustomers - yesterdayCustomers) / yesterdayCustomers) * 100 : 0,
      conversationsGrowth: yesterdayConversations > 0 ? ((newConversations - yesterdayConversations) / yesterdayConversations) * 100 : 0,
      messagesGrowth: yesterdayMessages > 0 ? ((messagesSent - yesterdayMessages) / yesterdayMessages) * 100 : 0,
    };

    return {
      overview: {
        totalCustomers,
        totalConversations,
        totalMessages,
        activeConversations,
      },
      today: {
        newCustomers,
        newConversations,
        messagesSent,
      },
      channels,
      trends,
    };
  }

  /**
   * Get cost breakdown by service and channel
   */
  static async getCostBreakdown(
    businessId: string,
    days: number = 30
  ): Promise<{
    total: number;
    byService: CostServiceBreakdown[];
    byChannel: CostChannelBreakdown[];
    daily: DailyCost[];
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get costs by service
    const byService = await db.$queryRaw<{ service: string; cost: number; count: number }[]>`
      SELECT service, SUM(cost) as cost, COUNT(*) as count
      FROM "CostLog"
      WHERE "businessId" = ${businessId}
      AND "createdAt" >= ${startDate}
      GROUP BY service
      ORDER BY cost DESC
    `;

    // Get costs by channel
    const byChannel = await db.$queryRaw<{ channel: Channel | null; cost: number; count: number }[]>`
      SELECT channel, SUM(cost) as cost, COUNT(*) as count
      FROM "CostLog"
      WHERE "businessId" = ${businessId}
      AND "createdAt" >= ${startDate}
      GROUP BY channel
      ORDER BY cost DESC
    `;

    // Get daily costs
    const daily = await db.$queryRaw<{ date: string; cost: number }[]>`
      SELECT DATE("createdAt") as date, SUM(cost) as cost
      FROM "CostLog"
      WHERE "businessId" = ${businessId}
      AND "createdAt" >= ${startDate}
      GROUP BY DATE("createdAt")
      ORDER BY date DESC
    `;

    const total = byService.reduce((sum, s) => sum + Number(s.cost), 0);

    return {
      total: Number(total.toFixed(4)),
      byService: byService.map((s) => ({
        service: s.service,
        cost: Number(Number(s.cost).toFixed(4)),
        count: Number(s.count),
      })),
      byChannel: byChannel.map((c) => ({
        channel: c.channel,
        cost: Number(Number(c.cost).toFixed(4)),
        count: Number(c.count),
      })),
      daily: daily.map((d) => ({
        date: d.date,
        cost: Number(Number(d.cost).toFixed(4)),
      })),
    };
  }

  /**
   * Get conversation statistics
   */
  static async getConversationStats(
    businessId: string,
    days: number = 30
  ): Promise<{
    total: number;
    byStatus: StatusStat[];
    byChannel: { channel: Channel; count: number }[];
    avgDuration: number;
    avgMessagesPerConversation: number;
    trends: ConversationTrend[];
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [total, byStatus] = await Promise.all([
      db.conversation.count({
        where: { businessId, createdAt: { gte: startDate } },
      }),
      db.conversation.groupBy({
        by: ['status'],
        where: { businessId, createdAt: { gte: startDate } },
        _count: { id: true },
      }),
    ]);

    const byChannel = await db.conversation.groupBy({
      by: ['channel'],
      where: { businessId, createdAt: { gte: startDate } },
      _count: { id: true },
    });

    // Calculate average conversation duration (for closed conversations)
    const avgDuration = await db.$queryRaw<{ avg_duration: number }[]>`
      SELECT AVG(EXTRACT(EPOCH FROM (updatedAt - createdAt))) / 60 as avg_duration
      FROM "Conversation"
      WHERE "businessId" = ${businessId}
      AND status = 'CLOSED'
      AND "createdAt" >= ${startDate}
    `;

    // Calculate average messages per conversation
    const avgMessages = await db.$queryRaw<{ avg_messages: number }[]>`
      SELECT AVG(msg_count) as avg_messages
      FROM (
        SELECT COUNT(m.id) as msg_count
        FROM "Conversation" c
        JOIN "Message" m ON m."conversationId" = c.id
        WHERE c."businessId" = ${businessId}
        AND c."createdAt" >= ${startDate}
        GROUP BY c.id
      ) as msg_counts
    `;

    // Get daily trends
    const trends = await db.$queryRaw<{ date: string; new: number; closed: number }[]>`
      SELECT 
        DATE("createdAt") as date,
        COUNT(*) FILTER (WHERE status != 'CLOSED' OR status IS NULL) as new,
        COUNT(*) FILTER (WHERE status = 'CLOSED') as closed
      FROM "Conversation"
      WHERE "businessId" = ${businessId}
      AND "createdAt" >= ${startDate}
      GROUP BY DATE("createdAt")
      ORDER BY date DESC
    `;

    return {
      total,
      byStatus: byStatus.map((s) => ({
        status: s.status,
        count: s._count.id,
      })),
      byChannel: byChannel.map((c) => ({
        channel: c.channel,
        count: c._count.id,
      })),
      avgDuration: Math.round(avgDuration[0]?.avg_duration || 0),
      avgMessagesPerConversation: Math.round(avgMessages[0]?.avg_messages || 0),
      trends: trends.map((t) => ({
        date: t.date,
        newConversations: Number(t.new),
        closedConversations: Number(t.closed),
      })),
    };
  }

  /**
   * Get cache statistics
   */
  static async getCacheStats(businessId: string): Promise<CacheStatsResult> {
    // Get cached responses count
    const totalCached = await db.responseCache.count({
      where: { businessId },
    });

    // Get cache hits and misses from message logs
    const cacheStats = await db.$queryRaw<{ query_type: string; hits: number; misses: number }[]>`
      SELECT 
        'cached' as query_type,
        COUNT(*) FILTER (WHERE "cachedResponse" = true) as hits,
        COUNT(*) FILTER (WHERE "cachedResponse" = false OR "cachedResponse" IS NULL) as misses
      FROM "Message"
      WHERE "conversationId" IN (
        SELECT id FROM "Conversation" WHERE "businessId" = ${businessId}
      )
    `;

    const hits = Number(cacheStats[0]?.hits || 0);
    const misses = Number(cacheStats[0]?.misses || 0);
    const total = hits + misses;
    const hitRate = total > 0 ? (hits / total) * 100 : 0;

    // Estimate savings (assume $0.001 per AI call)
    const estimatedCostSaved = hits * 0.001;

    // Get top cached queries
    const topQueries = await db.responseCache.findMany({
      where: { businessId },
      orderBy: { hitCount: 'desc' },
      take: 10,
      select: {
        query: true,
        hitCount: true,
      },
    });

    return {
      totalCached,
      hitRate: Math.round(hitRate * 100) / 100,
      byQueryType: [
        {
          queryType: 'cached',
          hits,
          misses,
        },
      ],
      savings: {
        estimatedAiCalls: hits,
        estimatedCostSaved: Number(estimatedCostSaved.toFixed(4)),
      },
      topQueries: topQueries.map((q) => ({
        query: q.query.substring(0, 100),
        hits: q.hitCount,
      })),
    };
  }

  /**
   * Get abuse detection statistics
   */
  static async getAbuseStats(
    businessId: string,
    days: number = 30
  ): Promise<{
    totalBlocked: number;
    totalThrottled: number;
    byReason: AbuseReasonStat[];
    trends: AbuseTrend[];
    topBlockedCustomers: TopBlockedCustomer[];
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [totalBlocked, totalThrottled] = await Promise.all([
      db.abuseLog.count({
        where: {
          businessId,
          action: 'BLOCKED',
          createdAt: { gte: startDate },
        },
      }),
      db.abuseLog.count({
        where: {
          businessId,
          action: 'THROTTLED',
          createdAt: { gte: startDate },
        },
      }),
    ]);

    const byReason = await db.abuseLog.groupBy({
      by: ['reason'],
      where: {
        businessId,
        createdAt: { gte: startDate },
      },
      _count: { id: true },
    });

    const trends = await db.$queryRaw<{ date: string; blocked: number; throttled: number }[]>`
      SELECT 
        DATE("createdAt") as date,
        COUNT(*) FILTER (WHERE action = 'BLOCKED') as blocked,
        COUNT(*) FILTER (WHERE action = 'THROTTLED') as throttled
      FROM "AbuseLog"
      WHERE "businessId" = ${businessId}
      AND "createdAt" >= ${startDate}
      GROUP BY DATE("createdAt")
      ORDER BY date DESC
    `;

    const topBlockedCustomers = await db.$queryRaw<{ customerId: string; count: number }[]>`
      SELECT "customerId", COUNT(*) as count
      FROM "AbuseLog"
      WHERE "businessId" = ${businessId}
      AND action = 'BLOCKED'
      AND "createdAt" >= ${startDate}
      GROUP BY "customerId"
      ORDER BY count DESC
      LIMIT 10
    `;

    return {
      totalBlocked,
      totalThrottled,
      byReason: byReason.map((r) => ({
        reason: r.reason,
        count: r._count.id,
      })),
      trends: trends.map((t) => ({
        date: t.date,
        blocked: Number(t.blocked),
        throttled: Number(t.throttled),
      })),
      topBlockedCustomers: topBlockedCustomers.map((c) => ({
        customerId: c.customerId,
        count: Number(c.count),
      })),
    };
  }

  /**
   * Get customer analytics
   */
  static async getCustomerAnalytics(
    businessId: string,
    days: number = 30
  ): Promise<CustomerAnalyticsResult> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [total, newCustomers, verified, blocked] = await Promise.all([
      db.customer.count({ where: { businessId } }),
      db.customer.count({ where: { businessId, createdAt: { gte: startDate } } }),
      db.customer.count({ where: { businessId, isVerified: true } }),
      db.customer.count({ where: { businessId, isBlocked: true } }),
    ]);

    // Get customers with conversations in the last 30 days
    const active = await db.customer.count({
      where: {
        businessId,
        conversations: {
          some: {
            updatedAt: { gte: startDate },
          },
        },
      },
    });

    // Get trust score distribution
    const byTrustScore = await db.$queryRaw<{ range: string; count: number }[]>`
      SELECT 
        CASE 
          WHEN "trustScore" >= 90 THEN '90-100'
          WHEN "trustScore" >= 70 THEN '70-89'
          WHEN "trustScore" >= 50 THEN '50-69'
          WHEN "trustScore" >= 30 THEN '30-49'
          ELSE '0-29'
        END as range,
        COUNT(*) as count
      FROM "Customer"
      WHERE "businessId" = ${businessId}
      GROUP BY range
      ORDER BY range DESC
    `;

    // Get top customers by activity
    const topCustomers = await db.$queryRaw<{ id: string; name: string; conversations: number; messages: number }[]>`
      SELECT 
        c.id,
        c.name,
        COUNT(DISTINCT conv.id) as conversations,
        COUNT(m.id) as messages
      FROM "Customer" c
      LEFT JOIN "Conversation" conv ON conv."customerId" = c.id
      LEFT JOIN "Message" m ON m."conversationId" = conv.id
      WHERE c."businessId" = ${businessId}
      GROUP BY c.id, c.name
      ORDER BY messages DESC
      LIMIT 10
    `;

    return {
      total,
      new: newCustomers,
      active,
      verified,
      blocked,
      byTrustScore: byTrustScore.map((t) => ({
        range: t.range,
        count: Number(t.count),
      })),
      topCustomers: topCustomers.map((c) => ({
        id: c.id,
        name: c.name,
        conversationCount: Number(c.conversations),
        messageCount: Number(c.messages),
      })),
    };
  }
}
