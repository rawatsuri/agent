/**
 * Phase 6: Advanced AI Features
 * 
 * 1. Sentiment Analysis Service
 * 2. Language Detection Service
 * 3. Intent Classification Service
 */

import OpenAI from 'openai';
import { db } from '@/config/database';
import { CostTrackerService } from '@/features/cost-control/cost-tracker.service';
import { logger } from '@/utils/logger';
import type { Channel } from '@prisma/client';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export enum Sentiment {
    POSITIVE = 'POSITIVE',
    NEGATIVE = 'NEGATIVE',
    NEUTRAL = 'NEUTRAL',
    MIXED = 'MIXED',
}

export enum Intent {
    SALES = 'SALES',
    SUPPORT = 'SUPPORT',
    COMPLAINT = 'COMPLAINT',
    INQUIRY = 'INQUIRY',
    FEEDBACK = 'FEEDBACK',
    APPOINTMENT = 'APPOINTMENT',
    PRICING = 'PRICING',
    GENERAL = 'GENERAL',
}

export interface SentimentResult {
    sentiment: Sentiment;
    confidence: number;
    score: number; // -1 to 1
    emotions: {
        anger?: number;
        joy?: number;
        sadness?: number;
        fear?: number;
        surprise?: number;
    };
    alert: boolean;
}

export interface IntentResult {
    intent: Intent;
    confidence: number;
    secondaryIntents: Array<{ intent: Intent; confidence: number }>;
    urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface LanguageResult {
    language: string;
    code: string;
    confidence: number;
    isSupported: boolean;
}

/**
 * Sentiment Analyzer Service
 * Real-time sentiment analysis with trend tracking
 */
export class SentimentAnalyzerService {
    /**
     * Analyze sentiment of customer message
     */
    static async analyze(params: {
        message: string;
        businessId: string;
        customerId: string;
        conversationId: string;
        channel: Channel;
    }): Promise<SentimentResult> {
        try {
            const prompt = `Analyze the sentiment of this customer message. Return a JSON object with:
- sentiment: "POSITIVE", "NEGATIVE", "NEUTRAL", or "MIXED"
- confidence: number 0-1
- score: number -1 to 1 (negative to positive)
- emotions: object with anger, joy, sadness, fear, surprise (0-1 scores)
- alert: boolean (true if very negative or angry)

Message: "${params.message}"`;

            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You are a sentiment analysis expert. Respond only with valid JSON.' },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.1,
                max_tokens: 200,
                response_format: { type: 'json_object' },
            });

            const content = response.choices[0].message.content || '{}';
            const result = JSON.parse(content) as SentimentResult;

            // Calculate cost
            const cost = CostTrackerService.calculateGPTCost(
                'gpt-4o-mini',
                response.usage?.prompt_tokens || 0,
                response.usage?.completion_tokens || 0
            );

            // Log cost
            await CostTrackerService.logAICost({
                businessId: params.businessId,
                customerId: params.customerId,
                conversationId: params.conversationId,
                service: 'OPENAI_GPT',
                cost,
                tokensUsed: response.usage?.total_tokens,
                model: 'gpt-4o-mini',
                channel: params.channel,
                metadata: { purpose: 'sentiment-analysis' },
            });

            // Log sentiment
            await this.logSentiment({
                ...params,
                sentiment: result.sentiment,
                confidence: result.confidence,
                score: result.score,
            });

            // Alert if negative sentiment detected
            if (result.alert || (result.sentiment === Sentiment.NEGATIVE && result.confidence > 0.8)) {
                await this.triggerNegativeSentimentAlert(params, result);
            }

            logger.info(
                {
                    businessId: params.businessId,
                    sentiment: result.sentiment,
                    score: result.score,
                },
                'Sentiment analyzed'
            );

