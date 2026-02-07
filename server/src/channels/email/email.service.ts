import type { IChannelAdapter } from '../base/channel.types';
import { Channel, IAgentResponse } from '@/types/channel.types';
import { logger } from '@/utils/logger';
import { CostTrackerService } from '@/features/cost-control/cost-tracker.service';
import { BudgetService } from '@/features/cost-control/budget.service';

/**
 * Email Service - SendGrid Integration
 * 
 * Handles:
 * - Outgoing email sending
 * - Email template rendering
 * - Thread tracking
 * - Attachment handling
 */
export class EmailService implements IChannelAdapter {
  readonly channel: Channel = Channel.EMAIL;
  
  private sendgridApiKey: string;
  private fromEmail: string;
  private fromName: string;

  constructor() {
    this.sendgridApiKey = process.env.SENDGRID_API_KEY || '';
    this.fromEmail = process.env.SENDGRID_FROM_EMAIL || 'ai@yourdomain.com';
    this.fromName = process.env.SENDGRID_FROM_NAME || 'AI Assistant';
  }

  /**
   * Send an email
   */
  async sendMessage(
    customerIdentifier: { email?: string },
    content: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      if (!customerIdentifier.email) {
        throw new Error('Email address required');
      }

      const businessId = metadata?.businessId;
      if (!businessId) {
        throw new Error('Business ID required');
      }

      // Check budget
      const budgetCheck = await BudgetService.hasBudgetAvailable(businessId, 0.0001);
      if (!budgetCheck.allowed) {
        logger.warn({ businessId }, 'Email blocked: budget exceeded');
        return { success: false, error: 'Budget exceeded' };
      }

      const { subject, htmlContent, threadId } = metadata || {};

      // Send via SendGrid
      const result = await this.sendViaSendGrid(
        customerIdentifier.email,
        subject || 'Re: Your inquiry',
        content,
        htmlContent,
        threadId
      );

      // Log cost
      await CostTrackerService.logExternalCost({
        businessId,
        customerId: metadata?.customerId,
        conversationId: metadata?.conversationId,
        service: 'SENDGRID_EMAIL',
        cost: 0.0001, // SendGrid is very cheap per email
        channel: this.channel,
        metadata: {
          to: customerIdentifier.email,
          subject,
          messageId: result.messageId,
        },
      });

      logger.info(
        { 
          businessId, 
          to: customerIdentifier.email,
          messageId: result.messageId 
        },
        'Email sent successfully'
      );

      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (error) {
      logger.error({ error, email: customerIdentifier.email }, 'Failed to send email');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Email delivery failed',
      };
    }
  }

  /**
   * Send email via SendGrid API
   */
  private async sendViaSendGrid(
    to: string,
    subject: string,
    textContent: string,
    htmlContent?: string,
    threadId?: string
  ): Promise<{ messageId: string }> {
    const url = 'https://api.sendgrid.com/v3/mail/send';

    // Build headers for threading
    const headers: Record<string, string> = {};
    if (threadId) {
      headers['In-Reply-To'] = threadId;
      headers['References'] = threadId;
    }

    const payload = {
      personalizations: [
        {
          to: [{ email: to }],
        },
      ],
      from: {
        email: this.fromEmail,
        name: this.fromName,
      },
      subject,
      content: [
        {
          type: 'text/plain',
          value: textContent,
        },
      ],
      headers,
    };

    // Add HTML content if provided
    if (htmlContent) {
      payload.content.push({
        type: 'text/html',
        value: htmlContent,
      });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.sendgridApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`SendGrid API error: ${response.status} - ${errorData}`);
    }

    // SendGrid returns message ID in X-Message-Id header
    const messageId = response.headers.get('X-Message-Id') || `sg-${Date.now()}`;

    return { messageId };
  }

  /**
   * Validate SendGrid webhook signature
   */
  validateWebhook(payload: unknown, signature?: string): boolean {
    // SendGrid uses a public key signature verification
    // In production, implement proper signature verification
    // https://docs.sendgrid.com/for-developers/tracking-events/event
    
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    // Basic validation - check required fields
    const data = payload as any;
    return !!(data.email || data.from);
  }

  /**
   * Parse SendGrid webhook payload (inbound parse or event webhook)
   */
  parseWebhook(payload: unknown): {
    businessId: string;
    customerIdentifier: { email: string };
    content: string;
    metadata: Record<string, any>;
  } | null {
    try {
      const data = payload as any;

      // Handle both inbound parse and event webhooks
      let email: string;
      let content: string;
      let subject: string;
      let messageId: string;

      if (data.from) {
        // Inbound parse webhook
        email = data.from;
        content = data.text || data.html || '';
        subject = data.subject || '';
        messageId = data.headers?.['Message-Id'] || data.messageId || '';
      } else if (data.email) {
        // Event webhook format
        email = data.email;
        content = data.text || '';
        subject = data.subject || '';
        messageId = data.sg_message_id || '';
      } else {
        return null;
      }

      return {
        businessId: data.businessId || this.extractBusinessIdFromTo(data.to),
        customerIdentifier: { email },
        content,
        metadata: {
          subject,
          messageId,
          to: data.to,
          headers: data.headers,
          attachments: data.attachments,
        },
      };
    } catch (error) {
      logger.error({ error, payload }, 'Failed to parse email webhook');
      return null;
    }
  }

  /**
   * Extract business ID from the "to" email address
   * Pattern: business-{id}@yourdomain.com
   */
  private extractBusinessIdFromTo(to: string): string {
    if (!to) return '';
    
    const match = to.match(/business-([^@]+)@/);
    return match ? match[1] : '';
  }

  /**
   * Format response for email
   * Full formatting including signatures
   */
  formatResponse(response: IAgentResponse): string {
    let formatted = response.content;

    // Add professional email signature if not present
    if (!formatted.includes('---')) {
      formatted += `\n\n---\nAI Assistant\nThis message was generated automatically.`;
    }

    return formatted;
  }

  /**
   * Get cost estimate for email
   * SendGrid: ~$0.0001 per email (very cheap)
   */
  getCostEstimate(): number {
    return 0.0001;
  }

  /**
   * Send HTML email with template
   */
  async sendTemplateEmail(
    to: string,
    templateData: {
      subject: string;
      templateId?: string;
      dynamicData?: Record<string, any>;
    },
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const { subject, templateId, dynamicData } = templateData;

      const url = 'https://api.sendgrid.com/v3/mail/send';

      const payload: any = {
        personalizations: [
          {
            to: [{ email: to }],
            dynamic_template_data: dynamicData,
          },
        ],
        from: {
          email: this.fromEmail,
          name: this.fromName,
        },
        subject,
      };

      if (templateId) {
        payload.template_id = templateId;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.sendgridApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`SendGrid template error: ${response.status}`);
      }

      const messageId = response.headers.get('X-Message-Id') || `sg-${Date.now()}`;

      return { success: true, messageId };
    } catch (error) {
      logger.error({ error, to }, 'Failed to send template email');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Template email failed',
      };
    }
  }
}
