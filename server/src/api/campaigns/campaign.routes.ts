import { Router } from 'express';
import { clerkAuth } from '@/middleware/auth.middleware';
import { CampaignController } from './campaign.controller';

/**
 * Campaign Routes - Campaign management endpoints
 * 
 * All routes require Clerk authentication
 * Base path: /api/campaigns
 */
const router = Router();

// All campaign routes require authentication
router.use(clerkAuth);

// Campaign CRUD
router.get('/', (req, res) => CampaignController.listCampaigns(req, res));
router.post('/', (req, res) => CampaignController.createCampaign(req, res));
router.get('/:id', (req, res) => CampaignController.getCampaign(req, res));
router.put('/:id', (req, res) => CampaignController.updateCampaign(req, res));
router.delete('/:id', (req, res) => CampaignController.deleteCampaign(req, res));

// Campaign actions
router.post('/:id/execute', (req, res) => CampaignController.executeCampaign(req, res));
router.get('/:id/stats', (req, res) => CampaignController.getCampaignStats(req, res));

export default router;
