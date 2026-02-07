/**
 * Model Router Service
 * Smart model selection with fallback strategies
 * 
 * Features:
 * - Cost-optimized model selection
 * - Query complexity analysis
 * - Automatic fallback on failures
 * - Token usage estimation
 * - Performance tracking
 */

import OpenAI from 'openai';
import { logger } from '@/utils/logger';
import { CostTrackerService } from '@/features/cost-control/cost-tracker.service';
import type { EnrichedContext } from './context-builder.service';
import { Channel } from '@prisma/client';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Model configurations
interface ModelConfig {
  id: string;
  name: string;
  inputPricePer1K: number;  // USD
  outputPricePer1K: number; // USD
  maxTokens: number;
  avgLatencyMs: number;
  capabilities: string[];
  recommendedFor: string[];
}

const MODELS: Record<string, ModelConfig> = {
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    inputPricePer1K: 0.00015,
    outputPricePer1K: 0.0006,
    maxTokens: 128000,
    avgLatencyMs: 500,
    capabilities: ['simple_qa', 'summarization', 'classification', 'entity_extraction'],
    recommendedFor: ['greetings', 'faqs', 'simple_queries', 'high_volume'],
  },
  'gpt-4o': {
    id: 'gpt-4o',
    name: 'GPT-4o',
    inputPricePer1K: 0.005,
    outputPricePer1K: 0.015,
    maxTokens: 128000,
    avgLatencyMs: 1000,
    capabilities: ['complex_reasoning', 'multistep', 'creative', 'analysis', 'coding'],
    recommendedFor: ['complex_queries', 'problem_solving', 'detailed_explanations'],
  },
  'gpt-4-turbo': {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    inputPricePer1K: 0.01,
    outputPricePer1K: 0.03,
    maxTokens: 128000,
    avgLatencyMs: 1500,
    capabilities: ['advanced_reasoning', 'research', 'complex_analysis', 'technical'],
    recommendedFor: ['critical_decisions', 'technical_support', 'research_queries'],
  },
};

export interface RoutingDecision {
  model: string;
  confidence: number;
  reasoning: string;
  estimatedCost: number;
  estimatedTokens: number;
  fallbackChain: string[];
}

export interface GenerationResult {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  cost: number;
  latencyMs: number;
  fromCache: boolean;
  attempts: number;
}

export class ModelRouterService {
  /**
   * Route a query to the most appropriate model
   */
  static routeQuery(
    query: string,
    context: EnrichedContext,
    channel: Channel,
    complexity?: 'AUTO' | 'SIMPLE' | 'MODERATE' | 'COMPLEX'
  ): RoutingDecision {
    const analysis = this.analyzeQuery(query, context);
    
    // Use provided complexity or auto-detect
    const queryComplexity = complexity === 'AUTO' || !complexity 
      ? analysis.complexity 
      : complexity;

    // Select model based on complexity and context
    let selectedModel: string;
    let confidence: number;
    let reasoning: string;

    switch (queryComplexity) {
      case 'SIMPLE':
        selectedModel = 'gpt-4o-mini';
        confidence = 0.95;
        reasoning = 'Simple query detected: greetings, FAQ, or short request';
        break;

      case 'MODERATE':
        // Use mini for voice (latency critical), 4o for others
        selectedModel = channel === Channel.VOICE ? 'gpt-4o-mini' : 'gpt-4o';
        confidence = 0.85;
        reasoning = 'Moderate complexity: requires some reasoning but not advanced';
        break;

      case 'COMPLEX':
        selectedModel = 'gpt-4o';
        confidence = 0.80;
        reasoning = 'Complex query: multi-step reasoning, analysis, or problem solving';
        break;

      default:
        selectedModel = 'gpt-4o-mini';
        confidence = 0.90;
        reasoning = 'Default to cost-effective model';
    }

    // Override based on business preferences
    if (context.business.config?.preferredModel) {
      selectedModel = context.business.config.preferredModel as string;
      reasoning += ' (overridden by business preference)';
    }

    // Calculate estimates
    const estimatedTokens = this.estimateTokens(query, context);
    const estimatedCost = this.calculateEstimatedCost(selectedModel, estimatedTokens);

    // Build fallback chain
    const fallbackChain = this.buildFallbackChain(selectedModel);

    logger.debug(
      {
        customerId: context.customer.id,
        selectedModel,
        complexity: queryComplexity,
        estimatedCost,
      },
      'Model routing decision'
    );

    return {
      model: selectedModel,
      confidence,
      reasoning,
      estimatedCost,
      estimatedTokens,
      fallbackChain,
    };
  }

