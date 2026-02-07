import { Router } from 'express';
import { clerkAuth } from '@/middleware/auth.middleware';
import { ConversationController } from './conversation.controller';

/**
 * Conversation Routes - Conversation management endpoints
 * 
 * All routes require Clerk authentication
 * Base path: /api/conversations
 */
const router = Router();

// All conversation routes require authentication
router.use(clerkAuth);

// List conversations
router.get('/', (req, res) => ConversationController.listConversations(req, res));

// Conversation detail routes
router.get('/:id', (req, res) => ConversationController.getConversation(req, res));
router.get('/:id/messages', (req, res) => ConversationController.getMessages(req, res));

// Conversation actions
router.post('/:id/close', (req, res) => ConversationController.closeConversation(req, res));
router.post('/:id/transfer', (req, res) => ConversationController.transferConversation(req, res));
router.delete('/:id', (req, res) => ConversationController.deleteConversation(req, res));

export default router;
