import type { Request, Response, NextFunction } from 'express';
import { clerkClient } from '@clerk/clerk-sdk-node';
import { db } from '@/config/database';
import { logger } from '@/utils/logger';

// Extend Express Request to include user data
declare global {
  namespace Express {
    interface Request {
      business?: {
        id: string;
        clerkId: string;
        name: string;
        apiKey: string;
      };
    }
  }
}

/**
 * Clerk JWT Authentication Middleware
 * Validates Clerk session tokens for Business (B2B) users
 */
export const clerkAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid authorization token',
      });
    }

    const token = authHeader.split(' ')[1];

    // Verify Clerk session token
    const session = await clerkClient.sessions.verifySession(
      token,
      token,
    );

    if (!session || !session.userId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid session',
      });
    }

    // Find or create business for this Clerk user
    let business = await db.business.findUnique({
      where: { clerkId: session.userId },
    });

    if (!business) {
      // Auto-create business on first login
      const user = await clerkClient.users.getUser(session.userId);

      business = await db.business.create({
        data: {
          clerkId: session.userId,
          name:
            user.firstName && user.lastName
              ? `${user.firstName} ${user.lastName}`
              : 'New Business',
          email: user.emailAddresses[0]?.emailAddress,
        },
      });

      logger.info({ businessId: business.id }, 'New business created from Clerk');
    }

    // Attach business to request
    req.business = {
      id: business.id,
      clerkId: business.clerkId,
      name: business.name,
      apiKey: business.apiKey,
    };

    next();
  } catch (error) {
    logger.error({ error }, 'Clerk authentication error');
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication failed',
    });
  }
};

/**
 * API Key Authentication Middleware
 * For internal services and admin endpoints
 */
export const apiKeyAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'API key required',
      });
    }

    // Check if it's the internal system API key
    if (apiKey === process.env.INTERNAL_API_KEY) {
      // Internal system access (no business context)
      return next();
    }

    // Check if it's a business API key
    const business = await db.business.findUnique({
      where: { apiKey },
    });

    if (!business || !business.active) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid API key',
      });
    }

    // Attach business to request
    req.business = {
      id: business.id,
      clerkId: business.clerkId,
      name: business.name,
      apiKey: business.apiKey,
    };

    next();
  } catch (error) {
    logger.error({ error }, 'API key authentication error');
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication failed',
    });
  }
};
