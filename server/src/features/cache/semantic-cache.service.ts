import OpenAI from 'openai';
import { db } from '@/config/database';
import { logger } from '@/utils/logger';
import { getRedisClient } from '@/config/redis';
import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Semantic Cache Service - PRODUCTION HARDENED
 * 
 * Multi-tier caching system for AI responses:
 * 1. L1: LRU in-memory cache - fastest, prevents memory leaks
 * 2. L2: Redis - distributed cache with embedding similarity
 * 3. L3: PostgreSQL - persistent FAQ and long-term cache
 * 
 * Uses embedding-based similarity matching (>0.92 cosine similarity)
 * to find semantically similar queries and return cached responses.
 */
export class SemanticCacheService {
  private static redis = getRedisClient();

  // L1: LRU in-memory cache (PRODUCTION FIX: Prevents memory leaks)
  private static l1Cache = new LRUCache<string, string>({
    max: parseInt(process.env.L1_CACHE_MAX_SIZE || '10000'),  // Max 10K entries
    maxSize: (parseInt(process.env.L1_CACHE_MAX_MB || '50')) * 1024 * 1024,  // 50MB default
    sizeCalculation: (value) => value.length,
    ttl: 5 * 60 * 1000,  // 5 minutes
    updateAgeOnGet: true,  // LRU behavior
    updateAgeOnHas: false,
  });

  // Cache hit/miss statistics
  private static stats = {
    hits: 0,
    misses: 0,
    l1Hits: 0,
    l2Hits: 0,
    l3Hits: 0,
  };

  // Default similarity threshold
  private static readonly SIMILARITY_THRESHOLD = 0.92;

  // TTL configuration (minutes)
  private static readonly TTL = {
    L1: 5,           // 5 minutes
    L2: 60,          // 1 hour
    L3_DYNAMIC: 15,  // 15 minutes for dynamic queries
    L3_STABLE: 1440, // 24 hours for stable queries (hours, location, etc.)
    L3_FAQ: 10080,   // 7 days for FAQs
  };

  /**
   * Get cached response for a query
   */
  static async getCachedResponse(params: {
    businessId: string;
    query: string;
    customerId?: string;
    channel?: Channel;
    context?: string; // Recent conversation context for personalization
  }): Promise<{
    hit: boolean;
    response?: string;
    source?: 'L1' | 'L2' | 'L3' | 'FAQ';
    similarity?: number;
    cachedEmbeddingCost?: number; // Cost saved by not generating embedding
  }> {
    try {
      // Step 1: Normalize query
      const normalizedQuery = this.normalizeQuery(params.query);

      // Step 2: Check L1 (In-Memory) - exact match only for speed
      const l1Key = this.generateL1Key(params.businessId, normalizedQuery);
      const l1Result = this.l1Cache.get(l1Key);

      if (l1Result) {  // LRU cache auto-handles expiry
        this.stats.hits++;
        this.stats.l1Hits++;

        // Update hit count in background
        this.updateCacheHitCount(params.businessId, normalizedQuery);

        return {
          hit: true,
          response: l1Result,
          source: 'L1',
        };
      }

      // Step 3: Generate embedding for semantic search
      const embeddingStart = Date.now();
      const embedding = await this.generateEmbedding(normalizedQuery);
      const embeddingCost = (Date.now() - embeddingStart) / 1000 * 0.0001; // Approximate cost

      // Step 4: Check L2 (Redis) - semantic similarity
      const l2Result = await this.checkL2Cache({
        businessId: params.businessId,
        query: normalizedQuery,
        embedding,
        customerId: params.customerId,
      });

      if (l2Result.hit) {
        this.stats.hits++;
        this.stats.l2Hits++;

        // Store in L1 for future fast access
        this.storeInL1(l1Key, l2Result.response!);

        return {
          hit: true,
          response: l2Result.response,
          source: 'L2',
          similarity: l2Result.similarity,
          cachedEmbeddingCost: embeddingCost,
        };
      }

      // Step 5: Check L3 (PostgreSQL) - FAQs and long-term cache
      const l3Result = await this.checkL3Cache({
        businessId: params.businessId,
        query: normalizedQuery,
        embedding,
        customerId: params.customerId,
      });

      if (l3Result.hit) {
        this.stats.hits++;
        this.stats.l3Hits++;

        // Store in L1 and L2 for future use
        this.storeInL1(l1Key, l3Result.response!);
        await this.storeInL2({
          businessId: params.businessId,
          query: normalizedQuery,
          embedding,
          response: l3Result.response!,
          source: l3Result.source === 'FAQ' ? 'FAQ' : 'L3',
        });

        return {
          hit: true,
          response: l3Result.response,
          source: l3Result.source,
          similarity: l3Result.similarity,
          cachedEmbeddingCost: embeddingCost,
        };
      }

      // Cache miss
      this.stats.misses++;

      return {
        hit: false,
        cachedEmbeddingCost: embeddingCost,
      };
    } catch (error) {
      logger.error({ error, params }, 'Semantic cache lookup failed');
      return { hit: false };
    }
  }

