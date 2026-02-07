/**
 * White-Label Customization API Routes
 */

import { Router, Request, Response } from 'express';
import { clerkAuth } from '@/middleware/auth.middleware';
import { BrandingService, DomainService } from '@/features/white-label';
import { resSuccess, resError } from '@/utils/response.utils';
import { z } from 'zod';

const router = Router();

// ============================================
// BRANDING
// ============================================

/**
 * Get branding configuration
 * GET /api/white-label/branding
 */
router.get('/branding', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;

        const branding = await BrandingService.getBranding(businessId);

        resSuccess(res, { data: branding });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Update branding colors
 * PUT /api/white-label/branding/colors
 */
router.put('/branding/colors', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;
        
        const schema = z.object({
            primary: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
            secondary: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
            accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
            background: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
            text: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        });

        const body = schema.parse(req.body);

        const branding = await BrandingService.updateColors(businessId, body);

        resSuccess(res, { data: branding, message: 'Colors updated successfully' });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Upload logo
 * POST /api/white-label/branding/logo
 */
router.post('/branding/logo', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;
        const type = (req.query.type as 'light' | 'dark') || 'light';

        // In production, handle file upload with multer or similar
        // For now, accept URL
        const schema = z.object({
            url: z.string().url(),
        });

        const body = schema.parse(req.body);

        // Mock file upload - in production, upload to S3
        const result = { url: body.url };

        resSuccess(res, { data: result, message: 'Logo updated successfully' });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Update custom CSS
 * PUT /api/white-label/branding/css
 */
router.put('/branding/css', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;
        
        const schema = z.object({
            css: z.string().max(50000),
        });

        const body = schema.parse(req.body);

        const branding = await BrandingService.updateCustomCSS(businessId, body.css);

        resSuccess(res, { data: branding, message: 'Custom CSS updated' });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Update email templates
 * PUT /api/white-label/branding/email-templates
 */
router.put('/branding/email-templates', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;
        
        const schema = z.object({
            headerHTML: z.string().optional(),
            footerHTML: z.string().optional(),
            signature: z.string().optional(),
        });

        const body = schema.parse(req.body);

        const branding = await BrandingService.updateEmailTemplates(businessId, body);

        resSuccess(res, { data: branding, message: 'Email templates updated' });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Update chat widget settings
 * PUT /api/white-label/branding/chat-widget
 */
router.put('/branding/chat-widget', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;
        
        const schema = z.object({
            position: z.enum(['bottom-left', 'bottom-right']).optional(),
            greeting: z.string().max(200).optional(),
            placeholder: z.string().max(100).optional(),
            showBranding: z.boolean().optional(),
        });

        const body = schema.parse(req.body);

        const branding = await BrandingService.updateChatWidget(businessId, body);

        resSuccess(res, { data: branding, message: 'Chat widget settings updated' });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Get chat widget embed code
 * GET /api/white-label/branding/embed-code
 */
router.get('/branding/embed-code', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;

        const code = await BrandingService.getChatWidgetCode(businessId);

        resSuccess(res, { data: { code } });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Generate CSS variables
 * GET /api/white-label/branding/css-variables
 */
router.get('/branding/css-variables', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;

        const branding = await BrandingService.getBranding(businessId);
        const css = BrandingService.generateCSSVariables(branding);

        resSuccess(res, { data: { css } });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

// ============================================
// CUSTOM DOMAINS
// ============================================

/**
 * Get custom domains
 * GET /api/white-label/domains
 */
router.get('/domains', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;

        const domains = await DomainService.getBusinessDomains(businessId);

        resSuccess(res, { data: domains });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Add custom domain
 * POST /api/white-label/domains
 */
router.post('/domains', clerkAuth, async (req: Request, res: Response) => {
    try {
        const businessId = (req as any).businessId;
        
        const schema = z.object({
            domain: z.string().min(3),
        });

        const body = schema.parse(req.body);

        const domain = await DomainService.addDomain(businessId, body.domain);

        resSuccess(res, {
            data: domain,
            message: 'Domain added. Please follow verification instructions.',
        });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Get domain verification instructions
 * GET /api/white-label/domains/:id/verify
 */
router.get('/domains/:id/verify', clerkAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const instructions = await DomainService.getVerificationInstructions(id);

        resSuccess(res, { data: instructions });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Verify domain
 * POST /api/white-label/domains/:id/verify
 */
router.post('/domains/:id/verify', clerkAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const result = await DomainService.verifyDomain(id);

        if (result.verified) {
            resSuccess(res, { data: result, message: 'Domain verified successfully' });
        } else {
            resError(res, new Error(result.message), 400);
        }
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

/**
 * Remove custom domain
 * DELETE /api/white-label/domains/:id
 */
router.delete('/domains/:id', clerkAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        await DomainService.removeDomain(id);

        resSuccess(res, { message: 'Domain removed successfully' });
    } catch (error) {
        resError(res, error as Error, 500);
    }
});

export default router;
