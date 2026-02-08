import IORedis from 'ioredis';
import { logger } from '@/utils/logger';

let redis: IORedis | null = null;
let bullRedis: IORedis | null = null;
let redisAvailable = false;
let mockRedisClient: IORedis | null = null;

/**
 * Create a mock Redis client for when Redis is not available
 */
function createMockRedis(): IORedis {
    if (mockRedisClient) {
        return mockRedisClient;
    }
    
    const mock = {
        get: async () => null,
        set: async () => 'OK',
        setex: async () => 'OK',
        del: async () => 0,
        keys: async () => [],
        ping: async () => 'PONG',
        quit: async () => 'OK',
        on: () => mock,
        once: () => mock,
        removeListener: () => mock,
        disconnect: async () => {},
        connect: async () => {},
        status: 'ready',
    };
    
    mockRedisClient = new Proxy(mock, {
        get(target, prop) {
            if (prop in target) {
                return target[prop as keyof typeof target];
            }
            // Return no-op function for any other method
            return () => Promise.resolve(null);
        }
    }) as unknown as IORedis;
    
    return mockRedisClient;
}

/**
 * Check if Redis is available and working
 */
export const isRedisEnabled = (): boolean => {
    return redisAvailable;
};

export const getRedisClient = (): IORedis => {
    // If REDIS_URL is not set, always return mock
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
        return createMockRedis();
    }
    
    // If we already have a real connection, return it
    if (redis) {
        return redis;
    }

    try {
        redis = new IORedis(redisUrl, {
            maxRetriesPerRequest: 3,
            retryStrategy(times) {
                if (times > 3) {
                    logger.error('Redis connection failed after 3 retries, using mock');
                    redisAvailable = false;
                    return null; // Stop retrying
                }
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
            lazyConnect: true,
            keepAlive: 30000,
        });

        redis.on('connect', () => {
            logger.info('Redis connected successfully');
            redisAvailable = true;
        });

        redis.on('error', (err) => {
            if (err.message?.includes('max number of clients reached')) {
                logger.error('Redis client limit reached, disabling Redis features');
                redisAvailable = false;
            } else if (err.message?.includes('ECONNREFUSED')) {
                logger.error('Redis connection refused, using mock client');
                redisAvailable = false;
            } else {
                logger.error({ err }, 'Redis connection error');
            }
        });

        // Graceful shutdown
        process.on('beforeExit', async () => {
            if (redis && redisAvailable) {
                await redis.quit();
            }
        });
        
        return redis;
    } catch (err) {
        logger.error({ err }, 'Failed to initialize Redis, using mock');
        redisAvailable = false;
        return createMockRedis();
    }
};

/**
 * Get Redis client for BullMQ (requires maxRetriesPerRequest: null)
 * BullMQ uses blocking operations that don't work with retry logic
 */
export const getBullRedisClient = (): IORedis => {
    // If REDIS_URL is not set, always return mock
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
        return createMockRedis();
    }
    
    // If we already have a real connection, return it
    if (bullRedis) {
        return bullRedis;
    }

    try {
        bullRedis = new IORedis(redisUrl, {
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            lazyConnect: true,
            retryStrategy(times) {
                if (times > 3) {
                    logger.error('BullMQ Redis connection failed, using mock');
                    return null;
                }
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
        });

        bullRedis.on('connect', () => {
            logger.info('BullMQ Redis connected successfully');
        });

        bullRedis.on('error', (err) => {
            if (err.message?.includes('max number of clients reached')) {
                logger.error('Redis client limit reached for BullMQ');
            } else if (err.message?.includes('ECONNREFUSED')) {
                logger.error('BullMQ Redis connection refused');
            } else {
                logger.error({ err }, 'BullMQ Redis connection error');
            }
        });

        // Graceful shutdown
        process.on('beforeExit', async () => {
            if (bullRedis && redisAvailable) {
                await bullRedis.quit();
            }
        });
        
        return bullRedis;
    } catch (err) {
        logger.error({ err }, 'Failed to initialize BullMQ Redis, using mock');
        return createMockRedis();
    }
};
