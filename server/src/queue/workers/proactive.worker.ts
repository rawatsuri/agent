/**
 * Proactive Campaign Worker
 * Background job processor for executing proactive outreach campaigns
 */

import { Worker, Job } from 'bullmq';
import { db } from '@/config/database';
import { Channel, CampaignStatus } from '@prisma/client';
import { AIService } from '@/services/ai.service';
import { CostTrackerService } from '@/features/cost-control/cost-tracker.service';
import { BudgetService } from '@/features/cost-control/budget.service';
import { getDefaultWorkerOptions, QUEUE_NAMES } from '../queue.config';
import {
  ExecuteCampaignJobData,
  SendCampaignMessageJobData,
  CheckTriggersJobData,
  JOB_NAMES,
} from '../job.definitions';
import { logger } from '@/utils/logger';
import { getProactiveCampaignQueue } from '../queue.config';

/**
 * Start the proactive campaign worker
 */
export const startProactiveCampaignWorker = (): Worker => {
  const options = getDefaultWorkerOptions();
  
  const worker = new Worker(
    QUEUE_NAMES.PROACTIVE_CAMPAIGNS,
    async (job: Job) => {
      const { name, data } = job;

      logger.info({ jobId: job.id, jobName: name }, 'Processing proactive campaign job');

      try {
        switch (name) {
          case JOB_NAMES.PROACTIVE_CAMPAIGNS.EXECUTE_CAMPAIGN:
            await processExecuteCampaign(job.id!, data as ExecuteCampaignJobData);
            break;

          case JOB_NAMES.PROACTIVE_CAMPAIGNS.SEND_MESSAGE:
            await processSendCampaignMessage(job.id!, data as SendCampaignMessageJobData);
            break;

          case JOB_NAMES.PROACTIVE_CAMPAIGNS.CHECK_TRIGGERS:
            await processCheckTriggers(job.id!, data as CheckTriggersJobData);
            break;

          default:
            throw new Error(`Unknown job name: ${name}`);
        }

        logger.info({ jobId: job.id }, 'Proactive campaign job completed');
      } catch (error) {
        logger.error({ error, jobId: job.id, jobName: name }, 'Proactive campaign job failed');
        throw error;
      }
    },
    {
      ...options,
      concurrency: 5,
    }
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'Proactive campaign worker job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, error: err }, 'Proactive campaign worker job failed');
  });

  logger.info('Proactive campaign worker started');

  return worker;
};

/**
 * Execute a scheduled or triggered campaign
 */
