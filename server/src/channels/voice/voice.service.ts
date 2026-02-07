import type { IChannelAdapter, IChannelConfig, IWebhookPayload } from '../base/channel.types';
import { Channel, IAgentResponse } from '@/types/channel.types';
import { logger } from '@/utils/logger';
import { CostTrackerService } from '@/features/cost-control/cost-tracker.service';
import { BudgetService } from '@/features/cost-control/budget.service';

/**
 * Voice Service - Exotel Integration for Phone Calls
 * 
 * Handles:
 * - Incoming call webhooks from Exotel
 * - Outgoing call initiation
 * - Call status tracking
 * - Integration with Vocode voice bridge
 */
export class VoiceService implements IChannelAdapter {
  readonly channel: Channel = Channel.VOICE;
  
  private exotelSid: string;
  private exotelToken: string;
  private exotelBaseUrl: string;

  constructor() {
    this.exotelSid = process.env.EXOTEL_SID || '';
    this.exotelToken = process.env.EXOTEL_TOKEN || '';
    this.exotelBaseUrl = 'https://api.exotel.com/v1/Accounts';
  }

  /**
   * Send an outgoing call (initiate call to customer)
   * Used for proactive campaigns or callbacks
   */
  async sendMessage(
    customerIdentifier: { phone?: string },
    content: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      if (!customerIdentifier.phone) {
        throw new Error('Phone number required for voice calls');
      }

      const businessId = metadata?.businessId;
      if (!businessId) {
        throw new Error('Business ID required');
      }

      // Check budget before making expensive call
      const budgetCheck = await BudgetService.hasBudgetAvailable(businessId, 0.02); // ~$0.02/min estimate
      if (!budgetCheck.allowed) {
        logger.warn({ businessId }, 'Voice call blocked: budget exceeded');
        return { success: false, error: 'Budget exceeded' };
      }

      // Initiate call via Exotel
      const callResponse = await this.initiateExotelCall(
        customerIdentifier.phone,
        metadata
      );

      // Log cost
      await CostTrackerService.logExternalCost({
        businessId,
        customerId: metadata?.customerId,
        conversationId: metadata?.conversationId,
        service: 'EXOTEL_VOICE',
        cost: 0.02, // Base cost for call initiation
        channel: this.channel,
        metadata: {
          to: customerIdentifier.phone,
          callSid: callResponse.callSid,
        },
      });

      logger.info(
        { 
          businessId, 
          phone: customerIdentifier.phone,
          callSid: callResponse.callSid 
        },
        'Outgoing voice call initiated'
      );

      return {
        success: true,
        messageId: callResponse.callSid,
      };
    } catch (error) {
      logger.error({ error, phone: customerIdentifier.phone }, 'Failed to initiate voice call');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Call initiation failed',
      };
    }
  }

  /**
   * Initiate call through Exotel API
   */
  private async initiateExotelCall(
    phone: string,
    metadata?: Record<string, any>
  ): Promise<{ callSid: string }> {
    const url = `${this.exotelBaseUrl}/${this.exotelSid}/Calls/connect.json`;
    
    const params = new URLSearchParams();
    params.append('From', phone);
    params.append('CallerId', process.env.EXOTEL_PHONE_NUMBER || '');
    params.append('Url', `${process.env.BASE_URL}/api/voice/bridge`); // Vocode bridge endpoint
    params.append('StatusCallback', `${process.env.BASE_URL}/webhooks/exotel/voice/status`);
    params.append('CustomField', JSON.stringify(metadata));

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
      throw new Error(`Exotel API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return { callSid: data.Call?.Sid || data.sid };
  }

  /**
   * Validate incoming Exotel webhook
   * Exotel doesn't use signatures, we validate by IP whitelist or token
   */
  validateWebhook(payload: unknown, signature?: string): boolean {
    // Exotel webhooks don't have signatures by default
    // In production, validate by source IP or add custom token
    if (payload && typeof payload === 'object') {
      const p = payload as any;
      // Basic validation - ensure required fields exist
      return !!(p.CallSid || p.call_sid);
    }
    return false;
  }

  /**
   * Parse Exotel webhook payload
   */
  parseWebhook(payload: unknown): {
    businessId: string;
    customerIdentifier: { phone: string };
    content: string;
    metadata: Record<string, any>;
  } | null {
    try {
      const data = payload as any;
      
      // Extract phone number
      const phone = data.From || data.FromNumber || data.CallerId;
      if (!phone) {
        logger.warn({ payload }, 'Voice webhook missing phone number');
        return null;
      }

      // Parse custom field for metadata (contains businessId, customerId, etc.)
      let customField: { businessId?: string; customerId?: string; conversationId?: string } = {};
      try {
        if (data.CustomField) {
          customField = JSON.parse(data.CustomField);
        }
      } catch (e) {
        // Ignore parse errors
      }

      return {
        businessId: customField.businessId || data.businessId,
        customerIdentifier: { phone },
        content: data.SpeechResult || data.TranscriptionText || '', // From Vocode/Exotel
        metadata: {
          callSid: data.CallSid || data.call_sid,
          status: data.Status || data.CallStatus,
          duration: data.Duration || data.CallDuration,
          recordingUrl: data.RecordingUrl,
          ...customField,
        },
      };
    } catch (error) {
      logger.error({ error, payload }, 'Failed to parse voice webhook');
      return null;
    }
  }

  /**
   * Format response for voice channel
   * Voice responses should be natural, conversational, and concise
   */
  formatResponse(response: IAgentResponse): string {
    let formatted = response.content;

    // Remove markdown formatting (not natural for voice)
    formatted = formatted
      .replace(/\*\*/g, '') // Bold
      .replace(/\*/g, '')   // Italic
      .replace(/`/g, '')    // Code
      .replace(/#{1,6}\s/g, '') // Headers
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links -> just text
      .replace(/\n{3,}/g, '\n\n'); // Normalize newlines

    // Add pauses for better speech flow (SSML-style for Azure TTS)
    // Convert natural punctuation to slight pauses
    formatted = formatted
      .replace(/\.\s+/g, '. <break time=\"300ms\"/> ')
      .replace(/,\s+/g, ', <break time=\"150ms\"/> ');

    // Limit length for voice (keep it conversational)
    if (formatted.length > 500) {
      // Find a good breaking point
      const breakPoint = formatted.lastIndexOf('. ', 500);
      if (breakPoint > 200) {
        formatted = formatted.substring(0, breakPoint + 1);
      }
    }

    return formatted;
  }

  /**
   * Get cost estimate for voice calls
   * ~$0.02 per minute (Exotel + Azure TTS)
   */
  getCostEstimate(): number {
    return 0.02;
  }

  /**
   * Get call recording from Exotel
   */
  async getRecording(callSid: string): Promise<{
    url: string;
    duration: number;
  } | null> {
    try {
      const url = `${this.exotelBaseUrl}/${this.exotelSid}/Calls/${callSid}.json`;
      
      const auth = Buffer.from(`${this.exotelSid}:${this.exotelToken}`).toString('base64');
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Basic ${auth}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch recording: ${response.status}`);
      }

      const data = await response.json();
      return {
        url: data.Call?.RecordingUrl,
        duration: parseInt(data.Call?.Duration) || 0,
      };
    } catch (error) {
      logger.error({ error, callSid }, 'Failed to get call recording');
      return null;
    }
  }
}
