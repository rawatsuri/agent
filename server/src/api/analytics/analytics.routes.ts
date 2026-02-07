import { Router } from 'express';
import { clerkAuth } from '@/middleware/auth.middleware';
import { AnalyticsController } from './analytics.controller';

/**
 * Analytics Routes - Analytics and dashboard endpoints
 * 
 * All routes require Clerk authentication
 * Base path: /api/analytics
 */
const router = Router();

// All analytics routes require authentication
router.use(clerkAuth);

// Dashboard metrics
router.get('/dashboard', (req, res) => AnalyticsController.getDashboard(req, res));

// Cost analytics
router.get('/costs', (req, res) => AnalyticsController.getCosts(req, res));

// Conversation analytics
router.get('/conversations', (req, res) => AnalyticsController.getConversations(req, res));

// Cache analytics
router.get('/cache', (req, res) => AnalyticsController.getCacheStats(req, res));

// Abuse detection analytics
router.get('/abuse', (req, res) => AnalyticsController.getAbuseStats(req, res));

// Customer analytics
router.get('/customers', (req, res) => AnalyticsController.getCustomerAnalytics(req, res));

// Data export
router.get('/export', (req, res) => AnalyticsController.exportData(req, res));

export default router;
