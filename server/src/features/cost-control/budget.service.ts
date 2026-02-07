import { db } from '@/config/database';
import { logger } from '@/utils/logger';
import { getRedisClient } from '@/config/redis';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import {
  validate,
  DeductBudgetParamsSchema,
  HasBudgetAvailableParamsSchema,
  AddCreditsParamsSchema,
  UpdatePlanParamsSchema
} from '@/utils/validators';

/**
 * Budget Service - PRODUCTION HARDENED
 * 
 * Manages business budgets with:
 * - Atomic transactions (race condition fix)
 * - Proper Decimal.js math (no precision loss)
 * - Redis caching for pause status
 * - Distributed locking
 */
export class BudgetService {
  private static redis = getRedisClient();

  /**
   * Initialize budget for a new business
   */
  static async initializeBusiness(businessId: string, planType: string = 'STARTER'): Promise<void> {
    const planCredits: Record<string, number> = {
      'STARTER': 100,
      'PRO': 500,
      'ENTERPRISE': 2000,
    };

    const planBudget: Record<string, number> = {
      'STARTER': 50,
      'PRO': 200,
      'ENTERPRISE': 1000,
    };

    await db.businessCredit.create({
      data: {
        businessId,
        planType,
        totalCredits: new Prisma.Decimal(planCredits[planType] || 100),
        availableCredits: new Prisma.Decimal(planCredits[planType] || 100),
        monthlyBudget: new Prisma.Decimal(planBudget[planType] || 50),
      },
    });

    logger.info({ businessId, planType }, 'Business budget initialized');
  }

  /**
   * Deduct from budget atomically (CRITICAL FIX: Race condition prevention)
   * 
   * Uses database transaction with row locking to prevent concurrent budget bypass.
   * 
   * @returns { success: boolean, newSpend: Decimal, reason?: string }
   */
  static async deductBudget(
    businessId: string,
    cost: number
  ): Promise<{
    success: boolean;
    newSpend: Decimal;
    percentUsed: number;
    reason?: string;
  }> {
    // Input validation
    const validated = validate(DeductBudgetParamsSchema, { businessId, cost });

    const costDecimal = new Decimal(cost);

    try {
      // Use transaction with explicit locking
      const result = await db.$transaction(async (tx) => {
        // SELECT FOR UPDATE locks the row - prevents concurrent modifications
        const credit = await tx.$queryRaw<Array<{
          business_id: string;
          current_month_spend: Prisma.Decimal;
          monthly_budget: Prisma.Decimal;
          total_credits: Prisma.Decimal;
          used_credits: Prisma.Decimal;
          is_paused: boolean;
        }>>`
          SELECT 
            business_id,
            current_month_spend,
            monthly_budget,
            total_credits,
            used_credits,
            is_paused
          FROM business_credits
          WHERE business_id = ${businessId}::uuid
          FOR UPDATE  -- CRITICAL: Row lock prevents race conditions
        `;

        if (!credit || credit.length === 0) {
          return {
            success: false,
            reason: 'Business credit record not found',
            newSpend: new Decimal(0),
            percentUsed: 0,
          };
        }

        const row = credit[0];

        // Check if paused
        if (row.is_paused) {
          return {
            success: false,
            reason: 'Account paused',
            newSpend: new Decimal(row.current_month_spend.toString()),
            percentUsed: 100,
          };
        }

        // Use Decimal.js for precise math
        const currentSpend = new Decimal(row.current_month_spend.toString());
        const budget = new Decimal(row.monthly_budget.toString());
        const totalCredits = new Decimal(row.total_credits.toString());
        const usedCredits = new Decimal(row.used_credits.toString());

        // Check if would exceed budget
        const newSpend = currentSpend.plus(costDecimal);
        if (newSpend.greaterThan(budget)) {
          // Auto-pause
          await tx.businessCredit.update({
            where: { businessId },
            data: {
              isPaused: true,
              pausedAt: new Date(),
              pauseReason: `Budget limit reached: $${currentSpend.toFixed(2)} + $${costDecimal.toFixed(2)} > $${budget.toFixed(2)}`,
            },
          });

          // Cache in Redis
          await this.redis.setex(`business:paused:${businessId}`, 3600, 'true');

          return {
            success: false,
            reason: `Budget limit would be exceeded: $${newSpend.toFixed(2)} > $${budget.toFixed(2)}`,
            newSpend: currentSpend,
            percentUsed: 100,
          };
        }

        // Check credits
        const availableCredits = totalCredits.minus(usedCredits);
        if (availableCredits.lessThan(costDecimal)) {
          return {
            success: false,
            reason: `Insufficient credits: $${availableCredits.toFixed(2)} available, need $${costDecimal.toFixed(2)}`,
            newSpend: currentSpend,
            percentUsed: currentSpend.dividedBy(budget).times(100).toNumber(),
          };
        }

        // ATOMIC UPDATE: Increment both spend and used credits
        await tx.businessCredit.update({
          where: { businessId },
          data: {
            currentMonthSpend: { increment: new Prisma.Decimal(cost) },
            usedCredits: { increment: new Prisma.Decimal(cost) },
          },
        });

        const percentUsed = newSpend.dividedBy(budget).times(100);

        return {
          success: true,
          newSpend,
          percentUsed: percentUsed.toNumber(),
        };
      }, {
        maxWait: 5000,  // Max 5s wait for lock
        timeout: 10000,  // Max 10s total transaction time
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,  // Highest isolation
      });

      // Check for budget alerts (async, don't block)
      if (result.success && result.percentUsed >= 75) {
        this.checkBudgetAlerts(businessId).catch(() => { });
      }

      return result;
    } catch (error) {
      logger.error({ error, businessId, cost }, 'Budget deduction failed');
      throw error;
    }
  }

