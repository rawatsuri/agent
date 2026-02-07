import { Router } from 'express';
import { apiKeyAuth } from '@/middleware/auth.middleware';
import { AgentController } from '@/features/voice/agent.controller';

const router = Router();

/**
 * Agent Routes - Core API for all channels
 * Protected by API key (internal services only)
 */

// Health check (public)
router.get('/health', AgentController.healthCheck);

// Process message (protected - for voice bridge and channel adapters)
router.post('/process', apiKeyAuth, AgentController.processMessage);

export default router;
