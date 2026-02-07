import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { Express, Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger';

/**
 * Security Middleware Setup
 *
 * Configures security headers, CORS, rate limiting, and other protections
 */
export function setupSecurityMiddleware(app: Express): void {
  // Trust proxy (required for rate limiting behind reverse proxy)
  app.set('trust proxy', 1);

  // Security headers with Helmet
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      dnsPrefetchControl: { allow: false },
      frameguard: { action: 'deny' },
      hidePoweredBy: true,
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      ieNoOpen: true,
      noSniff: true,
      originAgentCluster: true,
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      xssFilter: true,
    })
  );

  // CORS configuration
  const corsOptions = {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Business-ID',
      'X-Customer-ID',
      'X-Channel',
      'X-Request-ID',
    ],
    credentials: true,
    maxAge: 86400, // 24 hours
  };

  app.use(cors(corsOptions));

  // API Rate Limiting
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // Limit each IP to 200 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      // Use auth user ID if available, otherwise IP
      return req.auth?.userId || req.ip || 'unknown';
    },
    handler: (req: Request, res: Response) => {
      logger.warn({ ip: req.ip }, 'API rate limit exceeded');
      res.status(429).json({
        success: false,
        message: 'Too many requests, please try again later',
        code: 'RATE_LIMIT_EXCEEDED',
      });
    },
  });

  // Apply rate limiting to API routes only
  app.use('/api/', apiLimiter);

  // Webhook rate limiting (more lenient)
  const webhookLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // 100 webhooks per minute
    standardHeaders: true,
    keyGenerator: (req: Request) => req.ip || 'unknown',
  });

  app.use('/webhooks/', webhookLimiter);

  // Request ID middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    req.requestId =
      (req.headers['x-request-id'] as string) ||
      `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    res.setHeader('X-Request-ID', req.requestId);
    next();
  });

  // IP whitelist check for sensitive endpoints
  app.use('/admin/', (req: Request, res: Response, next: NextFunction) => {
    const allowedIPs = process.env.ADMIN_IP_WHITELIST?.split(',') || [];
    const clientIP = req.ip || req.socket.remoteAddress;

    if (allowedIPs.length > 0 && !allowedIPs.includes(clientIP || '')) {
      logger.warn({ ip: clientIP }, 'Admin access denied - IP not whitelisted');
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    next();
  });

  logger.info('Security middleware configured');
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}