  /**
   * Check if business has budget available (READ-ONLY, no modification)
   */
  static async hasBudgetAvailable(
    businessId: string,
    estimatedCost: number = 0.001
  ): Promise<{
    allowed: boolean;
    reason?: string;
    currentSpend: number;
    budget: number;
    percentUsed: number;
  }> {
    // Quick check: is account paused? (Redis cache)
    const isPaused = await this.isPaused(businessId);
    if (isPaused) {
      return {
        allowed: false,
        reason: 'Account paused',
        currentSpend: 0,
        budget: 0,
        percentUsed: 100,
      };
    }

    const credit = await db.businessCredit.findUnique({
      where: { businessId },
    });

    if (!credit) {
      return {
        allowed: false,
        reason: 'Business credit record not found',
        currentSpend: 0,
        budget: 0,
        percentUsed: 0,
      };
    }

    const currentSpend = new Decimal(credit.currentMonthSpend.toString());
    const budget = new Decimal(credit.monthlyBudget.toString());
    const costDecimal = new Decimal(estimatedCost);

    const percentUsed = budget.greaterThan(0)
      ? currentSpend.dividedBy(budget).times(100)
      : new Decimal(0);

    // Check if would exceed
    if (currentSpend.plus(costDecimal).greaterThan(budget)) {
      return {
        allowed: false,
        reason: 'Budget limit would be exceeded',
        currentSpend: currentSpend.toNumber(),
        budget: budget.toNumber(),
        percentUsed: 100,
      };
    }

    // Check credits
    const totalCredits = new Decimal(credit.totalCredits.toString());
    const usedCredits = new Decimal(credit.usedCredits.toString());
    const availableCredits = totalCredits.minus(usedCredits);

    if (availableCredits.lessThan(costDecimal)) {
      return {
        allowed: false,
        reason: 'Insufficient credits',
        currentSpend: currentSpend.toNumber(),
        budget: budget.toNumber(),
        percentUsed: percentUsed.toNumber(),
      };
    }

    return {
      allowed: true,
      currentSpend: currentSpend.toNumber(),
      budget: budget.toNumber(),
      percentUsed: Math.round(percentUsed.toNumber()),
    };
  }

  /**
   * Pause a business account
   */
  static async pauseBusiness(businessId: string, reason: string): Promise<void> {
    await db.businessCredit.update({
      where: { businessId },
      data: {
        isPaused: true,
        pausedAt: new Date(),
        pauseReason: reason,
      },
    });

    // Set flag in Redis for fast lookup
    await this.redis.setex(`business:paused:${businessId}`, 3600, 'true');

    logger.warn({ businessId, reason }, 'Business account paused');
  }

  /**
   * Resume a business account
   */
  static async resumeBusiness(businessId: string): Promise<void> {
    const credit = await db.businessCredit.findUnique({
      where: { businessId },
    });

    if (!credit) return;

    // Check if they have available budget or credits
    const availableBudget = new Decimal(credit.monthlyBudget.toString())
      .minus(new Decimal(credit.currentMonthSpend.toString()));
    const availableCredits = new Decimal(credit.totalCredits.toString())
      .minus(new Decimal(credit.usedCredits.toString()));

    if (availableBudget.lessThanOrEqualTo(0) && availableCredits.lessThanOrEqualTo(0)) {
      throw new Error('Cannot resume: No budget or credits available');
    }

    await db.businessCredit.update({
      where: { businessId },
      data: {
        isPaused: false,
        pausedAt: null,
        pauseReason: null,
      },
    });

    await this.redis.del(`business:paused:${businessId}`);

    logger.info({ businessId }, 'Business account resumed');
  }

