import type { IChannelAdapter } from '../base/channel.types';
import { Channel, IAgentResponse } from '@/types/channel.types';
import { logger } from '@/utils/logger';
import { CostTrackerService } from '@/features/cost-control/cost-tracker.service';
import { BudgetService } from '@/features/cost-control/budget.service';

/**
 * SMS Service - Exotel Integration
 * 
 * Handles:
 * - Outgoing SMS
 * - Incoming SMS webhooks
 * - Long message splitting (160 chars per SMS)
 * - Unicode detection for character counting
 */
export class SmsService implements IChannelAdapter {
  readonly channel: Channel = Channel.SMS;
  
  private exotelSid: string;
  private exotelToken: string;
  private exotelBaseUrl: string;
  private fromNumber: string;

  constructor() {
    this.exotelSid = process.env.EXOTEL_SID || '';
    this.exotelToken = process.env.EXOTEL_TOKEN || '';
    this.exotelBaseUrl = 'https://api.exotel.com/v1/Accounts';
    this.fromNumber = process.env.EXOTEL_PHONE_NUMBER || '';
  }

  /**
   * Send SMS message
   * Automatically splits long messages
   */
  async sendMessage(
    customerIdentifier: { phone?: string },
    content: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      if (!customerIdentifier.phone) {
        throw new Error('Phone number required for SMS');
      }

      const businessId = metadata?.businessId;
      if (!businessId) {
        throw new Error('Business ID required');
      }

      // Check budget (~$0.005 per SMS segment)
      const segmentCount = this.calculateSegments(content);
      const estimatedCost = 0.005 * segmentCount;
      
      const budgetCheck = await BudgetService.hasBudgetAvailable(businessId, estimatedCost);
      if (!budgetCheck.allowed) {
        logger.warn({ businessId }, 'SMS blocked: budget exceeded');
        return { success: false, error: 'Budget exceeded' };
      }

      // Send via Exotel
      const result = await this.sendViaExotel(
        customerIdentifier.phone,
        content
      );

      // Log cost per segment
      await CostTrackerService.logExternalCost({
        businessId,
        customerId: metadata?.customerId,
        conversationId: metadata?.conversationId,
        service: 'EXOTEL_SMS',
        cost: estimatedCost,
        channel: this.channel,
        metadata: {
          to: customerIdentifier.phone,
          segments: segmentCount,
          messageId: result.messageId,
          characters: content.length,
        },
      });

      logger.info(
        { 
          businessId, 
          to: customerIdentifier.phone,
          segments: segmentCount,
          messageId: result.messageId 
        },
        'SMS sent successfully'
      );

      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (error) {
      logger.error({ error, phone: customerIdentifier.phone }, 'Failed to send SMS');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'SMS delivery failed',
      };
    }
  }

  /**
   * Send SMS via Exotel API
   */
  private async sendViaExotel(phone: string, content: string): Promise<{ messageId: string }> {
    const url = `${this.exotelBaseUrl}/${this.exotelSid}/Sms/send.json`;
    
    const params = new URLSearchParams();
    params.append('From', this.fromNumber);
    params.append('To', phone);
    params.append('Body', content);
    params.append('StatusCallback', `${process.env.BASE_URL}/webhooks/exotel/sms/status`);

    const auth = Buffer.from(`${this.exotelSid}:${this.exotelToken}`).toString('base64');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Exotel SMS error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return { messageId: data.SMSMessage?.Sid || data.sid || `ex-${Date.now()}` };
  }

  /**
   * Validate Exotel webhook
   */
  validateWebhook(payload: unknown, signature?: string): boolean {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    const data = payload as any;
    // Exotel SMS webhooks have these fields
    return !!(data.From || data.FromNumber || data.SmsSid);
  }

  /**
   * Parse Exotel SMS webhook
   */
  parseWebhook(payload: unknown): {
    businessId: string;
    customerIdentifier: { phone: string };
    content: string;
    metadata: Record<string, any>;
  } | null {
    try {
      const data = payload as any;

      const phone = data.From || data.FromNumber;
      if (!phone) {
        logger.warn({ payload }, 'SMS webhook missing phone number');
        return null;
      }

      const content = data.Body || data.Text || data.Message || '';
      if (!content) {
        logger.warn({ payload }, 'SMS webhook missing content');
        return null;
      }

      return {
        businessId: data.businessId || this.extractBusinessId(data.To),
        customerIdentifier: { phone },
        content,
        metadata: {
          smsSid: data.SmsSid || data.sms_sid || data.MessageSid,
          to: data.To,
          from: data.From || data.FromNumber,
          numSegments: data.NumSegments || '1',
          status: data.Status || data.SmsStatus,
        },
      };
    } catch (error) {
      logger.error({ error, payload }, 'Failed to parse SMS webhook');
      return null;
    }
  }

  /**
   * Extract business ID from the "to" phone number
   * Each business has a dedicated number
   */
  private extractBusinessId(to: string): string {
    // Map of phone numbers to business IDs
    // In production, this comes from database
    const numberMapping: Record<string, string> = {
      [process.env.EXOTEL_PHONE_NUMBER || '']: 'default',
    };

    return numberMapping[to] || '';
  }

  /**
   * Format response for SMS
   * Short, concise, under 160 chars if possible
   */
  formatResponse(response: IAgentResponse): string {
    let formatted = response.content;

    // Remove markdown
    formatted = formatted
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/`/g, '')
      .replace(/#{1,6}\s/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // Truncate if too long (SMS costs increase with length)
    const maxLength = 320; // 2 SMS segments
    if (formatted.length > maxLength) {
      formatted = formatted.substring(0, maxLength - 3) + '...';
    }

    return formatted;
  }

  /**
   * Get cost estimate for SMS
   * ~$0.005 per segment
   */
  getCostEstimate(): number {
    return 0.005;
  }

  /**
   * Calculate SMS segments needed
   * - GSM-7: 160 chars per segment
   * - UCS-2 (Unicode): 70 chars per segment
   */
  private calculateSegments(text: string): number {
    // Check if text contains non-GSM characters
    const isUnicode = /[^\x00-\x7F\xA0-\xBF]/.test(text);
    
    if (isUnicode) {
      return Math.ceil(text.length / 70);
    }
    
    return Math.ceil(text.length / 160);
  }

  /**
   * Check if message fits in single SMS
   */
  fitsInSingleSms(text: string): boolean {
    return this.calculateSegments(text) === 1;
  }
}
