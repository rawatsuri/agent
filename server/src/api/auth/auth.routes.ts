import { Router } from 'express';
import { CustomerAuthController } from './customer-auth.controller';
import { authenticateCustomer } from '@/middleware/customer-auth.middleware';

const router = Router();

// Public routes
router.post('/register', CustomerAuthController.register);
router.post('/login', CustomerAuthController.login);

// Protected routes
router.get('/me', authenticateCustomer, CustomerAuthController.me);
router.put('/me', authenticateCustomer, CustomerAuthController.updateProfile);
router.post('/change-password', authenticateCustomer, CustomerAuthController.changePassword);

export default router;
