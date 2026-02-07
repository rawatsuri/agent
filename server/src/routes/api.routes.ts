import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { clerkAuth } from '@/middleware/auth.middleware';
import { logger } from '@/utils/logger';

// Import API routes
import businessRoutes from '@/api/business/business.routes';
import customerRoutes from '@/api/customers/customer.routes';
import analyticsRoutes from '@/api/analytics/analytics.routes';
import conversationRoutes from '@/api/conversations/conversation.routes';
import campaignRoutes from '@/api/campaigns/campaign.routes';
import faqRoutes from '@/api/faq/faq.routes';

// Phase 6: Enterprise Features
import aiAdvancedRoutes from '@/api/ai-advanced/ai-advanced.routes';
import crmRoutes from '@/api/crm/crm.routes';
import advancedAnalyticsRoutes from '@/api/advanced-analytics/advanced-analytics.routes';
import whiteLabelRoutes from '@/api/white-label/white-label.routes';
import advancedCampaignsRoutes from '@/api/advanced-campaigns/advanced-campaigns.routes';
import { auditRoutes } from '@/features/audit';

/**
 * API Routes - All authenticated business-facing endpoints
 * 
 * Base path: /api
 * 
 * All routes require Clerk authentication and are rate-limited
 */
const router = Router();

// API rate limiting - stricter than webhooks
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // limit each IP to 200 requests per windowMs
  message: {
    error: 'Too Many Requests',
    message: 'API rate limit exceeded. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all API routes
router.use(apiLimiter);

// Request logging middleware
router.use((req, res, next) => {
  logger.debug(
    {
      method: req.method,
      path: req.path,
      businessId: req.business?.id,
    },
    'API request received'
  );
  next();
});

// ============================================
// BUSINESS API
// ============================================
router.use('/business', businessRoutes);

// ============================================
// CUSTOMER API
// ============================================
router.use('/customers', customerRoutes);

// ============================================
// ANALYTICS API
// ============================================
router.use('/analytics', analyticsRoutes);

// ============================================
// CONVERSATION API
// ============================================
router.use('/conversations', conversationRoutes);

// ============================================
// CAMPAIGN API
// ============================================
router.use('/campaigns', campaignRoutes);

// ============================================
// FAQ & CACHE API
// ============================================
router.use('/faq', faqRoutes);

// ============================================
// PHASE 6: ENTERPRISE FEATURES
// ============================================

// ----------------------------------------
// Advanced AI API
// ----------------------------------------
router.use('/ai-advanced', aiAdvancedRoutes);

// ----------------------------------------
// CRM Integration API
// ----------------------------------------
router.use('/crm', crmRoutes);

// ----------------------------------------
// Advanced Analytics API
// ----------------------------------------
router.use('/advanced-analytics', advancedAnalyticsRoutes);

// ----------------------------------------
// White-Label API
// ----------------------------------------
router.use('/white-label', whiteLabelRoutes);

// ----------------------------------------
// Advanced Campaigns API
// ----------------------------------------
router.use('/advanced-campaigns', advancedCampaignsRoutes);

// ----------------------------------------
// Audit Log API
// ----------------------------------------
router.use('/audit', auditRoutes);

// ============================================
// API HEALTH CHECK
// ============================================
router.get('/health', clerkAuth, (req, res) => {
  res.json({
    status: 'healthy',
    service: 'api',
    timestamp: new Date().toISOString(),
    businessId: req.business?.id,
    version: '1.0.0',
  });
});

export default router;
