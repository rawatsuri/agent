import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      customer?: {
        id: string;
        email: string;
      };
    }
  }
}

/**
 * Middleware to authenticate customers via JWT
 */
export const authenticateCustomer = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);

    // Verify token
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'your-secret-key'
    ) as any;

    // Check if it's a customer token
    if (decoded.type !== 'customer') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    // Check if customer exists and is active
    const customer = await prisma.customer.findUnique({
      where: {
        id: decoded.customerId,
        isActive: true
      }
    });

    if (!customer) {
      return res.status(401).json({ error: 'Customer not found or inactive' });
    }

    // Attach customer to request
    req.customer = {
      id: customer.id,
      email: customer.email || '',
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Token expired' });
    }
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Optional customer authentication (doesn't fail if no token)
 */
export const optionalCustomerAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.substring(7);

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'your-secret-key'
    ) as any;

    if (decoded.type === 'customer') {
      const customer = await prisma.customer.findUnique({
        where: {
          id: decoded.customerId,
          isActive: true
        }
      });

      if (customer) {
        req.customer = {
          id: customer.id,
          email: customer.email || '',
        };
      }
    }

    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};
