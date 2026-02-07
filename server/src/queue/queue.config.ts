/**
 * Queue Configuration and Setup
 * BullMQ + Redis for background job processing
 */

import { Queue, QueueOptions, WorkerOptions } from 'bullmq';
import { getRedisClient, getBullRedisClient } from '@/config/redis';
import { logger } from '@/utils/logger';

// Queue names
export const QUEUE_NAMES = {
  EMBEDDINGS: 'embeddings',
  SUMMARIES: 'summaries',
  COST_REPORTS: 'cost-reports',
  CACHE_WARMER: 'cache-warmer',
  PROACTIVE_CAMPAIGNS: 'proactive-campaigns',
  CONVERSATION_CLEANUP: 'conversation-cleanup',
} as const;

// Queue instances cache
const queues: Map<string, Queue> = new Map();

/**
 * Get or create a queue instance
 */
export const getQueue = (name: string, options?: Partial<QueueOptions>): Queue => {
  if (!queues.has(name)) {
    const connection = getRedisClient();
    const queue = new Queue(name, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: {
          age: 24 * 3600, // Remove completed jobs after 24 hours
          count: 1000,
        },
        removeOnFail: {
          age: 7 * 24 * 3600, // Keep failed jobs for 7 days
        },
      },
      ...options,
    });

    queue.on('error', (error) => {
      logger.error({ error, queueName: name }, 'Queue error');
    });

    queues.set(name, queue);
    logger.info({ queueName: name }, 'Queue initialized');
  }

  return queues.get(name)!;
};

/**
 * Get default worker options
 */
export const getDefaultWorkerOptions = (): WorkerOptions => {
  const connection = getBullRedisClient();
  if (!connection) {
    throw new Error('Redis connection is required for worker options');
  }

  return {
    connection,
    concurrency: 5,
    limiter: {
      max: 100,
      duration: 1000, // 100 jobs per second max
    },
  };
};

/**
 * Graceful shutdown for all queues
 */
export const closeAllQueues = async (): Promise<void> => {
  logger.info('Closing all queues...');
  
  const closePromises = Array.from(queues.values()).map(async (queue) => {
    await queue.close();
  });
  
  await Promise.all(closePromises);
  queues.clear();
  
  logger.info('All queues closed');
};

// Export specific queue getters for convenience
export const getEmbeddingQueue = () => getQueue(QUEUE_NAMES.EMBEDDINGS);
export const getSummaryQueue = () => getQueue(QUEUE_NAMES.SUMMARIES);
export const getCostReportQueue = () => getQueue(QUEUE_NAMES.COST_REPORTS);
export const getCacheWarmerQueue = () => getQueue(QUEUE_NAMES.CACHE_WARMER);
export const getProactiveCampaignQueue = () => getQueue(QUEUE_NAMES.PROACTIVE_CAMPAIGNS);
export const getConversationCleanupQueue = () => getQueue(QUEUE_NAMES.CONVERSATION_CLEANUP);
