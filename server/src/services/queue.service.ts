import { Queue, Worker } from 'bullmq';
import { getRedisClient, getBullRedisClient } from '@/config/redis';
import { MemoryService } from '@/features/memory/memory.service';
import { logger } from '@/utils/logger';

// Queue for background jobs
let embeddingQueue: Queue | null = null;

export const getEmbeddingQueue = (): Queue => {
    if (!embeddingQueue) {
        const connection = getBullRedisClient();
        embeddingQueue = new Queue('embeddings', { connection });
    }
    return embeddingQueue;
};

/**
 * Background worker for generating embeddings
 * This runs separately to not block API responses
 */
export const startEmbeddingWorker = () => {
    const connection = getBullRedisClient();

    const worker = new Worker(
        'embeddings',
        async (job) => {
            const { customerId, content, source } = job.data;

            try {
                await MemoryService.addMemory(customerId, content, {
                    source,
                });

                logger.info(
                    { customerId, jobId: job.id },
                    'Embedding generated successfully',
                );
            } catch (error) {
                logger.error({ error, jobId: job.id }, 'Embedding generation failed');
                throw error;
            }
        },
        {
            connection,
            concurrency: 5, // Process 5 embeddings concurrently
        },
    );

    worker.on('completed', (job) => {
        logger.debug({ jobId: job.id }, 'Job completed');
    });

    worker.on('failed', (job, err) => {
        logger.error({ jobId: job?.id, error: err }, 'Job failed');
    });

    logger.info('Embedding worker started');

    return worker;
};

/**
 * Queue an embedding generation job
 */
export const queueEmbedding = async (
    customerId: string,
    content: string,
    source?: string,
) => {
    const queue = getEmbeddingQueue();

    await queue.add('generate', {
        customerId,
        content,
        source,
    });
};

// Additional queues for Phase 4
let campaignQueue: Queue | null = null;
let cacheQueue: Queue | null = null;

export const getCampaignQueue = (): Queue => {
    if (!campaignQueue) {
        const connection = getBullRedisClient();
        campaignQueue = new Queue('campaigns', { connection });
    }
    return campaignQueue;
};

export const getCacheQueue = (): Queue => {
    if (!cacheQueue) {
        const connection = getBullRedisClient();
        cacheQueue = new Queue('cache', { connection });
    }
    return cacheQueue;
};

/**
 * QueueService - Centralized queue management
 */
export class QueueService {
    /**
     * Queue a campaign execution job
     */
    static async queueCampaignExecution(campaignId: string): Promise<void> {
        const queue = getCampaignQueue();
        await queue.add('execute', { campaignId }, {
            priority: 5,
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 1000,
            },
        });
        logger.info({ campaignId }, 'Campaign execution queued');
    }

    /**
     * Queue cache warming job
     */
    static async queueCacheWarming(businessId: string): Promise<void> {
        const queue = getCacheQueue();
        await queue.add('warm', { businessId }, {
            priority: 3,
            attempts: 2,
            backoff: {
                type: 'fixed',
                delay: 5000,
            },
        });
        logger.info({ businessId }, 'Cache warming queued');
    }

    /**
     * Queue FAQ extraction job
     */
    static async queueFAQExtraction(businessId: string, days: number = 30): Promise<void> {
        const queue = getCacheQueue();
        await queue.add('extract-faq', { businessId, days }, {
            priority: 2,
            attempts: 2,
        });
        logger.info({ businessId, days }, 'FAQ extraction queued');
    }
}
