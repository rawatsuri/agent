import type { Request, Response } from 'express';
import { db } from '@/config/database';
import { logger } from '@/utils/logger';
import { resSuccess, resError } from '@/utils/response.utils';
import { QueueService } from '@/services/queue.service';
import { getRedisClient } from '@/config/redis';
import { z } from 'zod';

/**
 * FAQController - Handles FAQ and cache management endpoints
 */
export class FAQController {
  /**
   * GET /api/faq
   * List FAQs with pagination
   */
  static async listFAQs(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;

      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const skip = (page - 1) * limit;

      // Build filter conditions
      const where: any = { businessId };

      if (req.query.search) {
        const search = req.query.search as string;
        where.OR = [
          { question: { contains: search, mode: 'insensitive' } },
          { answer: { contains: search, mode: 'insensitive' } },
        ];
      }

      if (req.query.category) {
        where.category = req.query.category;
      }

      const [faqs, total] = await Promise.all([
        db.businessFAQ.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        db.businessFAQ.count({ where }),
      ]);

      resSuccess(res, {
        faqs: faqs.map((faq) => ({
          id: faq.id,
          question: faq.question,
          answer: faq.answer,
          category: faq.category,
          hitCount: faq.hitCount,
          createdAt: faq.createdAt,
          updatedAt: faq.updatedAt,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasMore: skip + faqs.length < total,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error listing FAQs');
      resError(res, 'Failed to list FAQs', 500);
    }
  }

  /**
   * POST /api/faq
   * Create a new FAQ
   */
  static async createFAQ(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;

      const schema = z.object({
        question: z.string().min(5).max(500),
        answer: z.string().min(10).max(2000),
        category: z.string().max(50).optional(),
      });

      const result = schema.safeParse(req.body);
      if (!result.success) {
        resError(res, 'Invalid FAQ data', 400, result.error.format());
        return;
      }

      const faq = await db.businessFAQ.create({
        data: {
          businessId,
          question: result.data.question,
          answer: result.data.answer,
          category: result.data.category,
          hitCount: 0,
        },
      });

      logger.info({ businessId, faqId: faq.id }, 'FAQ created');

      resSuccess(res, {
        message: 'FAQ created successfully',
        faq: {
          id: faq.id,
          question: faq.question,
          answer: faq.answer,
          category: faq.category,
        },
      }, 201);
    } catch (error) {
      logger.error({ error }, 'Error creating FAQ');
      resError(res, 'Failed to create FAQ', 500);
    }
  }

  /**
   * PUT /api/faq/:id
   * Update an FAQ
   */
  static async updateFAQ(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const faqId = req.params.id;

      const schema = z.object({
        question: z.string().min(5).max(500).optional(),
        answer: z.string().min(10).max(2000).optional(),
        category: z.string().max(50).optional(),
      });

      const result = schema.safeParse(req.body);
      if (!result.success) {
        resError(res, 'Invalid FAQ data', 400, result.error.format());
        return;
      }

      // Verify FAQ belongs to business
      const existingFAQ = await db.businessFAQ.findFirst({
        where: { id: faqId, businessId },
      });

      if (!existingFAQ) {
        resError(res, 'FAQ not found', 404);
        return;
      }

      const faq = await db.businessFAQ.update({
        where: { id: faqId },
        data: result.data,
      });

      logger.info({ businessId, faqId }, 'FAQ updated');

      resSuccess(res, {
        message: 'FAQ updated successfully',
        faq: {
          id: faq.id,
          question: faq.question,
          answer: faq.answer,
          category: faq.category,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error updating FAQ');
      resError(res, 'Failed to update FAQ', 500);
    }
  }

  /**
   * DELETE /api/faq/:id
   * Delete an FAQ
   */
  static async deleteFAQ(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const faqId = req.params.id;

      // Verify FAQ belongs to business
      const existingFAQ = await db.businessFAQ.findFirst({
        where: { id: faqId, businessId },
      });

      if (!existingFAQ) {
        resError(res, 'FAQ not found', 404);
        return;
      }

      await db.businessFAQ.delete({
        where: { id: faqId },
      });

      logger.info({ businessId, faqId }, 'FAQ deleted');

      resSuccess(res, {
        message: 'FAQ deleted successfully',
      });
    } catch (error) {
      logger.error({ error }, 'Error deleting FAQ');
      resError(res, 'Failed to delete FAQ', 500);
    }
  }

  /**
   * POST /api/faq/extract
   * Auto-extract FAQs from conversations
   */
  static async extractFAQs(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;

      const schema = z.object({
        days: z.number().min(1).max(90).default(30),
        minOccurrences: z.number().min(2).max(50).default(3),
      });

      const result = schema.safeParse(req.body);
      if (!result.success) {
        resError(res, 'Invalid extraction parameters', 400, result.error.format());
        return;
      }

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - result.data.days);

      // Find common customer questions (simplified implementation)
      // In production, this would use AI to identify common questions
      const commonQuestions = await db.$queryRaw<Array<{ question: string; count: number }>>`
        SELECT content as question, COUNT(*) as count
        FROM "Message"
        WHERE "conversationId" IN (
          SELECT id FROM "Conversation" 
          WHERE "businessId" = ${businessId} 
          AND "createdAt" >= ${startDate}
        )
        AND role = 'USER'
        AND LENGTH(content) > 10
        GROUP BY content
        HAVING COUNT(*) >= ${result.data.minOccurrences}
        ORDER BY count DESC
        LIMIT 50
      `;

      logger.info(
        { businessId, foundCount: commonQuestions.length },
        'FAQ extraction completed'
      );

      resSuccess(res, {
        message: `Found ${commonQuestions.length} potential FAQs`,
        suggestions: commonQuestions.map((q) => ({
          question: q.question,
          occurrences: Number(q.count),
        })),
      });
    } catch (error) {
      logger.error({ error }, 'Error extracting FAQs');
      resError(res, 'Failed to extract FAQs', 500);
    }
  }

  /**
   * GET /api/cache/stats
   * Get cache statistics
   */
  static async getCacheStats(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const redis = getRedisClient();

      // Get Redis stats
      const cacheKeys = await redis.keys(`cache:${businessId}:*`);
      const memoryKeys = await redis.keys(`memory:${businessId}:*`);

      // Get DB cache stats
      const dbCacheCount = await db.responseCache.count({
        where: { businessId },
      });

      const dbFAQCount = await db.businessFAQ.count({
        where: { businessId },
      });

      // Get recent cache hits from messages
      const messageStats = await db.$queryRaw<Array<{ hits: number; misses: number }>>`
        SELECT 
          COUNT(*) FILTER (WHERE "cachedResponse" = true) as hits,
          COUNT(*) FILTER (WHERE "cachedResponse" = false OR "cachedResponse" IS NULL) as misses
        FROM "Message"
        WHERE "conversationId" IN (
          SELECT id FROM "Conversation" WHERE "businessId" = ${businessId}
        )
        AND "createdAt" >= NOW() - INTERVAL '24 hours'
      `;

      const hits = Number(messageStats[0]?.hits || 0);
      const misses = Number(messageStats[0]?.misses || 0);
      const total = hits + misses;
      const hitRate = total > 0 ? (hits / total) * 100 : 0;

      resSuccess(res, {
        overview: {
          totalCached: dbCacheCount,
          faqCount: dbFAQCount,
          redisCacheKeys: cacheKeys.length,
          redisMemoryKeys: memoryKeys.length,
        },
        performance: {
          hitRate: Math.round(hitRate * 100) / 100,
          hits,
          misses,
          total,
        },
        savings: {
          estimatedAiCallsSaved: hits,
          estimatedCostSaved: Number((hits * 0.001).toFixed(4)),
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error fetching cache stats');
      resError(res, 'Failed to fetch cache stats', 500);
    }
  }

  /**
   * POST /api/cache/warm
   * Trigger cache warming
   */
  static async warmCache(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;

      // Queue cache warming job
      await QueueService.queueCacheWarming(businessId);

      logger.info({ businessId }, 'Cache warming triggered');

      resSuccess(res, {
        message: 'Cache warming started',
        businessId,
      });
    } catch (error) {
      logger.error({ error }, 'Error warming cache');
      resError(res, 'Failed to warm cache', 500);
    }
  }

  /**
   * DELETE /api/cache
   * Clear cache
   */
  static async clearCache(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const redis = getRedisClient();

      const schema = z.object({
        type: z.enum(['redis', 'database', 'all']).default('all'),
      });

      const result = schema.safeParse(req.body);
      if (!result.success) {
        resError(res, 'Invalid clear parameters', 400, result.error.format());
        return;
      }

      let cleared = {
        redisKeys: 0,
        databaseRecords: 0,
      };

      // Clear Redis cache
      if (result.data.type === 'redis' || result.data.type === 'all') {
        const cacheKeys = await redis.keys(`cache:${businessId}:*`);
        const memoryKeys = await redis.keys(`memory:${businessId}:*`);
        const allKeys = [...cacheKeys, ...memoryKeys];

        if (allKeys.length > 0) {
          await redis.del(...allKeys);
          cleared.redisKeys = allKeys.length;
        }
      }

      // Clear database cache
      if (result.data.type === 'database' || result.data.type === 'all') {
        const deleteResult = await db.responseCache.deleteMany({
          where: { businessId },
        });
        cleared.databaseRecords = deleteResult.count;
      }

      logger.info({ businessId, cleared }, 'Cache cleared');

      resSuccess(res, {
        message: 'Cache cleared successfully',
        cleared,
      });
    } catch (error) {
      logger.error({ error }, 'Error clearing cache');
      resError(res, 'Failed to clear cache', 500);
    }
  }
}
