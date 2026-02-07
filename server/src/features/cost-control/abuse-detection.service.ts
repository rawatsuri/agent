import { db } from '@/config/database';
import { logger } from '@/utils/logger';
import { getRedisClient } from '@/config/redis';

/**
 * Abuse Detection Service
 * 
 * Detects and prevents abuse patterns:
 * - Rapid-fire messaging (bot behavior)
 * - Gibberish/random text testing
 * - Repeated same questions (cost testing)
 * - Geographic anomalies (VPN/proxy detection)
 * - Known abuse patterns
 */
export class AbuseDetectionService {
  private static redis = getRedisClient();

  // Abuse patterns configuration
  private static readonly PATTERNS = {
    // Rapid fire: More than X messages in Y seconds
    RAPID_FIRE: {
      threshold: 5,      // messages
      windowSeconds: 10, // in 10 seconds
    },
    
    // Gibberish detection (basic regex patterns)
    GIBBERISH: {
      minLength: 10,
      maxRatio: 0.7,     // ratio of non-alphanumeric chars
    },
    
    // Repeated questions
    REPETITION: {
      windowMinutes: 60,
      maxRepetitions: 3,
    },
    
    // Geographic anomaly (will integrate with IP geolocation)
    GEO_ANOMALY: {
      enabled: true,
    },
  };

  /**
   * Analyze a message for abuse patterns
   */
  static async analyzeMessage(params: {
    customerId?: string;
    businessId: string;
    phone?: string;
    email?: string;
    ipAddress?: string;
    message: string;
    fingerprint?: string; // Device/browser fingerprint
  }): Promise<{
    isAbusive: boolean;
    action: 'ALLOW' | 'THROTTLE' | 'BLOCK' | 'BAN';
    reasons: string[];
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }> {
    const reasons: string[] = [];
    let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';

    try {
      // Check 1: Rapid fire detection
      const rapidFireCheck = await this.checkRapidFire(params);
      if (rapidFireCheck.isAbusive) {
        reasons.push('RAPID_FIRE');
        severity = 'MEDIUM';
      }

      // Check 2: Gibberish detection
      if (this.isGibberish(params.message)) {
        reasons.push('GIBBERISH');
        severity = Math.max(severity === 'LOW' ? 1 : severity === 'MEDIUM' ? 2 : 3, 1) as any;
      }

      // Check 3: Repetition detection
      const repetitionCheck = await this.checkRepetition(params);
      if (repetitionCheck.isAbusive) {
        reasons.push('REPETITION');
        severity = 'MEDIUM';
      }

      // Check 4: Known abuser
      const knownAbuser = await this.isKnownAbuser(params);
      if (knownAbuser) {
        reasons.push('KNOWN_ABUSER');
        severity = 'CRITICAL';
      }

      // Check 5: IP reputation
      const ipReputation = await this.checkIPReputation(params.ipAddress);
      if (ipReputation.isBad) {
        reasons.push('BAD_IP_REPUTATION');
        severity = 'HIGH';
      }

      // Determine action based on severity and config
      const action = this.determineAction(params.businessId, severity, reasons);

      // Log if abusive
      if (reasons.length > 0) {
        await this.logAbuse(params, action, severity, reasons);
      }

      return {
        isAbusive: reasons.length > 0,
        action,
        reasons,
        severity,
      };
    } catch (error) {
      logger.error({ error, params }, 'Abuse detection failed');
      // Fail open - allow request if detection fails
      return {
        isAbusive: false,
        action: 'ALLOW',
        reasons: [],
        severity: 'LOW',
      };
    }
  }

  /**
   * Check for rapid-fire messaging
   */
  private static async checkRapidFire(params: {
    customerId?: string;
    ipAddress?: string;
    phone?: string;
  }): Promise<{ isAbusive: boolean; count: number }> {
    const identifier = params.customerId || params.phone || params.ipAddress;
    if (!identifier) return { isAbusive: false, count: 0 };

    const key = `abuse:rapid:${identifier}`;
    const now = Date.now();
    const windowMs = this.PATTERNS.RAPID_FIRE.windowSeconds * 1000;

    // Add current request
    await this.redis.zadd(key, now, `${now}-${Math.random()}`);
    await this.redis.expire(key, this.PATTERNS.RAPID_FIRE.windowSeconds);

    // Remove old entries
    await this.redis.zremrangebyscore(key, 0, now - windowMs);

    // Count requests in window
    const count = await this.redis.zcard(key);

    return {
      isAbusive: count > this.PATTERNS.RAPID_FIRE.threshold,
      count,
    };
  }

  /**
   * Check if message is gibberish
   */
  private static isGibberish(message: string): boolean {
    if (message.length < this.PATTERNS.GIBBERISH.minLength) {
      return false;
    }

    // Count non-alphanumeric characters
    const nonAlphaNum = message.replace(/[a-zA-Z0-9\s]/g, '').length;
    const ratio = nonAlphaNum / message.length;

    // Check for excessive repetition
    const repeatedChars = /(.+)\1{4,}/.test(message); // Same char repeated 5+ times

    // Check for random keyboard mashing patterns
    const randomPattern = /[asdfjkl;qwertyuiopzxcvbnm]{10,}/i.test(message);

    return ratio > this.PATTERNS.GIBBERISH.maxRatio || repeatedChars || randomPattern;
  }

