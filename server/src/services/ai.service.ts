import OpenAI from 'openai';
import { MemoryService } from '@/features/memory/memory.service';
import { SemanticCacheService } from '@/features/cache/semantic-cache.service';
import { CostTrackerService } from '@/features/cost-control/cost-tracker.service';
import { db } from '@/config/database';
import type { IConversationContext } from '@/types/channel.types';
import { logger } from '@/utils/logger';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/**
 * AI Orchestrator - Context assembly and LLM interaction
 * 
 * Enhanced with:
 * - Semantic cache integration (cost optimization)
 * - Cost tracking for every AI call
 * - Model routing (use cheaper models for simple queries)
 */
export class AIService {
    /**
     * Build complete conversation context for AI
     */
    static async buildContext(
        customerId: string,
        businessId: string,
        conversationId: string,
        currentQuery: string,
    ): Promise<IConversationContext> {
        // Fetch in parallel
        const [customer, business, recentMessages, relevantMemories] =
            await Promise.all([
                db.customer.findUnique({
                    where: { id: customerId },
                    select: {
                        id: true,
                        name: true,
                        phone: true,
                        email: true,
                        preferences: true,
                        trustScore: true,
                        isVerified: true,
                    },
                }),
                db.business.findUnique({
                    where: { id: businessId },
                    select: {
                        id: true,
                        name: true,
                        config: true,
                    },
                }),
                MemoryService.getRecentContext(conversationId, 10),
                MemoryService.searchMemories(customerId, currentQuery, 3),
            ]);

        if (!customer || !business) {
            throw new Error('Customer or Business not found');
        }

        return {
            customer: {
                id: customer.id,
                name: customer.name || undefined,
                phone: customer.phone || undefined,
                email: customer.email || undefined,
                preferences: (customer.preferences as any) || undefined,
                trustScore: customer.trustScore,
                isVerified: customer.isVerified,
            },
            recentMessages: recentMessages.map((m) => ({
                role: m.role as any,
                content: m.content,
                timestamp: m.timestamp,
            })),
            relevantMemories: relevantMemories.map((m) => ({
                content: m.content,
                source: m.source,
                createdAt: m.createdAt,
            })),
            business: {
                id: business.id,
                name: business.name,
                config: (business.config as any) || undefined,
            },
        };
    }

