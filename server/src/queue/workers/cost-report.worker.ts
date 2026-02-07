/**
 * Cost Report Worker
 * Background job processor for generating and sending cost reports
 */

import { Worker, Job } from 'bullmq';
import sgMail from '@sendgrid/mail';
import { db } from '@/config/database';
import { CostTrackerService } from '@/features/cost-control/cost-tracker.service';
import { BudgetService } from '@/features/cost-control/budget.service';
import { getDefaultWorkerOptions, QUEUE_NAMES } from '../queue.config';
import { CostReportJobData, JOB_NAMES } from '../job.definitions';
import { logger } from '@/utils/logger';

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

/**
 * Start the cost report worker
 */
export const startCostReportWorker = (): Worker => {
  const options = getDefaultWorkerOptions();
  
  const worker = new Worker(
    QUEUE_NAMES.COST_REPORTS,
    async (job: Job) => {
      const { name, data } = job;

      logger.info({ jobId: job.id, jobName: name }, 'Processing cost report job');

      try {
        switch (name) {
          case JOB_NAMES.COST_REPORTS.DAILY_REPORT:
            await processDailyReport(job.id!, data as CostReportJobData);
            break;

          case JOB_NAMES.COST_REPORTS.WEEKLY_REPORT:
            await processWeeklyReport(job.id!, data as CostReportJobData);
            break;

          case JOB_NAMES.COST_REPORTS.MONTHLY_REPORT:
            await processMonthlyReport(job.id!, data as CostReportJobData);
            break;

          default:
            throw new Error(`Unknown job name: ${name}`);
        }

        logger.info({ jobId: job.id }, 'Cost report job completed');
      } catch (error) {
        logger.error({ error, jobId: job.id, jobName: name }, 'Cost report job failed');
        throw error;
      }
    },
    options
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'Cost report worker job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, error: err }, 'Cost report worker job failed');
  });

  logger.info('Cost report worker started');

  return worker;
};

/**
 * Generate and send daily cost report
 */
async function processDailyReport(jobId: string, data: CostReportJobData): Promise<void> {
  const { businessId, date, emailRecipients } = data;

  // Get all active businesses if no specific business
  const businesses = businessId
    ? await db.business.findMany({ where: { id: businessId, active: true } })
    : await db.business.findMany({ where: { active: true } });

  logger.info({ jobId, businessCount: businesses.length }, 'Generating daily cost reports');

  const targetDate = date ? new Date(date) : new Date();
  targetDate.setHours(0, 0, 0, 0);

  const nextDate = new Date(targetDate);
  nextDate.setDate(nextDate.getDate() + 1);

  for (const business of businesses) {
    try {
      // Get cost logs for the day
      const logs = await db.costLog.findMany({
        where: {
          businessId: business.id,
          createdAt: {
            gte: targetDate,
            lt: nextDate,
          },
        },
      });

      if (logs.length === 0) {
        logger.debug({ jobId, businessId: business.id }, 'No costs for day, skipping report');
        continue;
      }

      // Calculate metrics
      const totalCost = logs.reduce((sum, log) => sum + Number(log.cost), 0);
      const byService: Record<string, number> = {};
      const byChannel: Record<string, number> = {};

      logs.forEach((log) => {
        byService[log.service] = (byService[log.service] || 0) + Number(log.cost);
        if (log.channel) {
          byChannel[log.channel] = (byChannel[log.channel] || 0) + Number(log.cost);
        }
      });

      const report = {
        businessName: business.name,
        date: targetDate.toISOString().split('T')[0],
        totalCost: Math.round(totalCost * 10000) / 10000,
        messageCount: logs.length,
        byService,
        byChannel,
      };

      // Get recipients
      const recipients = emailRecipients?.length
        ? emailRecipients
        : [business.email].filter(Boolean);

      if (recipients.length === 0) {
        logger.warn({ jobId, businessId: business.id }, 'No email recipients for report');
        continue;
      }

      // Send email report
      await sendCostReportEmail(recipients, report, 'Daily');

      logger.info(
        {
          jobId,
          businessId: business.id,
          totalCost: report.totalCost,
          messageCount: report.messageCount,
        },
        'Daily cost report sent'
      );
    } catch (error) {
      logger.error({ error, jobId, businessId: business.id }, 'Failed to send daily report');
    }
  }
}

/**
 * Generate and send weekly cost report
 */
