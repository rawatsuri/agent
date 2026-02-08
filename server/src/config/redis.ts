import IORedis from 'ioredis';
import { logger } from '@/utils/logger';

let redis: IORedis | null = null;
let bullRedis: IORedis | null = null;

export const getRedisClient = (): IORedis => {
    if (!redis) {
        const redisUrl = process.env.REDIS_URL;

        if (!redisUrl) {
            logger.warn('REDIS_URL not set');
            // Return a mock Redis client that logs warnings
            return createMockRedis() as unknown as IORedis;
        }

        try {
            redis = new IORedis(redisUrl, {
                maxRetriesPerRequest: 3,
                retryStrategy(times) {
                    const delay = Math.min(times * 50, 2000);
                    return delay;
                },
                lazyConnect: true,
                keepAlive: 30000,
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
        } catch (err) {
            logger.error({ err }, 'Failed to initialize Redis');
            return createMockRedis() as unknown as IORedis;
        }
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
            logger.warn('REDIS_URL not set for BullMQ');
            return createMockRedis() as unknown as IORedis;
        }

        try {
            bullRedis = new IORedis(redisUrl, {
                maxRetriesPerRequest: null,
                enableReadyCheck: false,
                lazyConnect: true,
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
        } catch (err) {
            logger.error({ err }, 'Failed to initialize BullMQ Redis');
            return createMockRedis() as unknown as IORedis;
        }
    }

    return bullRedis;
};

/**
 * Create a mock Redis client for when Redis is not available
 */
function createMockRedis() {
    const mockClient = {
        get: async () => null,
        set: async () => 'OK',
        del: async () => 0,
        keys: async () => [],
        ping: async () => 'PONG',
        quit: async () => 'OK',
        on: () => mockClient,
    };
    
    return new Proxy(mockClient, {
        get(target, prop) {
            if (prop in target) {
                return target[prop as keyof typeof target];
            }
            return async () => null;
        }
    });
}
