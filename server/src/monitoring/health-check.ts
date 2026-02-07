import { Express, Request, Response } from 'express';
import { db } from '@/config/database';
import { getRedisClient } from '@/config/redis';
import { logger } from '@/utils/logger';
import os from 'os';

/**
 * Health Check Service
 *
 * Monitors system health and returns status
 */
export class HealthCheckService {
  /**
   * Perform comprehensive health check
   */
  static async check(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    timestamp: string;
    version: string;
    uptime: number;
    checks: {
      database: { status: string; latency: number };
      redis: { status: string; latency: number };
      memory: { status: string; usage: number };
      cpu: { status: string; load: number[] };
    };
  }> {
    const checks = {
      database: await this.checkDatabase(),
      redis: await this.checkRedis(),
      memory: this.checkMemory(),
      cpu: this.checkCPU(),
    };

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (checks.database.status === 'unhealthy' || checks.redis.status === 'unhealthy') {
      status = 'unhealthy';
    } else if (
      checks.database.status === 'degraded' ||
      checks.redis.status === 'degraded' ||
      checks.memory.status === 'degraded'
    ) {
      status = 'degraded';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: process.uptime(),
      checks,
    };
  }

  /**
   * Check database health
   */
  private static async checkDatabase(): Promise<{ status: string; latency: number }> {
    const start = Date.now();
    try {
      await db.$queryRaw`SELECT 1`;
      const latency = Date.now() - start;
      
      return {
        status: latency > 1000 ? 'degraded' : 'healthy',
        latency,
      };
    } catch (error) {
      logger.error({ error }, 'Database health check failed');
      return {
        status: 'unhealthy',
        latency: Date.now() - start,
      };
    }
  }

  /**
   * Check Redis health
   */
  private static async checkRedis(): Promise<{ status: string; latency: number }> {
    const start = Date.now();
    try {
      const redis = getRedisClient();
      await redis.ping();
      const latency = Date.now() - start;
      
      return {
        status: latency > 100 ? 'degraded' : 'healthy',
        latency,
      };
    } catch (error) {
      logger.error({ error }, 'Redis health check failed');
      return {
        status: 'unhealthy',
        latency: Date.now() - start,
      };
    }
  }

  /**
   * Check memory usage
   */
  private static checkMemory(): { status: string; usage: number } {
    const used = process.memoryUsage();
    const total = os.totalmem();
    const usagePercent = (used.heapUsed / total) * 100;
    
    return {
      status: usagePercent > 90 ? 'degraded' : 'healthy',
      usage: Math.round(usagePercent * 100) / 100,
    };
  }

  /**
   * Check CPU load
   */
  private static checkCPU(): { status: string; load: number[] } {
    const loadAvg = os.loadavg();
    const cpuCount = os.cpus().length;
    const loadPercent = (loadAvg[0] / cpuCount) * 100;
    
    return {
      status: loadPercent > 80 ? 'degraded' : 'healthy',
      load: loadAvg.map((l) => Math.round(l * 100) / 100),
    };
  }

  /**
   * Get metrics for monitoring
   */
  static async getMetrics(): Promise<{
    requests: { total: number; perMinute: number };
    conversations: { active: number; total: number };
    costs: { today: number; month: number };
    cache: { hitRate: number; size: number };
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [activeConversations, totalConversations, todayCosts, monthCosts] = await Promise.all([
      db.conversation.count({ where: { status: 'ACTIVE' } }),
      db.conversation.count(),
      db.costLog.aggregate({
        where: { createdAt: { gte: today } },
        _sum: { cost: true },
      }),
      db.costLog.aggregate({
        where: { createdAt: { gte: monthStart } },
        _sum: { cost: true },
      }),
    ]);

    return {
      requests: {
        total: 0, // Would be tracked via middleware
        perMinute: 0,
      },
      conversations: {
        active: activeConversations,
        total: totalConversations,
      },
      costs: {
        today: Number(todayCosts._sum.cost || 0),
        month: Number(monthCosts._sum.cost || 0),
      },
      cache: {
        hitRate: 0, // Would be tracked via cache service
        size: 0,
      },
    };
  }
}

/**
 * Setup health check routes
 */
export function setupHealthRoutes(app: Express): void {
  // Basic health check
  app.get('/health', async (req: Request, res: Response) => {
    const health = await HealthCheckService.check();
    
    const statusCode = health.status === 'healthy' ? 200 : 
                       health.status === 'degraded' ? 200 : 503;
    
    res.status(statusCode).json(health);
  });

  // Readiness check (for Kubernetes)
  app.get('/ready', async (req: Request, res: Response) => {
    const health = await HealthCheckService.check();
    
    if (health.status === 'unhealthy') {
      res.status(503).json({ ready: false });
    } else {
      res.json({ ready: true });
    }
  });

  // Liveness check (for Kubernetes)
  app.get('/live', (req: Request, res: Response) => {
    res.json({ alive: true });
  });

  // Metrics endpoint (for Prometheus)
  app.get('/metrics', async (req: Request, res: Response) => {
    const metrics = await HealthCheckService.getMetrics();
    
    // Simple text format for Prometheus
    const output = `
# HELP omnichannel_conversations_active Number of active conversations
# TYPE omnichannel_conversations_active gauge
omnichannel_conversations_active ${metrics.conversations.active}

# HELP omnichannel_conversations_total Total number of conversations
# TYPE omnichannel_conversations_total counter
omnichannel_conversations_total ${metrics.conversations.total}

# HELP omnichannel_costs_today Total costs today
# TYPE omnichannel_costs_today gauge
omnichannel_costs_today ${metrics.costs.today}

# HELP omnichannel_costs_month Total costs this month
# TYPE omnichannel_costs_month gauge
omnichannel_costs_month ${metrics.costs.month}
    `.trim();
    
    res.set('Content-Type', 'text/plain');
    res.send(output);
  });
}