  /**
   * Check for repeated questions
   */
  private static async checkRepetition(params: {
    customerId?: string;
    businessId: string;
    message: string;
  }): Promise<{ isAbusive: boolean; count: number }> {
    if (!params.customerId) return { isAbusive: false, count: 0 };

    const key = `abuse:repetition:${params.customerId}:${params.businessId}`;
    const normalizedMessage = this.normalizeMessage(params.message);
    const now = Date.now();
    const windowMs = this.PATTERNS.REPETITION.windowMinutes * 60 * 1000;

    // Get recent messages
    const recentMessages = await this.redis.zrangebyscore(key, now - windowMs, now);

    // Count similar messages
    let similarCount = 0;
    for (const msg of recentMessages) {
      if (this.calculateSimilarity(normalizedMessage, msg) > 0.8) {
        similarCount++;
      }
    }

    // Add current message
    await this.redis.zadd(key, now, normalizedMessage);
    await this.redis.expire(key, this.PATTERNS.REPETITION.windowMinutes * 60);

    // Clean old entries
    await this.redis.zremrangebyscore(key, 0, now - windowMs);

    return {
      isAbusive: similarCount >= this.PATTERNS.REPETITION.maxRepetitions,
      count: similarCount,
    };
  }

  /**
   * Check if this is a known abuser
   */
  private static async isKnownAbuser(params: {
    customerId?: string;
    phone?: string;
    email?: string;
    ipAddress?: string;
    fingerprint?: string;
  }): Promise<boolean> {
    const recentBlocks = await db.abuseLog.findMany({
      where: {
        OR: [
          { customerId: params.customerId },
          { phone: params.phone },
          { email: params.email },
          { ipAddress: params.ipAddress },
          { fingerprint: params.fingerprint },
        ],
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
        },
        action: { in: ['BLOCKED', 'BANNED'] },
      },
      take: 1,
    });

    return recentBlocks.length > 0;
  }

  /**
   * Check IP reputation
   */
  private static async checkIPReputation(ipAddress?: string): Promise<{ isBad: boolean; score: number }> {
    if (!ipAddress) return { isBad: false, score: 0 };

    // Check Redis cache first
    const cached = await this.redis.get(`ip:reputation:${ipAddress}`);
    if (cached) {
      const score = parseInt(cached);
      return { isBad: score > 50, score };
    }

    // TODO: Integrate with IP reputation service (AbuseIPDB, etc.)
    // For now, check our own abuse logs
    const recentAbuse = await db.abuseLog.count({
      where: {
        ipAddress,
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    });

    const score = Math.min(recentAbuse * 20, 100); // 5+ incidents = bad reputation
    
    // Cache for 1 hour
    await this.redis.setex(`ip:reputation:${ipAddress}`, 3600, score.toString());

    return { isBad: score > 50, score };
  }

  /**
   * Determine action based on severity and business config
   */
  private static async determineAction(
    businessId: string,
    severity: string,
    reasons: string[]
  ): Promise<'ALLOW' | 'THROTTLE' | 'BLOCK' | 'BAN'> {
    const config = await db.rateLimitConfig.findUnique({
      where: { businessId },
    });

    const autoBlockThreshold = config?.autoBlockAfterAbuseCount || 3;

    // Count recent abuse incidents
    const recentAbuseCount = reasons.length; // Simplified - in production, count from DB

    if (severity === 'CRITICAL') return 'BAN';
    if (severity === 'HIGH') return 'BLOCK';
    if (severity === 'MEDIUM' && recentAbuseCount >= autoBlockThreshold) return 'BLOCK';
    if (severity === 'MEDIUM') return 'THROTTLE';
    
    return 'ALLOW';
  }

  /**
   * Log abuse incident
   */
  private static async logAbuse(
    params: {
      customerId?: string;
      businessId: string;
      phone?: string;
      email?: string;
      ipAddress?: string;
      fingerprint?: string;
      message: string;
    },
    action: string,
    severity: string,
    reasons: string[]
  ): Promise<void> {
    try {
      await db.abuseLog.create({
        data: {
          businessId: params.businessId,
          customerId: params.customerId,
          phone: params.phone,
          email: params.email,
          ipAddress: params.ipAddress,
          fingerprint: params.fingerprint,
          action,
          reason: reasons.join(','),
          severity,
          evidence: {
            message: params.message,
            timestamp: new Date().toISOString(),
          },
        },
      });

      logger.warn(
        {
          businessId: params.businessId,
          customerId: params.customerId,
          action,
          severity,
          reasons,
        },
        'Abuse detected and logged'
      );
    } catch (error) {
      logger.error({ error }, 'Failed to log abuse incident');
    }
  }

  /**
   * Normalize message for comparison
   */
  private static normalizeMessage(message: string): string {
    return message
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '') // Remove special chars
      .replace(/\s+/g, ' ')        // Normalize whitespace
      .trim()
      .substring(0, 100);          // Limit length
  }

  /**
   * Calculate similarity between two strings (simple version)
   */
  private static calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  /**
   * Levenshtein distance for string similarity
   */
  private static levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Get abuse statistics for a business
   */
  static async getAbuseStats(businessId: string): Promise<{
    totalIncidents: number;
    byAction: Record<string, number>;
    byReason: Record<string, number>;
    recentIncidents: Array<{
      id: string;
      action: string;
      reason: string;
      createdAt: Date;
    }>;
  }> {
    const logs = await db.abuseLog.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });

    const byAction: Record<string, number> = {};
    const byReason: Record<string, number> = {};

    for (const log of logs) {
      byAction[log.action] = (byAction[log.action] || 0) + 1;
      
      const reasons = log.reason.split(',');
      for (const reason of reasons) {
        byReason[reason] = (byReason[reason] || 0) + 1;
      }
    }

    return {
      totalIncidents: logs.length,
      byAction,
      byReason,
      recentIncidents: logs.slice(0, 10).map(log => ({
        id: log.id,
        action: log.action,
        reason: log.reason,
        createdAt: log.createdAt,
      })),
    };
  }
}
