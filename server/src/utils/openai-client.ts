import OpenAI from 'openai';
import { CircuitBreakers } from '@/utils/circuit-breaker';
import { logger } from '@/utils/logger';

/**
 * OpenAI Client with Timeouts and Circuit Breaker Protection
 * 
 * Wraps OpenAI API calls with:
 * - Automatic timeouts (15s default)
 * - Circuit breaker protection
 * - Error handling and logging
 * - Retry logic with exponential backoff
 */

const OPENAI_TIMEOUT_MS = parseInt(process.env.OPENAI_TIMEOUT_MS || '15000');
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

export class OpenAIClient {
    private client: OpenAI;
    private circuitBreaker = CircuitBreakers.getOrCreate('openai', {
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 30000,
    });

    constructor() {
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            timeout: OPENAI_TIMEOUT_MS,
            maxRetries: 0,  // We handle retries manually for better control
        });
    }

    /**
     * Create chat completion with timeout and circuit breaker protection
     */
    async createChatCompletion(
        params: OpenAI.Chat.ChatCompletionCreateParams,
        options?: {
            timeout?: number;
            retries?: number;
        }
    ): Promise<OpenAI.Chat.ChatCompletion> {
        const timeout = options?.timeout || OPENAI_TIMEOUT_MS;
        const maxRetries = options?.retries ?? MAX_RETRIES;

        return this.withTimeout(
            () => this.withRetry(
                () => this.circuitBreaker.execute(
                    () => this.client.chat.completions.create(params)
                ),
                maxRetries
            ),
            timeout,
            'chat.completions.create'
        );
    }

    /**
     * Create embeddings with timeout and circuit breaker protection
     */
    async createEmbeddings(
        params: OpenAI.EmbeddingCreateParams,
        options?: {
            timeout?: number;
            retries?: number;
        }
    ): Promise<OpenAI.Embeddings.CreateEmbeddingResponse> {
        const timeout = options?.timeout || OPENAI_TIMEOUT_MS;
        const maxRetries = options?.retries ?? MAX_RETRIES;

        return this.withTimeout(
            () => this.withRetry(
                () => this.circuitBreaker.execute(
                    () => this.client.embeddings.create(params)
                ),
                maxRetries
            ),
            timeout,
            'embeddings.create'
        );
    }

    /**
     * Wrap function with timeout using AbortController
     */
    private async withTimeout<T>(
        fn: () => Promise<T>,
        timeoutMs: number,
        operation: string
    ): Promise<T> {
        const abortController = new AbortController();

        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
                abortController.abort();
                reject(new Error(`OpenAI ${operation} timeout after ${timeoutMs}ms`));
            }, timeoutMs);
        });

        try {
            return await Promise.race([fn(), timeoutPromise]);
        } catch (error: any) {
            if (error.name === 'AbortError' || error.message?.includes('timeout')) {
                logger.error(
                    { operation, timeoutMs },
                    'OpenAI request timeout'
                );
                throw new Error(`OpenAI timeout: ${operation}`);
            }
            throw error;
        }
    }

    /**
     * Retry logic with exponential backoff
     */
    private async withRetry<T>(
        fn: () => Promise<T>,
        maxRetries: number,
        currentRetry: number = 0
    ): Promise<T> {
        try {
            return await fn();
        } catch (error: any) {
            // Don't retry on certain errors
            if (
                error.status === 401 ||  // Authentication error
                error.status === 400 ||  // Bad request
                error.circuitBreakerOpen ||  // Circuit breaker open
                currentRetry >= maxRetries
            ) {
                throw error;
            }

            // Check if it's a retryable error
            const isRetryable = this.isRetryableError(error);

            if (!isRetryable || currentRetry >= maxRetries) {
                throw error;
            }

            // Calculate delay with exponential backoff
            const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, currentRetry);
            const jitter = Math.random() * 200;  // Add jitter to prevent thundering herd

            logger.warn(
                {
                    error: error.message,
                    currentRetry,
                    maxRetries,
                    delayMs,
                },
                'Retrying OpenAI request'
            );

            await this.sleep(delayMs + jitter);

            return this.withRetry(fn, maxRetries, currentRetry + 1);
        }
    }

    /**
     * Check if error is retryable
     */
    private isRetryable(error: any): boolean {
        // Retry on rate limits, timeouts, and 5xx errors
        return (
            error.status === 429 ||  // Rate limit
            error.status === 503 ||  // Service unavailable
            error.status === 504 ||  // Gateway timeout
            error.status >= 500 ||   // Server errors
            error.code === 'ETIMEDOUT' ||
            error.code === 'ECONNRESET' ||
            error.code === 'ENOTFOUND'
        );
    }

    /**
     * Sleep utility
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get underlying client for advanced usage
     */
    getRawClient(): OpenAI {
        return this.client;
    }

    /**
     * Check if API is available
     */
    async healthCheck(): Promise<boolean> {
        try {
            await this.withTimeout(
                () => this.client.models.list(),
                5000,
                'models.list'
            );
            return true;
        } catch {
            return false;
        }
    }
}

// Export singleton instance
export const openaiClient = new OpenAIClient();
