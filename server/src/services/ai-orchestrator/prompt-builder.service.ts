/**
 * Prompt Builder Service
 * Dynamic prompt engineering for AI responses
 * 
 * Features:
 * - Dynamic system prompts based on context
 * - Business-specific customization
 * - Tone and personality adjustment
 * - Context-aware instructions
 * - Multi-language support preparation
 */

import { logger } from '@/utils/logger';
import type { EnrichedContext } from './context-builder.service';
import { Channel } from '@prisma/client';

export interface PromptBuildOptions {
  context: EnrichedContext;
  userMessage: string;
  channel: Channel;
  intent?: string;
  urgency?: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  language?: string;
}

export interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
  presencePenalty: number;
  frequencyPenalty: number;
}

export class PromptBuilderService {
  /**
   * Build complete prompt configuration for AI
   */
  static buildPrompt(options: PromptBuildOptions): BuiltPrompt {
    const { context, userMessage, channel, urgency = 'NORMAL' } = options;

    try {
      const systemPrompt = this.buildSystemPrompt(context, channel);
      const userPrompt = this.buildUserPrompt(userMessage, context);
      const parameters = this.getModelParameters(channel, urgency, context.customer.isVerified);

      logger.debug(
        {
          customerId: context.customer.id,
          channel,
          urgency,
          temperature: parameters.temperature,
        },
        'Prompt built successfully'
      );

      return {
        systemPrompt,
        userPrompt,
        ...parameters,
      };
    } catch (error) {
      logger.error({ error, customerId: context.customer.id }, 'Failed to build prompt');
      throw error;
    }
  }

  /**
   * Build system prompt with full context
   */
  private static buildSystemPrompt(context: EnrichedContext, channel: Channel): string {
    const parts: string[] = [];

    // Identity
    parts.push(this.buildIdentitySection(context));

    // Customer Context
    parts.push(this.buildCustomerContextSection(context));

    // Conversation History
    parts.push(this.buildHistorySection(context));

    // Relevant Memories
    parts.push(this.buildMemoriesSection(context));

    // Business Rules & Guidelines
    parts.push(this.buildBusinessRulesSection(context));

    // Channel-Specific Instructions
    parts.push(this.buildChannelInstructions(channel));

    // Response Guidelines
    parts.push(this.buildResponseGuidelines(context, channel));

    // Safety & Escalation
    parts.push(this.buildSafetySection(context));

    return parts.filter(Boolean).join('\n\n');
  }

  /**
   * Build identity section
   */
  private static buildIdentitySection(context: EnrichedContext): string {
    const { business } = context;
    let identity = `You are an AI assistant for ${business.name}.`;

    if (business.industry) {
      identity += ` You specialize in helping customers in the ${business.industry} industry.`;
    }

    // Add custom personality if configured
    if (business.config?.personality) {
      identity += ` ${business.config.personality}`;
    }

    return identity;
  }

  /**
   * Build customer context section
   */
  private static buildCustomerContextSection(context: EnrichedContext): string {
    const { customer, customerMetrics } = context;
    const parts: string[] = [];

    if (customer.name) {
      parts.push(`You are helping ${customer.name}.`);
    }

    // Trust level indication
    if (!customer.isVerified) {
      parts.push('This is a new customer who has not been verified yet. Be helpful but cautious about sensitive operations or sharing confidential information.');
    } else if (customer.trustScore >= 80) {
      parts.push('This is a trusted, long-term customer.');
    }

    // Customer history
    if (customerMetrics.totalConversations > 5) {
      parts.push(`They have interacted with us ${customerMetrics.totalConversations} times before.`);
    }

    // Customer preferences
    if (customer.preferences) {
      const prefs = Object.entries(customer.preferences)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ');
      if (prefs) {
        parts.push(`Customer preferences: ${prefs}`);
      }
    }

    // Tags
    if (customer.tags && customer.tags.length > 0) {
      parts.push(`Customer tags: ${customer.tags.join(', ')}`);
    }

    return parts.length > 0 ? `CUSTOMER CONTEXT:\n${parts.join('\n')}` : '';
  }

