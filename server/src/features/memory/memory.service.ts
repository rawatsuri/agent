import OpenAI from 'openai';
import { db } from '@/config/database';
import { logger } from '@/utils/logger';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Memory Service - The "Brain" of the Omnichannel AI
 * Handles embedding generation, vector storage, and semantic search
 */
export class MemoryService {
    /**
     * Add a memory with embedding to vector store
     */
    static async addMemory(
        customerId: string,
        content: string,
        metadata?: {
            source?: string;
            conversationId?: string;
            channel?: string;
            importance?: number;
        },
    ): Promise<void> {
        try {
            // Generate embedding using OpenAI
            const embeddingResponse = await openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: content,
            });

            const embedding = embeddingResponse.data[0].embedding;

            // Store in Supabase with pgvector
            await db.$executeRaw`
        INSERT INTO memories (id, customer_id, content, embedding, source, metadata, created_at)
        VALUES (
          gen_random_uuid(),
          ${customerId}::uuid,
          ${content},
          ${JSON.stringify(embedding)}::vector,
          ${metadata?.source || null},
          ${JSON.stringify(metadata || {})}::jsonb,
          NOW()
        )
      `;

            logger.debug(
                { customerId, contentLength: content.length },
                'Memory added with embedding',
            );
        } catch (error) {
            logger.error({ error, customerId }, 'Failed to add memory');
            throw error;
        }
    }

    /**
     * Search memories using semantic similarity (vector search)
     */
    static async searchMemories(
        customerId: string,
        query: string,
        limit: number = 5,
    ): Promise<
        Array<{
            content: string;
            source?: string;
            similarity: number;
            createdAt: Date;
        }>
    > {
        try {
            // Generate embedding for the query
            const embeddingResponse = await openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: query,
            });

            const queryEmbedding = embeddingResponse.data[0].embedding;

            // Perform cosine similarity search using pgvector
            const results = await db.$queryRaw<
                Array<{
                    content: string;
                    source: string | null;
                    similarity: number;
                    created_at: Date;
                }>
            >`
        SELECT 
          content,
          source,
          1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector) as similarity,
          created_at
        FROM memories
        WHERE customer_id = ${customerId}::uuid
        ORDER BY embedding <=> ${JSON.stringify(queryEmbedding)}::vector
        LIMIT ${limit}
      `;

            return results.map((r) => ({
                content: r.content,
                source: r.source || undefined,
                similarity: r.similarity,
                createdAt: r.created_at,
            }));
        } catch (error) {
            logger.error({ error, customerId }, 'Memory search failed');
            return [];
        }
    }

    /**
     * Get recent conversation context (last N messages)
     */
    static async getRecentContext(
        conversationId: string,
        limit: number = 10,
    ): Promise<
        Array<{
            role: string;
            content: string;
            timestamp: Date;
        }>
    > {
        const messages = await db.message.findMany({
            where: { conversationId },
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: {
                role: true,
                content: true,
                createdAt: true,
            },
        });

        // Reverse to chronological order
        return messages
            .reverse()
            .map((m) => ({
                role: m.role,
                content: m.content,
                timestamp: m.createdAt,
            }));
    }

    /**
     * Save a conversation message (will be embedded in background job)
     */
    static async saveMessage(
        conversationId: string,
        role: 'USER' | 'ASSISTANT' | 'SYSTEM',
        content: string,
        channel: string,
        metadata?: Record<string, any>,
    ): Promise<void> {
        await db.message.create({
            data: {
                conversationId,
                role,
                content,
                channel: channel as any,
                metadata,
            },
        });
    }
}
