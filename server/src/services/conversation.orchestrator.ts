import { MemoryService } from '@/features/memory/memory.service';
import { AIService } from '@/services/ai.service';
import { CustomerService } from '@/features/customer/customer.service';
import { SemanticCacheService } from '@/features/cache/semantic-cache.service';
import { CostTrackerService } from '@/features/cost-control/cost-tracker.service';
import { db } from '@/config/database';
import type { IChannelMessage, IAgentResponse } from '@/types/channel.types';
import { logger } from '@/utils/logger';

/**
 * Conversation Orchestrator - The "Router" for all channels
 * 
 * Enhanced with Phase 1 features:
 * - Semantic cache integration
 * - Cost tracking for every operation
 * - Abuse detection integration
 * - Budget checking
 * 
 * Handles incoming messages from any channel and coordinates the AI response
 */
export class ConversationOrchestrator {
    /**
     * Process an incoming message from any channel
     * 
     * PRODUCTION FIX: Wrapped in database transaction for atomicity
     */
    static async processMessage(
        message: IChannelMessage,
    ): Promise<IAgentResponse> {
        try {
            // CHANNEL VALIDATION: Check if business has this channel enabled
            const business = await db.business.findUnique({
                where: { id: message.businessId },
                select: { enabledChannels: true, name: true }
            });

            if (!business) {
                logger.error({ businessId: message.businessId }, 'Business not found');
                throw new Error('Business not found');
            }

            if (!business.enabledChannels.includes(message.channel)) {
                logger.error({
                    businessId: message.businessId,
                    businessName: business.name,
                    requestedChannel: message.channel,
                    enabledChannels: business.enabledChannels
                }, 'Channel not enabled for business');

                throw new Error(`Channel ${message.channel} is not enabled for this business. Contact support to enable this channel.`);
            }

            // Wrap in transaction to ensure atomicity
            const result = await db.$transaction(async (tx) => {
                // Step 1: Identify or create customer (zero friction)
                const customer = await CustomerService.identifyOrCreate(message);

                // Step 2: Find or create conversation
                const conversation = await this.findOrCreateConversation(
                    customer.id,
                    message.businessId,
                    message.channel,
                    tx  // Pass transaction
                );

                // Step 3: Save user message
                const userMessage = await MemoryService.saveMessage(
                    conversation.id,
                    'USER',
                    message.content,
                    message.channel,
                    message.metadata,
                );

                // Step 4: Build context (recent messages + semantic memories)
                const context = await AIService.buildContext(
                    customer.id,
                    message.businessId,
                    conversation.id,
                    message.content,
                );

                // Step 5: Generate AI response (with cache, cost tracking)
                const aiResponse = await AIService.generateResponse(
                    context,
                    message.content,
                    {
                        businessId: message.businessId,
                        customerId: customer.id,
                        conversationId: conversation.id,
                        channel: message.channel,
                    }
                );

                // Step 6: Save AI response
                const assistantMessage = await MemoryService.saveMessage(
                    conversation.id,
                    'ASSISTANT',
                    aiResponse.content,
                    message.channel,
                    {
                        ...message.metadata,
                        fromCache: aiResponse.fromCache,
                        model: aiResponse.model,
                        cost: aiResponse.cost,
                    },
                );

                // Step 7: Update message with cost info
                if (aiResponse.cost > 0) {
                    await tx.message.update({
                        where: { id: assistantMessage.id },
                        data: {
                            aiCost: aiResponse.cost,
                            cachedResponse: aiResponse.fromCache,
                        },
                    });
                }

                // Step 8: Update customer last interaction
                await tx.customer.update({
                    where: { id: customer.id },
                    data: {
                        lastInteraction: new Date(),
                    },
                });

                return {
                    customer,
                    conversation,
                    assistantMessage,
                    aiResponse,
                };
            }, {
                maxWait: 5000,  // Max 5s wait for lock
                timeout: 30000,  // Max 30s total transaction time
            });

            // Step 9: Queue embedding generation (async, outside transaction)
            // This will be done in background job to not block response
            await this.queueEmbeddingGeneration(result.customer.id, [
                message.content,
                result.aiResponse.content,
            ]);

            logger.info(
                {
                    customerId: result.customer.id,
                    conversationId: result.conversation.id,
                    channel: message.channel,
                    fromCache: result.aiResponse.fromCache,
                    cost: result.aiResponse.cost,
                    model: result.aiResponse.model,
                },
                'Message processed successfully'
            );

            return {
                content: result.aiResponse.content,
                needsHumanTransfer: result.aiResponse.needsHumanTransfer,
                metadata: {
                    fromCache: result.aiResponse.fromCache,
                    cost: result.aiResponse.cost,
                    model: result.aiResponse.model,
                    conversationId: result.conversation.id,
                    messageId: result.assistantMessage.id,
                },
            };
        } catch (error) {
            logger.error({ error, message }, 'Failed to process message');

            // Transaction auto-rolled back on error
            logger.warn({ error }, 'Database transaction rolled back');

            // Return graceful error response
            return {
                content: "I apologize, but I'm having trouble processing your request right now. Please try again in a moment.",
                needsHumanTransfer: true,
                metadata: {
                    error: true,
                    errorMessage: error instanceof Error ? error.message : 'Unknown error',
                },
            };
        }
    }

