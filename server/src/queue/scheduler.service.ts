/**
 * Job Scheduler Service
 * Schedule and manage recurring background jobs
 */

import { logger } from '@/utils/logger';
import {
  getEmbeddingQueue,
  getSummaryQueue,
  getCostReportQueue,
  getCacheWarmerQueue,
  getProactiveCampaignQueue,
} from './queue.config';
import { JOB_NAMES } from './job.definitions';

export class JobSchedulerService {
  /**
   * Schedule daily cost reports (runs at 9 AM every day)
   */
  static async scheduleDailyCostReports(): Promise<void> {
    const queue = getCostReportQueue();

    // Remove existing repeatable job
    await this.removeRepeatableJob(queue, JOB_NAMES.COST_REPORTS.DAILY_REPORT);

    // Add new repeatable job
    await queue.add(
      JOB_NAMES.COST_REPORTS.DAILY_REPORT,
      { reportType: 'DAILY' },
      {
        repeat: {
          pattern: '0 9 * * *', // 9 AM daily
        } as any,
        jobId: 'daily-cost-reports',
      }
    );

    logger.info('Scheduled daily cost reports for 9:00 AM');
  }

  /**
   * Schedule weekly cost reports (runs at 9 AM every Monday)
   */
  static async scheduleWeeklyCostReports(): Promise<void> {
    const queue = getCostReportQueue();

    await this.removeRepeatableJob(queue, JOB_NAMES.COST_REPORTS.WEEKLY_REPORT);

    await queue.add(
      JOB_NAMES.COST_REPORTS.WEEKLY_REPORT,
      { reportType: 'WEEKLY' },
      {
        repeat: {
          pattern: '0 9 * * 1', // 9 AM every Monday
        } as any,
        jobId: 'weekly-cost-reports',
      }
    );

    logger.info('Scheduled weekly cost reports for Mondays at 9:00 AM');
  }

  /**
   * Schedule monthly cost reports (runs at 9 AM on 1st of every month)
   */
  static async scheduleMonthlyCostReports(): Promise<void> {
    const queue = getCostReportQueue();

    await this.removeRepeatableJob(queue, JOB_NAMES.COST_REPORTS.MONTHLY_REPORT);

    await queue.add(
      JOB_NAMES.COST_REPORTS.MONTHLY_REPORT,
      { reportType: 'MONTHLY' },
      {
        repeat: {
          pattern: '0 9 1 * *', // 9 AM on 1st of every month
        } as any,
        jobId: 'monthly-cost-reports',
      }
    );

    logger.info('Scheduled monthly cost reports for 1st of month at 9:00 AM');
  }

  /**
   * Schedule cache warming (runs every 6 hours)
   */
  static async scheduleCacheWarming(): Promise<void> {
    const queue = getCacheWarmerQueue();

    await this.removeRepeatableJob(queue, JOB_NAMES.CACHE_WARMER.WARM_FAQS);

    await queue.add(
      JOB_NAMES.CACHE_WARMER.WARM_FAQS,
      { warmAllFAQs: true },
      {
        repeat: {
          every: 6 * 60 * 60 * 1000, // Every 6 hours
        },
        jobId: 'cache-warming-faqs',
      }
    );

    logger.info('Scheduled cache warming every 6 hours');
  }

  /**
   * Schedule campaign trigger checks (runs every 15 minutes)
   */
  static async scheduleCampaignTriggerChecks(): Promise<void> {
    const queue = getProactiveCampaignQueue();

    await this.removeRepeatableJob(queue, JOB_NAMES.PROACTIVE_CAMPAIGNS.CHECK_TRIGGERS);

    await queue.add(
      JOB_NAMES.PROACTIVE_CAMPAIGNS.CHECK_TRIGGERS,
      {},
      {
        repeat: {
          every: 15 * 60 * 1000, // Every 15 minutes
        },
        jobId: 'campaign-trigger-checks',
      }
    );

    logger.info('Scheduled campaign trigger checks every 15 minutes');
  }

  /**
   * Schedule old conversation cleanup (runs daily at 3 AM)
   */
  static async scheduleConversationCleanup(): Promise<void> {
    const queue = getSummaryQueue();

    // We use the summary queue for cleanup jobs too
    await queue.add(
      'cleanup-old-conversations',
      { olderThanDays: 30 },
      {
        repeat: {
          pattern: '0 3 * * *', // 3 AM daily
        } as any,
        jobId: 'conversation-cleanup',
      }
    );

    logger.info('Scheduled conversation cleanup for 3:00 AM daily');
  }

  /**
   * Initialize all scheduled jobs
   */
  static async initializeAllSchedules(): Promise<void> {
    logger.info('Initializing job schedules...');

    await Promise.all([
      this.scheduleDailyCostReports(),
      this.scheduleWeeklyCostReports(),
      this.scheduleMonthlyCostReports(),
      this.scheduleCacheWarming(),
      this.scheduleCampaignTriggerChecks(),
      this.scheduleConversationCleanup(),
    ]);

    logger.info('All job schedules initialized');
  }

  /**
   * Remove existing repeatable job by name
   */
  private static async removeRepeatableJob(queue: any, jobName: string): Promise<void> {
    try {
      const jobs = await queue.getRepeatableJobs();
      const existingJob = jobs.find((job: any) => job.name === jobName);
      
      if (existingJob) {
        await queue.removeRepeatableByKey(existingJob.key);
        logger.debug({ jobName }, 'Removed existing repeatable job');
      }
    } catch (error) {
      logger.error({ error, jobName }, 'Failed to remove repeatable job');
    }
  }
}
