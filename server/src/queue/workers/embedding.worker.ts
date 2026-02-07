/**
 * Embedding Worker
 * Background job processor for generating vector embeddings
 */

import { Worker, Job } from 'bullmq';
import { MemoryService } from '@/features/memory/memory.service';
import { CostTrackerService } from '@/features/cost-control/cost-tracker.service';
import { getDefaultWorkerOptions, QUEUE_NAMES } from '../queue.config';
import { GenerateEmbeddingJobData, BatchEmbeddingJobData, JOB_NAMES } from '../job.definitions';
import { logger } from '@/utils/logger';

/**
 * Start the embedding worker
 */
export const startEmbeddingWorker = (): Worker => {
  const options = getDefaultWorkerOptions();
  
  const worker = new Worker(
    QUEUE_NAMES.EMBEDDINGS,
    async (job: Job) => {
      const { name, data } = job;

      logger.info({ jobId: job.id, jobName: name }, 'Processing embedding job');

      try {
        switch (name) {
          case JOB_NAMES.EMBEDDINGS.GENERATE:
            await processSingleEmbedding(job.id!, data as GenerateEmbeddingJobData);
            break;

          case JOB_NAMES.EMBEDDINGS.BATCH_GENERATE:
            await processBatchEmbeddings(job.id!, data as BatchEmbeddingJobData);
            break;

          default:
            throw new Error(`Unknown job name: ${name}`);
        }

        logger.info({ jobId: job.id }, 'Embedding job completed');
      } catch (error) {
        logger.error({ error, jobId: job.id, jobName: name }, 'Embedding job failed');
        throw error;
      }
    },
    {
      ...options,
      concurrency: 3, // Lower concurrency to avoid rate limits
    }
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'Embedding worker job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, error: err }, 'Embedding worker job failed');
  });

  logger.info('Embedding worker started');

  return worker;
};

/**
 * Process a single embedding generation
 */
async function processSingleEmbedding(
  jobId: string,
  data: GenerateEmbeddingJobData
): Promise<void> {
  const { customerId, content, source, conversationId, channel, importance } = data;

  const startTime = Date.now();

  await MemoryService.addMemory(customerId, content, {
    source,
    conversationId,
    channel: channel || undefined,
    importance,
  });

  const duration = Date.now() - startTime;

  // Estimate embedding cost (text-embedding-3-small: ~$0.02 per 1M tokens)
  const estimatedTokens = Math.ceil(content.length / 4); // Rough estimate: 4 chars per token
  const cost = CostTrackerService.calculateEmbeddingCost(estimatedTokens);

  logger.info(
    {
      jobId,
      customerId,
      contentLength: content.length,
      estimatedTokens,
      cost,
      durationMs: duration,
    },
    'Single embedding generated'
  );
}

/**
 * Process batch embedding generation
 */
async function processBatchEmbeddings(
  jobId: string,
  data: BatchEmbeddingJobData
): Promise<void> {
  const { items } = data;

  logger.info({ jobId, batchSize: items.length }, 'Processing batch embeddings');

  let successCount = 0;
  let failureCount = 0;

  // Process in chunks of 5 to avoid overwhelming the API
  const chunkSize = 5;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);

    const results = await Promise.allSettled(
      chunk.map(async (item) => {
        await MemoryService.addMemory(item.customerId, item.content, {
          source: item.source,
        });
      })
    );

    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        successCount++;
      } else {
        failureCount++;
      }
    });

    // Small delay between chunks
    if (i + chunkSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  logger.info(
    {
      jobId,
      batchSize: items.length,
      successCount,
      failureCount,
    },
    'Batch embeddings completed'
  );

  if (failureCount > 0) {
    throw new Error(`Batch processing had ${failureCount} failures`);
  }
}
