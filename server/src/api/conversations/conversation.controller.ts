import type { Request, Response } from 'express';
import { db } from '@/config/database';
import { logger } from '@/utils/logger';
import { resSuccess, resError } from '@/utils/response.utils';
import { z } from 'zod';

/**
 * ConversationController - Handles conversation management endpoints
 */
export class ConversationController {
  /**
   * GET /api/conversations
   * List conversations with filters and pagination
   */
  static async listConversations(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;

      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const skip = (page - 1) * limit;

      // Build filter conditions
      const where: any = { businessId };

      // Filter by status
      if (req.query.status) {
        where.status = req.query.status;
      }

      // Filter by channel
      if (req.query.channel) {
        where.channel = req.query.channel;
      }

      // Filter by customer
      if (req.query.customerId) {
        where.customerId = req.query.customerId;
      }

      // Filter by date range
      if (req.query.fromDate) {
        where.createdAt = { ...where.createdAt, gte: new Date(req.query.fromDate as string) };
      }
      if (req.query.toDate) {
        where.createdAt = { ...where.createdAt, lte: new Date(req.query.toDate as string) };
      }

      // Get total count
      const total = await db.conversation.count({ where });

      // Get conversations
      const conversations = await db.conversation.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          [req.query.sortBy as string || 'updatedAt']: req.query.sortOrder === 'asc' ? 'asc' : 'desc',
        },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
            },
          },
          _count: {
            select: {
              messages: true,
            },
          },
        },
      });

      resSuccess(res, {
        conversations: conversations.map((conv) => ({
          id: conv.id,
          channel: conv.channel,
          status: conv.status,
          summary: conv.summary,
          customer: conv.customer,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
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
      logger.error({ error }, 'Error listing conversations');
      resError(res, 'Failed to list conversations', 500);
    }
  }

  /**
   * GET /api/conversations/:id
   * Get conversation details
   */
  static async getConversation(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const conversationId = req.params.id;

      const conversation = await db.conversation.findFirst({
        where: { id: conversationId, businessId },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              isVerified: true,
              trustScore: true,
            },
          },
          _count: {
            select: {
              messages: true,
            },
          },
        },
      });

      if (!conversation) {
        resError(res, 'Conversation not found', 404);
        return;
      }

      resSuccess(res, {
        id: conversation.id,
        channel: conversation.channel,
        status: conversation.status,
        summary: conversation.summary,
        customer: conversation.customer,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount: conversation._count.messages,
      });
    } catch (error) {
      logger.error({ error }, 'Error fetching conversation');
      resError(res, 'Failed to fetch conversation', 500);
    }
  }

  /**
   * GET /api/conversations/:id/messages
   * Get messages in a conversation
   */
  static async getMessages(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const conversationId = req.params.id;

      // Verify conversation belongs to business
      const conversation = await db.conversation.findFirst({
        where: { id: conversationId, businessId },
      });

      if (!conversation) {
        resError(res, 'Conversation not found', 404);
        return;
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const skip = (page - 1) * limit;

      const [messages, total] = await Promise.all([
        db.message.findMany({
          where: { conversationId },
          skip,
          take: limit,
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            content: true,
            aiCost: true,
            cachedResponse: true,
            createdAt: true,
          },
        }),
        db.message.count({ where: { conversationId } }),
      ]);

      resSuccess(res, {
        messages: messages.map((msg) => ({
          ...msg,
          aiCost: msg.aiCost ? Number(msg.aiCost) : null,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasMore: skip + messages.length < total,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error fetching messages');
      resError(res, 'Failed to fetch messages', 500);
    }
  }

  /**
   * POST /api/conversations/:id/close
   * Close a conversation
   */
  static async closeConversation(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const conversationId = req.params.id;

      const schema = z.object({
        summary: z.string().optional(),
      });

      const result = schema.safeParse(req.body);
      if (!result.success) {
        resError(res, 'Invalid input data', 400, result.error.format());
        return;
      }

      // Verify conversation belongs to business
      const conversation = await db.conversation.findFirst({
        where: { id: conversationId, businessId },
      });

      if (!conversation) {
        resError(res, 'Conversation not found', 404);
        return;
      }

      const updatedConversation = await db.conversation.update({
        where: { id: conversationId },
        data: {
          status: 'CLOSED',
          summary: result.data.summary || conversation.summary,
        },
      });

      logger.info({ businessId, conversationId }, 'Conversation closed');

      resSuccess(res, {
        message: 'Conversation closed successfully',
        conversation: {
          id: updatedConversation.id,
          status: updatedConversation.status,
          summary: updatedConversation.summary,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error closing conversation');
      resError(res, 'Failed to close conversation', 500);
    }
  }

  /**
   * POST /api/conversations/:id/transfer
   * Transfer conversation to human
   */
  static async transferConversation(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const conversationId = req.params.id;

      const schema = z.object({
        reason: z.string().optional(),
        agentId: z.string().optional(),
      });

      const result = schema.safeParse(req.body);
      if (!result.success) {
        resError(res, 'Invalid input data', 400, result.error.format());
        return;
      }

      // Verify conversation belongs to business
      const conversation = await db.conversation.findFirst({
        where: { id: conversationId, businessId },
      });

      if (!conversation) {
        resError(res, 'Conversation not found', 404);
        return;
      }

      const updatedConversation = await db.conversation.update({
        where: { id: conversationId },
        data: {
          status: 'HUMAN_HANDOFF',
          summary: conversation.summary
            ? `${conversation.summary}\n[Transferred to human: ${result.data.reason || 'Manual transfer'}]`
            : `[Transferred to human: ${result.data.reason || 'Manual transfer'}]`,
          metadata: {
            transferredAt: new Date().toISOString(),
            transferReason: result.data.reason,
            assignedAgentId: result.data.agentId,
          },
        },
      });

      logger.info(
        { businessId, conversationId, reason: result.data.reason },
        'Conversation transferred to human'
      );

      resSuccess(res, {
        message: 'Conversation transferred to human agent',
        conversation: {
          id: updatedConversation.id,
          status: updatedConversation.status,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error transferring conversation');
      resError(res, 'Failed to transfer conversation', 500);
    }
  }

  /**
   * DELETE /api/conversations/:id
   * Delete a conversation
   */
  static async deleteConversation(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const conversationId = req.params.id;

      // Verify conversation belongs to business
      const conversation = await db.conversation.findFirst({
        where: { id: conversationId, businessId },
      });

      if (!conversation) {
        resError(res, 'Conversation not found', 404);
        return;
      }

      // Delete conversation (cascade will delete messages and memories)
      await db.conversation.delete({
        where: { id: conversationId },
      });

      logger.info({ businessId, conversationId }, 'Conversation deleted');

      resSuccess(res, {
        message: 'Conversation deleted successfully',
      });
    } catch (error) {
      logger.error({ error }, 'Error deleting conversation');
      resError(res, 'Failed to delete conversation', 500);
    }
  }
}