  /**
   * Store response in cache
   */
  static async cacheResponse(params: {
    businessId: string;
    query: string;
    response: string;
    customerId?: string;
    channel?: Channel;
    aiCost: number; // Cost of generating this response
    context?: string;
  }): Promise<void> {
    try {
      const normalizedQuery = this.normalizeQuery(params.query);
      const embedding = await this.generateEmbedding(normalizedQuery);
      const embeddingHash = this.hashEmbedding(embedding);

      // Determine TTL based on query type
      const ttl = this.determineTTL(normalizedQuery);

      // Store in L1
      const l1Key = this.generateL1Key(params.businessId, normalizedQuery);
      this.storeInL1(l1Key, params.response, ttl.L1);

      // Store in L2 (Redis)
      await this.storeInL2({
        businessId: params.businessId,
        query: normalizedQuery,
        embedding,
        embeddingHash,
        response: params.response,
        customerId: params.customerId,
        channel: params.channel,
        ttl: ttl.L2,
      });

      // Store in L3 (PostgreSQL) if high-value cache
      if (params.aiCost > 0.005 || ttl.L3 === this.TTL.L3_FAQ) {
        await this.storeInL3({
          businessId: params.businessId,
          query: normalizedQuery,
          embedding,
          embeddingHash,
          response: params.response,
          customerId: params.customerId,
          channel: params.channel,
          ttl: ttl.L3,
        });
      }

      logger.debug(
        {
          businessId: params.businessId,
          queryLength: normalizedQuery.length,
          ttl,
        },
        'Response cached'
      );
    } catch (error) {
      logger.error({ error, params }, 'Failed to cache response');
    }
  }

  /**
   * Check L2 cache (Redis) - semantic similarity
   */
  private static async checkL2Cache(params: {
    businessId: string;
    query: string;
    embedding: number[];
    customerId?: string;
  }): Promise<{ hit: boolean; response?: string; similarity?: number }> {
    // Try exact hash match first
    const embeddingHash = this.hashEmbedding(params.embedding);
    const exactKey = `cache:l2:${params.businessId}:${embeddingHash}`;

    const exactMatch = await this.redis.get(exactKey);
    if (exactMatch) {
      const data = JSON.parse(exactMatch);
      await this.redis.expire(exactKey, this.TTL.L2 * 60); // Extend TTL
      return { hit: true, response: data.response, similarity: 1.0 };
    }

    // Check for customer-specific cache (use SCAN instead of KEYS - production fix)
    if (params.customerId) {
      const customerKey = `cache:l2:${params.businessId}:customer:${params.customerId}:*`;
      const customerKeys = await this.scanKeys(customerKey);

      for (const key of customerKeys) {
        const cached = await this.redis.get(key);
        if (cached) {
          const data = JSON.parse(cached);
          const similarity = this.cosineSimilarity(params.embedding, data.embedding);

          if (similarity >= this.SIMILARITY_THRESHOLD) {
            await this.redis.expire(key, this.TTL.L2 * 60);
            return { hit: true, response: data.response, similarity };
          }
        }
      }
    }

    // Check general cache (non-customer-specific) - use SCAN for production
    const generalPattern = `cache:l2:${params.businessId}:general:*`;
    const generalKeys = await this.scanKeys(generalPattern);

    // Check first 50 keys to avoid blocking
    for (const key of generalKeys.slice(0, 50)) {
      const cached = await this.redis.get(key);
      if (cached) {
        const data = JSON.parse(cached);
        const similarity = this.cosineSimilarity(params.embedding, data.embedding);

        if (similarity >= this.SIMILARITY_THRESHOLD) {
          await this.redis.expire(key, this.TTL.L2 * 60);
          return { hit: true, response: data.response, similarity };
        }
      }
    }

    return { hit: false };
  }