  /**
   * Build conversation history section
   */
  private static buildHistorySection(context: EnrichedContext): string {
    const { recentMessages, session } = context;

    if (recentMessages.length === 0) {
      return '';
    }

    const parts: string[] = [];
    parts.push('RECENT CONVERSATION:');

    recentMessages.forEach((msg) => {
      const role = msg.role === 'USER' ? 'Customer' : 'Assistant';
      parts.push(`${role}: ${msg.content}`);
    });

    if (session.messageCount > recentMessages.length) {
      parts.push(`(This conversation has ${session.messageCount} total messages)`);
    }

    return parts.join('\n');
  }

  /**
   * Build relevant memories section
   */
  private static buildMemoriesSection(context: EnrichedContext): string {
    const { relevantMemories } = context;

    if (relevantMemories.length === 0) {
      return '';
    }

    const parts: string[] = [];
    parts.push('RELEVANT PAST INFORMATION:');

    relevantMemories.forEach((memory, index) => {
      let line = `${index + 1}. ${memory.content}`;
      if (memory.source) {
        line += ` (from ${memory.source})`;
      }
      parts.push(line);
    });

    return parts.join('\n');
  }

  /**
   * Build business rules section
   */
  private static buildBusinessRulesSection(context: EnrichedContext): string {
    const { business, businessRules } = context;
    const parts: string[] = [];

    // Custom business instructions
    if (business.config?.customPrompt) {
      parts.push(`BUSINESS SPECIFIC INSTRUCTIONS:\n${business.config.customPrompt}`);
    }

    // Operating hours
    if (businessRules.operatingHours) {
      parts.push(`Operating Hours: ${businessRules.operatingHours}`);
    }

    // Prohibited topics
    if (businessRules.prohibitedTopics && businessRules.prohibitedTopics.length > 0) {
      parts.push(`NEVER discuss these topics: ${businessRules.prohibitedTopics.join(', ')}`);
    }

    return parts.join('\n');
  }

  /**
   * Build channel-specific instructions
   */
  private static buildChannelInstructions(channel: Channel): string {
    const instructions: Record<Channel, string> = {
      [Channel.VOICE]: `CHANNEL: Voice Call
- Keep responses concise (under 30 seconds when spoken)
- Use natural, conversational language
- Avoid lists with more than 3 items
- Ask one question at a time
- Confirm understanding before proceeding`,

      [Channel.CHAT]: `CHANNEL: Web Chat
- You can use formatting (bullet points, short paragraphs)
- Be conversational but efficient
- Use emojis sparingly and appropriately
- Keep responses to 2-3 short paragraphs`,

      [Channel.EMAIL]: `CHANNEL: Email
- Use proper email formatting
- Include greeting and sign-off
- Be thorough but concise
- Use professional language`,

      [Channel.SMS]: `CHANNEL: SMS/Text
- EXTREMELY concise (under 160 characters if possible)
- No formatting, plain text only
- Break long responses into multiple messages
- Be direct and clear`,

      [Channel.WHATSAPP]: `CHANNEL: WhatsApp
- Can use light formatting
- Use emojis appropriately
- Keep to 1-2 short paragraphs
- Friendly, casual tone`,

      [Channel.TELEGRAM]: `CHANNEL: Telegram
- Support markdown formatting
- Can use emojis
- 1-2 paragraphs maximum
- Clear and direct`,

      [Channel.INSTAGRAM]: `CHANNEL: Instagram DM
- Casual, friendly tone
- Short, punchy responses
- Emoji-friendly
- Trendy but professional`,
    };

    return instructions[channel] || instructions[Channel.CHAT];
  }