            return result;
        } catch (error) {
            logger.error({ error, params }, 'Failed to analyze sentiment');
            return {
                sentiment: Sentiment.NEUTRAL,
                confidence: 0,
                score: 0,
                emotions: {},
                alert: false,
            };
        }
    }

    /**
     * Get sentiment trend for customer over time
     */
    static async getCustomerTrend(params: {
        customerId: string;
        days?: number;
    }): Promise<{
        trend: 'IMPROVING' | 'DECLINING' | 'STABLE';
        averageScore: number;
        dataPoints: number;
        history: Array<{ date: Date; sentiment: Sentiment; score: number }>;
    }> {
        const days = params.days || 30;
        const since = new Date();
        since.setDate(since.getDate() - days);

        const logs = await db.sentimentLog.findMany({
            where: {
                customerId: params.customerId,
                createdAt: { gte: since },
            },
            orderBy: { createdAt: 'asc' },
        });

        if (logs.length === 0) {
            return { trend: 'STABLE', averageScore: 0, dataPoints: 0, history: [] };
        }

        const scores = logs.map((log) => Number(log.score));
        const averageScore = scores.reduce((a, b) => a + b, 0) / scores.length;

        // Calculate trend (comparing first half to second half)
        const midPoint = Math.floor(scores.length / 2);
        const firstHalfAvg = scores.slice(0, midPoint).reduce((a, b) => a + b, 0) / midPoint || 0;
        const secondHalfAvg = scores.slice(midPoint).reduce((a, b) => a + b, 0) / (scores.length - midPoint) || 0;

        const trend: 'IMPROVING' | 'DECLINING' | 'STABLE' =
            secondHalfAvg > firstHalfAvg + 0.1 ? 'IMPROVING' : secondHalfAvg < firstHalfAvg - 0.1 ? 'DECLINING' : 'STABLE';

        return {
            trend,
            averageScore: Math.round(averageScore * 100) / 100,
            dataPoints: logs.length,
            history: logs.map((log) => ({
                date: log.createdAt,
                sentiment: log.sentiment as Sentiment,
                score: Number(log.score),
            })),
        };
    }

    /**
     * Log sentiment analysis to database
     */
    private static async logSentiment(params: {
        message: string;
        businessId: string;
        customerId: string;
        conversationId: string;
        channel: Channel;
        sentiment: Sentiment;
        confidence: number;
        score: number;
    }): Promise<void> {
        try {
            await db.sentimentLog.create({
                data: {
                    businessId: params.businessId,
                    customerId: params.customerId,
                    conversationId: params.conversationId,
                    channel: params.channel,
                    messagePreview: params.message.substring(0, 200),
                    sentiment: params.sentiment,
                    confidence: params.confidence,
                    score: params.score,
                },
            });
        } catch (error) {
            logger.error({ error, params }, 'Failed to log sentiment');
        }
    }

    /**
     * Trigger alert for negative sentiment
     */
    private static async triggerNegativeSentimentAlert(
        params: { businessId: string; customerId: string; conversationId: string; message: string },
        result: SentimentResult
    ): Promise<void> {
        logger.warn(
            {
                businessId: params.businessId,
                customerId: params.customerId,
                sentiment: result.sentiment,
                emotions: result.emotions,
            },
            'Negative sentiment alert triggered'
        );

        // Could integrate with notification service, Slack, etc.
        // For now, just log - could also update conversation priority
    }
}

/**
 * Language Detector Service
 * Auto-detect and translate customer language
 */
export class LanguageDetectorService {
    private static readonly SUPPORTED_LANGUAGES = [
        'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ru', 'zh', 'ja', 'ko', 'ar', 'hi',
        'tr', 'pl', 'vi', 'th', 'id', 'sv', 'da', 'no', 'fi', 'cs', 'hu', 'ro', 'el',
        'he', 'uk', 'bg', 'hr', 'sr', 'sk', 'sl', 'lt', 'lv', 'et', 'fa', 'ur', 'ta',
        'te', 'ml', 'kn', 'mr', 'gu', 'pa', 'bn', 'ne', 'si', 'my', 'km', 'lo', 'ms',
    ];