  /**
   * Check L3 cache (PostgreSQL) - FAQs and long-term storage
   */
  private static async checkL3Cache(params: {
    businessId: string;
    query: string;
    embedding: number[];
    customerId?: string;
  }): Promise<{ hit: boolean; response?: string; similarity?: number; source?: 'L3' | 'FAQ' }> {
    // Step 1: Check FAQ table first (pre-computed answers)
    const faqResults = await db.$queryRaw<{
      answer: string;
      similarity: number;
    }[]>`
      SELECT 
        answer,
        1 - (embedding <=> ${JSON.stringify(params.embedding)}::vector) as similarity
      FROM business_faqs
      WHERE business_id = ${params.businessId}::uuid
        AND is_active = true
      ORDER BY embedding <=> ${JSON.stringify(params.embedding)}::vector
      LIMIT 3
    `;

    for (const result of faqResults) {
      if (result.similarity >= this.SIMILARITY_THRESHOLD) {
        // Update hit count
        await db.businessFAQ.updateMany({
          where: {
            businessId: params.businessId,
            answer: result.answer,
          },
          data: {
            hitCount: { increment: 1 },
            lastHitAt: new Date(),
          },
        });

        return {
          hit: true,
          response: result.answer,
          similarity: result.similarity,
          source: 'FAQ',
        };
      }
    }

    // Step 2: Check response cache table
    const cacheResults = await db.$queryRaw<{
      response_text: string;
      similarity: number;
    }[]>`
      SELECT 
        response_text,
        1 - (query_vector <=> ${JSON.stringify(params.embedding)}::vector) as similarity
      FROM response_caches
      WHERE business_id = ${params.businessId}::uuid
        AND expires_at > NOW()
        AND (customer_id IS NULL OR customer_id = ${params.customerId || null}::uuid)
      ORDER BY query_vector <=> ${JSON.stringify(params.embedding)}::vector
      LIMIT 5
    `;

    for (const result of cacheResults) {
      if (result.similarity >= this.SIMILARITY_THRESHOLD) {
        // Update hit count
        await db.responseCache.updateMany({
          where: {
            businessId: params.businessId,
            responseText: result.response_text,
          },
          data: {
            hitCount: { increment: 1 },
            lastAccessedAt: new Date(),
          },
        });

        return {
          hit: true,
          response: result.response_text,
          similarity: result.similarity,
          source: 'L3',
        };
      }
    }

    return { hit: false };
  }

  /**
   * Store in L2 (Redis)
   */
  private static async storeInL2(params: {
    businessId: string;
    query: string;
    embedding: number[];
    embeddingHash?: string;
    response: string;
    customerId?: string;
    channel?: Channel;
    source?: string;
    ttl?: number;
  }): Promise<void> {
    const hash = params.embeddingHash || this.hashEmbedding(params.embedding);
    const key = params.customerId
      ? `cache:l2:${params.businessId}:customer:${params.customerId}:${hash}`
      : `cache:l2:${params.businessId}:general:${hash}`;

    const data = {
      query: params.query,
      embedding: params.embedding,
      response: params.response,
      channel: params.channel,
      source: params.source || 'L2',
      createdAt: new Date().toISOString(),
    };

    await this.redis.setex(key, (params.ttl || this.TTL.L2) * 60, JSON.stringify(data));
  }

