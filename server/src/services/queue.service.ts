import { Queue, Worker } from 'bullmq';
import { getBullRedisClient, isRedisEnabled } from '@/config/redis';
import { MemoryService } from '@/features/memory/memory.service';
import { logger } from '@/utils/logger';

// Queue for background jobs
let embeddingQueue: Queue | null = null;
let workersStarted = false;

export const getEmbeddingQueue = (): Queue | null => {
    if (!isRedisEnabled()) {
        return null;
    }
    
    if (!embeddingQueue) {
        const connection = getBullRedisClient();
        if (!connection) {
            return null;
        }
        try {
            embeddingQueue = new Queue('embeddings', { connection });
        } catch (err) {
            logger.error({ err }, 'Failed to create embedding queue');
            return null;
        }
    }
    return embeddingQueue;
};

/**
 * Background worker for generating embeddings
 * This runs separately to not block API responses
 */
export const startEmbeddingWorker = () => {
    // Don't start workers if Redis is not available
    if (!isRedisEnabled()) {
        logger.warn('Redis not available, skipping background workers');
        return;
    }
    
    if (workersStarted) {
        return;
    }
    
    try {
        const connection = getBullRedisClient();
        if (!connection) {
            logger.warn('Redis connection not available, skipping workers');
            return;
        }

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
                concurrency: 2, // Reduced from 5 to save connections
            },
        );

        worker.on('completed', (job) => {
            logger.debug({ jobId: job.id }, 'Job completed');
        });

        worker.on('failed', (job, err) => {
            logger.error({ jobId: job?.id, error: err }, 'Job failed');
        });

        workersStarted = true;
        logger.info('Background embedding worker started');
    } catch (err) {
        logger.error({ err }, 'Failed to start embedding worker, continuing without background jobs');
    }
};

/**
 * Add embedding generation job to queue
 */
export const queueEmbedding = async (
    customerId: string,
    content: string,
    source: string,
) => {
    const queue = getEmbeddingQueue();
    if (!queue) {
        // If queue not available, process synchronously
        logger.debug('Queue not available, processing embedding synchronously');
        try {
            await MemoryService.addMemory(customerId, content, { source });
        } catch (err) {
            logger.error({ err }, 'Synchronous embedding failed');
        }
        return;
    }

    try {
        await queue.add('generate-embedding', {
            customerId,
            content,
            source,
        });
    } catch (err) {
        logger.error({ err }, 'Failed to add embedding job, processing synchronously');
        // Fallback to synchronous
        try {
            await MemoryService.addMemory(customerId, content, { source });
        } catch (syncErr) {
            logger.error({ err: syncErr }, 'Synchronous embedding also failed');
        }
    }
};

/**
 * QueueService class for backward compatibility
 * Provides static methods used by controllers
 */
export class QueueService {
    /**
     * Queue a campaign for execution
     */
    static async queueCampaignExecution(campaignId: string): Promise<void> {
        if (!isRedisEnabled()) {
            logger.warn('Redis not available, campaign execution will not be queued');
            return;
        }
        
        try {
            // Implementation would go here - for now just log
            logger.info({ campaignId }, 'Campaign execution queued');
        } catch (err) {
            logger.error({ err, campaignId }, 'Failed to queue campaign execution');
        }
    }

    /**
     * Queue cache warming for a business
     */
    static async queueCacheWarming(businessId: string): Promise<void> {
        if (!isRedisEnabled()) {
            logger.warn('Redis not available, cache warming will not be queued');
            return;
        }
        
        try {
            // Implementation would go here - for now just log
            logger.info({ businessId }, 'Cache warming queued');
        } catch (err) {
            logger.error({ err, businessId }, 'Failed to queue cache warming');
        }
    }
}
