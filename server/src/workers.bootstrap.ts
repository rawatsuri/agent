/**
 * Worker Bootstrap
 * Initialize and manage all background job workers
 */

import { Worker } from 'bullmq';
import { logger } from '@/utils/logger';
import {
  startEmbeddingWorker,
  startSummaryWorker,
  startCostReportWorker,
  startCacheWarmerWorker,
  startProactiveCampaignWorker,
} from '@/queue/workers';
import { JobSchedulerService } from '@/queue/scheduler.service';

// Store active workers for graceful shutdown
const activeWorkers: Worker[] = [];

/**
 * Initialize all background workers
 */
export const initializeWorkers = async (): Promise<void> => {
  logger.info('Initializing background workers...');

  try {
    // Start all workers
    const workers = [
      startEmbeddingWorker(),
      startSummaryWorker(),
      startCostReportWorker(),
      startCacheWarmerWorker(),
      startProactiveCampaignWorker(),
    ];

    activeWorkers.push(...workers);

    // Initialize scheduled jobs
    await JobSchedulerService.initializeAllSchedules();

    logger.info(
      {
        workerCount: activeWorkers.length,
      },
      'All background workers initialized successfully'
    );
  } catch (error) {
    logger.error({ error }, 'Failed to initialize workers');
    throw error;
  }
};

/**
 * Gracefully shutdown all workers
 */
export const shutdownWorkers = async (): Promise<void> => {
  logger.info('Shutting down background workers...');

  try {
    // Close all workers
    const closePromises = activeWorkers.map(async (worker) => {
      await worker.close();
    });

    await Promise.all(closePromises);
    activeWorkers.length = 0; // Clear array

    logger.info('All background workers shut down successfully');
  } catch (error) {
    logger.error({ error }, 'Error during worker shutdown');
    throw error;
  }
};

/**
 * Get status of all workers
 */
export const getWorkerStatus = (): {
  totalWorkers: number;
  workers: Array<{
    name: string;
    isRunning: boolean;
    id?: string;
  }>;
} => {
  return {
    totalWorkers: activeWorkers.length,
    workers: activeWorkers.map((worker) => ({
      name: worker.name,
      isRunning: worker.isRunning(),
      id: worker.id,
    })),
  };
};
