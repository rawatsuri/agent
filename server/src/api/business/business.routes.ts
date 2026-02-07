import { Router } from 'express';
import { clerkAuth } from '@/middleware/auth.middleware';
import { BusinessController } from './business.controller';

/**
 * Business Routes - Business profile and configuration management
 * 
 * All routes require Clerk authentication
 * Base path: /api/business
 */
const router = Router();

// All business routes require authentication
router.use(clerkAuth);

// Profile routes
router.get('/me', (req, res) => BusinessController.getProfile(req, res));
router.put('/me', (req, res) => BusinessController.updateProfile(req, res));

// AI Configuration routes
router.get('/ai-config', (req, res) => BusinessController.getAIConfig(req, res));
router.put('/ai-config', (req, res) => BusinessController.updateAIConfig(req, res));

// Credits and billing routes
router.get('/credits', (req, res) => BusinessController.getCredits(req, res));

// Plan management
router.put('/plan', (req, res) => BusinessController.updatePlan(req, res));

export default router;
