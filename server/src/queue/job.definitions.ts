/**
 * Job Definitions and Types
 * Type-safe job definitions for all background workers
 */

import { Channel } from '@prisma/client';

// Job names for each queue
export const JOB_NAMES = {
  EMBEDDINGS: {
    GENERATE: 'generate',
    BATCH_GENERATE: 'batch-generate',
  },
  SUMMARIES: {
    CONVERSATION_SUMMARY: 'conversation-summary',
    BATCH_SUMMARY: 'batch-summary',
  },
  COST_REPORTS: {
    DAILY_REPORT: 'daily-report',
    WEEKLY_REPORT: 'weekly-report',
    MONTHLY_REPORT: 'monthly-report',
  },
  CACHE_WARMER: {
    WARM_COMMON_QUERIES: 'warm-common-queries',
    WARM_FAQS: 'warm-faqs',
    INVALIDATE_CACHE: 'invalidate-cache',
  },
  PROACTIVE_CAMPAIGNS: {
    EXECUTE_CAMPAIGN: 'execute-campaign',
    SEND_MESSAGE: 'send-message',
    CHECK_TRIGGERS: 'check-triggers',
  },
} as const;

// ============================================
// Job Data Types
// ============================================

export interface GenerateEmbeddingJobData {
  customerId: string;
  content: string;
  source?: string;
  conversationId?: string;
  channel?: Channel;
  importance?: number;
}

export interface BatchEmbeddingJobData {
  items: Array<{
    customerId: string;
    content: string;
    source?: string;
  }>;
}

export interface ConversationSummaryJobData {
  conversationId: string;
  customerId: string;
  businessId: string;
  forceRegenerate?: boolean;
}

export interface CostReportJobData {
  businessId: string;
  reportType: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  date?: string; // ISO date string
  emailRecipients?: string[];
}

export interface CacheWarmerJobData {
  businessId: string;
  queries?: string[]; // Specific queries to warm
  warmAllFAQs?: boolean;
  priority?: 'HIGH' | 'NORMAL' | 'LOW';
}

export interface InvalidateCacheJobData {
  businessId?: string; // If undefined, invalidate all
  pattern?: string; // Redis pattern to match
  embeddingHash?: string; // Specific embedding hash
  olderThan?: Date; // Invalidate entries older than this
}

export interface ExecuteCampaignJobData {
  campaignId: string;
  businessId: string;
  resumeFrom?: string; // Customer ID to resume from (for failed campaigns)
}

export interface SendCampaignMessageJobData {
  campaignId: string;
  customerId: string;
  businessId: string;
  channel: Channel;
  template: string;
  personalize: boolean;
}

export interface CheckTriggersJobData {
  businessId?: string; // If undefined, check all businesses
  triggerTypes?: string[];
}

// Union type of all job data
export type JobData =
  | GenerateEmbeddingJobData
  | BatchEmbeddingJobData
  | ConversationSummaryJobData
  | CostReportJobData
  | CacheWarmerJobData
  | InvalidateCacheJobData
  | ExecuteCampaignJobData
  | SendCampaignMessageJobData
  | CheckTriggersJobData;

// Job options for scheduling
export interface JobScheduleOptions {
  priority?: number;
  delay?: number;
  attempts?: number;
  repeat?: {
    cron?: string;
    every?: number;
    limit?: number;
  };
  jobId?: string;
}