    /**
     * Detect language of message
     */
    static async detect(params: {
        message: string;
        businessId: string;
        customerId: string;
    }): Promise<LanguageResult> {
        try {
            // Use OpenAI for language detection
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'Detect the language of the user message. Return JSON with: language (full name), code (ISO 639-1), confidence (0-1)',
                    },
                    { role: 'user', content: params.message },
                ],
                temperature: 0.1,
                max_tokens: 100,
                response_format: { type: 'json_object' },
            });

            const content = response.choices[0].message.content || '{}';
            const result = JSON.parse(content);

            const isSupported = this.SUPPORTED_LANGUAGES.includes(result.code?.toLowerCase());

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
                metadata: { purpose: 'language-detection' },
            });

            return {
                language: result.language || 'English',
                code: result.code?.toLowerCase() || 'en',
                confidence: result.confidence || 0.9,
                isSupported,
            };
        } catch (error) {
            logger.error({ error, params }, 'Failed to detect language');
            return {
                language: 'English',
                code: 'en',
                confidence: 0.5,
                isSupported: true,
            };
        }
    }

    /**
     * Translate text to target language
     */
    static async translate(params: {
        text: string;
        targetLanguage: string;
        businessId: string;
        customerId?: string;
    }): Promise<string> {
        try {
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `Translate the following text to ${params.targetLanguage}. Maintain the tone and meaning. Return only the translation.`,
                    },
                    { role: 'user', content: params.text },
                ],
                temperature: 0.3,
                max_tokens: 1000,
            });

            const translation = response.choices[0].message.content || params.text;

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
                metadata: { purpose: 'translation', targetLanguage: params.targetLanguage },
            });

            return translation;
        } catch (error) {
            logger.error({ error, params }, 'Failed to translate');
            return params.text;
        }
    }

    /**
     * Store customer language preference
     */
    static async setCustomerLanguagePreference(
        customerId: string,
        languageCode: string
    ): Promise<void> {
        try {
            await db.customer.update({
                where: { id: customerId },
                data: {
                    preferences: {
                        update: {
                            language: languageCode,
                        },
                    },
                },
            });
        } catch (error) {
            logger.error({ error, customerId, languageCode }, 'Failed to set language preference');
        }
    }
}

/**
 * Intent Classifier Service
 * Classify customer intent for routing and analytics
 */
export class IntentClassifierService {
    /**
     * Classify customer intent
     */
    static async classify(params: {
        message: string;
        businessId: string;
        customerId: string;
        conversationId: string;
        channel: Channel;
    }): Promise<IntentResult> {
        try {
            const prompt = `Classify the customer intent. Return JSON with:
- intent: main intent category (SALES, SUPPORT, COMPLAINT, INQUIRY, FEEDBACK, APPOINTMENT, PRICING, GENERAL)
- confidence: number 0-1
- secondaryIntents: array of {intent, confidence} for other possible intents
- urgency: LOW, MEDIUM, HIGH, or CRITICAL

Intent definitions:
- SALES: Buying, purchasing, product interest
- SUPPORT: Technical help, troubleshooting
- COMPLAINT: Dissatisfaction, problems, negative feedback
- INQUIRY: Questions about products/services
- FEEDBACK: Reviews, suggestions, testimonials
- APPOINTMENT: Scheduling, booking, meetings
- PRICING: Cost, price, payment questions
- GENERAL: Casual conversation, greetings

Customer message: "${params.message}"`;

            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You are an intent classification expert. Respond only with valid JSON.' },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.2,
                max_tokens: 300,
                response_format: { type: 'json_object' },
            });

            const content = response.choices[0].message.content || '{}';
            const result = JSON.parse(content);

            const intentResult: IntentResult = {
                intent: (result.intent as Intent) || Intent.GENERAL,
                confidence: result.confidence || 0.5,
                secondaryIntents: result.secondaryIntents || [],
                urgency: result.urgency || 'LOW',
            };

