import type { Request, Response } from 'express';
import { db } from '@/config/database';
import { logger } from '@/utils/logger';
import { resSuccess, resError } from '@/utils/response.utils';
import { z } from 'zod';

/**
 * CustomerController - Handles customer management endpoints
 */
export class CustomerController {
  /**
   * GET /api/customers
   * List customers with filters and pagination
   */
  static async listCustomers(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;

      // Parse query parameters
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const skip = (page - 1) * limit;

      // Build filter conditions
      const where: any = { businessId };

      // Search by name, phone, or email
      if (req.query.search) {
        const search = req.query.search as string;
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ];
      }

      // Filter by tags
      if (req.query.tags) {
        const tags = (req.query.tags as string).split(',');
        where.tags = { hasSome: tags };
      }

      // Filter by verification status
      if (req.query.verified !== undefined) {
        where.isVerified = req.query.verified === 'true';
      }

      // Filter by trust score range
      if (req.query.minTrustScore) {
        where.trustScore = {
          ...where.trustScore,
          gte: parseInt(req.query.minTrustScore as string),
        };
      }
      if (req.query.maxTrustScore) {
        where.trustScore = {
          ...where.trustScore,
          lte: parseInt(req.query.maxTrustScore as string),
        };
      }

      // Get total count for pagination
      const total = await db.customers.count({ where });

