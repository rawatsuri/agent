/**
 * Cache Warmer Worker
 * Background job processor for pre-computing and warming cache entries
 */

import { Worker, Job } from 'bullmq';
import { db } from '@/config/database';
import { AIService } from '@/services/ai.service';
import { SemanticCacheService } from '@/features/cache/semantic-cache.service';
import { CostTrackerService } from '@/features/cost-control/cost-tracker.service';
import { MemoryService } from '@/features/memory/memory.service';
import { getDefaultWorkerOptions, QUEUE_NAMES } from '../queue.config';
import { CacheWarmerJobData, InvalidateCacheJobData, JOB_NAMES } from '../job.definitions';
import { logger } from '@/utils/logger';
import { Channel } from '@prisma/client';

/**
 * Start the cache warmer worker
 */
export const startCacheWarmerWorker = (): Worker => {
  const options = getDefaultWorkerOptions();
  
  const worker = new Worker(
    QUEUE_NAMES.CACHE_WARMER,
    async (job: Job) => {
      const { name, data } = job;

      logger.info({ jobId: job.id, jobName: name }, 'Processing cache warmer job');

      try {
        switch (name) {
          case JOB_NAMES.CACHE_WARMER.WARM_COMMON_QUERIES:
            await processWarmCommonQueries(job.id!, data as CacheWarmerJobData);
            break;

          case JOB_NAMES.CACHE_WARMER.WARM_FAQS:
            await processWarmFAQs(job.id!, data as CacheWarmerJobData);
            break;

          case JOB_NAMES.CACHE_WARMER.INVALIDATE_CACHE:
            await processInvalidateCache(job.id!, data as InvalidateCacheJobData);
            break;

          default:
            throw new Error(`Unknown job name: ${name}`);
        }

        logger.info({ jobId: job.id }, 'Cache warmer job completed');
      } catch (error) {
        logger.error({ error, jobId: job.id, jobName: name }, 'Cache warmer job failed');
        throw error;
      }
    },
    {
      ...options,
      concurrency: 3,
    }
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'Cache warmer worker job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, error: err }, 'Cache warmer worker job failed');
  });

  logger.info('Cache warmer worker started');

  return worker;
};

/**
 * Pre-compute responses for common queries
 */
