/**
 * Advanced Campaigns API Routes
 * A/B Testing and Personalization
 */

import { Router, Request, Response } from 'express';
import { clerkAuth } from '@/middleware/auth.middleware';
import { db } from '@/config/database';
import { ABTestingService, PersonalizationService } from '@/features/campaigns-advanced';
import { resSuccess, resError } from '@/utils/response.utils';
import { z } from 'zod';

const router = Router();

// ============================================
// A/B TESTING
// ============================================

/**
 * Create A/B test
 * POST /api/advanced-campaigns/ab-tests
 */
router.post('/ab-tests', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;

        const schema = z.object({
            campaignId: z.string(),
            name: z.string(),
            description: z.string().optional(),
            variants: z.array(
                z.object({
                    name: z.string(),
                    content: z.string(),
                    subject: z.string().optional(),
                    weight: z.number().min(1).max(99).optional(),
                })
            ).min(2),
            winnerCriteria: z.enum(['OPEN_RATE', 'CLICK_RATE', 'REPLY_RATE', 'CONVERSION_RATE']).optional(),
            confidenceLevel: z.number().min(0.9).max(0.99).optional(),
            sampleSize: z.number().min(10).optional(),
        });

        const body = schema.parse(req.body);

        const test = await ABTestingService.createTest({
            businessId,
            ...body,
        });

        resSuccess(res, { data: test, message: 'A/B test created successfully' });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Get A/B tests for business
 * GET /api/advanced-campaigns/ab-tests
 */
router.get('/ab-tests', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;

        // Fetch from database
        const tests = await db.aBTest.findMany({
            where: { businessId },
            orderBy: { createdAt: 'desc' },
        });

        resSuccess(res, { data: tests });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Get A/B test details
 * GET /api/advanced-campaigns/ab-tests/:id
 */
router.get('/ab-tests/:id', clerkAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const test = await db.aBTest.findUnique({
            where: { id },
        });

        if (!test) {
            return resError(res, new Error('A/B test not found'), 404);
        }

        resSuccess(res, { data: test });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Start A/B test
 * POST /api/advanced-campaigns/ab-tests/:id/start
 */
router.post('/ab-tests/:id/start', clerkAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const test = await ABTestingService.startTest(id);

        resSuccess(res, { data: test, message: 'A/B test started' });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Get A/B test results
 * GET /api/advanced-campaigns/ab-tests/:id/results
 */
router.get('/ab-tests/:id/results', clerkAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const results = await ABTestingService.getTestResults(id);

        resSuccess(res, { data: results });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

// ============================================
// PERSONALIZATION
// ============================================

/**
 * Personalize message for customer
 * POST /api/advanced-campaigns/personalize
 */
router.post('/personalize', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;

        const schema = z.object({
            customerId: z.string(),
            message: z.string(),
            channel: z.enum(['VOICE', 'CHAT', 'EMAIL', 'SMS', 'TELEGRAM', 'WHATSAPP', 'INSTAGRAM']),
        });

        const body = schema.parse(req.body);

        const personalized = await PersonalizationService.personalizeMessage({
            businessId,
            customerId: body.customerId,
            baseMessage: body.message,
            channel: body.channel,
        });

        resSuccess(res, { data: { message: personalized } });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Get recommendations for customer
 * GET /api/advanced-campaigns/recommendations/:customerId
 */
router.get('/recommendations/:customerId', clerkAuth, async (req: Request, res: Response) => {
    try {
        const { customerId } = req.params;
        const businessId = (req as any).businessId;

        const recommendations = await PersonalizationService.getRecommendations({
            businessId,
            customerId,
        });

        resSuccess(res, { data: recommendations });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Segment customers
 * POST /api/advanced-campaigns/segment
 */
router.post('/segment', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;

        const schema = z.object({
            minConversations: z.number().optional(),
            minTrustScore: z.number().optional(),
            tags: z.array(z.string()).optional(),
            lastInteractionWithin: z.number().optional(),
            intents: z.array(z.string()).optional(),
        });

        const body = schema.parse(req.body);

        const segment = await PersonalizationService.segmentCustomers({
            businessId,
            criteria: body,
        });

        resSuccess(res, { data: segment });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

export default router;
