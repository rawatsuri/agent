import type { Request, Response, NextFunction } from 'express';
import { AbuseDetectionService } from '@/features/cost-control/abuse-detection.service';
import { RateLimiterService } from '@/features/cost-control/rate-limiter.service';
import { db } from '@/config/database';
import { logger } from '@/utils/logger';

/**
 * Abuse Detection Middleware
 * 
 * Detects and prevents abuse patterns:
 * - Rapid-fire messaging
 * - Gibberish/random text
 * - Repetitive questions
 * - Known abusers
 * - Bad IP reputation
 */
export const abuseDetectionMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const businessId = req.headers['x-business-id'] as string || req.params.businessId;
    const customerId = req.headers['x-customer-id'] as string || req.params.customerId;
    const message = req.body.message || req.body.content || '';
    
    // Get identifiers
    const phone = req.body.phone || req.headers['x-customer-phone'];
    const email = req.body.email || req.headers['x-customer-email'];
    const ipAddress = req.headers['x-forwarded-for'] as string || 
                      req.socket.remoteAddress || 
                      'unknown';
    const fingerprint = req.headers['x-device-fingerprint'] as string;

    if (!businessId || !message) {
      next();
      return;
    }

    // Run abuse detection
    const abuseCheck = await AbuseDetectionService.analyzeMessage({
      businessId,
      customerId,
      phone,
      email,
      ipAddress,
      message,
      fingerprint,
    });

    // Handle based on action
    switch (abuseCheck.action) {
      case 'BAN':
        logger.warn(
          {
            businessId,
            customerId,
            ipAddress,
            reasons: abuseCheck.reasons,
          },
          'Abuse detected - BAN action'
        );

        res.status(403).json({
          success: false,
          message: 'Access denied due to policy violation',
          code: 'ACCESS_BANNED',
          data: {
            reasons: abuseCheck.reasons,
            severity: abuseCheck.severity,
          },
        });
        return;

      case 'BLOCK':
        logger.warn(
          {
            businessId,
            customerId,
            ipAddress,
            reasons: abuseCheck.reasons,
          },
          'Abuse detected - BLOCK action'
        );

        res.status(429).json({
          success: false,
          message: 'Too many suspicious requests. Please try again later.',
          code: 'ABUSE_DETECTED',
          data: {
            reasons: abuseCheck.reasons,
            severity: abuseCheck.severity,
            retryAfter: 3600, // 1 hour
          },
        });
        return;

      case 'THROTTLE':
        // Add artificial delay
        logger.info(
          {
            businessId,
            customerId,
            reasons: abuseCheck.reasons,
          },
          'Abuse detected - THROTTLE action'
        );

        req.abuseInfo = {
          throttled: true,
          reasons: abuseCheck.reasons,
        };

        // Add 2 second artificial delay
        await new Promise(resolve => setTimeout(resolve, 2000));
        break;

      case 'ALLOW':
      default:
        // Normal flow
        break;
    }

    next();
  } catch (error) {
    logger.error({ error }, 'Abuse detection middleware error');
    // Fail open - allow request if detection fails
    next();
  }
};

/**
 * Customer Verification Middleware
 * 
 * Handles new customer verification flow:
 * - New customers get limited access (5 messages)
 * - After limit, require verification
 * - Verified customers get full access
 */
export const customerVerificationMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const businessId = req.headers['x-business-id'] as string || req.params.businessId;
    const customerId = req.headers['x-customer-id'] as string || req.params.customerId;

    if (!businessId || !customerId) {
      next();
      return;
    }

    // Get customer details
    const customer = await db.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        trustScore: true,
        isVerified: true,
        businessId: true,
      },
    });

    if (!customer) {
      res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
      return;
    }

    // Check if customer belongs to business
    if (customer.businessId !== businessId) {
      res.status(403).json({
        success: false,
        message: 'Customer does not belong to this business',
      });
      return;
    }

    // Get business rate config
    const rateConfig = await db.rateLimitConfig.findUnique({
      where: { businessId },
    });

    // If verification not required, skip
    if (!rateConfig?.requireVerification) {
      next();
      return;
    }

    // Check if customer needs verification
    if (!customer.isVerified && customer.trustScore < 50) {
      // Count messages from this customer today
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const messageCount = await db.message.count({
        where: {
          conversation: {
            customerId,
            businessId,
          },
          createdAt: {
            gte: today,
          },
        },
      });

      // Limited access for unverified customers
      const limit = 5; // 5 messages before verification required

      if (messageCount >= limit) {
        res.status(403).json({
          success: false,
          message: 'Verification required. Please verify your phone number to continue.',
          code: 'VERIFICATION_REQUIRED',
          data: {
            messagesUsed: messageCount,
            limit,
            verificationMethod: 'OTP',
          },
        });
        return;
      }

      // Store warning in request
      req.verificationInfo = {
        isVerified: false,
        messagesRemaining: limit - messageCount,
        trustScore: customer.trustScore,
      };
    } else {
      req.verificationInfo = {
        isVerified: true,
        trustScore: customer.trustScore,
      };
    }

    next();
  } catch (error) {
    logger.error({ error }, 'Customer verification middleware error');
    next();
  }
};

/**
 * Composite Middleware - All protections in one
 * 
 * Order matters:
 * 1. Abuse detection (block bad actors immediately)
 * 2. Customer verification (check trust level)
 * 3. Rate limiting (check quotas)
 * 4. Cost gate (check budget)
 */
export const protectionMiddleware = [
  abuseDetectionMiddleware,
  customerVerificationMiddleware,
];

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      abuseInfo?: {
        throttled: boolean;
        reasons: string[];
      };
      verificationInfo?: {
        isVerified: boolean;
        messagesRemaining?: number;
        trustScore: number;
      };
    }
  }
}
