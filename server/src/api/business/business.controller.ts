import type { Request, Response } from 'express';
import { db } from '@/config/database';
import { logger } from '@/utils/logger';
import { resSuccess, resError } from '@/utils/response.utils';
import { BudgetService } from '@/features/cost-control/budget.service';
import { z } from 'zod';

/**
 * BusinessController - Handles business profile and configuration endpoints
 */
export class BusinessController {
  /**
   * GET /api/business/me
   * Get current business profile
   */
  static async getProfile(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;

      const business = await db.businesses.findUnique({
        where: { id: businessId },
        include: {
          credits: true,
          _count: {
            select: {
              customers: true,
              conversations: true,
            },
          },
        },
      });

      if (!business) {
        resError(res, 'Business not found', 404);
        return;
      }

      resSuccess(res, {
        id: business.id,
        name: business.name,
        email: business.email,
        phone: business.phone,
        active: business.active,
        apiKey: business.apiKey,
        createdAt: business.createdAt,
        updatedAt: business.updatedAt,
        stats: {
          customerCount: business._count.customers,
          conversationCount: business._count.conversations,
        },
        credit: business.credits
          ? {
              planType: business.credits.planType,
              totalCredits: Number(business.credits.totalCredits),
              availableCredits:
                Number(business.credits.totalCredits) -
                Number(business.credits.usedCredits),
              monthlyBudget: Number(business.credits.monthlyBudget),
              currentMonthSpend: Number(business.credits.currentMonthSpend),
              isPaused: business.credits.isPaused,
              percentUsed:
                Number(business.credits.monthlyBudget) > 0
                  ? Math.round(
                      (Number(business.credits.currentMonthSpend) /
                        Number(business.credits.monthlyBudget)) *
                        100
                    )
                  : 0,
            }
          : null,
      });
    } catch (error) {
      logger.error({ error }, 'Error fetching business profile');
      resError(res, 'Failed to fetch business profile', 500);
    }
  }

  /**
   * PUT /api/business/me
   * Update business profile
   */
  static async updateProfile(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;

      const updateSchema = z.object({
        name: z.string().min(1).max(100).optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
      });

      const result = updateSchema.safeParse(req.body);
      if (!result.success) {
        resError(res, 'Invalid input data', 400, result.error.format());
        return;
      }

      const business = await db.businesses.update({
        where: { id: businessId },
        data: result.data,
      });

      logger.info({ businessId }, 'Business profile updated');

      resSuccess(res, {
        id: business.id,
        name: business.name,
        email: business.email,
        phone: business.phone,
        updatedAt: business.updatedAt,
      });
    } catch (error) {
      logger.error({ error }, 'Error updating business profile');
      resError(res, 'Failed to update business profile', 500);
    }
  }

  /**
   * GET /api/business/ai-config
   * Get AI configuration
   */
  static async getAIConfig(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;

      const business = await db.businesses.findUnique({
        where: { id: businessId },
        select: {
          id: true,
          config: true,
        },
      });

      if (!business) {
        resError(res, 'Business not found', 404);
        return;
      }

      // Parse config or return defaults
      const config = (business.config as any) || {};
      
      resSuccess(res, {
        personality: config.personality || 'professional',
        tone: config.tone || 'friendly',
        language: config.language || 'en',
        customInstructions: config.customInstructions || '',
        responseStyle: config.responseStyle || 'concise',
        enableProactiveSuggestions: config.enableProactiveSuggestions ?? true,
        maxResponseLength: config.maxResponseLength || 500,
        businessRules: config.businessRules || {},
      });
    } catch (error) {
      logger.error({ error }, 'Error fetching AI config');
      resError(res, 'Failed to fetch AI configuration', 500);
    }
  }

  /**
   * PUT /api/business/ai-config
   * Update AI personality/prompts
   */
  static async updateAIConfig(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;

      const configSchema = z.object({
        personality: z
          .enum(['professional', 'casual', 'friendly', 'formal'])
          .optional(),
        tone: z.enum(['friendly', 'professional', 'empathetic', 'urgent']).optional(),
        language: z.string().length(2).optional(),
        customInstructions: z.string().max(2000).optional(),
        responseStyle: z.enum(['concise', 'detailed', 'balanced']).optional(),
        enableProactiveSuggestions: z.boolean().optional(),
        maxResponseLength: z.number().min(50).max(2000).optional(),
        businessRules: z
          .object({
            operatingHours: z.string().optional(),
            prohibitedTopics: z.array(z.string()).optional(),
            escalationTriggers: z.array(z.string()).optional(),
          })
          .optional(),
      });

      const result = configSchema.safeParse(req.body);
      if (!result.success) {
        resError(res, 'Invalid configuration data', 400, result.error.format());
        return;
      }

      const business = await db.businesses.update({
        where: { id: businessId },
        data: {
          config: result.data,
        },
      });

      logger.info({ businessId }, 'AI configuration updated');

      resSuccess(res, {
        message: 'AI configuration updated successfully',
        config: business.config,
      });
    } catch (error) {
      logger.error({ error }, 'Error updating AI config');
      resError(res, 'Failed to update AI configuration', 500);
    }
  }

  /**
   * GET /api/business/credits
   * Get credit balance and usage
   */
  static async getCredits(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;

      const credit = await db.businessCredit.findUnique({
        where: { businessId },
      });

      if (!credit) {
        resError(res, 'Credit record not found', 404);
        return;
      }

      // Get recent cost logs
      const recentCosts = await db.costLogs.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          service: true,
          channel: true,
          cost: true,
          createdAt: true,
        },
      });

      resSuccess(res, {
        credits: {
          total: Number(credit.totalCredits),
          used: Number(credit.usedCredits),
          available: Number(credit.totalCredits) - Number(credit.usedCredits),
        },
        budget: {
          monthly: Number(credit.monthlyBudget),
          currentSpend: Number(credit.currentMonthSpend),
          remaining: Number(credit.monthlyBudget) - Number(credit.currentMonthSpend),
          percentUsed:
            Number(credit.monthlyBudget) > 0
              ? Math.round(
                  (Number(credit.currentMonthSpend) / Number(credit.monthlyBudget)) * 100
                )
              : 0,
        },
        status: {
          isPaused: credit.isPaused,
          pausedAt: credit.pausedAt,
          pauseReason: credit.pauseReason,
          planType: credit.planType,
        },
        recentActivity: recentCosts.map((cost) => ({
          ...cost,
          cost: Number(cost.cost),
        })),
      });
    } catch (error) {
      logger.error({ error }, 'Error fetching credits');
      resError(res, 'Failed to fetch credit information', 500);
    }
  }

  /**
   * PUT /api/business/plan
   * Upgrade/downgrade plan
   */
  static async updatePlan(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;

      const planSchema = z.object({
        planType: z.enum(['STARTER', 'PRO', 'ENTERPRISE']),
      });

      const result = planSchema.safeParse(req.body);
      if (!result.success) {
        resError(res, 'Invalid plan type', 400, result.error.format());
        return;
      }

      await BudgetService.updatePlan(businessId, result.data.planType);

      const credit = await db.businessCredit.findUnique({
        where: { businessId },
      });

      logger.info({ businessId, planType: result.data.planType }, 'Business plan updated');

      resSuccess(res, {
        message: `Plan upgraded to ${result.data.planType}`,
        plan: {
          type: credit?.planType,
          monthlyBudget: Number(credit?.monthlyBudget),
          totalCredits: Number(credit?.totalCredits),
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error updating plan');
      resError(res, 'Failed to update plan', 500);
    }
  }
}