            // Calculate cost
            const cost = CostTrackerService.calculateGPTCost(
                'gpt-4o-mini',
                response.usage?.prompt_tokens || 0,
                response.usage?.completion_tokens || 0
            );

            // Log cost
            await CostTrackerService.logAICost({
                businessId: params.businessId,
                customerId: params.customerId,
                conversationId: params.conversationId,
                service: 'OPENAI_GPT',
                cost,
                tokensUsed: response.usage?.total_tokens,
                model: 'gpt-4o-mini',
                channel: params.channel,
                metadata: { purpose: 'intent-classification', intent: intentResult.intent },
            });

            // Log intent
            await this.logIntent({ ...params, ...intentResult });

            // Auto-route based on intent if needed
            if (intentResult.urgency === 'CRITICAL' || intentResult.intent === Intent.COMPLAINT) {
                await this.escalateToHuman(params, intentResult);
            }

            return intentResult;
        } catch (error) {
            logger.error({ error, params }, 'Failed to classify intent');
            return {
                intent: Intent.GENERAL,
                confidence: 0,
                secondaryIntents: [],
                urgency: 'LOW',
            };
        }
    }

    /**
     * Get intent analytics for business
     */
    static async getIntentAnalytics(params: {
        businessId: string;
        days?: number;
    }): Promise<{
        totalClassified: number;
        byIntent: Record<string, number>;
        byUrgency: Record<string, number>;
        trends: Array<{ date: string; intent: string; count: number }>;
    }> {
        const days = params.days || 30;
        const since = new Date();
        since.setDate(since.getDate() - days);

        const logs = await db.intentLog.findMany({
            where: {
                businessId: params.businessId,
                createdAt: { gte: since },
            },
        });

        const byIntent: Record<string, number> = {};
        const byUrgency: Record<string, number> = {};
        const trends: Array<{ date: string; intent: string; count: number }> = [];
        const trendsMap = new Map<string, number>();

        for (const log of logs) {
            byIntent[log.intent] = (byIntent[log.intent] || 0) + 1;
            byUrgency[log.urgency] = (byUrgency[log.urgency] || 0) + 1;

            const date = log.createdAt.toISOString().split('T')[0];
            const key = `${date}-${log.intent}`;
            trendsMap.set(key, (trendsMap.get(key) || 0) + 1);
        }

        trendsMap.forEach((count, key) => {
            const [date, intent] = key.split('-');
            trends.push({ date, intent, count });
        });

        return {
            totalClassified: logs.length,
            byIntent,
            byUrgency,
            trends: trends.sort((a, b) => a.date.localeCompare(b.date)),
        };
    }

    /**
     * Log intent classification
     */
    private static async logIntent(params: {
        message: string;
        businessId: string;
        customerId: string;
        conversationId: string;
        channel: Channel;
        intent: Intent;
        confidence: number;
        urgency: string;
    }): Promise<void> {
        try {
            await db.intentLog.create({
                data: {
                    businessId: params.businessId,
                    customerId: params.customerId,
                    conversationId: params.conversationId,
                    channel: params.channel,
                    messagePreview: params.message.substring(0, 200),
                    intent: params.intent,
                    confidence: params.confidence,
                    urgency: params.urgency,
                },
            });
        } catch (error) {
            logger.error({ error, params }, 'Failed to log intent');
        }
    }

    /**
     * Escalate conversation to human agent
     */
    private static async escalateToHuman(
        params: { businessId: string; customerId: string; conversationId: string },
        intentResult: IntentResult
    ): Promise<void> {
        logger.warn(
            {
                businessId: params.businessId,
                conversationId: params.conversationId,
                intent: intentResult.intent,
                urgency: intentResult.urgency,
            },
            'Auto-escalating to human agent'
        );

        // Update conversation to mark for human transfer
        await db.conversation.update({
            where: { id: params.conversationId },
            data: {
                status: 'TRANSFERRED',
                metadata: {
                    escalationReason: intentResult.intent,
                    urgency: intentResult.urgency,
                    autoEscalated: true,
                },
            },
        });
    }
}
