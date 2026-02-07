/**
 * Advanced Campaign Services
 * 
 * 1. A/B Testing Service - Test different campaign variations
 * 2. Personalization Service - Dynamic content personalization
 */

import { db } from '@/config/database';
import { logger } from '@/utils/logger';
import OpenAI from 'openai';
import { CostTrackerService } from '@/features/cost-control/cost-tracker.service';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export enum TestStatus {
    DRAFT = 'DRAFT',
    RUNNING = 'RUNNING',
    PAUSED = 'PAUSED',
    COMPLETED = 'COMPLETED',
}

export enum WinnerCriteria {
    OPEN_RATE = 'OPEN_RATE',
    CLICK_RATE = 'CLICK_RATE',
    REPLY_RATE = 'REPLY_RATE',
    CONVERSION_RATE = 'CONVERSION_RATE',
}

export interface ABTestVariant {
    id: string;
    name: string;
    content: string;
    subject?: string;
    weight: number; // 0-100 percentage
    stats: {
        sent: number;
        opened: number;
        clicked: number;
        replied: number;
        converted: number;
    };
}

export interface ABTest {
    id: string;
    businessId: string;
    campaignId: string;
    name: string;
    description?: string;
    status: TestStatus;
    variants: ABTestVariant[];
    winnerCriteria: WinnerCriteria;
    confidenceLevel: number; // 0.90, 0.95, 0.99
    sampleSize: number; // Minimum sample size per variant
    winner?: string; // Variant ID of winner
    startedAt?: Date;
    endedAt?: Date;
    createdAt: Date;
}

export interface PersonalizationRule {
    id: string;
    name: string;
    condition: {
        field: string;
        operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than';
        value: any;
    };
    content: string;
    priority: number;
}

export interface Recommendation {
    product?: string;
    content: string;
    reason: string;
    confidence: number;
}

/**
 * A/B Testing Service
 * Statistical testing for campaign optimization
 */
