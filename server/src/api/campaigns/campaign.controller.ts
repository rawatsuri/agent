import type { Request, Response } from 'express';
import { db } from '@/config/database';
import { logger } from '@/utils/logger';
import { resSuccess, resError } from '@/utils/response.utils';
import { QueueService } from '@/services/queue.service';
import { BudgetService } from '@/features/cost-control/budget.service';
import { z } from 'zod';

/**
 * CampaignController - Handles campaign management endpoints
 */
export class CampaignController {
  /**
   * GET /api/campaigns
   * List campaigns with pagination
   */
  static async listCampaigns(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;

      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const skip = (page - 1) * limit;

      // Build filter conditions
      const where: any = { businessId };

      if (req.query.status) {
        where.status = req.query.status;
      }

      if (req.query.type) {
        where.type = req.query.type;
      }

      const [campaigns, total] = await Promise.all([
        db.campaign.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            _count: {
              select: {
                logs: true,
              },
            },
          },
        }),
        db.campaign.count({ where }),
      ]);

      resSuccess(res, {
        campaigns: campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          status: c.status,
          channel: c.channel,
          scheduleType: c.scheduleType,
          scheduledAt: c.scheduledAt,
          targetFilter: c.targetFilter,
          messageCount: c._count.logs,
          createdAt: c.createdAt,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasMore: skip + campaigns.length < total,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error listing campaigns');
      resError(res, 'Failed to list campaigns', 500);
    }
  }

  /**
   * POST /api/campaigns
   * Create a new campaign
   */
  static async createCampaign(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;

      const schema = z.object({
        name: z.string().min(1).max(100),
        type: z.enum(['SCHEDULED', 'EVENT_BASED']),
        channel: z.enum(['SMS', 'EMAIL', 'WHATSAPP', 'TELEGRAM']),
        scheduleType: z.enum(['ONE_TIME', 'RECURRING', 'TRIGGERED']).optional(),
        scheduledAt: z.string().datetime().optional(),
        messageTemplate: z.string().min(1).max(2000),
        aiPersonalization: z.boolean().default(false),
        targetFilter: z
          .object({
            tags: z.array(z.string()).optional(),
            minTrustScore: z.number().min(0).max(100).optional(),
            verifiedOnly: z.boolean().optional(),
          })
          .optional(),
        trigger: z
          .object({
            type: z.enum(['NO_INTERACTION', 'APPOINTMENT', 'BIRTHDAY']),
            days: z.number().min(1).max(365).optional(),
          })
          .optional(),
      });

      const result = schema.safeParse(req.body);
      if (!result.success) {
        resError(res, 'Invalid campaign data', 400, result.error.format());
        return;
      }

      // Check budget before creating
      const budgetCheck = await BudgetService.hasBudgetAvailable(businessId, 0.1);
      if (!budgetCheck.allowed) {
        resError(res, 'Insufficient budget to create campaign', 403, {
          reason: budgetCheck.reason,
        });
        return;
      }

      const campaign = await db.campaign.create({
        data: {
          businessId,
          name: result.data.name,
          type: result.data.type,
          channel: result.data.channel,
          scheduleType: result.data.scheduleType || 'ONE_TIME',
          scheduledAt: result.data.scheduledAt ? new Date(result.data.scheduledAt) : null,
          messageTemplate: result.data.messageTemplate,
          aiPersonalization: result.data.aiPersonalization,
          targetFilter: result.data.targetFilter || {},
          trigger: result.data.trigger || null,
          status: 'DRAFT',
        },
      });

      logger.info({ businessId, campaignId: campaign.id }, 'Campaign created');

      resSuccess(res, {
        message: 'Campaign created successfully',
        campaign: {
          id: campaign.id,
          name: campaign.name,
          type: campaign.type,
          status: campaign.status,
          channel: campaign.channel,
        },
      }, 201);
    } catch (error) {
      logger.error({ error }, 'Error creating campaign');
      resError(res, 'Failed to create campaign', 500);
    }
  }

  /**
   * GET /api/campaigns/:id
   * Get campaign details
   */
  static async getCampaign(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const campaignId = req.params.id;

      const campaign = await db.campaign.findFirst({
        where: { id: campaignId, businessId },
        include: {
          _count: {
            select: {
              logs: true,
            },
          },
          logs: {
            take: 10,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              status: true,
              errorMessage: true,
              createdAt: true,
              customer: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                },
              },
            },
          },
        },
      });

      if (!campaign) {
        resError(res, 'Campaign not found', 404);
        return;
      }

      resSuccess(res, {
        id: campaign.id,
        name: campaign.name,
        type: campaign.type,
        status: campaign.status,
        channel: campaign.channel,
        scheduleType: campaign.scheduleType,
        scheduledAt: campaign.scheduledAt,
        messageTemplate: campaign.messageTemplate,
        aiPersonalization: campaign.aiPersonalization,
        targetFilter: campaign.targetFilter,
        trigger: campaign.trigger,
        messageCount: campaign._count.logs,
        recentActivity: campaign.logs,
        createdAt: campaign.createdAt,
        updatedAt: campaign.updatedAt,
      });
    } catch (error) {
      logger.error({ error }, 'Error fetching campaign');
      resError(res, 'Failed to fetch campaign', 500);
    }
  }

  /**
   * PUT /api/campaigns/:id
   * Update a campaign
   */
  static async updateCampaign(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const campaignId = req.params.id;

      // Verify campaign belongs to business and is not running
      const existingCampaign = await db.campaign.findFirst({
        where: { id: campaignId, businessId },
      });

      if (!existingCampaign) {
        resError(res, 'Campaign not found', 404);
        return;
      }

      if (existingCampaign.status === 'RUNNING') {
        resError(res, 'Cannot update a running campaign', 400);
        return;
      }

      const schema = z.object({
        name: z.string().min(1).max(100).optional(),
        messageTemplate: z.string().min(1).max(2000).optional(),
        aiPersonalization: z.boolean().optional(),
        targetFilter: z
          .object({
            tags: z.array(z.string()).optional(),
            minTrustScore: z.number().min(0).max(100).optional(),
            verifiedOnly: z.boolean().optional(),
          })
          .optional(),
        scheduledAt: z.string().datetime().optional(),
        status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED']).optional(),
      });

      const result = schema.safeParse(req.body);
      if (!result.success) {
        resError(res, 'Invalid campaign data', 400, result.error.format());
        return;
      }

      const updateData: any = { ...result.data };
      if (result.data.scheduledAt) {
        updateData.scheduledAt = new Date(result.data.scheduledAt);
      }

      const campaign = await db.campaign.update({
        where: { id: campaignId },
        data: updateData,
      });

      logger.info({ businessId, campaignId }, 'Campaign updated');

      resSuccess(res, {
        message: 'Campaign updated successfully',
        campaign: {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error updating campaign');
      resError(res, 'Failed to update campaign', 500);
    }
  }

  /**
   * DELETE /api/campaigns/:id
   * Delete a campaign
   */
  static async deleteCampaign(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const campaignId = req.params.id;

      // Verify campaign belongs to business and is not running
      const existingCampaign = await db.campaign.findFirst({
        where: { id: campaignId, businessId },
      });

      if (!existingCampaign) {
        resError(res, 'Campaign not found', 404);
        return;
      }

      if (existingCampaign.status === 'RUNNING') {
        resError(res, 'Cannot delete a running campaign', 400);
        return;
      }

      // Delete campaign (cascade will delete logs)
      await db.campaign.delete({
        where: { id: campaignId },
      });

      logger.info({ businessId, campaignId }, 'Campaign deleted');

      resSuccess(res, {
        message: 'Campaign deleted successfully',
      });
    } catch (error) {
      logger.error({ error }, 'Error deleting campaign');
      resError(res, 'Failed to delete campaign', 500);
    }
  }

  /**
   * POST /api/campaigns/:id/execute
   * Execute campaign immediately
   */
  static async executeCampaign(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const campaignId = req.params.id;

      // Verify campaign belongs to business
      const campaign = await db.campaign.findFirst({
        where: { id: campaignId, businessId },
      });

      if (!campaign) {
        resError(res, 'Campaign not found', 404);
        return;
      }

      if (campaign.status === 'RUNNING') {
        resError(res, 'Campaign is already running', 400);
        return;
      }

      if (campaign.status === 'COMPLETED') {
        resError(res, 'Campaign has already been completed', 400);
        return;
      }

      // Check budget before executing
      const budgetCheck = await BudgetService.hasBudgetAvailable(businessId, 1.0);
      if (!budgetCheck.allowed) {
        resError(res, 'Insufficient budget to execute campaign', 403, {
          reason: budgetCheck.reason,
        });
        return;
      }

      // Update status to running
      await db.campaign.update({
        where: { id: campaignId },
        data: { status: 'RUNNING' },
      });

      // Queue campaign execution
      await QueueService.queueCampaignExecution(campaignId);

      logger.info({ businessId, campaignId }, 'Campaign execution queued');

      resSuccess(res, {
        message: 'Campaign execution started',
        campaignId,
        status: 'RUNNING',
      });
    } catch (error) {
      logger.error({ error }, 'Error executing campaign');
      resError(res, 'Failed to execute campaign', 500);
    }
  }

  /**
   * GET /api/campaigns/:id/stats
   * Get campaign statistics
   */
  static async getCampaignStats(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const campaignId = req.params.id;

      // Verify campaign belongs to business
      const campaign = await db.campaign.findFirst({
        where: { id: campaignId, businessId },
      });

      if (!campaign) {
        resError(res, 'Campaign not found', 404);
        return;
      }

      // Get execution stats
      const stats = await db.$queryRaw<Array<{ status: string; count: number }>>`
        SELECT status, COUNT(*) as count
        FROM "CampaignLog"
        WHERE "campaignId" = ${campaignId}
        GROUP BY status
      `;

      // Get time-based stats
      const dailyStats = await db.$queryRaw<Array<{ date: string; sent: number; failed: number }>>`
        SELECT 
          DATE("createdAt") as date,
          COUNT(*) FILTER (WHERE status = 'SENT') as sent,
          COUNT(*) FILTER (WHERE status = 'FAILED') as failed
        FROM "CampaignLog"
        WHERE "campaignId" = ${campaignId}
        GROUP BY DATE("createdAt")
        ORDER BY date DESC
        LIMIT 30
      `;

      resSuccess(res, {
        campaignId,
        status: campaign.status,
        overall: {
          sent: stats.find((s) => s.status === 'SENT')?.count || 0,
          failed: stats.find((s) => s.status === 'FAILED')?.count || 0,
          pending: stats.find((s) => s.status === 'PENDING')?.count || 0,
        },
        daily: dailyStats.map((d) => ({
          date: d.date,
          sent: Number(d.sent),
          failed: Number(d.failed),
        })),
      });
    } catch (error) {
      logger.error({ error }, 'Error fetching campaign stats');
      resError(res, 'Failed to fetch campaign stats', 500);
    }
  }
}
