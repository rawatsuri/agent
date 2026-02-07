import IORedis from 'ioredis';
import { logger } from '@/utils/logger';

let redis: IORedis | null = null;
let bullRedis: IORedis | null = null;

export const getRedisClient = (): IORedis => {
    if (!redis) {
        const redisUrl = process.env.REDIS_URL;

        if (!redisUrl) {
            throw new Error('REDIS_URL environment variable is not set');
        }

        redis = new IORedis(redisUrl, {
            maxRetriesPerRequest: 3,
            retryStrategy(times) {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
        });

        redis.on('connect', () => {
            logger.info('Redis connected successfully');
        });

        redis.on('error', (err) => {
            logger.error({ err }, 'Redis connection error');
        });

        // Graceful shutdown
        process.on('beforeExit', async () => {
            if (redis) {
                await redis.quit();
            }
        });
    }

    return redis;
};

/**
 * Get Redis client for BullMQ (requires maxRetriesPerRequest: null)
 * BullMQ uses blocking operations that don't work with retry logic
 */
export const getBullRedisClient = (): IORedis => {
    if (!bullRedis) {
        const redisUrl = process.env.REDIS_URL;

        if (!redisUrl) {
            throw new Error('REDIS_URL environment variable is not set');
        }

        bullRedis = new IORedis(redisUrl, {
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            retryStrategy(times) {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
        });

        bullRedis.on('connect', () => {
            logger.info('BullMQ Redis connected successfully');
        });

        bullRedis.on('error', (err) => {
            logger.error({ err }, 'BullMQ Redis connection error');
        });

        // Graceful shutdown
        process.on('beforeExit', async () => {
            if (bullRedis) {
                await bullRedis.quit();
            }
        });
    }

    return bullRedis;
};