export class ABTestingService {
    /**
     * Create new A/B test
     */
    static async createTest(params: {
        businessId: string;
        campaignId: string;
        name: string;
        description?: string;
        variants: Array<{
            name: string;
            content: string;
            subject?: string;
            weight?: number;
        }>;
        winnerCriteria?: WinnerCriteria;
        confidenceLevel?: number;
        sampleSize?: number;
    }): Promise<ABTest> {
        // Validate at least 2 variants
        if (params.variants.length < 2) {
            throw new Error('A/B test requires at least 2 variants');
        }

        // Validate weights sum to 100
        const totalWeight = params.variants.reduce((sum, v) => sum + (v.weight || 50), 0);
        if (totalWeight !== 100) {
            // Normalize weights
            params.variants = params.variants.map((v) => ({
                ...v,
                weight: Math.round(((v.weight || 50) / totalWeight) * 100),
            }));
        }

        const test = await db.aBTest.create({
            data: {
                businessId: params.businessId,
                campaignId: params.campaignId,
                name: params.name,
                description: params.description,
                status: TestStatus.DRAFT,
                variants: params.variants.map((v) => ({
                    id: `variant_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    name: v.name,
                    content: v.content,
                    subject: v.subject,
                    weight: v.weight || 50,
                    stats: {
                        sent: 0,
                        opened: 0,
                        clicked: 0,
                        replied: 0,
                        converted: 0,
                    },
                })),
                winnerCriteria: params.winnerCriteria || WinnerCriteria.CONVERSION_RATE,
                confidenceLevel: params.confidenceLevel || 0.95,
                sampleSize: params.sampleSize || 100,
            },
        });

        logger.info(
            { testId: test.id, businessId: params.businessId },
            'A/B test created'
        );

        return this.mapToABTest(test);
    }

    /**
     * Start A/B test
     */
    static async startTest(testId: string): Promise<ABTest> {
        const test = await db.aBTest.update({
            where: { id: testId },
            data: {
                status: TestStatus.RUNNING,
                startedAt: new Date(),
            },
        });

        logger.info({ testId }, 'A/B test started');

        return this.mapToABTest(test);
    }

    /**
     * Get variant for customer (traffic allocation)
     */
    static async getVariantForCustomer(
        testId: string,
        customerId: string
    ): Promise<ABTestVariant> {
        const test = await this.getTest(testId);

        if (test.status !== TestStatus.RUNNING) {
            // Return control variant if test not running
            return test.variants[0];
        }

        // Deterministic assignment based on customer ID
        const hash = this.hashString(`${testId}:${customerId}`);
        const random = hash % 100;

        let cumulativeWeight = 0;
        for (const variant of test.variants) {
            cumulativeWeight += variant.weight;
            if (random < cumulativeWeight) {
                return variant;
            }
        }

        return test.variants[test.variants.length - 1];
    }

    /**
     * Record event for variant
     */
    static async recordEvent(params: {
        testId: string;
        variantId: string;
        event: 'sent' | 'opened' | 'clicked' | 'replied' | 'converted';
    }): Promise<void> {
        const test = await db.aBTest.findUnique({
            where: { id: params.testId },
        });

        if (!test) return;

        const variants = test.variants as any[];
        const variant = variants.find((v) => v.id === params.variantId);

        if (!variant) return;

        variant.stats[params.event] = (variant.stats[params.event] || 0) + 1;

        await db.aBTest.update({
            where: { id: params.testId },
            data: { variants },
        });

        // Check if we have a winner
        await this.checkForWinner(params.testId);
    }

    /**
     * Check if we have a statistically significant winner
     */
    static async checkForWinner(testId: string): Promise<{
        hasWinner: boolean;
        winner?: ABTestVariant;
        confidence?: number;
    }> {
        const test = await this.getTest(testId);

        if (test.status !== TestStatus.RUNNING) {
            return { hasWinner: !!test.winner, winner: test.variants.find((v) => v.id === test.winner) };
        }

        // Check if minimum sample size reached
        const totalSent = test.variants.reduce((sum, v) => sum + v.stats.sent, 0);
        const minSampleReached = test.variants.every(
            (v) => v.stats.sent >= test.sampleSize
        );

        if (!minSampleReached) {
            return { hasWinner: false };
        }

        // Calculate statistical significance (simplified)
        const rates = test.variants.map((v) => ({
            variant: v,
            rate: this.getRateForCriteria(v, test.winnerCriteria),
        }));

        rates.sort((a, b) => b.rate - a.rate);

        // Check if top performer is significantly better than control
        if (rates.length >= 2) {
            const winner = rates[0];
            const control = rates[1];

            // Calculate confidence (simplified z-test)
            const confidence = this.calculateConfidence(
                winner.rate,
                winner.variant.stats.sent,
                control.rate,
                control.variant.stats.sent
            );

            if (confidence >= test.confidenceLevel) {
                // Declare winner
                await db.aBTest.update({
                    where: { id: testId },
                    data: {
                        status: TestStatus.COMPLETED,
                        winner: winner.variant.id,
                        endedAt: new Date(),
                    },
                });

                logger.info(
                    { testId, winnerId: winner.variant.id, confidence },
                    'A/B test winner determined'
                );

                return { hasWinner: true, winner: winner.variant, confidence };
            }
        }

        return { hasWinner: false };
    }

    /**
     * Get test results
     */
    static async getTestResults(testId: string): Promise<{
        test: ABTest;
        stats: Array<{
            variant: ABTestVariant;
            rates: {
                openRate: number;
                clickRate: number;
                replyRate: number;
                conversionRate: number;
            };
            lift: number; // % improvement over control
        }>;
        significance: number;
        recommendation: string;
    }> {
        const test = await this.getTest(testId);

        // Calculate stats for each variant
        const stats = test.variants.map((variant, index) => {
            const rates = {
                openRate: variant.stats.sent > 0 ? (variant.stats.opened / variant.stats.sent) * 100 : 0,
                clickRate: variant.stats.sent > 0 ? (variant.stats.clicked / variant.stats.sent) * 100 : 0,
                replyRate: variant.stats.sent > 0 ? (variant.stats.replied / variant.stats.sent) * 100 : 0,
                conversionRate: variant.stats.sent > 0 ? (variant.stats.converted / variant.stats.sent) * 100 : 0,
            };

            // Calculate lift vs control (first variant)
            const control = test.variants[0];
            const controlRate = this.getRateForCriteria(control, test.winnerCriteria);
            const variantRate = this.getRateForCriteria(variant, test.winnerCriteria);
            const lift = controlRate > 0 ? ((variantRate - controlRate) / controlRate) * 100 : 0;

            return { variant, rates, lift: Math.round(lift * 100) / 100 };
        });

        // Calculate overall significance
        const significance = test.winner
            ? this.calculateConfidence(
                this.getRateForCriteria(
                    test.variants.find((v) => v.id === test.winner)!,
                    test.winnerCriteria
                ),
                100,
                this.getRateForCriteria(test.variants[0], test.winnerCriteria),
                100
            )
            : 0;

        const recommendation = test.winner
            ? `Winner found: ${test.variants.find((v) => v.id === test.winner)?.name}. Implement this variation.`
            : test.status === TestStatus.RUNNING
                ? 'Test still running. Continue until statistical significance is reached.'
                : 'No clear winner. Consider running a new test with different variations.';

        return { test, stats, significance, recommendation };
    }

    /**
     * Get rate based on winner criteria
     */
    private static getRateForCriteria(variant: ABTestVariant, criteria: WinnerCriteria): number {
        switch (criteria) {
            case WinnerCriteria.OPEN_RATE:
                return variant.stats.sent > 0 ? variant.stats.opened / variant.stats.sent : 0;
            case WinnerCriteria.CLICK_RATE:
                return variant.stats.sent > 0 ? variant.stats.clicked / variant.stats.sent : 0;
            case WinnerCriteria.REPLY_RATE:
                return variant.stats.sent > 0 ? variant.stats.replied / variant.stats.sent : 0;
            case WinnerCriteria.CONVERSION_RATE:
                return variant.stats.sent > 0 ? variant.stats.converted / variant.stats.sent : 0;
            default:
                return 0;
        }
    }

    /**
     * Calculate statistical confidence (simplified)
     */
    private static calculateConfidence(
        rate1: number,
        n1: number,
        rate2: number,
        n2: number
    ): number {
        // Simplified confidence calculation
        const p1 = rate1;
        const p2 = rate2;
        const se = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
        const z = Math.abs(p1 - p2) / (se || 1);

        // Rough z-score to confidence mapping
        if (z > 2.576) return 0.99;
        if (z > 1.96) return 0.95;
        if (z > 1.645) return 0.90;
        return 0;
    }

    /**
     * Hash string to number
     */
    private static hashString(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash;
        }
        return Math.abs(hash);
    }

    /**
     * Get test by ID
     */
    private static async getTest(testId: string): Promise<ABTest> {
        const test = await db.aBTest.findUnique({
            where: { id: testId },
        });

        if (!test) {
            throw new Error('A/B test not found');
        }

        return this.mapToABTest(test);
    }

    /**
     * Map database record to ABTest
     */
    private static mapToABTest(test: any): ABTest {
        return {
            id: test.id,
            businessId: test.businessId,
            campaignId: test.campaignId,
            name: test.name,
            description: test.description || undefined,
            status: test.status as TestStatus,
            variants: test.variants as ABTestVariant[],
            winnerCriteria: test.winnerCriteria as WinnerCriteria,
            confidenceLevel: test.confidenceLevel,
            sampleSize: test.sampleSize,
            winner: test.winner || undefined,
            startedAt: test.startedAt || undefined,
            endedAt: test.endedAt || undefined,
            createdAt: test.createdAt,
        };
    }
}

/**
 * Personalization Service
 * Dynamic content based on customer data
 */
export class PersonalizationService {
    /**
     * Generate personalized message
     */
    static async personalizeMessage(params: {
        businessId: string;
        customerId: string;
        baseMessage: string;
        channel: string;
    }): Promise<string> {
        const customer = await db.customer.findUnique({
            where: { id: params.customerId },
            include: {
                conversations: {
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                },
                memories: {
                    orderBy: { createdAt: 'desc' },
                    take: 3,
                },
            },
        });

        if (!customer) {
            return params.baseMessage;
        }

        // Get personalization rules
        const rules = await this.getRulesForCustomer(params.businessId, customer);

        // Apply rules to personalize message
        let personalizedMessage = params.baseMessage;

        for (const rule of rules.sort((a, b) => b.priority - a.priority)) {
            if (this.matchesRule(customer, rule)) {
                personalizedMessage = personalizedMessage.replace(
                    /\{\{dynamic_content\}\}/g,
                    rule.content
                );
            }
        }

        // Replace customer variables
        personalizedMessage = personalizedMessage
            .replace(/\{\{first_name\}\}/g, customer.name?.split(' ')[0] || 'there')
            .replace(/\{\{name\}\}/g, customer.name || 'valued customer')
            .replace(/\{\{last_interaction\}\}/g, customer.lastInteraction.toLocaleDateString())
            .replace(/\{\{trust_score\}\}/g, customer.trustScore.toString());

        // AI-powered personalization
        const aiPersonalized = await this.aiPersonalize({
            baseMessage: personalizedMessage,
            customerContext: {
                name: customer.name,
                tags: customer.tags,
                preferences: customer.preferences,
                conversationCount: customer.conversations.length,
            },
            channel: params.channel,
        });

        return aiPersonalized;
    }

    /**
     * Get recommendations for customer
     */
    static async getRecommendations(params: {
        businessId: string;
        customerId: string;
    }): Promise<Recommendation[]> {
        const customer = await db.customer.findUnique({
            where: { id: params.customerId },
            include: {
                conversations: {
                    include: { messages: { take: 10 } },
                },
            },
        });

        if (!customer) {
            return [];
        }

        // Analyze customer data with AI
        const conversationHistory = customer.conversations
            .map((c) => c.messages.map((m) => m.content).join('\n'))
            .join('\n---\n');

        const prompt = `Based on this customer conversation history, generate 3 personalized recommendations:

Customer Profile:
- Name: ${customer.name}
- Tags: ${customer.tags.join(', ')}
- Previous Interactions: ${customer.conversations.length} conversations

Conversation History:
${conversationHistory.substring(0, 2000)}

Provide recommendations in this JSON format:
{
  "recommendations": [
    {
      "product": "product name or service",
      "content": "personalized message about the recommendation",
      "reason": "why this is relevant to the customer",
      "confidence": 0.85
    }
  ]
}`;

        try {
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a personalization expert. Generate relevant product/service recommendations.',
                    },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.7,
                max_tokens: 800,
                response_format: { type: 'json_object' },
            });

            const content = response.choices[0].message.content || '{}';
            const result = JSON.parse(content);

            // Log cost
            const cost = CostTrackerService.calculateGPTCost(
                'gpt-4o-mini',
                response.usage?.prompt_tokens || 0,
                response.usage?.completion_tokens || 0
            );

            await CostTrackerService.logAICost({
                businessId: params.businessId,
                customerId: params.customerId,
                service: 'OPENAI_GPT',
                cost,
                tokensUsed: response.usage?.total_tokens,
                model: 'gpt-4o-mini',
                metadata: { purpose: 'personalization-recommendations' },
            });

            return result.recommendations || [];
        } catch (error) {
            logger.error({ error, customerId: params.customerId }, 'Failed to generate recommendations');
            return [];
        }
    }

    /**
     * Behavioral targeting - segment customers by behavior
     */
    static async segmentCustomers(params: {
        businessId: string;
        criteria: {
            minConversations?: number;
            minTrustScore?: number;
            tags?: string[];
            lastInteractionWithin?: number; // days
            intents?: string[];
        };
    }): Promise<{
        segment: string;
        count: number;
        customers: string[];
        characteristics: string[];
    }> {
        const since = params.criteria.lastInteractionWithin
            ? new Date(Date.now() - params.criteria.lastInteractionWithin * 24 * 60 * 60 * 1000)
            : undefined;

        const customers = await db.customer.findMany({
            where: {
                businessId: params.businessId,
                ...(params.criteria.minTrustScore && {
                    trustScore: { gte: params.criteria.minTrustScore },
                }),
                ...(params.criteria.tags && { tags: { hasEvery: params.criteria.tags } }),
                ...(since && { lastInteraction: { gte: since } }),
            },
            include: {
                _count: { select: { conversations: true } },
            },
        });

        // Filter by conversation count if specified
        const filtered = params.criteria.minConversations
            ? customers.filter((c) => c._count.conversations >= params.criteria.minConversations!)
            : customers;

        // Get characteristics
        const characteristics = [
            `Average trust score: ${Math.round(
                filtered.reduce((sum, c) => sum + c.trustScore, 0) / filtered.length
            )}`,
            `Verified customers: ${filtered.filter((c) => c.isVerified).length} (${Math.round(
                (filtered.filter((c) => c.isVerified).length / filtered.length) * 100
            )}%)`,
        ];

        return {
            segment: 'Custom Segment',
            count: filtered.length,
            customers: filtered.map((c) => c.id),
            characteristics,
        };
    }

    /**
     * AI-powered personalization
     */
    private static async aiPersonalize(params: {
        baseMessage: string;
        customerContext: {
            name?: string;
            tags: string[];
            preferences: any;
            conversationCount: number;
        };
        channel: string;
    }): Promise<string> {
        const prompt = `Personalize this message for the customer. Keep the core message but adapt the tone and add personal touches:

Base Message: "${params.baseMessage}"

Customer Context:
- Name: ${params.customerContext.name}
- Tags: ${params.customerContext.tags.join(', ')}
- Conversation History: ${params.customerContext.conversationCount} previous conversations
- Channel: ${params.channel}

Rules:
- Keep it ${params.channel === 'SMS' ? 'brief (under 160 chars)' : 'conversational'}
- Use the customer's name naturally
- Reference their history if relevant
- Maintain professional but friendly tone

Return only the personalized message, no explanation.`;

        try {
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a personalization expert. Adapt messages to individual customers.',
                    },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.7,
                max_tokens: 300,
            });

            return response.choices[0].message.content || params.baseMessage;
        } catch (error) {
            logger.error({ error }, 'AI personalization failed');
            return params.baseMessage;
        }
    }

    /**
     * Get personalization rules for customer
     */
    private static async getRulesForCustomer(
        businessId: string,
        customer: any
    ): Promise<PersonalizationRule[]> {
        // In production, fetch from database
        // For now, return default rules
        return [
            {
                id: 'rule_1',
                name: 'New Customer Welcome',
                condition: {
                    field: 'conversationCount',
                    operator: 'less_than',
                    value: 3,
                },
                content: "Welcome! We're excited to help you get started.",
                priority: 10,
            },
            {
                id: 'rule_2',
                name: 'VIP Customer',
                condition: {
                    field: 'trustScore',
                    operator: 'greater_than',
                    value: 80,
                },
                content: 'As a valued customer, you have access to priority support.',
                priority: 20,
            },
        ];
    }

    /**
     * Check if customer matches personalization rule
     */
    private static matchesRule(customer: any, rule: PersonalizationRule): boolean {
        const value = customer[rule.condition.field];

        switch (rule.condition.operator) {
            case 'equals':
                return value === rule.condition.value;
            case 'not_equals':
                return value !== rule.condition.value;
            case 'contains':
                return value?.includes(rule.condition.value);
            case 'greater_than':
                return value > rule.condition.value;
            case 'less_than':
                return value < rule.condition.value;
            default:
                return false;
        }
    }
}