    /**
     * Generate AI response with full context
     * 
     * Enhanced with:
     * - Semantic cache check
     * - Cost tracking
     * - Response caching
     */
    static async generateResponse(
        context: IConversationContext,
        userMessage: string,
        params: {
            businessId: string;
            customerId: string;
            conversationId: string;
            channel: string;
        }
    ): Promise<{
        content: string;
        needsHumanTransfer: boolean;
        fromCache: boolean;
        cost: number;
        model: string;
    }> {
        try {
            // Step 1: Check semantic cache first
            const cacheResult = await SemanticCacheService.getCachedResponse({
                businessId: params.businessId,
                query: userMessage,
                customerId: params.customerId,
                channel: params.channel as any,
            });

            if (cacheResult.hit && cacheResult.response) {
                logger.info(
                    {
                        customerId: params.customerId,
                        cacheSource: cacheResult.source,
                        similarity: cacheResult.similarity,
                    },
                    'AI response served from cache'
                );

                return {
                    content: cacheResult.response,
                    needsHumanTransfer: false,
                    fromCache: true,
                    cost: cacheResult.cachedEmbeddingCost || 0,
                    model: 'cache',
                };
            }

            // Step 2: Get business configuration for tier settings
            const business = await db.business.findUnique({
                where: { id: params.businessId },
                select: {
                    aiModel: true,
                    defaultLanguage: true,
                    supportedLanguages: true
                }
            });

            // Step 3: Use admin-configured model (or fallback)
            const model = business?.aiModel || 'gpt-4o-mini';
            const language = business?.defaultLanguage || 'en';

            // Step 4: Build system prompt with context and language
            const systemPrompt = this.buildSystemPrompt(context, language);

            // Step 5: Build messages array
            const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
                { role: 'system', content: systemPrompt },
                ...context.recentMessages.map((m) => ({
                    role: m.role.toLowerCase() as 'user' | 'assistant',
                    content: m.content,
                })),
                { role: 'user', content: userMessage },
            ];

            // Step 6: Call OpenAI with business-configured model
            const completionStart = Date.now();
            const completion = await openai.chat.completions.create({
                model,
                messages,
                temperature: 0.7,
                max_tokens: 500,
            });
            const completionTime = Date.now() - completionStart;

            const responseContent = completion.choices[0].message.content || '';

            // Step 7: Calculate cost
            const inputTokens = completion.usage?.prompt_tokens || 0;
            const outputTokens = completion.usage?.completion_tokens || 0;
            const cost = CostTrackerService.calculateGPTCost(model, inputTokens, outputTokens);

            // Step 8: Log cost
            await CostTrackerService.logAICost({
                businessId: params.businessId,
                customerId: params.customerId,
                conversationId: params.conversationId,
                service: 'OPENAI_GPT',
                cost,
                tokensUsed: inputTokens + outputTokens,
                model,
                channel: params.channel as any,
                metadata: {
                    inputTokens,
                    outputTokens,
                    completionTimeMs: completionTime,
                    cachedResponse: false,
                    language,
                },
            });

            // Step 9: Cache the response
            await SemanticCacheService.cacheResponse({
                businessId: params.businessId,
                query: userMessage,
                response: responseContent,
                customerId: params.customerId,
                channel: params.channel as any,
                aiCost: cost,
            });

            // Step 10: Detect human transfer need
            const needsHumanTransfer = this.detectHumanTransferNeed(responseContent);

            logger.info(
                {
                    customerId: params.customerId,
                    model,
                    language,
                    tokens: completion.usage?.total_tokens,
                    cost,
                    completionTimeMs: completionTime,
                },
                'AI response generated'
            );

            return {
                content: responseContent,
                needsHumanTransfer,
                fromCache: false,
                cost,
                model,
            };
        } catch (error) {
            logger.error({ error }, 'AI generation failed');
            throw error;
        }
    }

    /**
     * Generate embedding for a text
     */
    static async generateEmbedding(text: string): Promise<number[]> {
        const response = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: text,
        });

        return response.data[0].embedding;
    }

    /**
     * Build context-rich system prompt with language support
     */
    private static buildSystemPrompt(context: IConversationContext, language: string = 'en'): string {
        const { customer, business, relevantMemories } = context;

        // Language-specific instructions
        const languageInstructions: Record<string, string> = {
            en: 'Respond in English.',
            hi: 'Respond in Hindi (हिन्दी). Use Devanagari script. Be culturally appropriate for Indian context.',
            es: 'Respond in Spanish (Español).',
            fr: 'Respond in French (Français).',
            ar: 'Respond in Arabic (العربية). Use Arabic script.',
            zh: 'Respond in Simplified Chinese (简体中文).',
            de: 'Respond in German (Deutsch).',
            pt: 'Respond in Portuguese (Português).',
            ru: 'Respond in Russian (Русский).',
            ja: 'Respond in Japanese (日本語).',
        };

        let prompt = `You are an AI assistant for ${business.name}.\n`;

        // Add language instruction
        prompt += `${languageInstructions[language] || languageInstructions.en}\n`;

        // Add customer context
        if (customer.name) {
            prompt += `\nYou are currently helping ${customer.name}.`;
        }

        // Add trust level context
        if (!customer.isVerified) {
            prompt += `\n\nNote: This customer is new and not yet verified. Be helpful but cautious about sensitive operations.`;
        }

        // Add relevant memories
        if (relevantMemories.length > 0) {
            prompt += `\n\nRelevant past interactions:`;
            relevantMemories.forEach((mem, i) => {
                prompt += `\n${i + 1}. ${mem.content}`;
            });
        }

        // Add business-specific config
        if (business.config) {
            const config = business.config as any;
            if (config.customPrompt) {
                prompt += `\n\n${config.customPrompt}`;
            }
            if (config.tone) {
                prompt += `\n\nTone: ${config.tone}`;
            }
        }

        prompt += `\n\nBe helpful, concise, and reference past interactions when relevant. If you cannot help, say "I need to transfer you to a human agent."`;

        return prompt;
    }

    /**
     * Detect if response indicates need for human transfer
     */
    private static detectHumanTransferNeed(response: string): boolean {
        const transferIndicators = [
            'transfer to human',
            'transfer you to',
            'connect you with',
            'human agent',
            'specialist',
            'unable to help',
            "can't help",
            'beyond my capabilities',
        ];

        const lowerResponse = response.toLowerCase();
        return transferIndicators.some(indicator => lowerResponse.includes(indicator));
    }

    /**
     * Get cache statistics for monitoring
     */
    static getCacheStats(): {
        hits: number;
        misses: number;
        hitRate: number;
        l1Size: number;
    } {
        return SemanticCacheService.getStats();
    }
}
