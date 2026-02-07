import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { logger } from '@/utils/logger';

// Import API routes
import customerRoutes from '@/api/customers/customer.routes';
import analyticsRoutes from '@/api/analytics/analytics.routes';
import conversationRoutes from '@/api/conversations/conversation.routes';
import campaignRoutes from '@/api/campaigns/campaign.routes';
import faqRoutes from '@/api/faq/faq.routes';
import authRoutes from '@/api/auth/auth.routes';
import adminRoutes from '@/api/admin/admin.routes';

// Import middleware
import { authenticateCustomer } from '@/middleware/customer-auth.middleware';

/**
 * API Routes
 * 
 * Base path: /api
 * 
 * Customer routes: JWT authentication
 * Admin routes: Clerk authentication
 */
const router = Router();

// API rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: {
    error: 'Too Many Requests',
    message: 'API rate limit exceeded. Please try again later.',
  },
});

router.use(apiLimiter);

// ============================================
// AUTHENTICATION (PUBLIC)
// ============================================
router.use('/auth', authRoutes);

// ============================================
// ADMIN ROUTES (Clerk Auth)
// ============================================
router.use('/admin', adminRoutes);

// ============================================
// CUSTOMER ROUTES (JWT Auth)
// ============================================
router.use('/customer', authenticateCustomer, customerRoutes);

// ============================================
// CORE API ROUTES (JWT Auth)
// ============================================
router.use('/analytics', authenticateCustomer, analyticsRoutes);
router.use('/conversations', authenticateCustomer, conversationRoutes);
router.use('/campaigns', authenticateCustomer, campaignRoutes);
router.use('/faq', authenticateCustomer, faqRoutes);

// ============================================
// API HEALTH CHECK
// ============================================
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'api',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
  });
});

export default router;
