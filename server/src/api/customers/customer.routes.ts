import { Router } from 'express';
import { clerkAuth } from '@/middleware/auth.middleware';
import { CustomerController } from './customer.controller';

/**
 * Customer Routes - Customer management endpoints
 * 
 * All routes require Clerk authentication
 * Base path: /api/customers
 */
const router = Router();

// All customer routes require authentication
router.use(clerkAuth);

// List customers
router.get('/', (req, res) => CustomerController.listCustomers(req, res));

// Customer detail routes
router.get('/:id', (req, res) => CustomerController.getCustomer(req, res));
router.get('/:id/conversations', (req, res) =>
  CustomerController.getCustomerConversations(req, res)
);
router.get('/:id/metrics', (req, res) => CustomerController.getCustomerMetrics(req, res));

// Tag management
router.post('/:id/tags', (req, res) => CustomerController.addTags(req, res));
router.delete('/:id/tags', (req, res) => CustomerController.removeTags(req, res));

// Customer status management
router.post('/:id/verify', (req, res) => CustomerController.verifyCustomer(req, res));
router.post('/:id/block', (req, res) => CustomerController.blockCustomer(req, res));

export default router;
