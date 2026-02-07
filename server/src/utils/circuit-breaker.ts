import { logger } from '@/utils/logger';

/**
 * Circuit Breaker Pattern Implementation
 * 
 * Prevents cascading failures by stopping requests to failing services
 * and allowing them time to recover.
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is failing, requests are blocked
 * - HALF_OPEN: Testing if service has recovered
 */

export enum CircuitState {
    CLOSED = 'CLOSED',
    OPEN = 'OPEN',
    HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
    failureThreshold: number;      // Number of failures before opening circuit
    successThreshold: number;       // Number of successes needed to close from half-open
    timeout: number;                // Milliseconds to wait before moving to half-open
    resetTimeout?: number;          // Optional reset timeout for half-open state
}

export class CircuitBreaker {
    private state: CircuitState = CircuitState.CLOSED;
    private failureCount: number = 0;
    private successCount: number = 0;
    private nextAttempt: number = Date.now();
    private name: string;

    constructor(
        name: string,
        private options: CircuitBreakerOptions
    ) {
        this.name = name;
        this.options.successThreshold = options.successThreshold || 2;
        this.options.resetTimeout = options.resetTimeout || options.timeout;
    }

    /**
     * Execute a function with circuit breaker protection
     */
    async execute<T>(fn: () => Promise<T>): Promise<T> {
        if (this.state === CircuitState.OPEN) {
            if (Date.now() < this.nextAttempt) {
                const error = new Error(`Circuit breaker is OPEN for ${this.name}`);
                (error as any).circuitBreakerOpen = true;
                throw error;
            }
            // Transition to HALF_OPEN
            this.state = CircuitState.HALF_OPEN;
            logger.info({ name: this.name }, 'Circuit breaker transitioning to HALF_OPEN');
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    /**
     * Handle successful execution
     */
    private onSuccess(): void {
        if (this.state === CircuitState.HALF_OPEN) {
            this.successCount++;

            if (this.successCount >= this.options.successThreshold) {
                // Close the circuit
                this.state = CircuitState.CLOSED;
                this.failureCount = 0;
                this.successCount = 0;
                logger.info({ name: this.name }, 'Circuit breaker CLOSED - service recovered');
            }
        } else if (this.state === CircuitState.CLOSED) {
            // Reset failure count on success
            this.failureCount = 0;
        }
    }

    /**
     * Handle failed execution
     */
    private onFailure(): void {
        this.failureCount++;

        if (this.state === CircuitState.HALF_OPEN) {
            // Failed during recovery, back to OPEN
            this.state = CircuitState.OPEN;
            this.successCount = 0;
            this.nextAttempt = Date.now() + (this.options.resetTimeout || this.options.timeout);

            logger.warn(
                { name: this.name, nextAttempt: new Date(this.nextAttempt) },
                'Circuit breaker back to OPEN - recovery failed'
            );
        } else if (this.failureCount >= this.options.failureThreshold) {
            // Threshold exceeded, open the circuit
            this.state = CircuitState.OPEN;
            this.nextAttempt = Date.now() + this.options.timeout;

            logger.error(
                {
                    name: this.name,
                    failureCount: this.failureCount,
                    threshold: this.options.failureThreshold,
                    nextAttempt: new Date(this.nextAttempt),
                },
                'Circuit breaker OPEN - service failing'
            );
        }
    }

    /**
     * Get current state
     */
    getState(): CircuitState {
        return this.state;
    }

    /**
     * Get failure count
     */
    getFailureCount(): number {
        return this.failureCount;
    }

    /**
     * Manually reset the circuit breaker
     */
    reset(): void {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.nextAttempt = Date.now();

        logger.info({ name: this.name }, 'Circuit breaker manually reset');
    }

    /**
     * Get stats for monitoring
     */
    getStats(): {
        name: string;
        state: CircuitState;
        failureCount: number;
        successCount: number;
        nextAttempt: Date | null;
    } {
        return {
            name: this.name,
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            nextAttempt: this.state === CircuitState.OPEN ? new Date(this.nextAttempt) : null,
        };
    }
}

/**
 * Global circuit breakers for external services
 */
export class CircuitBreakers {
    private static breakers = new Map<string, CircuitBreaker>();

    static getOrCreate(name: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker {
        if (!this.breakers.has(name)) {
            const defaultOptions: CircuitBreakerOptions = {
                failureThreshold: 5,
                successThreshold: 2,
                timeout: 30000, // 30 seconds
            };

            this.breakers.set(
                name,
                new CircuitBreaker(name, { ...defaultOptions, ...options })
            );
        }

        return this.breakers.get(name)!;
    }

    static get(name: string): CircuitBreaker | undefined {
        return this.breakers.get(name);
    }

    static getAll(): CircuitBreaker[] {
        return Array.from(this.breakers.values());
    }

    static getAllStats() {
        return Array.from(this.breakers.values()).map(breaker => breaker.getStats());
    }

    static reset(name: string): void {
        const breaker = this.breakers.get(name);
        if (breaker) {
            breaker.reset();
        }
    }

    static resetAll(): void {
        for (const breaker of this.breakers.values()) {
            breaker.reset();
        }
    }
}

/**
 * Decorator for methods that should be protected by circuit breaker
 */
export function WithCircuitBreaker(name: string, options?: Partial<CircuitBreakerOptions>) {
    return function (
        target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ) {
        const originalMethod = descriptor.value;

        descriptor.value = async function (...args: any[]) {
            const breaker = CircuitBreakers.getOrCreate(name, options);
            return breaker.execute(() => originalMethod.apply(this, args));
        };

        return descriptor;
    };
}
