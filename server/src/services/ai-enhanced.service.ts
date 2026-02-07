import { db } from '@/config/database';
import { logger, logError, logPerformance } from '@/utils/logger';
import { openaiClient } from '@/utils/openai-client';
import { CircuitBreakers } from '@/utils/circuit-breaker';

/**
 * AI Service with Graceful Degradation
 * 
 * Production-ready AI service with:
 * - Timeout protection (15s)
 * - Circuit breaker integration
 * - Graceful degradation strategies
 * - Comprehensive error handling
 * - Fallback responses
 */

export class AIServiceEnhanced {
    private static openai = openaiClient;
    private static fallbackResponses = {
        greeting: "Hello! I'm here to help. Could you please tell me more about what you need?",
        error: "I apologize, but I'm having trouble processing your request right now. Our team has been notified and will assist you shortly.",
        timeout: "I'm taking a bit longer than expected to respond. Let me transfer you to a human agent who can help you immediately.",
        busy: "We're experiencing high demand right now. Please hold on for just a moment while I get your information.",
    };

    /**
     * Generate AI response with graceful degradation
     */
    static async generateResponse(
        context: string,
        query: string,
        metadata: {
            businessId: string;
            customerId?: string;
            conversationId?: string;
            channel?: string;
        }
    ): Promise<{
        content: string;
        fromCache: boolean;
        cost: number;
        model: string;
        needsHumanTransfer: boolean;
        degraded?: boolean;
    }> {
        const startTime = Date.now();

        try {
            // Strategy 1: Try primary AI model (GPT-4)
            const response = await this.tryPrimaryModel(context, query, metadata);

            logPerformance('ai.generate.primary', Date.now() - startTime, {
                businessId: metadata.businessId,
                model: response.model,
            });

            return response;
        } catch (primaryError: any) {
            logger.warn(
                { error: primaryError, businessId: metadata.businessId },
                'Primary AI model failed, attempting fallback'
            );

            try {
                // Strategy 2: Fallback to faster model (GPT-3.5)
                const response = await this.tryFallbackModel(context, query, metadata);

                logPerformance('ai.generate.fallback', Date.now() - startTime, {
                    businessId: metadata.businessId,
                    model: response.model,
                });

                return { ...response, degraded: true };
            } catch (fallbackError: any) {
                logger.error(
                    { error: fallbackError, businessId: metadata.businessId },
                    'Fallback AI model failed, using static response'
                );

                // Strategy 3: Static fallback response
                return this.getStaticFallback(primaryError, query);
            }
        }
    }

    /**
     * Try primary AI model (GPT-4)
     */
    private static async tryPrimaryModel(
        context: string,
        query: string,
        metadata: any
    ) {
        try {
            const completion = await this.openai.createChatCompletion({
                model: process.env.OPENAI_MODEL || 'gpt-4',
                messages: [
                    { role: 'system', content: context },
                    { role: 'user', content: query },
                ],
                temperature: 0.7,
                max_tokens: 500,
            }, {
                timeout: 15000,  // 15s timeout
                retries: 2,
            });

            const content = completion.choices[0]?.message?.content || '';
            const cost = this.calculateCost(completion.usage, 'gpt-4');

            return {
                content,
                fromCache: false,
                cost,
                model: 'gpt-4',
                needsHumanTransfer: this.detectTransferIntent(content),
            };
        } catch (error: any) {
            if (error.circuitBreakerOpen) {
                throw new Error('Circuit breaker open - service degraded');
            }
            throw error;
        }
    }

    /**
     * Try fallback model (GPT-3.5 - faster, cheaper)
     */
    private static async tryFallbackModel(
        context: string,
        query: string,
        metadata: any
    ) {
        const completion = await this.openai.createChatCompletion({
            model: 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: context },
                { role: 'user', content: query },
            ],
            temperature: 0.7,
            max_tokens: 300,
        }, {
            timeout: 10000,  // 10s timeout (faster model)
            retries: 1,
        });

        const content = completion.choices[0]?.message?.content || '';
        const cost = this.calculateCost(completion.usage, 'gpt-3.5-turbo');

        return {
            content,
            fromCache: false,
            cost,
            model: 'gpt-3.5-turbo',
            needsHumanTransfer: this.detectTransferIntent(content),
        };
    }

    /**
     * Get static fallback response when all AI models fail
     */
    private static getStaticFallback(error: any, query: string) {
        let fallbackType: keyof typeof this.fallbackResponses = 'error';

        // Determine appropriate fallback based on error
        if (error.message?.includes('timeout')) {
            fallbackType = 'timeout';
        } else if (error.message?.includes('Circuit breaker')) {
            fallbackType = 'busy';
        } else if (query.toLowerCase().match(/hello|hi|hey/)) {
            fallbackType = 'greeting';
        }

        return {
            content: this.fallbackResponses[fallbackType],
            fromCache: false,
            cost: 0,
            model: 'fallback',
            needsHumanTransfer: true,  // Always transfer when using fallback
            degraded: true,
        };
    }

    /**
     * Calculate cost based on token usage
     */
    private static calculateCost(usage: any, model: string): number {
        if (!usage) return 0;

        const prices: Record<string, { prompt: number; completion: number }> = {
            'gpt-4': { prompt: 0.03 / 1000, completion: 0.06 / 1000 },
            'gpt-3.5-turbo': { prompt: 0.0015 / 1000, completion: 0.002 / 1000 },
        };

        const modelPrices = prices[model] || prices['gpt-3.5-turbo'];

        return (
            usage.prompt_tokens * modelPrices.prompt +
            usage.completion_tokens * modelPrices.completion
        );
    }

    /**
     * Detect if AI wants to transfer to human
     */
    private static detectTransferIntent(content: string): boolean {
        const transferKeywords = [
            'transfer',
            'human agent',
            'speak to someone',
            'talk to a person',
            'representative',
        ];

        return transferKeywords.some((keyword) =>
            content.toLowerCase().includes(keyword)
        );
    }

    /**
     * Health check for AI service
     */
    static async healthCheck(): Promise<boolean> {
        try {
            return await this.openai.healthCheck();
        } catch {
            return false;
        }
    }
}
