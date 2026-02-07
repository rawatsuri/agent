import { z } from 'zod';
import type { Channel } from '@prisma/client';

/**
 * Common Validation Schemas
 * 
 * Zod schemas for validating inputs across the application.
 * Prevents injection attacks, type confusion, and invalid data.
 */

// ============================================
// Primitive Validators
// ============================================

export const UUIDSchema = z.string().uuid('Invalid UUID format');

export const EmailSchema = z.string().email('Invalid email format').max(255);

export const PhoneSchema = z.string()
    .regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format (E.164)')
    .optional();

export const URLSchema = z.string().url('Invalid URL format');

// ============================================
// Business Domain Validators
// ============================================

export const BusinessIdSchema = UUIDSchema;

export const CustomerIdSchema = UUIDSchema;

export const ConversationIdSchema = UUIDSchema;

export const ChannelSchema = z.enum([
    'VOICE',
    'CHAT',
    'EMAIL',
    'SMS',
    'WHATSAPP',
    'TELEGRAM',
    'INSTAGRAM',
]);

// ============================================
// Cost & Budget Validators
// ============================================

export const CostSchema = z.number()
    .min(0, 'Cost cannot be negative')
    .max(100, 'Single operation cost cannot exceed $100')
    .finite('Cost must be a finite number');

export const BudgetSchema = z.number()
    .min(0, 'Budget cannot be negative')
    .max(1000000, 'Budget cannot exceed $1M')
    .finite('Budget must be a finite number');

export const CreditSchema = z.number()
    .min(0, 'Credits cannot be negative')
    .max(10000000, 'Credits cannot exceed 10M')
    .finite('Credits must be a finite number');

// ============================================
// Message Validators
// ============================================

export const MessageContentSchema = z.string()
    .min(1, 'Message cannot be empty')
    .max(10000, 'Message too long (max 10,000 characters)')
    .refine(
        (val) => val.trim().length > 0,
        'Message cannot be only whitespace'
    );

export const MessageRoleSchema = z.enum(['USER', 'ASSISTANT', 'SYSTEM']);

// ============================================
// Service Method Validators
// ============================================

/**
 * Budget Service Validators
 */
export const DeductBudgetParamsSchema = z.object({
    businessId: BusinessIdSchema,
    cost: CostSchema,
});

export const HasBudgetAvailableParamsSchema = z.object({
    businessId: BusinessIdSchema,
    estimatedCost: CostSchema.optional().default(0.001),
});

export const AddCreditsParamsSchema = z.object({
    businessId: BusinessIdSchema,
    amount: CreditSchema,
});

export const UpdatePlanParamsSchema = z.object({
    businessId: BusinessIdSchema,
    planType: z.enum(['STARTER', 'PRO', 'ENTERPRISE']),
});

/**
 * AI Service Validators
 */
export const GenerateResponseParamsSchema = z.object({
    businessId: BusinessIdSchema,
    customerId: CustomerIdSchema,
    conversationId: ConversationIdSchema,
    channel: ChannelSchema,
    content: MessageContentSchema,
    context: z.object({
        business: z.any(), // Complex object, validate separately
        customer: z.any(),
        recentMessages: z.array(z.any()),
        memories: z.array(z.any()),
    }),
});

/**
 * Conversation Orchestrator Validators
 */
export const ProcessMessageParamsSchema = z.object({
    businessId: BusinessIdSchema,
    customerId: CustomerIdSchema.optional(),
    phone: PhoneSchema,
    email: EmailSchema.optional(),
    content: MessageContentSchema,
    channel: ChannelSchema,
    conversationId: ConversationIdSchema.optional(),
    metadata: z.record(z.any()).optional(),
});

/**
 * Rate Limiter Validators
 */
export const CheckCustomerLimitParamsSchema = z.object({
    customerId: CustomerIdSchema,
    businessId: BusinessIdSchema,
    type: z.enum(['MESSAGE', 'CALL']),
    channel: z.string(),
});

/**
 * Semantic Cache Validators
 */
export const GetCachedResponseParamsSchema = z.object({
    businessId: BusinessIdSchema,
    query: z.string().min(1).max(1000),
    customerId: CustomerIdSchema.optional(),
    channel: ChannelSchema.optional(),
    context: z.string().optional(),
});

export const CacheResponseParamsSchema = z.object({
    businessId: BusinessIdSchema,
    query: z.string().min(1).max(1000),
    response: z.string().min(1),
    customerId: CustomerIdSchema.optional(),
    channel: ChannelSchema.optional(),
    aiCost: CostSchema,
    context: z.string().optional(),
});

/**
 * Encryption Service Validators
 */
export const EncryptParamsSchema = z.object({
    plaintext: z.string().max(10000, 'Text too long to encrypt'),
});

export const DecryptParamsSchema = z.object({
    encrypted: z.string(),
});

// ============================================
// Helper Functions
// ============================================

/**
 * Validate and parse input with a Zod schema
 * Throws ZodError with detailed messages if validation fails
 */
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
    return schema.parse(data);
}

/**
 * Validate input and return { success: boolean, data?: T, error?: string }
 * Does not throw, returns validation result
 */
export function validateSafe<T>(
    schema: z.ZodSchema<T>,
    data: unknown
): { success: true; data: T } | { success: false; error: string } {
    const result = schema.safeParse(data);

    if (result.success) {
        return { success: true, data: result.data };
    }

    return {
        success: false,
        error: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
    };
}

/**
 * Decorator for validating method parameters
 */
export function ValidateParams<T>(schema: z.ZodSchema<T>) {
    return function (
        target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ) {
        const originalMethod = descriptor.value;

        descriptor.value = function (...args: any[]) {
            // Assume first argument is the params object
            const params = args[0];
            const validated = validate(schema, params);

            // Replace first argument with validated params
            args[0] = validated;

            return originalMethod.apply(this, args);
        };

        return descriptor;
    };
}

// ============================================
// SQL Injection Prevention
// ============================================

/**
 * Sanitize string for use in SQL queries
 * Note: Still prefer parameterized queries, this is a backup
 */
export function sanitizeForSQL(input: string): string {
    // Remove SQL injection patterns
    return input
        .replace(/['";\\]/g, '') // Remove quotes and backslashes
        .replace(/--/g, '') // Remove SQL comments
        .replace(/\/\*/g, '') // Remove block comment start
        .replace(/\*\//g, '') // Remove block comment end
        .replace(/xp_/gi, '') // Remove SQL Server extended procedures
        .replace(/sp_/gi, '') // Remove SQL Server stored procedures
        .substring(0, 1000); // Limit length
}

/**
 * Check if string contains potential SQL injection
 */
export function hasSQLInjection(input: string): boolean {
    const sqlPatterns = [
        /(\bUNION\b|\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bCREATE\b|\bALTER\b)/i,
        /;.*--/,
        /\/\*.*\*\//,
        /'.*OR.*'/i,
        /".*OR.*"/i,
    ];

    return sqlPatterns.some(pattern => pattern.test(input));
}

/**
 * Validate embedding array
 */
export const EmbeddingSchema = z.array(z.number())
    .length(1536, 'Embedding must have exactly 1536 dimensions')
    .refine(
        (arr) => arr.every(n => isFinite(n) && n >= -1 && n <= 1),
        'Embedding values must be finite numbers between -1 and 1'
    );
