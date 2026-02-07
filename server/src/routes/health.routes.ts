import express from 'express';
import { db } from '@/config/database';
import { getRedisClient } from '@/config/redis';
import { logger } from '@/utils/logger';
import { CircuitBreakers } from '@/utils/circuit-breaker';
import OpenAI from 'openai';

const router = express.Router();
const redis = getRedisClient();

/**
 * Basic health check - is the server alive?
 */
router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        service: 'Omnichannel AI Platform',
    });
});

/**
 * Readiness check - are all dependencies ready?
 */
router.get('/ready', async (req, res) => {
    const checks: Record<string, { healthy: boolean; latency?: number; error?: string }> = {};
    let allHealthy = true;

    // Database check
    const dbStart = Date.now();
    try {
        await db.$queryRaw`SELECT 1`;
        checks.database = {
            healthy: true,
            latency: Date.now() - dbStart,
        };
    } catch (error: any) {
        allHealthy = false;
        checks.database = {
            healthy: false,
            error: error.message,
        };
    }

    // Redis check
    const redisStart = Date.now();
    try {
        await redis.ping();
        checks.redis = {
            healthy: true,
            latency: Date.now() - redisStart,
        };
    } catch (error: any) {
        allHealthy = false;
        checks.redis = {
            healthy: false,
            error: error.message,
        };
    }

    // OpenAI check (optional - don't fail if API key missing in dev)
    if (process.env.OPENAI_API_KEY) {
        const openaiStart = Date.now();
        try {
            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
            // Light check - just verify API key works      await openai.models.list();
            checks.openai = {
                healthy: true,
                latency: Date.now() - openaiStart,
            };
        } catch (error: any) {
            // Don't fail readiness for OpenAI issues (circuit breaker will handle)
            checks.openai = {
                healthy: false,
                error: error.message,
            };
        }
    }

    const statusCode = allHealthy ? 200 : 503;

    res.status(statusCode).json({
        status: allHealthy ? 'ready' : 'not_ready',
        checks,
        timestamp: new Date().toISOString(),
    });
});

/**
 * Detailed metrics endpoint
 */
router.get('/metrics', async (req, res) => {
    try {
        // Process metrics
        const memUsage = process.memoryUsage();

        // Circuit breaker stats
        const circuitBreakers = CircuitBreakers.getAllStats();

        // Database connection pool (if available)
        let dbPoolStats = null;
        try {
            // This would need Prisma extension or custom implementation
            // dbPoolStats = await db.$metrics.json();
        } catch { }

        res.json({
            timestamp: new Date().toISOString(),
            process: {
                uptime: process.uptime(),
                memoryUsage: {
                    rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
                    heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
                    heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
                    external: `${Math.round(memUsage.external / 1024 / 1024)}MB`,
                },
                cpuUsage: process.cpuUsage(),
            },
            circuitBreakers,
            database: dbPoolStats,
        });
    } catch (error: any) {
        logger.error({ error }, 'Metrics endpoint error');
        res.status(500).json({
            error: 'Failed to collect metrics',
            message: error.message,
        });
    }
});

/**
 * Database migration status
 */
router.get('/db-status', async (req, res) => {
    try {
        // Check if essential tables exist
        const tables = await db.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename
    `;

        const tableNames = tables.map(t => t.tablename);

        const requiredTables = [
            'businesses',
            'customers',
            'conversations',
            'messages',
            'memories',
            'business_credits',
            'cost_logs',
        ];

        const missingTables = requiredTables.filter(t => !tableNames.includes(t));

        res.json({
            status: missingTables.length === 0 ? 'ok' : 'incomplete',
            tables: tableNames,
            missingTables,
            totalTables: tableNames.length,
        });
    } catch (error: any) {
        logger.error({ error }, 'DB status check failed');
        res.status(500).json({
            error: 'Failed to check database status',
            message: error.message,
        });
    }
});

/**
 * Circuit breaker status and manual controls
 */
router.get('/circuit-breakers', (req, res) => {
    const stats = CircuitBreakers.getAllStats();
    res.json({ circuitBreakers: stats });
});

router.post('/circuit-breakers/:name/reset', (req, res) => {
    const { name } = req.params;

    try {
        CircuitBreakers.reset(name);
        res.json({
            success: true,
            message: `Circuit breaker '${name}' reset`,
        });
    } catch (error: any) {
        res.status(404).json({
            success: false,
            error: `Circuit breaker '${name}' not found`,
        });
    }
});

export default router;
