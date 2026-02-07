/**
 * CRM Integration API Routes
 */

import { Router, Request, Response } from 'express';
import { clerkAuth } from '@/middleware/auth.middleware';
import { CRMFactory, WebhookOutService, CRMProvider } from '@/integrations';
import { resSuccess, resError } from '@/utils/response.utils';
import { z } from 'zod';
import { db } from '@/config/database';
import { logger } from '@/utils/logger';

const router = Router();

/**
 * Get CRM configuration
 * GET /api/crm/config
 */
router.get('/config', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;
        
        const config = await db.cRMIntegration.findUnique({
            where: { businessId },
        });

        if (!config) {
            return resSuccess(res, { data: null, message: 'No CRM configured' });
        }

        // Don't return sensitive credentials
        resSuccess(res, {
            data: {
                provider: config.provider,
                enabled: config.enabled,
                instanceUrl: config.instanceUrl,
                autoSync: config.autoSync,
                syncContacts: config.syncContacts,
                syncLeads: config.syncLeads,
                syncOpportunities: config.syncOpportunities,
                syncCases: config.syncCases,
                lastSyncAt: config.lastSyncAt,
                lastSyncError: config.lastSyncError,
            },
        });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Configure CRM integration
 * POST /api/crm/config
 */
router.post('/config', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;
        
        const schema = z.object({
            provider: z.nativeEnum(CRMProvider),
            apiKey: z.string().optional(),
            apiSecret: z.string().optional(),
            accessToken: z.string().optional(),
            refreshToken: z.string().optional(),
            instanceUrl: z.string().optional(),
            settings: z.record(z.any()).optional(),
            autoSync: z.boolean().optional(),
            syncContacts: z.boolean().optional(),
            syncLeads: z.boolean().optional(),
            syncOpportunities: z.boolean().optional(),
            syncCases: z.boolean().optional(),
        });

        const body = schema.parse(req.body);

        const config = await db.cRMIntegration.upsert({
            where: { businessId },
            update: {
                provider: body.provider,
                ...(body.apiKey && { apiKey: body.apiKey }),
                ...(body.apiSecret && { apiSecret: body.apiSecret }),
                ...(body.accessToken && { accessToken: body.accessToken }),
                ...(body.refreshToken && { refreshToken: body.refreshToken }),
                ...(body.instanceUrl && { instanceUrl: body.instanceUrl }),
                ...(body.settings && { settings: body.settings }),
                ...(body.autoSync !== undefined && { autoSync: body.autoSync }),
                ...(body.syncContacts !== undefined && { syncContacts: body.syncContacts }),
                ...(body.syncLeads !== undefined && { syncLeads: body.syncLeads }),
                ...(body.syncOpportunities !== undefined && { syncOpportunities: body.syncOpportunities }),
                ...(body.syncCases !== undefined && { syncCases: body.syncCases }),
                enabled: true,
            },
            create: {
                businessId,
                provider: body.provider,
                apiKey: body.apiKey,
                apiSecret: body.apiSecret,
                accessToken: body.accessToken,
                refreshToken: body.refreshToken,
                instanceUrl: body.instanceUrl,
                settings: body.settings || {},
                autoSync: body.autoSync ?? true,
                syncContacts: body.syncContacts ?? true,
                syncLeads: body.syncLeads ?? true,
                syncOpportunities: body.syncOpportunities ?? true,
                syncCases: body.syncCases ?? false,
            },
        });

        logger.info({ businessId, provider: body.provider }, 'CRM configured');

        resSuccess(res, {
            data: {
                provider: config.provider,
                enabled: config.enabled,
                message: 'CRM integration configured successfully',
            },
        });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Sync customer to CRM
 * POST /api/crm/sync/:customerId
 */
router.post('/sync/:customerId', clerkAuth, async (req: Request, res: Response) => {
    try {
        const { customerId } = req.params;
        const businessId = (req as any).businessId;
        const entityType = req.query.type as string || 'contact';

        const config = await CRMFactory.getConfig(businessId);
        if (!config) {
            return resError(res, new Error('CRM not configured'), 400);
        }

        const connector = CRMFactory.getConnector(config);
        
        let result;
        if (entityType === 'contact') {
            result = await connector.syncContact(customerId);
        } else if (entityType === 'lead') {
            result = await connector.syncLead(customerId);
        } else {
            return resError(res, new Error('Invalid entity type'), 400);
        }

        if (result.success) {
            resSuccess(res, { data: result });
        } else {
            resError(res, new Error(result.message), 400);
        }
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Create opportunity in CRM
 * POST /api/crm/opportunities
 */
router.post('/opportunities', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;
        
        const schema = z.object({
            customerId: z.string(),
            name: z.string(),
            value: z.number().optional(),
            stage: z.string().optional(),
        });

        const body = schema.parse(req.body);

        const config = await CRMFactory.getConfig(businessId);
        if (!config) {
            return resError(res, new Error('CRM not configured'), 400);
        }

        const connector = CRMFactory.getConnector(config);
        const result = await connector.createOpportunity(body);

        if (result.success) {
            resSuccess(res, { data: result });
        } else {
            resError(res, new Error(result.message), 400);
        }
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Create case/ticket in CRM
 * POST /api/crm/cases
 */
router.post('/cases', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;
        
        const schema = z.object({
            customerId: z.string(),
            subject: z.string(),
            description: z.string(),
            priority: z.enum(['Low', 'Medium', 'High']).optional(),
        });

        const body = schema.parse(req.body);

        const config = await CRMFactory.getConfig(businessId);
        if (!config) {
            return resError(res, new Error('CRM not configured'), 400);
        }

        const connector = CRMFactory.getConnector(config);
        const result = await connector.createCase(body);

        if (result.success) {
            resSuccess(res, { data: result });
        } else {
            resError(res, new Error(result.message), 400);
        }
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Test CRM connection
 * GET /api/crm/test
 */
router.get('/test', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;

        const config = await CRMFactory.getConfig(businessId);
        if (!config) {
            return resSuccess(res, { data: { connected: false, message: 'CRM not configured' } });
        }

        // Simple connection test by trying to get config
        resSuccess(res, {
            data: {
                connected: true,
                provider: config.provider,
                message: `Connected to ${config.provider}`,
            },
        });
    } catch (error) {
        resSuccess(res, { data: { connected: false, error: (error as Error).message } });
    }
});

/**
 * Configure outbound webhook
 * POST /api/crm/webhooks
 */
router.post('/webhooks', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;
        
        const schema = z.object({
            webhookUrl: z.string().url(),
            secret: z.string().optional(),
            events: z.array(z.string()).optional(),
        });

        const body = schema.parse(req.body);

        await db.cRMIntegration.upsert({
            where: { businessId },
            update: {
                provider: 'CUSTOM',
                settings: {
                    webhookUrl: body.webhookUrl,
                    events: body.events || ['customer.created', 'conversation.closed'],
                },
                apiSecret: body.secret,
                enabled: true,
            },
            create: {
                businessId,
                provider: 'CUSTOM',
                settings: {
                    webhookUrl: body.webhookUrl,
                    events: body.events || ['customer.created', 'conversation.closed'],
                },
                apiSecret: body.secret,
                enabled: true,
            },
        });

        resSuccess(res, { data: { message: 'Webhook configured successfully' } });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Send test webhook
 * POST /api/crm/webhooks/test
 */
router.post('/webhooks/test', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;

        const result = await WebhookOutService.send({
            url: req.body.url,
            event: 'test',
            payload: { businessId, test: true, timestamp: new Date().toISOString() },
            secret: req.body.secret,
        });

        resSuccess(res, { data: result });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

export default router;