async function processExecuteCampaign(jobId: string, data: ExecuteCampaignJobData): Promise<void> {
  const { campaignId, resumeFrom } = data;

  logger.info({ jobId, campaignId, resumeFrom }, 'Executing campaign');

  // Get campaign details
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: { business: true },
  });

  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  if (campaign.status !== 'SCHEDULED' && campaign.status !== 'RUNNING') {
    logger.warn({ jobId, campaignId, status: campaign.status }, 'Campaign not in executable state');
    return;
  }

  // Update campaign status to running
  await db.campaign.update({
    where: { id: campaignId },
    data: {
      status: 'RUNNING',
      startedAt: new Date(),
    },
  });

  try {
    // Build target customer query
    const whereClause: any = {
      businessId: campaign.businessId,
    };

    // Apply target filters if configured
    if (campaign.targetFilter) {
      const filter = campaign.targetFilter as any;

      if (filter.tags && filter.tags.length > 0) {
        whereClause.tags = { hasSome: filter.tags };
      }

      if (filter.minTrustScore !== undefined) {
        whereClause.trustScore = { gte: filter.minTrustScore };
      }

      if (filter.isVerified !== undefined) {
        whereClause.isVerified = filter.isVerified;
      }

      if (filter.lastInteractionAfter) {
        whereClause.lastInteraction = {
          gte: new Date(filter.lastInteractionAfter),
        };
      }
    }

    // Get target customers
    const customers = await db.customer.findMany({
      where: whereClause,
      orderBy: { id: 'asc' },
    });

    logger.info(
      {
        jobId,
        campaignId,
        targetCount: customers.length,
      },
      'Campaign targets identified'
    );

    // Update campaign stats
    await db.campaign.update({
      where: { id: campaignId },
      data: { totalTargeted: customers.length },
    });

    // Queue individual message jobs
    const queue = getProactiveCampaignQueue();
    let queuedCount = 0;

    for (const customer of customers) {
      // Skip if resuming and haven't reached resume point
      if (resumeFrom && customer.id < resumeFrom) {
        continue;
      }

      await queue.add(
        JOB_NAMES.PROACTIVE_CAMPAIGNS.SEND_MESSAGE,
        {
          campaignId,
          customerId: customer.id,
          businessId: campaign.businessId,
          channel: campaign.channel,
          template: campaign.messageTemplate,
          personalize: campaign.aiPersonalized,
        },
        {
          priority: campaign.type === 'APPOINTMENT_REMINDER' ? 1 : 5,
        }
      );

      queuedCount++;
    }

    logger.info(
      {
        jobId,
        campaignId,
        queuedCount,
      },
      'Campaign messages queued'
    );
  } catch (error) {
    // Update campaign status to failed
    await db.campaign.update({
      where: { id: campaignId },
      data: {
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    throw error;
  }
}

/**
 * Send a single campaign message
 */
async function processSendCampaignMessage(
  jobId: string,
  data: SendCampaignMessageJobData
): Promise<void> {
  const { campaignId, customerId, businessId, channel, template, personalize } = data;

  try {
    // Check budget before sending
    const canSpend = await BudgetService.checkBudget(businessId, 0.01); // Estimate 1 cent per message
    if (!canSpend.allowed) {
      logger.warn({ jobId, campaignId, customerId }, 'Budget exceeded, skipping campaign message');

      // Update campaign
      await db.campaign.update({
        where: { id: campaignId },
        data: {
          totalFailed: { increment: 1 },
          status: 'PAUSED',
        },
      });

      return;
    }

    // Get customer details
    const customer = await db.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new Error(`Customer not found: ${customerId}`);
    }

    // Personalize message if enabled
    let message = template;
    if (personalize) {
      message = await personalizeMessage(template, customer, businessId);
    } else {
      // Simple variable substitution
      message = template
        .replace(/{{name}}/g, customer.name || 'there')
        .replace(/{{firstName}}/g, customer.name?.split(' ')[0] || 'there');
    }

    // Create conversation for this campaign message
    const conversation = await db.conversation.create({
      data: {
        businessId,
        customerId,
        channel,
        status: 'ACTIVE',
        metadata: {
          campaignId,
          isCampaignMessage: true,
        },
      },
    });

    // Save the message
    await db.message.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: message,
        channel,
        status: 'SENT',
        metadata: { campaignId },
      },
    });

    // Log cost (estimate based on channel)
    const estimatedCost = getChannelCost(channel);
    await CostTrackerService.logExternalCost({
      businessId,
      customerId,
      conversationId: conversation.id,
      service: getServiceName(channel),
      cost: estimatedCost,
      channel,
    });

    // Update campaign stats
    await db.campaign.update({
      where: { id: campaignId },
      data: {
        totalSent: { increment: 1 },
        actualCost: { increment: estimatedCost },
      },
    });

    logger.info(
      {
        jobId,
        campaignId,
        customerId,
        channel,
      },
      'Campaign message sent'
    );
  } catch (error) {
    // Update campaign failure count
    await db.campaign.update({
      where: { id: campaignId },
      data: { totalFailed: { increment: 1 } },
    });

    throw error;
  }
}

/**
 * Check and trigger event-based campaigns
 */
