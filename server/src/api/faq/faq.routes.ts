import { Router } from 'express';
import { clerkAuth } from '@/middleware/auth.middleware';
import { FAQController } from './faq.controller';

/**
 * FAQ Routes - FAQ and cache management endpoints
 * 
 * All routes require Clerk authentication
 * Base path: /api/faq
 */
const router = Router();

// All FAQ routes require authentication
router.use(clerkAuth);

// FAQ CRUD
router.get('/', (req, res) => FAQController.listFAQs(req, res));
router.post('/', (req, res) => FAQController.createFAQ(req, res));
router.put('/:id', (req, res) => FAQController.updateFAQ(req, res));
router.delete('/:id', (req, res) => FAQController.deleteFAQ(req, res));

// FAQ extraction
router.post('/extract', (req, res) => FAQController.extractFAQs(req, res));

// Cache management (mounted at /api/cache)
router.get('/cache/stats', (req, res) => FAQController.getCacheStats(req, res));
router.post('/cache/warm', (req, res) => FAQController.warmCache(req, res));
router.delete('/cache', (req, res) => FAQController.clearCache(req, res));

export default router;
