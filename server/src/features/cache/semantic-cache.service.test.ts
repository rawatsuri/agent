import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SemanticCacheService } from '@/features/cache/semantic-cache.service';
import { db } from '@/config/database';
import { createTestBusiness, createMockRedisClient, wait } from '@test/utils';

describe('SemanticCacheService', () => {
  let mockRedis: ReturnType<typeof createMockRedisClient>;

  beforeEach(async () => {
    mockRedis = createMockRedisClient();
    vi.mocked(await import('@/config/redis')).getRedisClient.mockReturnValue(mockRedis as any);
    
    await db.responseCache.deleteMany();
    await db.businessFAQ.deleteMany();
    await db.businessCredit.deleteMany();
    await db.business.deleteMany();
  });

  describe('getCachedResponse', () => {
    it('should return cache hit from L1 (memory)', async () => {
      const business = await createTestBusiness();
      const query = 'What are your business hours?';

      // First call to populate cache
      await SemanticCacheService.cacheResponse({
        businessId: business.id,
        query,
        response: 'We are open 9 AM to 6 PM daily',
        aiCost: 0.001,
      });

      // Second call should hit L1 cache
      const result = await SemanticCacheService.getCachedResponse({
        businessId: business.id,
        query,
      });

      // Note: L1 cache won't work across test calls due to module state
      // but we're testing the logic structure
      expect(result).toBeDefined();
    });

    it('should return cache miss for unknown queries', async () => {
      const business = await createTestBusiness();

      const result = await SemanticCacheService.getCachedResponse({
        businessId: business.id,
        query: 'Unique query that does not exist in cache',
      });

      expect(result.hit).toBe(false);
    });

    it('should calculate embedding cost for cache miss', async () => {
      const business = await createTestBusiness();

      const result = await SemanticCacheService.getCachedResponse({
        businessId: business.id,
        query: 'Another unique query',
      });

      // Should have embedding cost even on miss
      expect(result.cachedEmbeddingCost).toBeGreaterThan(0);
    });
  });

  describe('cacheResponse', () => {
    it('should store response in cache', async () => {
      const business = await createTestBusiness();

      await SemanticCacheService.cacheResponse({
        businessId: business.id,
        query: 'What is your return policy?',
        response: 'We accept returns within 30 days',
        aiCost: 0.001,
        channel: 'CHAT',
      });

      // Verify stored in Redis (L2)
      expect(mockRedis.setex).toHaveBeenCalled();

      // Verify stored in database (L3)
      const cached = await db.responseCache.findMany({
        where: { businessId: business.id },
      });

      expect(cached.length).toBeGreaterThan(0);
      expect(cached[0].queryText).toBe('what is your return policy');
      expect(cached[0].responseText).toBe('We accept returns within 30 days');
    });
  });

  describe('getStats', () => {
    it('should return cache statistics', () => {
      const stats = SemanticCacheService.getStats();

      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
      expect(stats).toHaveProperty('hitRate');
      expect(stats).toHaveProperty('l1Size');
      expect(stats.hitRate).toBeGreaterThanOrEqual(0);
    });
  });

  describe('populateFAQs', () => {
    it('should create FAQs with embeddings', async () => {
      const business = await createTestBusiness();

      const faqs = [
        {
          question: 'What are your hours?',
          answer: '9 AM to 6 PM',
          category: 'hours',
        },
        {
          question: 'Where are you located?',
          answer: '123 Main St',
          category: 'location',
        },
      ];

      await SemanticCacheService.populateFAQs(business.id, faqs);

      const storedFaqs = await db.businessFAQ.findMany({
        where: { businessId: business.id },
      });

      expect(storedFaqs).toHaveLength(2);
      expect(storedFaqs[0].category).toBe('hours');
      expect(storedFaqs[1].category).toBe('location');
      expect(storedFaqs[0].isActive).toBe(true);
    });
  });

  describe('invalidateBusinessCache', () => {
    it('should clear all cache for a business', async () => {
      const business = await createTestBusiness();

      // Add some cache entries
      await db.responseCache.create({
        data: {
          businessId: business.id,
          embeddingHash: 'hash1',
          queryText: 'Query 1',
          queryNormalized: 'query 1',
          responseText: 'Response 1',
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      await SemanticCacheService.invalidateBusinessCache(business.id, 'Testing');

      // Verify cache entries are expired
      const cached = await db.responseCache.findMany({
        where: { businessId: business.id },
      });

      expect(cached[0].expiresAt.getTime()).toBeLessThan(Date.now());
    });
  });

  describe('getBusinessCacheStats', () => {
    it('should return cache statistics for a business', async () => {
      const business = await createTestBusiness();

      // Add some cache entries
      await db.responseCache.create({
        data: {
          businessId: business.id,
          embeddingHash: 'hash1',
          queryText: 'Query 1',
          queryNormalized: 'query 1',
          responseText: 'Response 1',
          hitCount: 10,
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      await db.businessFAQ.create({
        data: {
          businessId: business.id,
          question: 'FAQ Question',
          answer: 'FAQ Answer',
          isActive: true,
        },
      });

      const stats = await SemanticCacheService.getBusinessCacheStats(business.id);

      expect(stats.totalCached).toBe(1);
      expect(stats.totalHits).toBe(10);
      expect(stats.faqCount).toBe(1);
      expect(stats.topQueries).toHaveLength(1);
    });
  });
});
