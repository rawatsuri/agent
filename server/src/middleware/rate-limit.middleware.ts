import type { Request, Response, NextFunction } from 'express';
import { RateLimiterService } from '@/features/cost-control/rate-limiter.service';
import { BudgetService } from '@/features/cost-control/budget.service';
import { logger } from '@/utils/logger';

/**
 * Rate Limit Middleware
 * 
 * Multi-tier rate limiting:
 * 1. Check business monthly quota
 * 2. Check customer daily/hourly limits
 * 3. Check IP-based limits for unknown sources
 */
export const rateLimitMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const businessId = req.headers['x-business-id'] as string || req.params.businessId;
    const customerId = req.headers['x-customer-id'] as string || req.params.customerId;
    const channel = req.headers['x-channel'] as string || 'CHAT';
    const type = req.path.includes('voice') || req.path.includes('call') ? 'CALL' : 'MESSAGE';
    
    // Get IP address
    const ipAddress = req.headers['x-forwarded-for'] as string || 
                      req.socket.remoteAddress || 
                      'unknown';

    if (!businessId) {
      res.status(400).json({
        success: false,
        message: 'Business ID required',
      });
      return;
    }

    // Step 1: Check if business is paused
    const isPaused = await BudgetService.isPaused(businessId);
    if (isPaused) {
      res.status(403).json({
        success: false,
        message: 'Account paused - budget limit reached. Please upgrade your plan or contact support.',
        code: 'BUDGET_EXCEEDED',
      });
      return;
    }

    // Step 2: Check business monthly quota
    const businessQuota = await RateLimiterService.checkBusinessQuota(businessId, type);
    if (!businessQuota.allowed) {
      res.status(429).json({
        success: false,
        message: businessQuota.reason,
        code: 'BUSINESS_QUOTA_EXCEEDED',
        data: {
          used: businessQuota.used,
          quota: businessQuota.quota,
        },
      });
      return;
    }

    // Step 3: Check customer limits (if customerId provided)
    if (customerId) {
      const customerLimit = await RateLimiterService.checkCustomerLimit(
        customerId,
        businessId,
        type,
        channel
      );

      if (!customerLimit.allowed) {
        res.status(429).json({
          success: false,
          message: customerLimit.reason,
          code: 'RATE_LIMIT_EXCEEDED',
          data: {
            remaining: customerLimit.remaining,
            resetAt: customerLimit.resetAt,
            limit: customerLimit.limit,
          },
        });
        return;
      }

      // Store rate limit info in request for later use
      req.rateLimitInfo = {
        customerRemaining: customerLimit.remaining,
        customerResetAt: customerLimit.resetAt,
        businessRemaining: businessQuota.remaining,
      };
    }

    // Step 4: Check IP-based limit (especially for unknown customers)
    const isKnownCustomer = !!customerId;
    const ipLimit = await RateLimiterService.checkIPLimit(ipAddress, isKnownCustomer);
    
    if (!ipLimit.allowed) {
      res.status(429).json({
        success: false,
        message: ipLimit.reason,
        code: 'IP_RATE_LIMITED',
      });
      return;
    }

    next();
  } catch (error) {
    logger.error({ error }, 'Rate limit middleware error');
    // Fail open - allow request if rate limiting fails
    next();
  }
};

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      rateLimitInfo?: {
        customerRemaining: number;
        customerResetAt: Date;
        businessRemaining: number;
      };
    }
  }
}