async function processWeeklyReport(jobId: string, data: CostReportJobData): Promise<void> {
  const { businessId, emailRecipients } = data;

  const businesses = businessId
    ? await db.business.findMany({ where: { id: businessId, active: true } })
    : await db.business.findMany({ where: { active: true } });

  logger.info({ jobId, businessCount: businesses.length }, 'Generating weekly cost reports');

  // Get last 7 days
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 7);

  for (const business of businesses) {
    try {
      const dashboard = await CostTrackerService.getCostDashboard(business.id);

      // Get daily breakdown
      const logs = await db.costLog.findMany({
        where: {
          businessId: business.id,
          createdAt: { gte: startDate, lt: endDate },
        },
      });

      const totalCost = logs.reduce((sum, log) => sum + Number(log.cost), 0);

      const report = {
        businessName: business.name,
        weekStarting: startDate.toISOString().split('T')[0],
        weekEnding: endDate.toISOString().split('T')[0],
        totalCost: Math.round(totalCost * 10000) / 10000,
        messageCount: logs.length,
        budgetUsedPercent: dashboard.budgetUsedPercent,
        availableCredits: dashboard.availableCredits,
        dailySpend: dashboard.dailySpend.slice(-7),
      };

      const recipients = emailRecipients?.length
        ? emailRecipients
        : [business.email].filter(Boolean);

      if (recipients.length > 0) {
        await sendCostReportEmail(recipients, report, 'Weekly');
      }

      logger.info(
        {
          jobId,
          businessId: business.id,
          totalCost: report.totalCost,
        },
        'Weekly cost report sent'
      );
    } catch (error) {
      logger.error({ error, jobId, businessId: business.id }, 'Failed to send weekly report');
    }
  }
}

/**
 * Generate and send monthly cost report
 */
async function processMonthlyReport(jobId: string, data: CostReportJobData): Promise<void> {
  const { businessId, emailRecipients } = data;

  const businesses = businessId
    ? await db.business.findMany({ where: { id: businessId, active: true } })
    : await db.business.findMany({ where: { active: true } });

  logger.info({ jobId, businessCount: businesses.length }, 'Generating monthly cost reports');

  for (const business of businesses) {
    try {
      const summary = await CostTrackerService.getMonthlyCostSummary(business.id);
      const dashboard = await CostTrackerService.getCostDashboard(business.id);

      const report = {
        businessName: business.name,
        month: new Date().toLocaleString('default', { month: 'long', year: 'numeric' }),
        totalCost: Math.round(summary.totalCost * 10000) / 10000,
        messageCount: summary.messageCount,
        tokenCount: summary.tokenCount,
        byService: summary.byService,
        byChannel: summary.byChannel,
        budgetUsedPercent: dashboard.budgetUsedPercent,
        monthlyBudget: dashboard.monthlyBudget,
      };

      const recipients = emailRecipients?.length
        ? emailRecipients
        : [business.email].filter(Boolean);

      if (recipients.length > 0) {
        await sendCostReportEmail(recipients, report, 'Monthly');
      }

      logger.info(
        {
          jobId,
          businessId: business.id,
          totalCost: report.totalCost,
          messageCount: report.messageCount,
        },
        'Monthly cost report sent'
      );
    } catch (error) {
      logger.error({ error, jobId, businessId: business.id }, 'Failed to send monthly report');
    }
  }
}

/**
 * Send cost report email via SendGrid
 */
async function sendCostReportEmail(
  recipients: string[],
  report: any,
  reportType: string
): Promise<void> {
  if (!process.env.SENDGRID_API_KEY) {
    logger.warn('SendGrid not configured, skipping email');
    return;
  }

  const subject = `${reportType} Cost Report - ${report.businessName}`;

  // Build HTML content
  const htmlContent = buildReportHtml(report, reportType);

  const msg = {
    to: recipients,
    from: process.env.FROM_EMAIL || 'reports@ai-platform.com',
    subject,
    html: htmlContent,
  };

  await sgMail.send(msg);
}

/**
 * Build HTML email content
 */
function buildReportHtml(report: any, reportType: string): string {
  const formatCurrency = (val: number) => `$${val.toFixed(4)}`;

  let html = `
    <h1>${reportType} Cost Report</h1>
    <h2>${report.businessName}</h2>
    <p><strong>Period:</strong> ${report.date || report.weekStarting || report.month}</p>
    
    <h3>Summary</h3>
    <ul>
      <li>Total Cost: ${formatCurrency(report.totalCost)}</li>
      <li>Messages: ${report.messageCount}</li>
      ${report.tokenCount ? `<li>Tokens Used: ${report.tokenCount.toLocaleString()}</li>` : ''}
      ${report.budgetUsedPercent !== undefined ? `<li>Budget Used: ${report.budgetUsedPercent}%</li>` : ''}
    </ul>
  `;

  if (report.byService && Object.keys(report.byService).length > 0) {
    html += '<h3>Costs by Service</h3><ul>';
    for (const [service, cost] of Object.entries(report.byService)) {
      html += `<li>${service}: ${formatCurrency(cost as number)}</li>`;
    }
    html += '</ul>';
  }

  if (report.byChannel && Object.keys(report.byChannel).length > 0) {
    html += '<h3>Costs by Channel</h3><ul>';
    for (const [channel, cost] of Object.entries(report.byChannel)) {
      html += `<li>${channel}: ${formatCurrency(cost as number)}</li>`;
    }
    html += '</ul>';
  }

  html += '<p><em>This is an automated report from your AI Customer Service Platform.</em></p>';

  return html;
}
