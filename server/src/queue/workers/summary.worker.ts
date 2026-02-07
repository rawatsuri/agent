/**
 * Summary Worker
 * Background job processor for conversation summarization
 */

import { Worker, Job } from 'bullmq';
import OpenAI from 'openai';
import { db } from '@/config/database';
import { CostTrackerService } from '@/features/cost-control/cost-tracker.service';
import { getDefaultWorkerOptions, QUEUE_NAMES } from '../queue.config';
import { ConversationSummaryJobData, JOB_NAMES } from '../job.definitions';
import { logger } from '@/utils/logger';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Start the summary worker
 */
export const startSummaryWorker = (): Worker => {
  const options = getDefaultWorkerOptions();
  
  const worker = new Worker(
    QUEUE_NAMES.SUMMARIES,
    async (job: Job) => {
      const { name, data } = job;

      logger.info({ jobId: job.id, jobName: name }, 'Processing summary job');

      try {
        switch (name) {
          case JOB_NAMES.SUMMARIES.CONVERSATION_SUMMARY:
            await processConversationSummary(job.id!, data as ConversationSummaryJobData);
            break;

          case JOB_NAMES.SUMMARIES.BATCH_SUMMARY:
            await processBatchSummaries(job.id!, data as { conversationIds: string[] });
            break;

          case 'cleanup-old-conversations':
            await processConversationCleanup(job.id!, data as { olderThanDays: number });
            break;

          default:
            throw new Error(`Unknown job name: ${name}`);
        }

        logger.info({ jobId: job.id }, 'Summary job completed');
      } catch (error) {
        logger.error({ error, jobId: job.id, jobName: name }, 'Summary job failed');
        throw error;
      }
    },
    {
      ...options,
      concurrency: 2, // Lower concurrency for AI processing
    }
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'Summary worker job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, error: err }, 'Summary worker job failed');
  });

  logger.info('Summary worker started');

  return worker;
};

/**
 * Generate summary for a single conversation
 */
async function processConversationSummary(
  jobId: string,
  data: ConversationSummaryJobData
): Promise<void> {
  const { conversationId, businessId, forceRegenerate } = data;

  // Check if summary already exists
  if (!forceRegenerate) {
    const existing = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { summary: true },
    });

    if (existing?.summary) {
      logger.debug({ jobId, conversationId }, 'Summary already exists, skipping');
      return;
    }
  }

  // Get all messages for this conversation
  const messages = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: {
      role: true,
      content: true,
      createdAt: true,
    },
  });

  if (messages.length < 3) {
    logger.debug({ jobId, conversationId, messageCount: messages.length }, 'Too few messages to summarize');
    return;
  }

  // Build conversation transcript
  const transcript = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n\n');

  // Generate summary using OpenAI
  const startTime = Date.now();
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a conversation summarizer. Create a concise summary (max 200 characters) of the customer conversation, focusing on the main topic and resolution.',
      },
      {
        role: 'user',
        content: `Summarize this conversation:\n\n${transcript}`,
      },
    ],
    temperature: 0.3,
    max_tokens: 100,
  });

  const summary = completion.choices[0].message.content?.trim();
  const duration = Date.now() - startTime;

  if (!summary) {
    throw new Error('Failed to generate summary');
  }

  // Calculate and log cost
  const inputTokens = completion.usage?.prompt_tokens || 0;
  const outputTokens = completion.usage?.completion_tokens || 0;
  const cost = CostTrackerService.calculateGPTCost('gpt-4o-mini', inputTokens, outputTokens);

  await CostTrackerService.logAICost({
    businessId,
    conversationId,
    service: 'OPENAI_GPT',
    cost,
    tokensUsed: inputTokens + outputTokens,
    model: 'gpt-4o-mini',
    metadata: {
      jobType: 'conversation-summary',
      messageCount: messages.length,
      durationMs: duration,
    },
  });

  // Update conversation with summary
  await db.conversation.update({
    where: { id: conversationId },
    data: {
      summary,
      status: 'CLOSED',
      endedAt: new Date(),
    },
  });

  logger.info(
    {
      jobId,
      conversationId,
      messageCount: messages.length,
      summaryLength: summary.length,
      cost,
      durationMs: duration,
    },
    'Conversation summary generated'
  );
}

/**
 * Process batch conversation summaries
 */
async function processBatchSummaries(
  jobId: string,
  data: { conversationIds: string[] }
): Promise<void> {
  const { conversationIds } = data;

  logger.info({ jobId, batchSize: conversationIds.length }, 'Processing batch summaries');

  let successCount = 0;
  let failureCount = 0;

  // Process sequentially to avoid rate limits
  for (const conversationId of conversationIds) {
    try {
      const conversation = await db.conversation.findUnique({
        where: { id: conversationId },
        select: { businessId: true, customerId: true },
      });

      if (!conversation) {
        failureCount++;
        continue;
      }

      await processConversationSummary(jobId, {
        conversationId,
        customerId: conversation.customerId,
        businessId: conversation.businessId,
      });

      successCount++;

      // Small delay between requests
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (error) {
      failureCount++;
      logger.error({ error, jobId, conversationId }, 'Failed to summarize conversation');
    }
  }

  logger.info(
    {
      jobId,
      batchSize: conversationIds.length,
      successCount,
      failureCount,
    },
    'Batch summaries completed'
  );
}

/**
 * Cleanup old conversations and archive data
 */
async function processConversationCleanup(
  jobId: string,
  data: { olderThanDays: number }
): Promise<void> {
  const { olderThanDays } = data;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  logger.info({ jobId, cutoffDate, olderThanDays }, 'Starting conversation cleanup');

  // Find old closed conversations
  const oldConversations = await db.conversation.findMany({
    where: {
      status: 'CLOSED',
      endedAt: { lt: cutoffDate },
    },
    select: {
      id: true,
      businessId: true,
    },
  });

  logger.info({ jobId, count: oldConversations.length }, 'Found old conversations to cleanup');

  // Archive logic could go here (move to cold storage, etc.)
  // For now, we just log that they exist

  // Optionally delete old messages to free up space (keeping summary)
  // This is commented out for safety - uncomment when ready
  /*
  for (const conv of oldConversations) {
    await db.message.deleteMany({
      where: { conversationId: conv.id },
    });
  }
  */

  logger.info({ jobId, count: oldConversations.length }, 'Conversation cleanup completed');
}
