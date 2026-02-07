/**
 * Advanced AI API Routes
 * Endpoints for sentiment analysis, intent classification, and language detection
 */

import { Router, Request, Response } from 'express';
import { clerkAuth } from '@/middleware/auth.middleware';
import { db } from '@/config/database';
import {
    SentimentAnalyzerService,
    IntentClassifierService,
    LanguageDetectorService,
    Sentiment,
    Intent,
} from '@/features/ai-advanced';
import { resSuccess, resError } from '@/utils/response.utils';
import { z } from 'zod';

const router = Router();

/**
 * Analyze sentiment of a message
 * POST /api/ai-advanced/sentiment
 */
router.post(
    '/sentiment',
    clerkAuth,
    async (req: Request, res: Response) => {
        try {
            const schema = z.object({
                message: z.string().min(1),
                conversationId: z.string().optional(),
                customerId: z.string().optional(),
                channel: z.enum(['VOICE', 'CHAT', 'EMAIL', 'SMS', 'TELEGRAM', 'WHATSAPP', 'INSTAGRAM']).optional(),
            });

            const body = schema.parse(req.body);
            const businessId = (req as any).businessId;

            const result = await SentimentAnalyzerService.analyze({
                message: body.message,
                businessId,
                customerId: body.customerId || 'temp',
                conversationId: body.conversationId || 'temp',
                channel: (body.channel as any) || 'CHAT',
            });

            resSuccess(res, { data: result });
        } catch (error) {
            resError(res, error as Error, 500);
        }
    }
);

/**
 * Get sentiment trend for customer
 * GET /api/ai-advanced/sentiment/trend/:customerId
 */
router.get(
    '/sentiment/trend/:customerId',
    clerkAuth,
    async (req: Request, res: Response) => {
        try {
            const { customerId } = req.params;
            const days = parseInt(req.query.days as string) || 30;
            const businessId = (req as any).businessId;

            // Verify customer belongs to business
            const trend = await SentimentAnalyzerService.getCustomerTrend({
                customerId,
                days,
            });

            resSuccess(res, { data: trend });
        } catch (error) {
            resError(res, error as Error, 500);
        }
    }
);

/**
 * Classify intent of a message
 * POST /api/ai-advanced/intent
 */
router.post(
    '/intent',
    clerkAuth,
    async (req: Request, res: Response) => {
        try {
            const schema = z.object({
                message: z.string().min(1),
                conversationId: z.string().optional(),
                customerId: z.string().optional(),
                channel: z.enum(['VOICE', 'CHAT', 'EMAIL', 'SMS', 'TELEGRAM', 'WHATSAPP', 'INSTAGRAM']).optional(),
            });

            const body = schema.parse(req.body);
            const businessId = (req as any).businessId;

            const result = await IntentClassifierService.classify({
                message: body.message,
                businessId,
                customerId: body.customerId || 'temp',
                conversationId: body.conversationId || 'temp',
                channel: (body.channel as any) || 'CHAT',
            });

            resSuccess(res, { data: result });
        } catch (error) {
            resError(res, error as Error, 500);
        }
    }
);

/**
 * Get intent analytics for business
 * GET /api/ai-advanced/intent/analytics
 */
router.get(
    '/intent/analytics',
    clerkAuth,
    async (req: Request, res: Response) => {
        try {
            const businessId = (req as any).businessId;
            const days = parseInt(req.query.days as string) || 30;

            const analytics = await IntentClassifierService.getIntentAnalytics({
                businessId,
                days,
            });

            resSuccess(res, { data: analytics });
        } catch (error) {
            resError(res, error as Error, 500);
        }
    }
);

/**
 * Detect language of a message
 * POST /api/ai-advanced/language/detect
 */
router.post(
    '/language/detect',
    clerkAuth,
    async (req: Request, res: Response) => {
        try {
            const schema = z.object({
                message: z.string().min(1),
                customerId: z.string().optional(),
            });

            const body = schema.parse(req.body);
            const businessId = (req as any).businessId;

            const result = await LanguageDetectorService.detect({
                message: body.message,
                businessId,
                customerId: body.customerId || 'temp',
            });

            resSuccess(res, { data: result });
        } catch (error) {
            resError(res, error as Error, 500);
        }
    }
);

/**
 * Translate text
 * POST /api/ai-advanced/language/translate
 */
router.post(
    '/language/translate',
    clerkAuth,
    async (req: Request, res: Response) => {
        try {
            const schema = z.object({
                text: z.string().min(1),
                targetLanguage: z.string(),
                customerId: z.string().optional(),
            });

            const body = schema.parse(req.body);
            const businessId = (req as any).businessId;

            const result = await LanguageDetectorService.translate({
                text: body.text,
                targetLanguage: body.targetLanguage,
                businessId,
                customerId: body.customerId,
            });

            resSuccess(res, { data: { translation: result } });
        } catch (error) {
            resError(res, error as Error, 500);
        }
    }
);

/**
 * Get all sentiment and intent data for dashboard
 * GET /api/ai-advanced/dashboard
 */
router.get(
    '/dashboard',
    clerkAuth,
    async (req: Request, res: Response) => {
        try {
            const businessId = (req as any).businessId;
            const days = parseInt(req.query.days as string) || 30;

            const since = new Date();
            since.setDate(since.getDate() - days);

            // Get sentiment distribution
            const sentimentData = await db.sentimentLog.groupBy({
                by: ['sentiment'],
                where: {
                    businessId,
                    createdAt: { gte: since },
                },
                _count: { id: true },
            });

            // Get intent distribution
            const intentData = await db.intentLog.groupBy({
                by: ['intent'],
                where: {
                    businessId,
                    createdAt: { gte: since },
                },
                _count: { id: true },
            });

            // Get alerts count
            const alertsCount = await db.sentimentLog.count({
                where: {
                    businessId,
                    createdAt: { gte: since },
                    alertTriggered: true,
                },
            });

            resSuccess(res, {
                data: {
                    sentimentDistribution: sentimentData,
                    intentDistribution: intentData,
                    alertsCount,
                    period: `${days} days`,
                },
            });
        } catch (error) {
            resError(res, error as Error, 500);
        }
    }
);

export default router;