async function processWarmCommonQueries(jobId: string, data: CacheWarmerJobData): Promise<void> {
  const { businessId, queries, priority = 'NORMAL' } = data;

  // Get businesses to warm
  const businesses = businessId
    ? await db.business.findMany({ where: { id: businessId, active: true } })
    : await db.business.findMany({ where: { active: true } });

  logger.info({ jobId, businessCount: businesses.length, priority }, 'Warming common queries');

  const commonQueries = queries || getDefaultCommonQueries();

  for (const business of businesses) {
    try {
      // Check budget before warming
      const credit = await db.businessCredit.findUnique({
        where: { businessId: business.id },
      });

      if (!credit || credit.isPaused) {
        logger.debug({ jobId, businessId: business.id }, 'Business paused, skipping cache warm');
        continue;
      }

      // Get or create a sample customer context
      const sampleCustomer = await db.customer.findFirst({
        where: { businessId: business.id },
      });

      let warmedCount = 0;
      let skippedCount = 0;

      for (const query of commonQueries) {
        try {
          // Check if already cached
          const cached = await SemanticCacheService.getCachedResponse({
            businessId: business.id,
            query,
            channel: Channel.CHAT,
          });

          if (cached.hit) {
            skippedCount++;
            continue;
          }

          // Generate response and cache it
          if (sampleCustomer) {
            const context = await AIService.buildContext(
              sampleCustomer.id,
              business.id,
              'warm-cache-conversation',
              query
            );

            const response = await AIService.generateResponse(context, query, {
              businessId: business.id,
              customerId: sampleCustomer.id,
              conversationId: 'warm-cache-conversation',
              channel: 'CHAT',
            });

            warmedCount++;

            // Small delay to avoid rate limits
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        } catch (error) {
          logger.error({ error, jobId, businessId: business.id, query }, 'Failed to warm query');
        }
      }

      logger.info(
        {
          jobId,
          businessId: business.id,
          warmedCount,
          skippedCount,
        },
        'Cache warming completed for business'
      );
    } catch (error) {
      logger.error({ error, jobId, businessId: business.id }, 'Failed to warm cache for business');
    }
  }
}

/**
 * Warm cache with business FAQs
 */
async function processWarmFAQs(jobId: string, data: CacheWarmerJobData): Promise<void> {
  const { businessId } = data;

  const businesses = businessId
    ? await db.business.findMany({ where: { id: businessId, active: true } })
    : await db.business.findMany({ where: { active: true } });

  logger.info({ jobId, businessCount: businesses.length }, 'Warming FAQ cache');

  for (const business of businesses) {
    try {
      // Get active FAQs for this business
      const faqs = await db.businessFAQ.findMany({
        where: {
          businessId: business.id,
          isActive: true,
        },
        orderBy: { priority: 'desc' },
      });

      if (faqs.length === 0) {
        logger.debug({ jobId, businessId: business.id }, 'No FAQs to warm');
        continue;
      }

      let warmedCount = 0;

      for (const faq of faqs) {
        try {
          // Cache the FAQ response
          const allQuestions = [faq.question, ...(faq.questionVariants || [])];

          for (const question of allQuestions) {
            await SemanticCacheService.cacheResponse({
              businessId: business.id,
              query: question,
              response: faq.answer,
              channel: Channel.CHAT,
              aiCost: 0, // No AI cost for FAQ
            });
          }

          // Update hit count
          await db.businessFAQ.update({
            where: { id: faq.id },
            data: { hitCount: { increment: 1 } },
          });

          warmedCount++;
        } catch (error) {
          logger.error({ error, jobId, faqId: faq.id }, 'Failed to warm FAQ');
        }
      }

      logger.info(
        {
          jobId,
          businessId: business.id,
          warmedCount,
          totalFaqs: faqs.length,
        },
        'FAQ cache warming completed'
      );
    } catch (error) {
      logger.error({ error, jobId, businessId: business.id }, 'Failed to warm FAQ cache');
    }
  }
}

/**
 * Invalidate cache entries
 */
async function processInvalidateCache(jobId: string, data: InvalidateCacheJobData): Promise<void> {
  const { businessId, pattern, embeddingHash, olderThan } = data;

  logger.info(
    {
      jobId,
      businessId,
      hasPattern: !!pattern,
      hasEmbeddingHash: !!embeddingHash,
      olderThan: olderThan?.toISOString(),
    },
    'Processing cache invalidation'
  );

  try {
    let deletedCount = 0;

    if (embeddingHash) {
      // Delete specific entry
      await db.responseCache.deleteMany({
        where: {
          businessId,
          embeddingHash,
        },
      });
      deletedCount = 1;
    } else if (olderThan) {
      // Delete entries older than date
      const result = await db.responseCache.deleteMany({
        where: {
          businessId,
          createdAt: { lt: olderThan },
        },
      });
      deletedCount = result.count;
    } else if (businessId) {
      // Delete all entries for business
      const result = await db.responseCache.deleteMany({
        where: { businessId },
      });
      deletedCount = result.count;
    } else {
      // Delete all expired entries
      const result = await db.responseCache.deleteMany({
        where: {
          expiresAt: { lt: new Date() },
        },
      });
      deletedCount = result.count;
    }

    logger.info({ jobId, deletedCount }, 'Cache invalidation completed');
  } catch (error) {
    logger.error({ error, jobId }, 'Cache invalidation failed');
    throw error;
  }
}

/**
 * Get default common queries to warm
 */
function getDefaultCommonQueries(): string[] {
  return [
    'What are your hours?',
    'What time do you open?',
    'What time do you close?',
    'Are you open today?',
    'Where are you located?',
    'What is your address?',
    'How do I get there?',
    'Do you have parking?',
    'What is your phone number?',
    'How can I contact you?',
    'Do you take reservations?',
    'How much does it cost?',
    'What are your prices?',
    'Do you offer discounts?',
    'What payment methods do you accept?',
    'Do you accept credit cards?',
    'Can I pay with cash?',
    'Do you deliver?',
    'What services do you offer?',
    'Do you have a website?',
    'What is your email address?',
    'Can I book online?',
    'Do I need an appointment?',
    'How long will it take?',
    'Is there a wait time?',
    'Do you take walk-ins?',
    'What is your cancellation policy?',
    'Can I reschedule?',
    'What are your COVID policies?',
    'Are masks required?',
    'Is it safe to visit?',
    'Do you have WiFi?',
    'Is there a bathroom?',
    'Are you wheelchair accessible?',
    'Do you have gift cards?',
    'Can I get a refund?',
    'What is your return policy?',
    'Do you offer refunds?',
    'How do I get a quote?',
    'Can you give me an estimate?',
    'Do you offer free consultations?',
    'What should I bring?',
    'What do I need to prepare?',
    'Do I need to bring ID?',
    'What documents do I need?',
    'Can I bring someone with me?',
    'Is there a dress code?',
    'What should I wear?',
    'Can I bring my pet?',
    'Do you allow pets?',
    'Is smoking allowed?',
    'Do you have outdoor seating?',
    'What is the weather like today?',
    'Will it rain today?',
    'Thank you',
    'Thanks',
    'Goodbye',
    'Bye',
    'Have a nice day',
    'See you later',
    'Good morning',
    'Good afternoon',
    'Good evening',
    'Hello',
    'Hi',
    'Hey',
    'How are you?',
    'How is it going?',
    'Nice to meet you',
    'What is your name?',
    'Who am I speaking with?',
    'Are you a bot?',
    'Are you human?',
    'Speak to a human',
    'I need help',
    'Help me',
    'I have a problem',
    'Something is wrong',
    'I am not happy',
    'I want to complain',
    'This is urgent',
    'It is an emergency',
    'I need to talk to someone',
    'Connect me to a manager',
    'I want to speak to the owner',
    'This is unacceptable',
    'I am frustrated',
    'Please help me',
    'Can you assist me?',
    'I do not understand',
    'Explain that again',
    'What do you mean?',
    'Can you repeat that?',
    'Speak louder',
    'Speak slower',
    'I cannot hear you',
    'The line is bad',
    'You are breaking up',
    'Can you call me back?',
    'I will call back later',
    'Please hold',
    'Wait a moment',
    'One second please',
    'Let me think',
    'I need a minute',
    'Do not hang up',
    'Stay on the line',
    'Almost done',
    'Just a moment',
    'I am looking that up',
    'Let me check',
    'I will find out',
    'Getting that information',
    'One moment please',
  ];
}