  /**
   * Store in L3 (PostgreSQL)
   */
  private static async storeInL3(params: {
    businessId: string;
    query: string;
    embedding: number[];
    embeddingHash: string;
    response: string;
    customerId?: string;
    channel?: Channel;
    ttl: number;
  }): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + params.ttl);

    await db.responseCache.create({
      data: {
        businessId: params.businessId,
        embeddingHash: params.embeddingHash,
        queryText: params.query,
        queryNormalized: this.normalizeQuery(params.query),
        responseText: params.response,
        queryVector: params.embedding as any,
        expiresAt,
        sourceChannel: params.channel,
        customerId: params.customerId,
        similarityScore: this.SIMILARITY_THRESHOLD,
      },
    });
  }

  /**
   * Store in L1 (In-Memory)
   */
  private static storeInL1(key: string, response: string, ttlMinutes: number = this.TTL.L1): void {
    this.l1Cache.set(key, {
      response,
      expiresAt: Date.now() + ttlMinutes * 60 * 1000,
    });

    // Simple cleanup of expired entries every 100 inserts
    if (this.l1Cache.size % 100 === 0) {
      this.cleanupL1Cache();
    }
  }

  /**
   * Cleanup expired L1 cache entries
   */
  private static cleanupL1Cache(): void {
    const now = Date.now();
    for (const [key, value] of this.l1Cache.entries()) {
      if (value.expiresAt < now) {
        this.l1Cache.delete(key);
      }
    }
  }

  /**
   * Generate embedding using OpenAI
   */
  private static async generateEmbedding(text: string): Promise<number[]> {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });

    return response.data[0].embedding;
  }

  /**
   * Hash embedding for cache key
   */
  private static hashEmbedding(embedding: number[]): string {
    return createHash('sha256')
      .update(JSON.stringify(embedding))
      .digest('hex')
      .substring(0, 16); // First 16 chars is enough
  }

  /**
   * Generate L1 cache key
   */
  private static generateL1Key(businessId: string, query: string): string {
    return `${businessId}:${createHash('sha256').update(query).digest('hex')}`;
  }

  /**
   * Normalize query for consistent matching
   */
  private static normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ') // Replace special chars with space
      .replace(/\s+/g, ' ')         // Normalize whitespace
      .trim()
      .substring(0, 500);           // Limit to 500 chars
  }

  /**
   * Determine TTL based on query type
   */
  private static determineTTL(query: string): { L1: number; L2: number; L3: number } {
    const lowerQuery = query.toLowerCase();

    // Stable information (rarely changes)
    if (this.isStableQuery(lowerQuery)) {
      return {
        L1: this.TTL.L1,
        L2: this.TTL.L2,
        L3: this.TTL.L3_STABLE,
      };
    }

    // Dynamic information (changes frequently)
    if (this.isDynamicQuery(lowerQuery)) {
      return {
        L1: this.TTL.L1,
        L2: 15, // Shorter TTL for dynamic
        L3: this.TTL.L3_DYNAMIC,
      };
    }

    // Default
    return {
      L1: this.TTL.L1,
      L2: this.TTL.L2,
      L3: this.TTL.L3_DYNAMIC,
    };
  }

  /**
   * Check if query is about stable information
   */
  private static isStableQuery(query: string): boolean {
    const stablePatterns = [
      /\b(hour|time|open|close|schedule)\b/,
      /\b(location|address|where|direction)\b/,
      /\b(contact|phone|email|reach)\b/,
      /\b(about|who|what is)\b/,
      /\b(policy|return|refund|warranty)\b/,
    ];

    return stablePatterns.some(pattern => pattern.test(query));
  }

  /**
   * Check if query is about dynamic information
   */
  private static isDynamicQuery(query: string): boolean {
    const dynamicPatterns = [
      /\b(price|cost|how much|fee)\b/,
      /\b(availability|stock|inventory|in stock)\b/,
      /\b(appointment|slot|booking|schedule)\b/,
      /\b(status|track|order|delivery)\b/,
      /\b(promo|discount|sale|offer|deal)\b/,
    ];

    return dynamicPatterns.some(pattern => pattern.test(query));
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  private static cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Update cache hit count (background)
   */
  private static async updateCacheHitCount(businessId: string, query: string): Promise<void> {
    // Fire and forget - don't wait for this
    db.responseCache.updateMany({
      where: {
        businessId,
        queryNormalized: query,
      },
      data: {
        hitCount: { increment: 1 },
        lastAccessedAt: new Date(),
      },
    }).catch(() => { });
  }

  /**
   * Get cache statistics
   */
  static getStats(): {
    hits: number;
    misses: number;
    hitRate: number;
    l1Hits: number;
    l2Hits: number;
    l3Hits: number;
    l1Size: number;
  } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? Math.round((this.stats.hits / total) * 100) : 0,
      l1Size: this.l1Cache.size,
    };
  }

  /**
   * Get business-specific cache analytics
   */
  static async getBusinessCacheStats(businessId: string): Promise<{
    totalCached: number;
    totalHits: number;
    faqCount: number;
    topQueries: Array<{ query: string; hits: number }>;
  }> {
    const [totalCached, faqCount, topCaches] = await Promise.all([
      db.responseCache.count({
        where: { businessId },
      }),
      db.businessFAQ.count({
        where: { businessId, isActive: true },
      }),
      db.responseCache.findMany({
        where: { businessId },
        orderBy: { hitCount: 'desc' },
        take: 10,
        select: {
          queryText: true,
          hitCount: true,
        },
      }),
    ]);

    const totalHits = await db.responseCache.aggregate({
      where: { businessId },
      _sum: { hitCount: true },
    });

    return {
      totalCached,
      totalHits: totalHits._sum.hitCount || 0,
      faqCount,
      topQueries: topCaches.map(c => ({
        query: c.queryText.substring(0, 100),
        hits: c.hitCount,
      })),
    };
  }

  /**
   * Non-blocking Redis SCAN helper (PRODUCTION FIX)
   * 
   * Uses SCAN instead of KEYS to avoid blocking Redis
   */
  private static async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, matchedKeys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100
      );

      cursor = nextCursor;
      keys.push(...matchedKeys);

      // Safety limit to prevent infinite loops
      if (keys.length > 10000) {
        logger.warn(
          { pattern, keysFound: keys.length },
          'SCAN returning too many keys, stopping early'
        );
        break;
      }
    } while (cursor !== '0');

    return keys;
  }

  /**
   * Invalidate cache for a business
   */
  static async invalidateBusinessCache(businessId: string, reason?: string): Promise<void> {
    // Clear L2 (Redis) - use SCAN instead of KEYS (production fix)
    const keys = await this.scanKeys(`cache:l2:${businessId}:*`);
    if (keys.length > 0) {
      // Delete in batches to avoid blocking
      const batchSize = 100;
      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);
        await this.redis.del(...batch);
      }
    }

    // Clear L1
    for (const key of this.l1Cache.keys()) {
      if (key.startsWith(businessId)) {
        this.l1Cache.delete(key);
      }
    }

    // Mark L3 entries as expired
    await db.responseCache.updateMany({
      where: { businessId },
      data: { expiresAt: new Date() },
    });

    logger.info({ businessId, reason }, 'Business cache invalidated');
  }

  /**
   * Pre-populate FAQs for a business
   */
  static async populateFAQs(
    businessId: string,
    faqs: Array<{ question: string; answer: string; category?: string }>
  ): Promise<void> {
    for (const faq of faqs) {
      const embedding = await this.generateEmbedding(faq.question);

      await db.businessFAQ.create({
        data: {
          businessId,
          question: faq.question,
          answer: faq.answer,
          category: faq.category || 'general',
          embedding: embedding as any,
          isActive: true,
        },
      });
    }

    logger.info({ businessId, count: faqs.length }, 'FAQs populated');
  }
}
