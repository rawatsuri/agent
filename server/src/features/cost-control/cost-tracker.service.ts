import { db } from '@/config/database';
import { logger } from '@/utils/logger';
import type { Channel, Prisma } from '@prisma/client';

/**
 * Cost Tracker Service
 * 
 * Logs every single cost incurred by the system:
 * - OpenAI API calls (GPT, Embeddings)
 * - Voice synthesis (Azure TTS)
 * - SMS/Voice calls (Exotel, Twilio)
 * - External API calls
 * 
 * Every operation MUST call this service to track costs
 */
export class CostTrackerService {
  /**
   * Log an AI/OpenAI cost
   */
  static async logAICost(params: {
    businessId: string;
    customerId?: string;
    conversationId?: string;
    service: 'OPENAI_GPT' | 'OPENAI_EMBEDDING' | 'AZURE_TTS';
    cost: number;
    tokensUsed?: number;
    model?: string;
    channel?: Channel;
    metadata?: Record<string, any>;
  }): Promise<void> {
    try {
      await db.costLog.create({
        data: {
          businessId: params.businessId,
          customerId: params.customerId,
          conversationId: params.conversationId,
          service: params.service,
          cost: params.cost,
          tokensUsed: params.tokensUsed,
          model: params.model,
          channel: params.channel,
          metadata: params.metadata as Prisma.InputJsonValue,
        },
      });

      // Also update the business credit tracking
      await this.updateBusinessSpend(params.businessId, params.cost);

      logger.debug(
        {
          businessId: params.businessId,
          service: params.service,
          cost: params.cost,
        },
        'Cost logged: AI service'
      );
    } catch (error) {
      logger.error({ error, params }, 'Failed to log AI cost');
      // Don't throw - cost tracking should not break the flow
    }
  }

  /**
   * Log an external service cost (SMS, Voice, Email)
   */
  static async logExternalCost(params: {
    businessId: string;
    customerId?: string;
    conversationId?: string;
    service: 'EXOTEL_SMS' | 'EXOTEL_VOICE' | 'TWILIO_SMS' | 'TWILIO_VOICE' | 'SENDGRID_EMAIL' | 'WHATSAPP_API' | 'INSTAGRAM_API';
    cost: number;
    durationSeconds?: number; // For voice calls
    channel?: Channel;
    metadata?: Record<string, any>;
  }): Promise<void> {
    try {
      await db.costLog.create({
        data: {
          businessId: params.businessId,
          customerId: params.customerId,
          conversationId: params.conversationId,
          service: params.service,
          cost: params.cost,
          durationSeconds: params.durationSeconds,
          channel: params.channel,
          metadata: params.metadata as Prisma.InputJsonValue,
        },
      });

      await this.updateBusinessSpend(params.businessId, params.cost);

      logger.debug(
        {
          businessId: params.businessId,
          service: params.service,
          cost: params.cost,
        },
        'Cost logged: External service'
      );
    } catch (error) {
      logger.error({ error, params }, 'Failed to log external cost');
    }
  }

  /**
   * Update business spend tracking
   */
  private static async updateBusinessSpend(
    businessId: string,
    cost: number
  ): Promise<void> {
    try {
      await db.businessCredit.update({
        where: { businessId },
        data: {
          usedCredits: { increment: cost },
          currentMonthSpend: { increment: cost },
        },
      });
    } catch (error) {
      logger.error({ error, businessId, cost }, 'Failed to update business spend');
    }
  }

  /**
   * Calculate OpenAI GPT cost based on model and tokens
   */
  static calculateGPTCost(model: string, inputTokens: number, outputTokens: number): number {
    // Pricing per 1K tokens (as of 2024)
    const pricing: Record<string, { input: number; output: number }> = {
      'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
      'gpt-4o': { input: 0.005, output: 0.015 },
      'gpt-4-turbo': { input: 0.01, output: 0.03 },
    };

    const modelPricing = pricing[model] || pricing['gpt-4o-mini'];
    
    const inputCost = (inputTokens / 1000) * modelPricing.input;
    const outputCost = (outputTokens / 1000) * modelPricing.output;
    
    return inputCost + outputCost;
  }

  /**
   * Calculate embedding cost
   */
  static calculateEmbeddingCost(tokens: number): number {
    // text-embedding-3-small: $0.02 per 1M tokens
    return (tokens / 1000000) * 0.02;
  }

  /**
   * Calculate Azure TTS cost
   */
  static calculateTTSCost(characters: number): number {
    // Azure TTS: ~$1 per 1M characters (varies by voice)
    return (characters / 1000000) * 1.0;
  }

  /**
   * Get business cost summary for current month
   */
  static async getMonthlyCostSummary(businessId: string): Promise<{
    totalCost: number;
    byService: Record<string, number>;
    byChannel: Record<string, number>;
    messageCount: number;
    tokenCount: number;
  }> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const logs = await db.costLog.findMany({
      where: {
        businessId,
        createdAt: { gte: startOfMonth },
      },
    });

    const summary = {
      totalCost: 0,
      byService: {} as Record<string, number>,
      byChannel: {} as Record<string, number>,
      messageCount: 0,
      tokenCount: 0,
    };

    for (const log of logs) {
      summary.totalCost += Number(log.cost);
      
      summary.byService[log.service] = (summary.byService[log.service] || 0) + Number(log.cost);
      
      if (log.channel) {
        summary.byChannel[log.channel] = (summary.byChannel[log.channel] || 0) + Number(log.cost);
      }
      
      if (log.tokensUsed) {
        summary.tokenCount += log.tokensUsed;
      }
    }

    summary.messageCount = logs.length;

    return summary;
  }

  /**
   * Get real-time cost dashboard data
   */
  static async getCostDashboard(businessId: string): Promise<{
    currentMonthSpend: number;
    monthlyBudget: number;
    budgetUsedPercent: number;
    availableCredits: number;
    isPaused: boolean;
    dailySpend: Array<{ date: string; cost: number }>;
  }> {
    const credit = await db.businessCredit.findUnique({
      where: { businessId },
    });

    if (!credit) {
      throw new Error('Business credit record not found');
    }

    // Get daily spend for last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const logs = await db.costLog.findMany({
      where: {
        businessId,
        createdAt: { gte: thirtyDaysAgo },
      },
      select: {
        cost: true,
        createdAt: true,
      },
    });

    // Group by date
    const dailySpendMap = new Map<string, number>();
    
    for (const log of logs) {
      const date = log.createdAt.toISOString().split('T')[0];
      const current = dailySpendMap.get(date) || 0;
      dailySpendMap.set(date, current + Number(log.cost));
    }

    const dailySpend = Array.from(dailySpendMap.entries())
      .map(([date, cost]) => ({ date, cost: Math.round(cost * 10000) / 10000 }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const budgetUsedPercent = credit.monthlyBudget > 0
      ? Math.round((Number(credit.currentMonthSpend) / Number(credit.monthlyBudget)) * 100)
      : 0;

    return {
      currentMonthSpend: Number(credit.currentMonthSpend),
      monthlyBudget: Number(credit.monthlyBudget),
      budgetUsedPercent,
      availableCredits: Number(credit.totalCredits) - Number(credit.usedCredits),
      isPaused: credit.isPaused,
      dailySpend,
    };
  }
}