  /**
   * Generate response with automatic fallback
   */
  static async generateWithFallback(
    systemPrompt: string,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    routingDecision: RoutingDecision,
    businessId: string,
    conversationId: string
  ): Promise<GenerationResult> {
    const startTime = Date.now();
    const modelsToTry = [routingDecision.model, ...routingDecision.fallbackChain];
    
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < modelsToTry.length; attempt++) {
      const model = modelsToTry[attempt];
      
      try {
        logger.debug(
          {
            model,
            attempt: attempt + 1,
            businessId,
          },
          'Attempting AI generation'
        );

        const completion = await openai.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages,
          ],
          temperature: 0.7,
          max_tokens: 500,
        });

        const latencyMs = Date.now() - startTime;
        const content = completion.choices[0].message.content || '';
        const usage = {
          promptTokens: completion.usage?.prompt_tokens || 0,
          completionTokens: completion.usage?.completion_tokens || 0,
          totalTokens: completion.usage?.total_tokens || 0,
        };

        // Calculate actual cost
        const cost = CostTrackerService.calculateGPTCost(
          model,
          usage.promptTokens,
          usage.completionTokens
        );

        // Log the cost
        await CostTrackerService.logAICost({
          businessId,
          conversationId,
          service: 'OPENAI_GPT',
          cost,
          tokensUsed: usage.totalTokens,
          model,
          metadata: {
            latencyMs,
            attempt: attempt + 1,
            fallbackUsed: attempt > 0,
          },
        });

        logger.info(
          {
            model,
            latencyMs,
            tokens: usage.totalTokens,
            cost,
            attempt: attempt + 1,
          },
          'AI generation successful'
        );

        return {
          content,
          model,
          usage,
          cost,
          latencyMs,
          fromCache: false,
          attempts: attempt + 1,
        };

      } catch (error) {
        lastError = error as Error;
        logger.error(
          {
            error,
            model,
            attempt: attempt + 1,
            businessId,
          },
          'AI generation failed, trying fallback'
        );

        // Continue to next model in chain
        if (attempt < modelsToTry.length - 1) {
          // Small delay before retry
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }

    // All models failed
    throw new Error(
      `All models failed. Last error: ${lastError?.message}`
    );
  }

  /**
   * Analyze query to determine complexity
   */
  private static analyzeQuery(
    query: string,
    context: EnrichedContext
  ): {
    complexity: 'SIMPLE' | 'MODERATE' | 'COMPLEX';
    indicators: string[];
  } {
    const lowerQuery = query.toLowerCase();
    const indicators: string[] = [];

    // Simple patterns
    const simplePatterns = [
      { pattern: /^(hi|hello|hey|good morning|good afternoon|good evening)/, label: 'greeting' },
      { pattern: /\b(hours?|time|open|close|location|address|phone|contact)\b/, label: 'basic_info' },
      { pattern: /^(thank|thanks|ok|okay|bye|goodbye|see you)/, label: 'closing' },
      { pattern: /^\d+$/, label: 'number_only' },
    ];

    // Complex patterns
    const complexPatterns = [
      { pattern: /\b(compare|difference between|vs|versus)\b/, label: 'comparison' },
      { pattern: /\b(why|how does|explain|what if|scenario)\b/, label: 'explanation' },
      { pattern: /\b(troubleshoot|fix|problem|issue|error|broken|not working)\b/, label: 'troubleshooting' },
      { pattern: /\b(recommend|suggest|best|option|choose|decide)\b/, label: 'recommendation' },
      { pattern: /\b(multiple|several|list|steps|process)\b/, label: 'multi_step' },
    ];

    // Check simple patterns
    for (const { pattern, label } of simplePatterns) {
      if (pattern.test(lowerQuery)) {
        indicators.push(label);
      }
    }

    // Check complex patterns
    for (const { pattern, label } of complexPatterns) {
      if (pattern.test(lowerQuery)) {
        indicators.push(label);
      }
    }

    // Length-based complexity
    if (query.length > 200) {
      indicators.push('long_query');
    }

    // Memory-based complexity
    if (context.relevantMemories.length >= 3) {
      indicators.push('rich_context');
    }

    // Determine complexity
    const hasComplexIndicators = indicators.some((i) =>
      ['comparison', 'explanation', 'troubleshooting', 'recommendation', 'multi_step'].includes(i)
    );

    const hasSimpleIndicators = indicators.some((i) =>
      ['greeting', 'basic_info', 'closing'].includes(i)
    );

    if (hasComplexIndicators || indicators.includes('long_query')) {
      return { complexity: 'COMPLEX', indicators };
    }

    if (hasSimpleIndicators && !hasComplexIndicators) {
      return { complexity: 'SIMPLE', indicators };
    }

    return { complexity: 'MODERATE', indicators };
  }

  /**
   * Estimate token count for a query
   */
  private static estimateTokens(query: string, context: EnrichedContext): number {
    // Rough estimate: 1 token ≈ 4 characters
    const queryTokens = Math.ceil(query.length / 4);
    
    // Add context tokens (system prompt, memories, etc.)
    let contextTokens = 500; // Base system prompt
    
    // Add recent messages
    contextTokens += context.recentMessages.length * 50;
    
    // Add relevant memories
    contextTokens += context.relevantMemories.length * 100;
    
    // Add output estimate
    const outputTokens = 150;
    
    return queryTokens + contextTokens + outputTokens;
  }

  /**
   * Calculate estimated cost for a model
   */
  private static calculateEstimatedCost(model: string, tokens: number): number {
    const config = MODELS[model];
    if (!config) {
      return 0;
    }

    // Assume 70% input, 30% output ratio
    const inputTokens = Math.floor(tokens * 0.7);
    const outputTokens = Math.floor(tokens * 0.3);

    const inputCost = (inputTokens / 1000) * config.inputPricePer1K;
    const outputCost = (outputTokens / 1000) * config.outputPricePer1K;

    return inputCost + outputCost;
  }

  /**
   * Build fallback chain for a model
   */
  private static buildFallbackChain(primaryModel: string): string[] {
    const chain: Record<string, string[]> = {
      'gpt-4-turbo': ['gpt-4o', 'gpt-4o-mini'],
      'gpt-4o': ['gpt-4o-mini'],
      'gpt-4o-mini': [], // No fallback from cheapest
    };

    return chain[primaryModel] || ['gpt-4o-mini'];
  }

  /**
   * Get model statistics for monitoring
   */
  static getModelStats(): Record<string, ModelConfig> {
    return MODELS;
  }

  /**
   * Calculate potential savings from smart routing
   */
  static calculateSavingsPotential(
    totalQueries: number,
    simplePercentage: number = 60
  ): {
    naiveCost: number;
    optimizedCost: number;
    savings: number;
    savingsPercent: number;
  } {
    const simpleQueries = Math.floor(totalQueries * (simplePercentage / 100));
    const complexQueries = totalQueries - simpleQueries;

    // Naive: Use GPT-4o for everything
    const gpt4oCostPerQuery = 0.002; // Average cost per query
    const naiveCost = totalQueries * gpt4oCostPerQuery;

    // Optimized: Use mini for simple, 4o for complex
    const miniCostPerQuery = 0.0002;
    const optimizedCost = (simpleQueries * miniCostPerQuery) + (complexQueries * gpt4oCostPerQuery);

    const savings = naiveCost - optimizedCost;
    const savingsPercent = (savings / naiveCost) * 100;

    return {
      naiveCost: Math.round(naiveCost * 100) / 100,
      optimizedCost: Math.round(optimizedCost * 100) / 100,
      savings: Math.round(savings * 100) / 100,
      savingsPercent: Math.round(savingsPercent * 10) / 10,
    };
  }
}
