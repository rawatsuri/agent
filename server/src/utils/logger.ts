import pino from 'pino';

/**
 * Structured Logger Configuration
 * 
 * Production-ready logging with:
 * - JSON formatting for log aggregation
 * - Request ID tracking
 * - Error serialization
 * - Performance monitoring
 */

const isDevelopment = process.env.NODE_ENV === 'development';
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

export const logger = pino({
    level: logLevel,

    // Production: JSON format for log aggregation (Datadog, CloudWatch, etc.)
    // Development: Pretty print for readability
    ...(!isDevelopment && {
        formatters: {
            level: (label) => {
                return { level: label.toUpperCase() };
            },
        },
    }),

    ...(isDevelopment && {
        transport: {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
            },
        },
    }),

    // Error serialization
    serializers: {
        err: pino.stdSerializers.err,
        error: pino.stdSerializers.err,
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res,
    },

    // Base properties included in every log
    base: {
        pid: process.pid,
        hostname: process.env.HOSTNAME || undefined,
        environment: process.env.NODE_ENV,
        service: 'omnichannel-ai-platform',
    },

    // Timestamp in ISO format
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
});

/**
 * Create child logger with additional context
 */
export function createLogger(context: {
    requestId?: string;
    businessId?: string;
    customerId?: string;
    conversationId?: string;
    [key: string]: any;
}) {
    return logger.child(context);
}

/**
 * Log with request context
 */
export function logWithContext(
    level: 'info' | 'warn' | 'error' | 'debug',
    context: Record<string, any>,
    message: string
) {
    logger[level](context, message);
}

/**
 * Log performance metric
 */
export function logPerformance(
    operation: string,
    durationMs: number,
    metadata?: Record<string, any>
) {
    logger.info(
        {
            type: 'performance',
            operation,
            durationMs,
            ...metadata,
        },
        `${operation} completed in ${durationMs}ms`
    );
}

/**
 * Log error with full context
 */
export function logError(
    error: Error,
    context: {
        operation?: string;
        requestId?: string;
        businessId?: string;
        customerId?: string;
        [key: string]: any;
    } = {}
) {
    logger.error(
        {
            ...context,
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack,
                ...(error as any),  // Include any custom properties
            },
            type: 'error',
        },
        error.message || 'An error occurred'
    );
}

/**
 * Log audit event (security, compliance)
 */
export function logAudit(
    action: string,
    actor: { type: 'user' | 'system' | 'api'; id: string },
    target: { type: string; id: string },
    result: 'success' | 'failure',
    metadata?: Record<string, any>
) {
    logger.info(
        {
            type: 'audit',
            action,
            actor,
            target,
            result,
            ...metadata,
        },
        `Audit: ${action} by ${actor.type}:${actor.id} on ${target.type}:${target.id} - ${result}`
    );
}

/**
 * Log business metric
 */
export function logMetric(
    metric: string,
    value: number,
    unit: string,
    tags?: Record<string, string>
) {
    logger.info(
        {
            type: 'metric',
            metric,
            value,
            unit,
            tags,
        },
        `Metric: ${metric} = ${value} ${unit}`
    );
}

export default logger;
