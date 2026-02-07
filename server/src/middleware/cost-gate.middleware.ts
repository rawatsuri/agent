import type { Request, Response, NextFunction } from 'express';
import { BudgetService } from '@/features/cost-control/budget.service';
import { logger } from '@/utils/logger';

/**
 * Cost Gate Middleware
 * 
 * Checks if business has sufficient budget/credits before processing
 * expensive operations. Integrates with budget service for real-time checks.
 * 
 * Should be placed BEFORE expensive operations (AI calls, external APIs)
 */
export const costGateMiddleware = (estimatedCost: number = 0.001) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const businessId = req.headers['x-business-id'] as string || req.params.businessId;

      if (!businessId) {
        res.status(400).json({
          success: false,
          message: 'Business ID required',
        });
        return;
      }

      // Check budget availability
      const budgetCheck = await BudgetService.hasBudgetAvailable(businessId, estimatedCost);

      if (!budgetCheck.allowed) {
        logger.warn(
          {
            businessId,
            reason: budgetCheck.reason,
            currentSpend: budgetCheck.currentSpend,
            budget: budgetCheck.budget,
          },
          'Cost gate blocked request - insufficient budget'
        );

        res.status(403).json({
          success: false,
          message: budgetCheck.reason || 'Insufficient budget',
          code: 'INSUFFICIENT_BUDGET',
          data: {
            currentSpend: budgetCheck.currentSpend,
            budget: budgetCheck.budget,
            percentUsed: budgetCheck.percentUsed,
          },
        });
        return;
      }

      // Check for budget alerts (async, don't block)
      BudgetService.checkBudgetAlerts(businessId).catch(() => {});

      // Store budget info in request
      req.budgetInfo = {
        currentSpend: budgetCheck.currentSpend,
        budget: budgetCheck.budget,
        percentUsed: budgetCheck.percentUsed,
      };

      next();
    } catch (error) {
      logger.error({ error }, 'Cost gate middleware error');
      // Fail open - allow request if budget check fails
      next();
    }
  };
};

/**
 * AI Cost Gate - Specific for AI operations (higher cost)
 */
export const aiCostGateMiddleware = costGateMiddleware(0.0015); // GPT-4o-mini average cost

/**
 * Voice Cost Gate - Specific for voice operations (highest cost)
 */
export const voiceCostGateMiddleware = costGateMiddleware(0.02); // Voice call + AI + TTS

/**
 * SMS Cost Gate - Specific for SMS operations
 */
export const smsCostGateMiddleware = costGateMiddleware(0.005); // SMS + AI

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      budgetInfo?: {
        currentSpend: number;
        budget: number;
        percentUsed: number;
      };
    }
  }
}
