/**
 * Audit Log API Routes
 * Endpoints for querying and managing audit logs
 */

import { Router, Request, Response } from 'express';
import { clerkAuth } from '@/middleware/auth.middleware';
import { AuditLoggerService, AuditAction, AuditSeverity } from './audit-logger.service';
import { resSuccess, resError } from '@/utils/response.utils';
import { z } from 'zod';

const router = Router();

/**
 * Query audit logs
 * GET /api/audit/logs
 */
router.get(
    '/logs',
    clerkAuth,
    async (req: Request, res: Response) => {
        try {
            const businessId = (req as any).businessId;

            const querySchema = z.object({
                action: z.nativeEnum(AuditAction).optional(),
                severity: z.nativeEnum(AuditSeverity).optional(),
                resource: z.string().optional(),
                startDate: z.string().datetime().optional(),
                endDate: z.string().datetime().optional(),
                limit: z.string().transform(Number).optional(),
                offset: z.string().transform(Number).optional(),
            });

            const query = querySchema.parse(req.query);

            const result = await AuditLoggerService.query({
                businessId,
                action: query.action,
                severity: query.severity,
                resource: query.resource,
                startDate: query.startDate ? new Date(query.startDate) : undefined,
                endDate: query.endDate ? new Date(query.endDate) : undefined,
                limit: query.limit,
                offset: query.offset,
            });

            resSuccess(res, {
                data: result.entries,
                meta: {
                    total: result.total,
                    summary: result.summary,
                },
            });
        } catch (error) {
            resError(res, error as Error, 500);
        }
    }
);

/**
 * Get audit trail for specific resource
 * GET /api/audit/resource/:resource/:id
 */
router.get(
    '/resource/:resource/:id',
    clerkAuth,
    async (req: Request, res: Response) => {
        try {
            const { resource, id } = req.params;
            const businessId = (req as any).businessId;

            const history = await AuditLoggerService.getResourceHistory(resource, id);

            // Filter by business for security
            const filtered = history.filter(
                (entry) => !entry.businessId || entry.businessId === businessId
            );

            resSuccess(res, { data: filtered });
        } catch (error) {
            resError(res, error as Error, 500);
        }
    }
);

/**
 * Generate compliance report
 * POST /api/audit/compliance-report
 */
router.post(
    '/compliance-report',
    clerkAuth,
    async (req: Request, res: Response) => {
        try {
            const businessId = (req as any).businessId;

            const schema = z.object({
                startDate: z.string().datetime(),
                endDate: z.string().datetime(),
            });

            const body = schema.parse(req.body);

            const report = await AuditLoggerService.generateComplianceReport({
                businessId,
                startDate: new Date(body.startDate),
                endDate: new Date(body.endDate),
            });

            resSuccess(res, { data: report });
        } catch (error) {
            resError(res, error as Error, 500);
        }
    }
);

/**
 * Get audit statistics
 * GET /api/audit/stats
 */
router.get(
    '/stats',
    clerkAuth,
    async (req: Request, res: Response) => {
        try {
            const businessId = (req as any).businessId;
            const days = parseInt(req.query.days as string) || 30;

            const since = new Date();
            since.setDate(since.getDate() - days);

            const result = await AuditLoggerService.query({
                businessId,
                startDate: since,
                endDate: new Date(),
                limit: 10000,
            });

            resSuccess(res, {
                data: {
                    totalEvents: result.total,
                    byAction: result.summary.byAction,
                    bySeverity: result.summary.bySeverity,
                    period: `${days} days`,
                },
            });
        } catch (error) {
            resError(res, error as Error, 500);
        }
    }
);

export default router;