      // Get customers
      const customers = await db.customers.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          [req.query.sortBy as string || 'updatedAt']: req.query.sortOrder === 'asc' ? 'asc' : 'desc',
        },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          tags: true,
          isVerified: true,
          trustScore: true,
          firstInteraction: true,
          lastInteraction: true,
          _count: {
            select: {
              conversations: true,
            },
          },
        },
      });

      resSuccess(res, {
        customers,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasMore: skip + customers.length < total,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error listing customers');
      resError(res, 'Failed to list customers', 500);
    }
  }

  /**
   * GET /api/customers/:id
   * Get customer details
   */
  static async getCustomer(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const customerId = req.params.id;

      const customer = await db.customers.findFirst({
        where: { id: customerId, businessId },
        include: {
          _count: {
            select: {
              conversations: true,
              memories: true,
            },
          },
        },
      });

      if (!customer) {
        resError(res, 'Customer not found', 404);
        return;
      }

      resSuccess(res, {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        tags: customer.tags,
        isVerified: customer.isVerified,
        trustScore: customer.trustScore,
        metadata: customer.metadata,
        firstInteraction: customer.firstInteraction,
        lastInteraction: customer.lastInteraction,
        stats: {
          conversationCount: customer._count.conversations,
          memoryCount: customer._count.memories,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error fetching customer');
      resError(res, 'Failed to fetch customer', 500);
    }
  }

  /**
   * GET /api/customers/:id/conversations
   * Get conversation history for a customer
   */
  static async getCustomerConversations(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const customerId = req.params.id;

      // Verify customer belongs to business
      const customer = await db.customers.findFirst({
        where: { id: customerId, businessId },
      });

      if (!customer) {
        resError(res, 'Customer not found', 404);
        return;
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const skip = (page - 1) * limit;

      const conversations = await db.conversations.findMany({
        where: { customerId, businessId },
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          _count: {
            select: {
              messages: true,
            },
          },
        },
      });

      const total = await db.conversations.count({
        where: { customerId, businessId },
      });

      resSuccess(res, {
        conversations: conversations.map((conv) => ({
          id: conv.id,
          channel: conv.channel,
          status: conv.status,
          summary: conv.summary,
          startedAt: conv.startedAt,
          lastMessageAt: conv.updatedAt,
          messageCount: conv._count.messages,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasMore: skip + conversations.length < total,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error fetching customer conversations');
      resError(res, 'Failed to fetch conversations', 500);
    }
  }

  /**
   * GET /api/customers/:id/metrics
   * Get customer metrics
   */
  static async getCustomerMetrics(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const customerId = req.params.id;

      // Verify customer belongs to business
      const customer = await db.customers.findFirst({
        where: { id: customerId, businessId },
      });

      if (!customer) {
        resError(res, 'Customer not found', 404);
        return;
      }

      // Get conversation stats
      const conversationStats = await db.conversations.groupBy({
        by: ['channel'],
        where: { customerId, businessId },
        _count: { id: true },
      });

      // Get message stats
      const messageStats = await db.messages.aggregate({
        where: {
          conversation: { customerId, businessId },
        },
        _count: { id: true },
        _avg: { aiCost: true },
      });

      // Get recent activity
      const recentConversations = await db.conversations.findMany({
        where: { customerId, businessId },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          channel: true,
          status: true,
          updatedAt: true,
        },
      });

      resSuccess(res, {
        customerId,
        overview: {
          totalConversations: conversationStats.reduce((sum, s) => sum + s._count.id, 0),
          totalMessages: messageStats._count.id,
          averageAiCost: messageStats._avg.aiCost ? Number(messageStats._avg.aiCost) : 0,
        },
        channels: conversationStats.map((stat) => ({
          channel: stat.channel,
          conversationCount: stat._count.id,
        })),
        recentActivity: recentConversations,
      });
    } catch (error) {
      logger.error({ error }, 'Error fetching customer metrics');
      resError(res, 'Failed to fetch customer metrics', 500);
    }
  }

  /**
   * POST /api/customers/:id/tags
   * Add tags to customer
   */
  static async addTags(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const customerId = req.params.id;

      const schema = z.object({
        tags: z.array(z.string().min(1).max(50)).min(1),
      });

      const result = schema.safeParse(req.body);
      if (!result.success) {
        resError(res, 'Invalid tags data', 400, result.error.format());
        return;
      }

      // Verify customer belongs to business
      const customer = await db.customers.findFirst({
        where: { id: customerId, businessId },
      });

      if (!customer) {
        resError(res, 'Customer not found', 404);
        return;
      }

      // Merge existing tags with new ones
      const existingTags = customer.tags || [];
      const newTags = [...new Set([...existingTags, ...result.data.tags])];

      const updatedCustomer = await db.customers.update({
        where: { id: customerId },
        data: { tags: newTags },
      });

      logger.info({ businessId, customerId, tags: result.data.tags }, 'Tags added to customer');

      resSuccess(res, {
        message: 'Tags added successfully',
        tags: updatedCustomer.tags,
      });
    } catch (error) {
      logger.error({ error }, 'Error adding tags');
      resError(res, 'Failed to add tags', 500);
    }
  }

  /**
   * DELETE /api/customers/:id/tags
   * Remove tags from customer
   */
  static async removeTags(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const customerId = req.params.id;

      const schema = z.object({
        tags: z.array(z.string()).min(1),
      });

      const result = schema.safeParse(req.body);
      if (!result.success) {
        resError(res, 'Invalid tags data', 400, result.error.format());
        return;
      }

      // Verify customer belongs to business
      const customer = await db.customers.findFirst({
        where: { id: customerId, businessId },
      });

      if (!customer) {
        resError(res, 'Customer not found', 404);
        return;
      }

      // Remove specified tags
      const existingTags = customer.tags || [];
      const newTags = existingTags.filter((tag) => !result.data.tags.includes(tag));

      const updatedCustomer = await db.customers.update({
        where: { id: customerId },
        data: { tags: newTags },
      });

      logger.info({ businessId, customerId, tags: result.data.tags }, 'Tags removed from customer');

      resSuccess(res, {
        message: 'Tags removed successfully',
        tags: updatedCustomer.tags,
      });
    } catch (error) {
      logger.error({ error }, 'Error removing tags');
      resError(res, 'Failed to remove tags', 500);
    }
  }

  /**
   * POST /api/customers/:id/verify
   * Verify customer
   */
  static async verifyCustomer(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const customerId = req.params.id;

      // Verify customer belongs to business
      const customer = await db.customers.findFirst({
        where: { id: customerId, businessId },
      });

      if (!customer) {
        resError(res, 'Customer not found', 404);
        return;
      }

      const updatedCustomer = await db.customers.update({
        where: { id: customerId },
        data: {
          isVerified: true,
          trustScore: Math.max(customer.trustScore, 70),
          metadata: {
            ...(customer.metadata as object || {}),
            verifiedAt: new Date().toISOString(),
          },
        },
      });

      logger.info({ businessId, customerId }, 'Customer verified');

      resSuccess(res, {
        message: 'Customer verified successfully',
        customer: {
          id: updatedCustomer.id,
          isVerified: updatedCustomer.isVerified,
          trustScore: updatedCustomer.trustScore,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error verifying customer');
      resError(res, 'Failed to verify customer', 500);
    }
  }

  /**
   * POST /api/customers/:id/block
   * Block or unblock customer (stored in metadata since no isBlocked field)
   */
  static async blockCustomer(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const customerId = req.params.id;

      const schema = z.object({
        blocked: z.boolean(),
        reason: z.string().optional(),
      });

      const result = schema.safeParse(req.body);
      if (!result.success) {
        resError(res, 'Invalid request data', 400, result.error.format());
        return;
      }

      // Verify customer belongs to business
      const customer = await db.customers.findFirst({
        where: { id: customerId, businessId },
      });

      if (!customer) {
        resError(res, 'Customer not found', 404);
        return;
      }

      const currentMetadata = (customer.metadata as object) || {};
      
      const updatedCustomer = await db.customers.update({
        where: { id: customerId },
        data: {
          metadata: {
            ...currentMetadata,
            isBlocked: result.data.blocked,
            blockedAt: result.data.blocked ? new Date().toISOString() : undefined,
            blockReason: result.data.blocked ? result.data.reason : undefined,
          },
        },
      });

      logger.info(
        { businessId, customerId, blocked: result.data.blocked },
        result.data.blocked ? 'Customer blocked' : 'Customer unblocked'
      );

      resSuccess(res, {
        message: result.data.blocked ? 'Customer blocked' : 'Customer unblocked',
        customer: {
          id: updatedCustomer.id,
          isBlocked: result.data.blocked,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error blocking/unblocking customer');
      resError(res, 'Failed to update customer block status', 500);
    }
  }
}
