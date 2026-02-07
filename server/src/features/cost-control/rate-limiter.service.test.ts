import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RateLimiterService } from '@/features/cost-control/rate-limiter.service';
import { db } from '@/config/database';
import { createTestBusiness, createMockRedisClient } from '@test/utils';

describe('RateLimiterService', () => {
  let mockRedis: ReturnType<typeof createMockRedisClient>;

  beforeEach(async () => {
    mockRedis = createMockRedisClient();
    vi.mocked(await import('@/config/redis')).getRedisClient.mockReturnValue(mockRedis as any);
    
    await db.rateLimitHit.deleteMany();
    await db.rateLimitConfig.deleteMany();
    await db.businessCredit.deleteMany();
    await db.business.deleteMany();
  });

  describe('checkCustomerLimit', () => {
    it('should allow requests within limits', async () => {
      const business = await createTestBusiness();
      const customerId = 'test_customer_123';

      const result = await RateLimiterService.checkCustomerLimit(
        customerId,
        business.id,
        'MESSAGE',
        'CHAT'
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
      expect(result.limit).toBe(50); // Default daily limit
    });

    it('should block requests exceeding daily limit', async () => {
      const business = await createTestBusiness();
      const customerId = 'test_customer_456';

      // Simulate 51 requests (exceeds limit of 50)
      mockRedis.zcard.mockResolvedValue(51);

      const result = await RateLimiterService.checkCustomerLimit(
        customerId,
        business.id,
        'MESSAGE',
        'CHAT'
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily');
      expect(result.remaining).toBe(0);
    });

    it('should block requests exceeding hourly limit', async () => {
      const business = await createTestBusiness();
      const customerId = 'test_customer_789';

      // Daily is fine but hourly is exceeded
      mockRedis.zcard
        .mockResolvedValueOnce(10) // Daily count
        .mockResolvedValueOnce(21); // Hourly count (limit is 20)

      const result = await RateLimiterService.checkCustomerLimit(
        customerId,
        business.id,
        'MESSAGE',
        'CHAT'
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Hourly');
    });

    it('should enforce cooldown between messages', async () => {
      const business = await createTestBusiness();
      const customerId = 'test_customer_cooldown';

      // Simulate active cooldown (TTL > 0)
      mockRedis.ttl.mockResolvedValue(15);

      const result = await RateLimiterService.checkCustomerLimit(
        customerId,
        business.id,
        'MESSAGE',
        'CHAT'
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('wait');
    });
  });

  describe('checkBusinessQuota', () => {
    it('should allow requests within monthly quota', async () => {
      const business = await createTestBusiness();

      // Mock Redis to show 500 messages used (limit is 1000)
      mockRedis.get.mockResolvedValue('500');

      const result = await RateLimiterService.checkBusinessQuota(
        business.id,
        'MESSAGE'
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(499); // 1000 - 500 - 1 (for this request)
      expect(result.quota).toBe(1000);
    });

    it('should block requests exceeding monthly quota', async () => {
      const business = await createTestBusiness();

      // Mock Redis to show 1000 messages used (at limit)
      mockRedis.get.mockResolvedValue('1000');

      const result = await RateLimiterService.checkBusinessQuota(
        business.id,
        'MESSAGE'
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('quota');
      expect(result.remaining).toBe(0);
    });
  });

  describe('checkIPLimit', () => {
    it('should allow requests from known customers', async () => {
      const result = await RateLimiterService.checkIPLimit(
        '192.168.1.1',
        true // isKnownCustomer
      );

      expect(result.allowed).toBe(true);
    });

    it('should have stricter limits for unknown IPs', async () => {
      // Mock Redis to show 51 requests (unknown IP limit is 50)
      mockRedis.zcard.mockResolvedValue(51);

      const result = await RateLimiterService.checkIPLimit(
        '10.0.0.1',
        false // unknown customer
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Unverified');
    });
  });

  describe('getCustomerStatus', () => {
    it('should return current rate limit status', async () => {
      const business = await createTestBusiness();
      const customerId = 'test_customer_status';

      mockRedis.zcard
        .mockResolvedValueOnce(25)  // Daily messages
        .mockResolvedValueOnce(10)  // Hourly messages
        .mockResolvedValueOnce(2)   // Daily calls
        .mockResolvedValueOnce(1);  // Hourly calls

      const status = await RateLimiterService.getCustomerStatus(customerId, business.id);

      expect(status.messages.daily).toBe(25);
      expect(status.messages.dailyLimit).toBe(50);
      expect(status.messages.hourly).toBe(10);
      expect(status.calls.daily).toBe(2);
      expect(status.calls.dailyLimit).toBe(3);
    });
  });

  describe('resetCustomerCounters', () => {
    it('should reset all counters for a customer', async () => {
      const customerId = 'test_customer_reset';

      // Add some mock data to Redis
      mockRedis._store.set(`ratelimit:customer:daily:${customerId}:message`, 'data');
      mockRedis._store.set(`cooldown:${customerId}:message`, 'data');

      await RateLimiterService.resetCustomerCounters(customerId);

      // Verify keys were deleted
      expect(mockRedis.del).toHaveBeenCalled();
    });
  });
});