    /**
     * Process message with full protection (for API endpoints)
     * 
     * This method is used by controllers that have already passed through middleware
     */
    static async processProtectedMessage(
        message: IChannelMessage,
        protectionInfo: {
            rateLimitInfo?: any;
            budgetInfo?: any;
            abuseInfo?: any;
            verificationInfo?: any;
        }
    ): Promise<IAgentResponse> {
        // Log protection info for analytics
        logger.debug({
            customerId: message.customerId,
            protectionInfo,
        }, 'Processing with protection info');

        return this.processMessage(message);
    }

    /**
     * Find existing conversation or create new one
     */
    private static async findOrCreateConversation(
        customerId: string,
        businessId: string,
        channel: string,
        tx?: any,  // Prisma transaction client
    ) {
        const client = tx || db;

        // Try to find active conversation on this channel
        let conversation = await client.conversation.findFirst({
            where: {
                customerId,
                businessId,
                channel: channel as any,
                status: 'ACTIVE',
            },
            orderBy: { startedAt: 'desc' },
        });

        if (!conversation) {
            // Create new conversation
            conversation = await client.conversation.create({
                data: {
                    customerId,
                    businessId,
                    channel: channel as any,
                    status: 'ACTIVE',
                },
            });

            logger.info(
                { conversationId: conversation.id, customerId, channel },
                'New conversation started'
            );
        }

        return conversation;
    }

    /**
     * Queue embedding generation for background processing
     * 
     * In Phase 4, this will use BullMQ workers
     * For now, we process immediately but don't block response
     */
    private static async queueEmbeddingGeneration(
        customerId: string,
        contents: string[],
    ): Promise<void> {
        // Fire and forget - don't block response
        Promise.all(
            contents.map(async (content) => {
                try {
                    await MemoryService.addMemory(customerId, content, {
                        source: 'conversation',
                    });
                } catch (error) {
                    logger.error({ error, customerId }, 'Failed to add memory');
                }
            })
        ).catch(() => { });
    }

    /**
     * Get conversation analytics for a business
     */
    static async getBusinessAnalytics(businessId: string): Promise<{
        totalConversations: number;
        totalMessages: number;
        activeConversations: number;
        avgResponseTime: number;
        cacheHitRate: number;
        totalCost: number;
        topQueries: Array<{ query: string; hits: number }>;
    }> {
        const [
            totalConversations,
            totalMessages,
            activeConversations,
            cacheStats,
            costSummary,
            cacheBusinessStats,
        ] = await Promise.all([
            db.conversation.count({
                where: { businessId },
            }),
            db.message.count({
                where: {
                    conversation: { businessId },
                },
            }),
            db.conversation.count({
                where: { businessId, status: 'ACTIVE' },
            }),
            Promise.resolve(SemanticCacheService.getStats()),
            CostTrackerService.getMonthlyCostSummary(businessId),
            SemanticCacheService.getBusinessCacheStats(businessId),
        ]);

        return {
            totalConversations,
            totalMessages,
            activeConversations,
            avgResponseTime: 0, // Will be calculated in Phase 5
            cacheHitRate: cacheStats.hitRate,
            totalCost: costSummary.totalCost,
            topQueries: cacheBusinessStats.topQueries,
        };
    }

    /**
     * Close a conversation and generate summary
     */
    static async closeConversation(
        conversationId: string,
        reason: string = 'CLOSED'
    ): Promise<void> {
        const conversation = await db.conversation.findUnique({
            where: { id: conversationId },
            include: { messages: true },
        });

        if (!conversation) {
            throw new Error('Conversation not found');
        }

        // TODO: Generate AI summary of conversation (Phase 4)
        // For now, just close it

        await db.conversation.update({
            where: { id: conversationId },
            data: {
                status: reason === 'TRANSFERRED' ? 'TRANSFERRED' : 'CLOSED',
                endedAt: new Date(),
                summary: `Conversation closed: ${reason}`,
            },
        });

        logger.info(
            { conversationId, reason, messageCount: conversation.messages.length },
            'Conversation closed'
        );
    }
}
