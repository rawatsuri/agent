import { createHmac, timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger';

/**
 * Webhook Signature Validation Middleware
 * 
 * Validates incoming webhooks from external services to prevent
 * unauthorized requests and replay attacks.
 */

export interface WebhookConfig {
    secret: string;
    headerName: string;
    algorithm?: 'sha256' | 'sha1';
    prefix?: string;  // e.g., 'sha256=' for some services
}

/**
 * Create webhook validation middleware
 */
export function validateWebhookSignature(config: WebhookConfig) {
    const algorithm = config.algorithm || 'sha256';

    return (req: Request, res: Response, next: NextFunction) => {
        try {
            // Get signature from header
            const receivedSignature = req.headers[config.headerName.toLowerCase()] as string;

            if (!receivedSignature) {
                logger.warn(
                    { headerName: config.headerName },
                    'Webhook signature missing'
                );
                return res.status(401).json({ error: 'Signature missing' });
            }

            // Get raw body (body-parser must use verify option to preserve raw)
            const rawBody = (req as any).rawBody;

            if (!rawBody) {
                logger.error('Raw body not available for signature verification');
                return res.status(500).json({ error: 'Server configuration error' });
            }

            // Compute expected signature
            const hmac = createHmac(algorithm, config.secret);
            hmac.update(rawBody);
            const expectedSignature = config.prefix
                ? `${config.prefix}${hmac.digest('hex')}`
                : hmac.digest('hex');

            // Timing-safe comparison to prevent timing attacks
            const receivedBuffer = Buffer.from(receivedSignature);
            const expectedBuffer = Buffer.from(expectedSignature);

            if (receivedBuffer.length !== expectedBuffer.length) {
                logger.warn(
                    { service: config.headerName },
                    'Webhook signature length mismatch'
                );
                return res.status(401).json({ error: 'Invalid signature' });
            }

            if (!timingSafeEqual(receivedBuffer, expectedBuffer)) {
                logger.warn(
                    { service: config.headerName },
                    'Webhook signature mismatch'
                );
                return res.status(401).json({ error: 'Invalid signature' });
            }

            // Signature valid
            logger.debug({ service: config.headerName }, 'Webhook signature validated');
            next();
        } catch (error) {
            logger.error({ error }, 'Webhook signature validation error');
            res.status(500).json({ error: 'Validation error' });
        }
    };
}

/**
 * Middleware to capture raw body for signature validation
 * Must be used BEFORE body-parser middleware
 */
export function captureRawBody(req: Request, res: Response, buf: Buffer) {
    (req as any).rawBody = buf.toString('utf8');
}

/**
 * Pre-configured validators for common services
 */
export const WebhookValidators = {
    /**
     * Clerk webhook validation
     */
    clerk: () => validateWebhookSignature({
        secret: process.env.CLERK_WEBHOOK_SECRET || '',
        headerName: 'svix-signature',
        algorithm: 'sha256',
    }),

    /**
     * SendGrid webhook validation
     */
    sendgrid: () => validateWebhookSignature({
        secret: process.env.SENDGRID_WEBHOOK_SECRET || '',
        headerName: 'x-twilio-email-event-webhook-signature',
        algorithm: 'sha256',
    }),

    /**
     * Meta (WhatsApp/Instagram) webhook validation
     */
    meta: () => validateWebhookSignature({
        secret: process.env.META_WEBHOOK_SECRET || '',
        headerName: 'x-hub-signature-256',
        algorithm: 'sha256',
        prefix: 'sha256=',
    }),

    /**
     * Exotel webhook validation
     */
    exotel: () => validateWebhookSignature({
        secret: process.env.EXOTEL_API_TOKEN || '',
        headerName: 'x-exotel-signature',
        algorithm: 'sha256',
    }),

    /**
     * Telegram webhook validation
     * Note: Telegram uses a different validation method (token in URL)
     */
    telegram: (req: Request, res: Response, next: NextFunction) => {
        const token = req.query.token || req.headers['x-telegram-bot-api-secret-token'];
        const expectedToken = process.env.TELEGRAM_BOT_TOKEN;

        if (!token || token !== expectedToken) {
            logger.warn('Telegram webhook token invalid');
            return res.status(401).json({ error: 'Invalid token' });
        }

        next();
    },
};

/**
 * Verify webhook timestamp to prevent replay attacks
 */
export function verifyWebhookTimestamp(
    maxAgeSeconds: number = 300  // 5 minutes default
) {
    return (req: Request, res: Response, next: NextFunction) => {
        const timestamp = req.headers['x-webhook-timestamp'] as string;

        if (!timestamp) {
            // Optional - some webhooks don't include timestamps
            return next();
        }

        const webhookTime = parseInt(timestamp, 10);
        const currentTime = Math.floor(Date.now() / 1000);

        if (isNaN(webhookTime)) {
            logger.warn('Invalid webhook timestamp format');
            return res.status(401).json({ error: 'Invalid timestamp' });
        }

        if (Math.abs(currentTime - webhookTime) > maxAgeSeconds) {
            logger.warn(
                { webhookTime, currentTime, diff: currentTime - webhookTime },
                'Webhook timestamp too old (possible replay attack)'
            );
            return res.status(401).json({ error: 'Timestamp too old' });
        }

        next();
    };
}