async function processCheckTriggers(jobId: string, data: CheckTriggersJobData): Promise<void> {
  const { businessId, triggerTypes } = data;

  logger.info({ jobId, businessId, triggerTypes }, 'Checking campaign triggers');

  const whereClause: any = {
    status: 'SCHEDULED',
    triggerType: 'EVENT_BASED',
  };

  if (businessId) {
    whereClause.businessId = businessId;
  }

  const campaigns = await db.campaign.findMany({
    where: whereClause,
  });

  logger.info({ jobId, campaignCount: campaigns.length }, 'Found event-based campaigns');

  for (const campaign of campaigns) {
    try {
      const triggerConfig = campaign.triggerConfig as any;

      if (!triggerConfig) {
        continue;
      }

      // Check if trigger conditions are met
      const shouldTrigger = await evaluateTrigger(campaign.businessId, triggerConfig);

      if (shouldTrigger) {
        logger.info({ jobId, campaignId: campaign.id }, 'Campaign trigger activated');

        // Execute the campaign
        const queue = getProactiveCampaignQueue();
        await queue.add(JOB_NAMES.PROACTIVE_CAMPAIGNS.EXECUTE_CAMPAIGN, {
          campaignId: campaign.id,
          businessId: campaign.businessId,
        });
      }
    } catch (error) {
      logger.error({ error, jobId, campaignId: campaign.id }, 'Failed to check campaign trigger');
    }
  }
}

/**
 * Personalize message using AI
 */
async function personalizeMessage(
  template: string,
  customer: any,
  businessId: string
): Promise<string> {
  try {
    // Get business details for context
    const business = await db.business.findUnique({
      where: { id: businessId },
      select: { name: true, config: true },
    });

    const context = await AIService.buildContext(
      customer.id,
      businessId,
      'campaign-personalization',
      template
    );

    const prompt = `Personalize this campaign message for ${customer.name || 'the customer'}. 
    Original template: "${template}"
    
    Make it friendly and natural while keeping the core message. Use the customer's name if available.
    Return only the personalized message, nothing else.`;

    const response = await AIService.generateResponse(context, prompt, {
      businessId,
      customerId: customer.id,
      conversationId: 'campaign-personalization',
      channel: 'CHAT',
    });

    return response.content;
  } catch (error) {
    logger.error({ error, customerId: customer.id }, 'Failed to personalize message, using template');
    return template.replace(/{{name}}/g, customer.name || 'there');
  }
}

/**
 * Evaluate trigger conditions for event-based campaigns
 */
async function evaluateTrigger(businessId: string, triggerConfig: any): Promise<boolean> {
  const { event, conditions } = triggerConfig;

  switch (event) {
    case 'NO_INTERACTION':
      // Check for customers with no interaction in X days
      const days = conditions?.days || 30;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const inactiveCustomers = await db.customer.count({
        where: {
          businessId,
          lastInteraction: { lt: cutoffDate },
        },
      });

      return inactiveCustomers > 0;

    case 'BIRTHDAY':
      // Check for customers with birthday today
      const today = new Date();
      const month = today.getMonth() + 1;
      const day = today.getDate();

      // This would require birthday field in customer model
      // For now, return false
      return false;

    case 'APPOINTMENT_UPCOMING':
      // Check for upcoming appointments within X hours
      // This would require appointment data
      return false;

    case 'CART_ABANDONED':
      // Check for abandoned carts
      // This would require cart/e-commerce integration
      return false;

    default:
      return false;
  }
}

/**
 * Get estimated cost for a channel
 */
function getChannelCost(channel: Channel): number {
  const costs: Record<Channel, number> = {
    SMS: 0.005,
    WHATSAPP: 0.005,
    EMAIL: 0.0001,
    VOICE: 0.02,
    CHAT: 0,
    TELEGRAM: 0,
    INSTAGRAM: 0,
  };

  return costs[channel] || 0.01;
}

/**
 * Get service name for cost tracking
 */
function getServiceName(channel: Channel): any {
  const services: Record<Channel, any> = {
    SMS: 'EXOTEL_SMS',
    WHATSAPP: 'EXOTEL_SMS', // Using same cost structure
    EMAIL: 'SENDGRID_EMAIL',
    VOICE: 'EXOTEL_VOICE',
    CHAT: 'EXOTEL_SMS',
    TELEGRAM: 'EXOTEL_SMS',
    INSTAGRAM: 'EXOTEL_SMS',
  };

  return services[channel] || 'EXOTEL_SMS';
}