  /**
   * Check and send budget alerts
   */
  static async checkBudgetAlerts(businessId: string): Promise<void> {
    const credit = await db.businessCredit.findUnique({
      where: { businessId },
    });

    if (!credit || credit.isPaused) return;

    const percentUsed = new Decimal(credit.currentMonthSpend.toString())
      .dividedBy(new Decimal(credit.monthlyBudget.toString()))
      .times(100)
      .toNumber();

    // Check 90% threshold
    if (percentUsed >= 90 && !credit.lastAlertAt90) {
      await this.sendBudgetAlert(businessId, 90, percentUsed);

      await db.businessCredit.update({
        where: { businessId },
        data: { lastAlertAt90: new Date() },
      });
    }
    // Check 75% threshold
    else if (percentUsed >= 75 && !credit.lastAlertAt75 && percentUsed < 90) {
      await this.sendBudgetAlert(businessId, 75, percentUsed);

      await db.businessCredit.update({
        where: { businessId },
        data: { lastAlertAt75: new Date() },
      });
    }
  }

  /**
   * Send budget alert (placeholder - integrate with email/notification service)
   */
  private static async sendBudgetAlert(
    businessId: string,
    threshold: number,
    percentUsed: number
  ): Promise<void> {
    logger.warn(
      { businessId, threshold, percentUsed },
      `Budget alert: ${threshold}% threshold reached`
    );

    // TODO: Send email notification to business owner
    // TODO: Send in-app notification
  }

  /**
   * Monthly budget reset (cron job)
   */
  static async resetMonthlyBudgets(): Promise<void> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Reset all business credits
    await db.businessCredit.updateMany({
      where: {
        lastResetAt: { lt: startOfMonth },
      },
      data: {
        currentMonthSpend: 0,
        lastResetAt: new Date(),
        lastAlertAt75: null,
        lastAlertAt90: null,
        isPaused: false,
        pausedAt: null,
        pauseReason: null,
      },
    });

    // Clear all paused flags from Redis (use SCAN, not KEYS)
    await this.clearPausedFlagsFromRedis();

    logger.info('Monthly budgets reset for all businesses');
  }

  /**
   * Clear paused flags from Redis using SCAN (production-safe)
   */
  private static async clearPausedFlagsFromRedis(): Promise<void> {
    const pattern = 'business:paused:*';
    let cursor = '0';
    let deletedCount = 0;

    do {
      const result = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = result[0];
      const keys = result[1];

      if (keys.length > 0) {
        await this.redis.del(...keys);
        deletedCount += keys.length;
      }
    } while (cursor !== '0');

    logger.debug({ deletedCount }, 'Cleared paused flags from Redis');
  }

  /**
   * Add credits to business account
   */
  static async addCredits(businessId: string, amount: number): Promise<void> {
    await db.businessCredit.update({
      where: { businessId },
      data: {
        totalCredits: { increment: new Prisma.Decimal(amount) },
      },
    });

    logger.info({ businessId, amount }, 'Credits added to business account');
  }

  /**
   * Update business plan
   */
  static async updatePlan(businessId: string, planType: string): Promise<void> {
    const planBudget: Record<string, number> = {
      'STARTER': 50,
      'PRO': 200,
      'ENTERPRISE': 1000,
    };

    const planCredits: Record<string, number> = {
      'STARTER': 100,
      'PRO': 500,
      'ENTERPRISE': 2000,
    };

    const credit = await db.businessCredit.findUnique({
      where: { businessId },
    });

    if (!credit) {
      throw new Error('Business credit record not found');
    }

    const newBudget = planBudget[planType];
    const newCredits = planCredits[planType];

    await db.businessCredit.update({
      where: { businessId },
      data: {
        planType,
        monthlyBudget: new Prisma.Decimal(newBudget),
        totalCredits: { increment: new Prisma.Decimal(newCredits) },
        isPaused: false, // Unpause if they upgrade
      },
    });

    // Clear pause cache
    await this.redis.del(`business:paused:${businessId}`);

    logger.info({ businessId, planType, newBudget }, 'Business plan updated');
  }

  /**
   * Quick check if business is paused (using Redis cache)
   */
  static async isPaused(businessId: string): Promise<boolean> {
    // Check Redis first (fast)
    const cached = await this.redis.get(`business:paused:${businessId}`);
    if (cached === 'true') return true;

    // Check database
    const credit = await db.businessCredit.findUnique({
      where: { businessId },
      select: { isPaused: true },
    });

    const isPaused = credit?.isPaused || false;

    // Cache in Redis if paused
    if (isPaused) {
      await this.redis.setex(`business:paused:${businessId}`, 3600, 'true');
    }

    return isPaused;
  }
}