  /**
   * Build response guidelines
   */
  private static buildResponseGuidelines(context: EnrichedContext, channel: Channel): string {
    const parts: string[] = [];
    parts.push('RESPONSE GUIDELINES:');

    // Tone
    const tone = context.business.config?.tone || 'professional and helpful';
    parts.push(`- Tone: ${tone}`);

    // General guidelines
    parts.push('- Be helpful, accurate, and concise');
    parts.push('- If unsure, say "I\'ll need to check on that" rather than guessing');
    parts.push('- Reference previous conversations when relevant');
    parts.push('- Address the customer by name when appropriate');

    // Channel-specific length guidelines
    const lengthLimits: Record<Channel, string> = {
      [Channel.VOICE]: '- Maximum 3 sentences per response',
      [Channel.CHAT]: '- Maximum 3 short paragraphs',
      [Channel.EMAIL]: '- Maximum 5 paragraphs, use proper formatting',
      [Channel.SMS]: '- Maximum 2 sentences, under 300 characters',
      [Channel.WHATSAPP]: '- Maximum 2 paragraphs',
      [Channel.TELEGRAM]: '- Maximum 2 paragraphs',
      [Channel.INSTAGRAM]: '- Maximum 2 short sentences',
    };
    parts.push(lengthLimits[channel] || lengthLimits[Channel.CHAT]);

    return parts.join('\n');
  }

  /**
   * Build safety and escalation section
   */
  private static buildSafetySection(context: EnrichedContext): string {
    const parts: string[] = [];
    parts.push('SAFETY & ESCALATION:');

    parts.push('- If the customer expresses anger, frustration, or urgency, acknowledge their feelings');
    parts.push('- If you cannot help, say "I need to transfer you to a human agent"');
    parts.push('- Never share sensitive customer data with other customers');
    parts.push('- Do not make promises or commitments on behalf of the business');
    parts.push('- If asked about pricing, quote only what is in your knowledge base');

    // Escalation triggers
    if (context.businessRules.escalationTriggers && context.businessRules.escalationTriggers.length > 0) {
      parts.push(`- ESCALATE IMMEDIATELY if customer mentions: ${context.businessRules.escalationTriggers.join(', ')}`);
    }

    return parts.join('\n');
  }

  /**
   * Build user prompt
   */
  private static buildUserPrompt(userMessage: string, context: EnrichedContext): string {
    // Simple pass-through for now, can be enhanced with:
    // - Intent clarification
    // - Query rewriting
    // - Context injection
    return userMessage;
  }

  /**
   * Get model parameters based on context
   */
  private static getModelParameters(
    channel: Channel,
    urgency: string,
    isVerified: boolean
  ): {
    temperature: number;
    maxTokens: number;
    presencePenalty: number;
    frequencyPenalty: number;
  } {
    // Temperature: Lower = more deterministic, Higher = more creative
    let temperature = 0.7;

    // Voice calls need more consistent, predictable responses
    if (channel === Channel.VOICE) {
      temperature = 0.5;
    }

    // Urgent matters need focused responses
    if (urgency === 'HIGH' || urgency === 'CRITICAL') {
      temperature = 0.4;
    }

    // Max tokens based on channel
    const maxTokens: Record<Channel, number> = {
      [Channel.VOICE]: 150,    // ~30 seconds spoken
      [Channel.CHAT]: 300,     // ~2-3 paragraphs
      [Channel.EMAIL]: 800,    // Full email
      [Channel.SMS]: 100,      // Short text
      [Channel.WHATSAPP]: 250, // 1-2 paragraphs
      [Channel.TELEGRAM]: 250, // 1-2 paragraphs
      [Channel.INSTAGRAM]: 150, // Short, punchy
    };

    return {
      temperature,
      maxTokens: maxTokens[channel] || 300,
      presencePenalty: 0.1,  // Slight penalty for repeating topics
      frequencyPenalty: 0.1, // Slight penalty for repeating phrases
    };
  }

  /**
   * Build simplified prompt for cache warming (no dynamic context)
   */
  static buildStaticPrompt(
    businessName: string,
    industry?: string,
    customInstructions?: string
  ): string {
    let prompt = `You are an AI assistant for ${businessName}.`;

    if (industry) {
      prompt += ` You specialize in the ${industry} industry.`;
    }

    prompt += '\n\nBe helpful, concise, and professional.';
    prompt += '\nProvide accurate information and acknowledge when you need to transfer to a human agent.';

    if (customInstructions) {
      prompt += `\n\n${customInstructions}`;
    }

    return prompt;
  }
}
