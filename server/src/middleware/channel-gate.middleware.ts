import { Request, Response, NextFunction } from 'express';
import { db } from '@/config/database';
import { logger } from '@/utils/logger';

/**
 * Channel Gate Middleware
 * 
 * Validates that a business has access to the requested channel
 * based on their enabledChannels configuration.
 */

/**
 * Extract channel from request
 */
function extractChannelFromRequest(req: Request): string | null {
    // From body (most common for webhooks)
    if (req.body?.channel) {
        return req.body.channel;
    }

    // From route path
    const path = req.path.toLowerCase();
    if (path.includes('/voice') || path.includes('/call')) return 'VOICE';
    if (path.includes('/whatsapp')) return 'WHATSAPP';
    if (path.includes('/telegram')) return 'TELEGRAM';
    if (path.includes('/instagram')) return 'INSTAGRAM';
    if (path.includes('/email')) return 'EMAIL';
    if (path.includes('/sms')) return 'SMS';
    if (path.includes('/chat')) return 'CHAT';

    return null;
}

/**
 * Validate channel access middleware
 * 
 * Use this on routes that process channel-specific messages
 */
export async function validateChannelAccess(req: Request, res: Response, next: NextFunction) {
    try {
        const businessId = (req as any).business?.id || req.body?.businessId;

        if (!businessId) {
            logger.warn('Channel validation skipped - no businessId');
            return next(); // Skip validation if no business context
        }

        const channel = extractChannelFromRequest(req);

        if (!channel) {
            logger.warn({ path: req.path }, 'Could not determine channel from request');
            return next(); // Skip if we can't determine channel
        }

        // Fetch business enabled channels
        const business = await db.business.findUnique({
            where: { id: businessId },
            select: {
                enabledChannels: true,
                name: true
            }
        });

        if (!business) {
            logger.error({ businessId }, 'Business not found for channel validation');
            return res.status(404).json({
                error: 'Business not found',
                message: 'Invalid business ID'
            });
        }

        // Check if channel is enabled
        if (!business.enabledChannels.includes(channel as any)) {
            logger.warn({
                businessId,
                businessName: business.name,
                requestedChannel: channel,
                enabledChannels: business.enabledChannels
            }, 'Channel access denied');

            return res.status(403).json({
                error: 'Channel not enabled',
                message: `The ${channel} channel is not enabled for your account. Contact support to enable this channel.`,
                requestedChannel: channel,
                enabledChannels: business.enabledChannels
            });
        }

        // Channel is enabled, proceed
        logger.debug({
            businessId,
            channel,
            businessName: business.name
        }, 'Channel access validated');

        next();
    } catch (error) {
        logger.error({ error }, 'Error in channel validation middleware');
        res.status(500).json({
            error: 'Internal error',
            message: 'Failed to validate channel access'
        });
    }
}

/**
 * Validate specific channel (factory function)
 * 
 * Usage: router.post('/voice', validateChannel('VOICE'), handler)
 */
export function validateChannel(channel: string) {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const businessId = (req as any).business?.id || req.body?.businessId;

            if (!businessId) {
                return next();
            }

            const business = await db.business.findUnique({
                where: { id: businessId },
                select: { enabledChannels: true, name: true }
            });

            if (!business) {
                return res.status(404).json({
                    error: 'Business not found'
                });
            }

            if (!business.enabledChannels.includes(channel as any)) {
                logger.warn({
                    businessId,
                    businessName: business.name,
                    requestedChannel: channel,
                    enabledChannels: business.enabledChannels
                }, 'Channel access denied');

                return res.status(403).json({
                    error: 'Channel not enabled',
                    message: `${channel} is not enabled for your account`
                });
            }

            next();
        } catch (error) {
            logger.error({ error }, 'Error validating channel');
            res.status(500).json({ error: 'Internal error' });
        }
    };
}

/**
 * Check if business has channel enabled (utility function)
 */
export async function hasChannelEnabled(businessId: string, channel: string): Promise<boolean> {
    try {
        const business = await db.business.findUnique({
            where: { id: businessId },
            select: { enabledChannels: true }
        });

        return business?.enabledChannels.includes(channel as any) || false;
    } catch (error) {
        logger.error({ error, businessId, channel }, 'Error checking channel access');
        return false;
    }
}
