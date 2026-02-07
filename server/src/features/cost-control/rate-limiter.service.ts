import { getRedisClient } from '@/config/redis';
import { db } from '@/config/database';
import { logger } from '@/utils/logger';

/**
 * Rate Limiter Service
 * 
 * Multi-tier rate limiting using Redis:
 * 1. Per-customer (daily/hourly limits)
 * 2. Per-business (monthly quotas)
 * 3. Per-IP (strict limits for unknown sources)
 * 
 * Uses sliding window algorithm for accurate rate limiting.
 */
export class RateLimiterService {
  private static redis = getRedisClient();

  // Redis key prefixes
  private static readonly KEY_PREFIX = {
    CUSTOMER_DAILY: 'ratelimit:customer:daily',
    CUSTOMER_HOURLY: 'ratelimit:customer:hourly',
    BUSINESS_MONTHLY: 'ratelimit:business:monthly',
    IP_STRICT: 'ratelimit:ip:strict',
  };

  /**
   * Check and record rate limit for customer
   */
  static async checkCustomerLimit(
    customerId: string,
    businessId: string,
    type: 'MESSAGE' | 'CALL',
    channel: string
  ): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: Date;
    limit: number;
    reason?: string;
  }> {
    try {
      // Get business rate config
      const config = await db.rateLimitConfig.findUnique({
        where: { businessId },
      });

      const defaultConfig = {
        maxMessagesPerDay: 50,
        maxMessagesPerHour: 20,
        maxCallsPerDay: 3,
        maxCallsPerHour: 1,
        messageCooldownSeconds: 30,
      };

      const limits = config || defaultConfig;

      // Determine which limits to check
      let dailyLimit: number;
      let hourlyLimit: number;
      let windowMinutes: number;

      if (type === 'MESSAGE') {
        dailyLimit = limits.maxMessagesPerDay;
        hourlyLimit = limits.maxMessagesPerHour;
        windowMinutes = 1; // Check cooldown
      } else {
        dailyLimit = limits.maxCallsPerDay;
        hourlyLimit = limits.maxCallsPerHour;
        windowMinutes = 60; // 1 hour window for calls
      }

      // Check daily limit
      const dailyKey = `${this.KEY_PREFIX.CUSTOMER_DAILY}:${customerId}:${type.toLowerCase()}`;
      const dailyResult = await this.checkSlidingWindow(dailyKey, dailyLimit, 24 * 60); // 24 hours

      if (!dailyResult.allowed) {
        await this.logRateLimitHit({
          customerId,
          businessId,
          limitType: `${type}_DAILY`,
          actionTaken: 'BLOCKED',
          hitCount: dailyResult.currentCount,
          limitValue: dailyLimit,
        });

        return {
          allowed: false,
          remaining: 0,
          resetAt: dailyResult.resetAt,
          limit: dailyLimit,
          reason: `Daily ${type.toLowerCase()} limit reached (${dailyLimit}/${dailyLimit})`,
        };
      }

      // Check hourly limit
      const hourlyKey = `${this.KEY_PREFIX.CUSTOMER_HOURLY}:${customerId}:${type.toLowerCase()}`;
      const hourlyResult = await this.checkSlidingWindow(hourlyKey, hourlyLimit, 60); // 1 hour

      if (!hourlyResult.allowed) {
        await this.logRateLimitHit({
          customerId,
          businessId,
          limitType: `${type}_HOURLY`,
          actionTaken: 'BLOCKED',
          hitCount: hourlyResult.currentCount,
          limitValue: hourlyLimit,
        });

        return {
          allowed: false,
          remaining: 0,
          resetAt: hourlyResult.resetAt,
          limit: hourlyLimit,
          reason: `Hourly ${type.toLowerCase()} limit reached (${hourlyLimit}/${hourlyLimit})`,
        };
      }

      // Check cooldown (for messages only)
      if (type === 'MESSAGE' && limits.messageCooldownSeconds > 0) {
        const cooldownKey = `cooldown:${customerId}:message`;
        const cooldownTtl = await this.redis.ttl(cooldownKey);
        
        if (cooldownTtl > 0) {
          return {
            allowed: false,
            remaining: dailyResult.remaining - 1,
            resetAt: new Date(Date.now() + cooldownTtl * 1000),
            limit: dailyLimit,
            reason: `Please wait ${cooldownTtl} seconds before sending another message`,
          };
        }

        // Set cooldown
        await this.redis.setex(cooldownKey, limits.messageCooldownSeconds, '1');
      }

      // Increment counters
      await this.incrementCounter(dailyKey, 24 * 60);
      await this.incrementCounter(hourlyKey, 60);

      return {
        allowed: true,
        remaining: dailyResult.remaining - 1,
        resetAt: dailyResult.resetAt,
        limit: dailyLimit,
      };
    } catch (error) {
      logger.error({ error, customerId, type }, 'Rate limit check failed');
      // Fail open - allow request if Redis is down
      return {
        allowed: true,
        remaining: 999,
        resetAt: new Date(Date.now() + 60000),
        limit: 1000,
      };
    }
  }

  /**
   * Check business-level monthly quota
   */
  static async checkBusinessQuota(
    businessId: string,
    type: 'MESSAGE' | 'CALL' | 'SMS'
  ): Promise<{
    allowed: boolean;
    remaining: number;
    used: number;
    quota: number;
    reason?: string;
  }> {
    try {
      const config = await db.rateLimitConfig.findUnique({
        where: { businessId },
      });

      const defaultQuotas = {
        monthlyMessageQuota: 1000,
        monthlyCallQuota: 100,
        monthlySMQuota: 500,
      };

      const quotas = config || defaultQuotas;

      let quota: number;
      switch (type) {
        case 'MESSAGE':
          quota = quotas.monthlyMessageQuota;
          break;
        case 'CALL':
          quota = quotas.monthlyCallQuota;
          break;
        case 'SMS':
          quota = quotas.monthlySMQuota;
          break;
        default:
          quota = 1000;
      }

      const key = `${this.KEY_PREFIX.BUSINESS_MONTHLY}:${businessId}:${type.toLowerCase()}`;
      
      // Check monthly counter
      const currentCount = await this.getMonthlyCounter(key);
      
      if (currentCount >= quota) {
        await this.logRateLimitHit({
          businessId,
          limitType: `BUSINESS_${type}_MONTHLY`,
          actionTaken: 'BLOCKED',
          hitCount: currentCount,
          limitValue: quota,
        });

        return {
          allowed: false,
          remaining: 0,
          used: currentCount,
          quota,
          reason: `Monthly ${type.toLowerCase()} quota exceeded for your plan`,
        };
      }

      // Increment counter
      await this.incrementMonthlyCounter(key);

      return {
        allowed: true,
        remaining: quota - currentCount - 1,
        used: currentCount + 1,
        quota,
      };
    } catch (error) {
      logger.error({ error, businessId, type }, 'Business quota check failed');
      return {
        allowed: true,
        remaining: 999,
        used: 0,
        quota: 1000,
      };
    }
  }

  /**
   * Check IP-based rate limit (strict for unknown sources)
   */
  static async checkIPLimit(
    ipAddress: string,
    isKnownCustomer: boolean
  ): Promise<{
    allowed: boolean;
    remaining: number;
    reason?: string;
  }> {
    try {
      // Stricter limits for unknown IPs
      const limit = isKnownCustomer ? 1000 : 50; // 50 requests per hour for unknown
      const key = `${this.KEY_PREFIX.IP_STRICT}:${ipAddress}`;

      const result = await this.checkSlidingWindow(key, limit, 60); // 1 hour

      if (!result.allowed) {
        await this.logRateLimitHit({
          limitType: 'IP_STRICT',
          actionTaken: 'BLOCKED',
          hitCount: result.currentCount,
          limitValue: limit,
          ipAddress,
        });

        return {
          allowed: false,
          remaining: 0,
          reason: isKnownCustomer
            ? 'Too many requests from your IP'
            : 'Unverified IP - please verify your account',
        };
      }

      await this.incrementCounter(key, 60);

      return {
        allowed: true,
        remaining: result.remaining - 1,
      };
    } catch (error) {
      logger.error({ error, ipAddress }, 'IP rate limit check failed');
      return { allowed: true, remaining: 999 };
    }
  }

  /**
   * Sliding window rate limiting using Redis sorted sets
   */
  private static async checkSlidingWindow(
    key: string,
    limit: number,
    windowMinutes: number
  ): Promise<{
    allowed: boolean;
    currentCount: number;
    remaining: number;
    resetAt: Date;
  }> {
    const now = Date.now();
    const windowMs = windowMinutes * 60 * 1000;
    const windowStart = now - windowMs;

    // Remove old entries outside the window
    await this.redis.zremrangebyscore(key, 0, windowStart);

    // Count current entries in window
    const currentCount = await this.redis.zcard(key);

    const allowed = currentCount < limit;
    const remaining = Math.max(0, limit - currentCount);

    // Get the oldest entry to calculate reset time
    const oldestEntries = await this.redis.zrange(key, 0, 0, 'WITHSCORES');
    let resetAt: Date;

    if (oldestEntries.length >= 2) {
      const oldestTimestamp = parseInt(oldestEntries[1]);
      resetAt = new Date(oldestTimestamp + windowMs);
    } else {
      resetAt = new Date(now + windowMs);
    }

    return { allowed, currentCount, remaining, resetAt };
  }

  /**
   * Increment counter with timestamp
   */
  private static async incrementCounter(key: string, ttlMinutes: number): Promise<void> {
    const now = Date.now();
    await this.redis.zadd(key, now, `${now}-${Math.random()}`);
    await this.redis.expire(key, ttlMinutes * 60);
  }

  /**
   * Get monthly counter (resets on 1st of month)
   */
  private static async getMonthlyCounter(key: string): Promise<number> {
    const count = await this.redis.get(key);
    return count ? parseInt(count) : 0;
  }

  /**
   * Increment monthly counter
   */
  private static async incrementMonthlyCounter(key: string): Promise<void> {
    // Calculate TTL to end of month
    const now = new Date();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const ttlSeconds = Math.floor((endOfMonth.getTime() - now.getTime()) / 1000);

    await this.redis.incr(key);
    await this.redis.expire(key, ttlSeconds);
  }

  /**
   * Log rate limit hit for analytics
   */
  private static async logRateLimitHit(params: {
    customerId?: string;
    businessId?: string;
    limitType: string;
    actionTaken: string;
    hitCount: number;
    limitValue: number;
    ipAddress?: string;
  }): Promise<void> {
    try {
      await db.rateLimitHit.create({
        data: {
          customerId: params.customerId,
          businessId: params.businessId,
          limitType: params.limitType,
          actionTaken: params.actionTaken,
          hitCount: params.hitCount,
          limitValue: params.limitValue,
          ipAddress: params.ipAddress,
        },
      });
    } catch (error) {
      logger.error({ error, params }, 'Failed to log rate limit hit');
    }
  }

  /**
   * Reset all counters for a customer (e.g., after verification)
   */
  static async resetCustomerCounters(customerId: string): Promise<void> {
    const patterns = [
      `${this.KEY_PREFIX.CUSTOMER_DAILY}:${customerId}:*`,
      `${this.KEY_PREFIX.CUSTOMER_HOURLY}:${customerId}:*`,
      `cooldown:${customerId}:*`,
    ];

    for (const pattern of patterns) {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    }

    logger.info({ customerId }, 'Rate limit counters reset for customer');
  }

  /**
   * Get rate limit status for customer
   */
  static async getCustomerStatus(
    customerId: string,
    businessId: string
  ): Promise<{
    messages: { daily: number; dailyLimit: number; hourly: number; hourlyLimit: number };
    calls: { daily: number; dailyLimit: number; hourly: number; hourlyLimit: number };
  }> {
    const config = await db.rateLimitConfig.findUnique({
      where: { businessId },
    });

    const limits = config || {
      maxMessagesPerDay: 50,
      maxMessagesPerHour: 20,
      maxCallsPerDay: 3,
      maxCallsPerHour: 1,
    };

    // Get current counts from Redis
    const messageDailyKey = `${this.KEY_PREFIX.CUSTOMER_DAILY}:${customerId}:message`;
    const messageHourlyKey = `${this.KEY_PREFIX.CUSTOMER_HOURLY}:${customerId}:message`;
    const callDailyKey = `${this.KEY_PREFIX.CUSTOMER_DAILY}:${customerId}:call`;
    const callHourlyKey = `${this.KEY_PREFIX.CUSTOMER_HOURLY}:${customerId}:call`;

    const [
      messageDaily,
      messageHourly,
      callDaily,
      callHourly,
    ] = await Promise.all([
      this.redis.zcard(messageDailyKey),
      this.redis.zcard(messageHourlyKey),
      this.redis.zcard(callDailyKey),
      this.redis.zcard(callHourlyKey),
    ]);

    return {
      messages: {
        daily: messageDaily,
        dailyLimit: limits.maxMessagesPerDay,
        hourly: messageHourly,
        hourlyLimit: limits.maxMessagesPerHour,
      },
      calls: {
        daily: callDaily,
        dailyLimit: limits.maxCallsPerDay,
        hourly: callHourly,
        hourlyLimit: limits.maxCallsPerHour,
      },
    };
  }
}
