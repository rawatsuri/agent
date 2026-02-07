import { Router } from 'express';
import { requireAuth } from '@clerk/express';
import { AdminController } from './admin.controller';

const router = Router();

// All admin routes require Clerk authentication
router.use(requireAuth());

// Customer management
router.get('/customers', AdminController.listCustomers);
router.post('/customers', AdminController.createCustomer);
router.get('/customers/:id', AdminController.getCustomer);
router.put('/customers/:id', AdminController.updateCustomer);
router.delete('/customers/:id', AdminController.deleteCustomer);

// Credits management
router.post('/customers/:id/credits', AdminController.addCredits);

// Analytics & Costs
router.get('/costs', AdminController.getCosts);
router.get('/analytics', AdminController.getAnalytics);

// AI Configuration
router.get('/ai-config', AdminController.getGlobalAIConfig);

export default router;
