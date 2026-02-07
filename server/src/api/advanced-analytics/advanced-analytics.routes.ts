/**
 * Advanced Analytics API Routes
 */

import { Router, Request, Response } from 'express';
import { clerkAuth } from '@/middleware/auth.middleware';
import { FunnelAnalyzerService, CohortAnalyzerService, PredictionService } from '@/analytics/advanced';
import { resSuccess, resError } from '@/utils/response.utils';
import { z } from 'zod';

const router = Router();

// ============================================
// FUNNEL ANALYSIS
// ============================================

/**
 * Get conversion funnel
 * GET /api/advanced-analytics/funnel
 */
router.get('/funnel', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;
        const days = parseInt(req.query.days as string) || 30;

        const funnel = await FunnelAnalyzerService.getFunnel({
            businessId,
            days,
        });

        resSuccess(res, { data: funnel });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Compare funnels over time
 * POST /api/advanced-analytics/funnel/compare
 */
router.post('/funnel/compare', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;
        
        const schema = z.object({
            period1Start: z.string().datetime(),
            period1End: z.string().datetime(),
            period2Start: z.string().datetime(),
            period2End: z.string().datetime(),
        });

        const body = schema.parse(req.body);

        const comparison = await FunnelAnalyzerService.compareFunnels({
            businessId,
            period1: {
                start: new Date(body.period1Start),
                end: new Date(body.period1End),
            },
            period2: {
                start: new Date(body.period2Start),
                end: new Date(body.period2End),
            },
        });

        resSuccess(res, { data: comparison });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

// ============================================
// COHORT ANALYSIS
// ============================================

/**
 * Get cohort analysis
 * GET /api/advanced-analytics/cohorts
 */
router.get('/cohorts', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;
        const months = parseInt(req.query.months as string) || 12;

        const cohorts = await CohortAnalyzerService.getCohortAnalysis({
            businessId,
            months,
        });

        resSuccess(res, { data: cohorts });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Get LTV distribution
 * GET /api/advanced-analytics/ltv-distribution
 */
router.get('/ltv-distribution', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;

        const distribution = await CohortAnalyzerService.getLTVDistribution({
            businessId,
        });

        resSuccess(res, { data: distribution });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Get behavior patterns
 * GET /api/advanced-analytics/behavior-patterns
 */
router.get('/behavior-patterns', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;
        const segment = req.query.segment as 'high_value' | 'churned' | 'active' || 'high_value';

        const patterns = await CohortAnalyzerService.getBehaviorPatterns({
            businessId,
            segment,
        });

        resSuccess(res, { data: patterns });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

// ============================================
// PREDICTIONS
// ============================================

/**
 * Predict churn risk for customer
 * GET /api/advanced-analytics/predictions/churn/:customerId
 */
router.get('/predictions/churn/:customerId', clerkAuth, async (req: Request, res: Response) => {
    try {
        const { customerId } = req.params;
        const businessId = (req as any).businessId;

        const prediction = await PredictionService.predictChurn({
            businessId,
            customerId,
        });

        resSuccess(res, { data: prediction });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Predict customer LTV
 * GET /api/advanced-analytics/predictions/ltv/:customerId
 */
router.get('/predictions/ltv/:customerId', clerkAuth, async (req: Request, res: Response) => {
    try {
        const { customerId } = req.params;
        const businessId = (req as any).businessId;

        const prediction = await PredictionService.predictLTV({
            businessId,
            customerId,
        });

        resSuccess(res, { data: prediction });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Get next best action for customer
 * GET /api/advanced-analytics/predictions/next-action/:customerId
 */
router.get('/predictions/next-action/:customerId', clerkAuth, async (req: Request, res: Response) => {
    try {
        const { customerId } = req.params;
        const businessId = (req as any).businessId;

        const action = await PredictionService.getNextBestAction({
            businessId,
            customerId,
        });

        resSuccess(res, { data: action });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Get business-wide predictions
 * GET /api/advanced-analytics/predictions/business
 */
router.get('/predictions/business', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;

        const predictions = await PredictionService.getBusinessPredictions({
            businessId,
        });

        resSuccess(res, { data: predictions });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

// ============================================
// DASHBOARD
// ============================================

/**
 * Get advanced analytics dashboard
 * GET /api/advanced-analytics/dashboard
 */
router.get('/dashboard', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;
        const days = parseInt(req.query.days as string) || 30;

        const [funnel, cohorts, ltv, businessPredictions] = await Promise.all([
            FunnelAnalyzerService.getFunnel({ businessId, days }),
            CohortAnalyzerService.getCohortAnalysis({ businessId, months: 6 }),
            CohortAnalyzerService.getLTVDistribution({ businessId }),
            PredictionService.getBusinessPredictions({ businessId }),
        ]);

        resSuccess(res, {
            data: {
                funnel,
                cohorts,
                ltv,
                predictions: businessPredictions,
                period: `${days} days`,
            },
        });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

export default router;
