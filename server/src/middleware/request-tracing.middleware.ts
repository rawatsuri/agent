import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '@/utils/logger';

/**
 * Request Tracing Middleware
 * 
 * Adds unique request ID to each request for distributed tracing.
 * Request ID is accessible via req.id and automatically logged.
 */

declare global {
    namespace Express {
        interface Request {
            id: string;
            startTime: number;
        }
    }
}

export function requestTracing(req: Request, res: Response, next: NextFunction) {
    // Generate or use existing request ID
    req.id = (req.headers['x-request-id'] as string) || randomUUID();
    req.startTime = Date.now();

    // Add request ID to response headers
    res.setHeader('X-Request-ID', req.id);

    // Log request start
    logger.info(
        {
            requestId: req.id,
            method: req.method,
            path: req.path,
            query: req.query,
            ip: req.ip,
        },
        'Request started'
    );

    // Log response when finished
    res.on('finish', () => {
        const duration = Date.now() - req.startTime;

        logger.info(
            {
                requestId: req.id,
                method: req.method,
                path: req.path,
                statusCode: res.statusCode,
                duration,
            },
            'Request completed'
        );
    });

    next();
}

/**
 * Get current request ID from async context
 * Useful for logging in services
 */
export function getRequestId(req?: Request): string | null {
    return req?.id || null;
}
