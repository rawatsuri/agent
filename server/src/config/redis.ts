import IORedis from 'ioredis';
import { logger } from '@/utils/logger';

let redis: IORedis | null = null;
let bullRedis: IORedis | null = null;
let redisEnabled = true;

export const getRedisClient = (): IORedis | null => {
    if (!redisEnabled) {
        return null;
    }
    
    if (!redis) {
        const redisUrl = process.env.REDIS_URL;

        if (!redisUrl) {
            logger.warn('REDIS_URL not set, Redis features disabled');
            redisEnabled = false;
            return null;
        }

        try {
            redis = new IORedis(redisUrl, {
                maxRetriesPerRequest: 3,
                retryStrategy(times) {
                    if (times > 3) {
                        logger.error('Redis connection failed after 3 retries, disabling Redis');
                        redisEnabled = false;
                        return null;
                    }
                    const delay = Math.min(times * 50, 2000);
                    return delay;
                },
                // Limit concurrent connections
                lazyConnect: true,
                keepAlive: 30000,
            });

            redis.on('connect', () => {
                logger.info('Redis connected successfully');
            });

            redis.on('error', (err) => {
                if (err.message?.includes('max number of clients reached')) {
                    logger.error('Redis client limit reached, disabling Redis features');
                    redisEnabled = false;
                    redis = null;
                } else {
                    logger.error({ err }, 'Redis connection error');
                }
            });

            // Graceful shutdown
            process.on('beforeExit', async () => {
                if (redis) {
                    await redis.quit();
                }
            });
        } catch (err) {
            logger.error({ err }, 'Failed to initialize Redis, disabling');
            redisEnabled = false;
            return null;
        }
    }

    return redis;
};

/**
 * Get Redis client for BullMQ (requires maxRetriesPerRequest: null)
 * BullMQ uses blocking operations that don't work with retry logic
 */
export const getBullRedisClient = (): IORedis | null => {
    if (!redisEnabled) {
        return null;
    }
    
    if (!bullRedis) {
        const redisUrl = process.env.REDIS_URL;

        if (!redisUrl) {
            logger.warn('REDIS_URL not set, BullMQ disabled');
            return null;
        }

        try {
            bullRedis = new IORedis(redisUrl, {
                maxRetriesPerRequest: null,
                enableReadyCheck: false,
                lazyConnect: true,
                retryStrategy(times) {
                    if (times > 3) {
                        logger.error('BullMQ Redis connection failed, disabling');
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
                    logger.error('Redis client limit reached, disabling BullMQ');
                    redisEnabled = false;
                    bullRedis = null;
                } else {
                    logger.error({ err }, 'BullMQ Redis connection error');
                }
            });

            // Graceful shutdown
            process.on('beforeExit', async () => {
                if (bullRedis) {
                    await bullRedis.quit();
                }
            });
        } catch (err) {
            logger.error({ err }, 'Failed to initialize BullMQ Redis');
            return null;
        }
    }

    return bullRedis;
};

/**
 * Check if Redis is enabled and available
 */
export const isRedisEnabled = (): boolean => {
    return redisEnabled && redis !== null;
};
