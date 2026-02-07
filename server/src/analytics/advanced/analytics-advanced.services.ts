/**
 * Advanced Analytics Services
 * 
 * 1. Funnel Analyzer - Conversion funnel analysis
 * 2. Cohort Analyzer - Customer retention and behavior
 * 3. Prediction Service - Predictive analytics
 */

import { db } from '@/config/database';
import { logger } from '@/utils/logger';

export interface FunnelStage {
    name: string;
    count: number;
    dropOff: number;
    conversionRate: number;
    avgTimeToNext?: number; // in seconds
}

export interface Funnel {
    id: string;
    name: string;
    stages: FunnelStage[];
    totalConversion: number;
    totalCustomers: number;
}

export interface Cohort {
    id: string;
    name: string;
    period: string; // '2024-01', etc.
    size: number;
    retention: number[]; // % retained at month 1, 2, 3...
    ltv: number; // lifetime value
    avgOrderValue: number;
}

export interface ChurnPrediction {
    customerId: string;
    churnRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    confidence: number;
    factors: string[];
    recommendation: string;
}

export interface NextBestAction {
    customerId: string;
    action: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    expectedOutcome: string;
    channel: string;
}

/**
 * Funnel Analyzer Service
 * Track customer journey and conversion
 */
export class FunnelAnalyzerService {
    /**
     * Define funnel stages for a business
     */
    static readonly DEFAULT_FUNNEL_STAGES = [
        { name: 'First Contact', event: 'message_received' },
        { name: 'Engaged', event: 'conversation_started' },
        { name: 'Qualified Lead', event: 'intent_classified_sales' },
        { name: 'Opportunity Created', event: 'crm_opportunity_created' },
        { name: 'Won Deal', event: 'deal_closed_won' },
    ];

    /**
     * Get conversion funnel for business
     */
    static async getFunnel(params: {
        businessId: string;
        days?: number;
        stages?: string[];
    }): Promise<Funnel> {
        const days = params.days || 30;
        const since = new Date();
        since.setDate(since.getDate() - days);

        // Get all customers who interacted in period
        const customers = await db.customer.findMany({
            where: {
                businessId: params.businessId,
                firstInteraction: { gte: since },
            },
            include: {
                conversations: {
                    where: { createdAt: { gte: since } },
                    orderBy: { createdAt: 'asc' },
                },
            },
        });

        const stageNames = params.stages || this.DEFAULT_FUNNEL_STAGES.map((s) => s.name);
        const stages: FunnelStage[] = [];

        // Stage 1: First Contact (all customers)
        const firstContactCount = customers.length;
        stages.push({
            name: stageNames[0] || 'First Contact',
            count: firstContactCount,
            dropOff: 0,
            conversionRate: 100,
        });

        // Stage 2: Engaged (had conversation)
        const engagedCustomers = customers.filter((c) => c.conversations.length > 0);
        stages.push({
            name: stageNames[1] || 'Engaged',
            count: engagedCustomers.length,
            dropOff: firstContactCount - engagedCustomers.length,
            conversionRate: Math.round((engagedCustomers.length / firstContactCount) * 100) || 0,
        });

        // Stage 3: Qualified (positive sentiment + sales intent)
        const qualifiedCustomers = await this.getQualifiedCustomers(
            params.businessId,
            engagedCustomers.map((c) => c.id),
            since
        );
        stages.push({
            name: stageNames[2] || 'Qualified Lead',
            count: qualifiedCustomers.length,
            dropOff: engagedCustomers.length - qualifiedCustomers.length,
            conversionRate: Math.round((qualifiedCustomers.length / engagedCustomers.length) * 100) || 0,
        });

        // Stage 4: Opportunity (CRM created)
        const opportunityCustomers = await this.getOpportunityCustomers(
            params.businessId,
            since
        );
        stages.push({
            name: stageNames[3] || 'Opportunity',
            count: opportunityCustomers,
            dropOff: qualifiedCustomers.length - opportunityCustomers,
            conversionRate: Math.round((opportunityCustomers / qualifiedCustomers.length) * 100) || 0,
        });

        // Stage 5: Converted (positive outcome)
        const convertedCustomers = await this.getConvertedCustomers(
            params.businessId,
            since
        );
        stages.push({
            name: stageNames[4] || 'Converted',
            count: convertedCustomers,
            dropOff: opportunityCustomers - convertedCustomers,
            conversionRate: Math.round((convertedCustomers / opportunityCustomers) * 100) || 0,
        });

        const totalConversion = firstContactCount > 0
            ? Math.round((convertedCustomers / firstContactCount) * 100)
            : 0;

        return {
            id: `funnel_${params.businessId}_${Date.now()}`,
            name: 'Customer Journey Funnel',
            stages,
            totalConversion,
            totalCustomers: firstContactCount,
        };
    }

    /**
     * Get qualified leads (positive intent/sentiment)
     */
    private static async getQualifiedCustomers(
        businessId: string,
        customerIds: string[],
        since: Date
    ): Promise<string[]> {
        if (customerIds.length === 0) return [];

        // Get customers with positive intent or sales intent
        const intentLogs = await db.intentLog.findMany({
            where: {
                businessId,
                customerId: { in: customerIds },
                createdAt: { gte: since },
                OR: [
                    { intent: 'SALES' },
                    { intent: 'INQUIRY', confidence: { gt: 0.7 } },
                ],
            },
            distinct: ['customerId'],
        });

        return intentLogs.map((log) => log.customerId);
    }

    /**
     * Get customers with CRM opportunities
     */
    private static async getOpportunityCustomers(
        businessId: string,
        since: Date
    ): Promise<number> {
        // Count based on cost logs mentioning CRM opportunities
        const logs = await db.costLog.findMany({
            where: {
                businessId,
                createdAt: { gte: since },
                metadata: {
                    path: ['action'],
                    equals: 'create_opportunity',
                },
            },
            distinct: ['customerId'],
        });

        return logs.length;
    }

    /**
     * Get converted customers (would need deal tracking table)
     */
    private static async getConvertedCustomers(
        businessId: string,
        since: Date
    ): Promise<number> {
        // Estimate based on positive sentiment and campaign conversions
        const positiveLogs = await db.sentimentLog.findMany({
            where: {
                businessId,
                createdAt: { gte: since },
                sentiment: 'POSITIVE',
                score: { gt: 0.5 },
            },
            distinct: ['customerId'],
        });

        // This is an approximation - real conversion would need deal tracking
        return Math.floor(positiveLogs.length * 0.3);
    }

    /**
     * Identify drop-off points in funnel
     */
    static async getDropOffAnalysis(params: {
        businessId: string;
        stageFrom: string;
        stageTo: string;
        days?: number;
    }): Promise<{
        totalDropped: number;
        reasons: Array<{ reason: string; count: number; percentage: number }>;
        commonMessages: string[];
    }> {
        const days = params.days || 30;
        const since = new Date();
        since.setDate(since.getDate() - days);

        // Get customers who dropped off between stages
        // This would require more detailed tracking in real implementation

        return {
            totalDropped: 0,
            reasons: [],
            commonMessages: [],
        };
    }

    /**
     * Compare funnel performance over time
     */
    static async compareFunnels(params: {
        businessId: string;
        period1: { start: Date; end: Date };
        period2: { start: Date; end: Date };
    }): Promise<{
        period1: Funnel;
        period2: Funnel;
        improvements: Array<{ stage: string; change: number }>;
    }> {
        const funnel1 = await this.getFunnel({
            businessId: params.businessId,
            days: Math.ceil((params.period1.end.getTime() - params.period1.start.getTime()) / (1000 * 60 * 60 * 24)),
        });

        const funnel2 = await this.getFunnel({
            businessId: params.businessId,
            days: Math.ceil((params.period2.end.getTime() - params.period2.start.getTime()) / (1000 * 60 * 60 * 24)),
        });

        const improvements = funnel1.stages.map((stage, i) => {
            const stage2 = funnel2.stages[i];
            const change = stage2 ? stage2.conversionRate - stage.conversionRate : 0;
            return { stage: stage.name, change: Math.round(change * 100) / 100 };
        });

        return { period1: funnel1, period2: funnel2, improvements };
    }
}

/**
 * Cohort Analyzer Service
 * Analyze customer retention and behavior
 */
export class CohortAnalyzerService {
    /**
     * Generate cohort analysis for business
     */
    static async getCohortAnalysis(params: {
        businessId: string;
        months?: number;
    }): Promise<Cohort[]> {
        const months = params.months || 12;
        const cohorts: Cohort[] = [];

        // Get customers grouped by first interaction month
        const customers = await db.customer.findMany({
            where: { businessId: params.businessId },
            orderBy: { firstInteraction: 'asc' },
            include: {
                conversations: {
                    orderBy: { createdAt: 'asc' },
                },
            },
        });

        // Group by cohort period (YYYY-MM)
        const cohortMap = new Map<string, typeof customers>();

        for (const customer of customers) {
            const period = customer.firstInteraction.toISOString().slice(0, 7);
            if (!cohortMap.has(period)) {
                cohortMap.set(period, []);
            }
            cohortMap.get(period)!.push(customer);
        }

        // Analyze each cohort
        const sortedPeriods = Array.from(cohortMap.keys()).sort().slice(-months);

        for (const period of sortedPeriods) {
            const cohortCustomers = cohortMap.get(period)!;
            const retention = await this.calculateRetention(cohortCustomers, period);
            const ltv = await this.calculateLTV(cohortCustomers, params.businessId);

            cohorts.push({
                id: `cohort_${params.businessId}_${period}`,
                name: `Cohort ${period}`,
                period,
                size: cohortCustomers.length,
                retention,
                ltv: Math.round(ltv * 100) / 100,
                avgOrderValue: 0, // Would need transaction data
            });
        }

        return cohorts;
    }

    /**
     * Calculate retention rates for a cohort
     */
    private static async calculateRetention(
        customers: any[],
        cohortPeriod: string
    ): Promise<number[]> {
        if (customers.length === 0) return [];

        const retention: number[] = [];
        const cohortStart = new Date(cohortPeriod + '-01');

        // Calculate retention for months 1-6
        for (let month = 1; month <= 6; month++) {
            const monthStart = new Date(cohortStart);
            monthStart.setMonth(monthStart.getMonth() + month);
            const monthEnd = new Date(monthStart);
            monthEnd.setMonth(monthEnd.getMonth() + 1);

            const activeCustomers = customers.filter((c) =>
                c.conversations.some(
                    (conv: any) =>
                        conv.createdAt >= monthStart && conv.createdAt < monthEnd
                )
            );

            const rate = Math.round((activeCustomers.length / customers.length) * 100);
            retention.push(rate);
        }

        return retention;
    }

    /**
     * Calculate lifetime value for cohort
     */
    private static async calculateLTV(
        customers: any[],
        businessId: string
    ): Promise<number> {
        // LTV = average value per customer over their lifetime
        // For now, estimate based on conversation value
        const costLogs = await db.costLog.findMany({
            where: {
                businessId,
                customerId: { in: customers.map((c) => c.id) },
            },
        });

        const totalValue = costLogs.reduce((sum, log) => sum + Number(log.cost), 0);
        return customers.length > 0 ? totalValue / customers.length : 0;
    }

    /**
     * Get customer lifetime value distribution
     */
    static async getLTVDistribution(params: {
        businessId: string;
    }): Promise<{
        average: number;
        median: number;
        topPercentile: number;
        distribution: Array<{ range: string; count: number; percentage: number }>;
    }> {
        const customers = await db.customer.findMany({
            where: { businessId: params.businessId },
            include: {
                _count: {
                    select: { conversations: true },
                },
            },
        });

        // Calculate LTV for each customer (using conversation count as proxy)
        const ltvs = customers.map((c) => c._count.conversations * 5); // $5 per conversation estimate
        ltvs.sort((a, b) => a - b);

        const average = ltvs.reduce((a, b) => a + b, 0) / ltvs.length || 0;
        const median = ltvs[Math.floor(ltvs.length / 2)] || 0;
        const topPercentile = ltvs[Math.floor(ltvs.length * 0.9)] || 0;

        // Create distribution buckets
        const buckets = [
            { range: '$0-25', min: 0, max: 25, count: 0 },
            { range: '$25-50', min: 25, max: 50, count: 0 },
            { range: '$50-100', min: 50, max: 100, count: 0 },
            { range: '$100-250', min: 100, max: 250, count: 0 },
            { range: '$250+', min: 250, max: Infinity, count: 0 },
        ];

        for (const ltv of ltvs) {
            const bucket = buckets.find((b) => ltv >= b.min && ltv < b.max);
            if (bucket) bucket.count++;
        }

        const distribution = buckets.map((b) => ({
            range: b.range,
            count: b.count,
            percentage: Math.round((b.count / customers.length) * 100) || 0,
        }));

        return {
            average: Math.round(average * 100) / 100,
            median,
            topPercentile,
            distribution,
        };
    }

    /**
     * Identify high-value customer behaviors
     */
    static async getBehaviorPatterns(params: {
        businessId: string;
        segment?: 'high_value' | 'churned' | 'active';
    }): Promise<{
        segment: string;
        characteristics: Array<{ trait: string; value: number; description: string }>;
        recommendations: string[];
    }> {
        const segment = params.segment || 'high_value';

        // Get customers in segment
        const customers = await db.customer.findMany({
            where: {
                businessId: params.businessId,
                ...(segment === 'high_value' ? { trustScore: { gte: 80 } } : {}),
                ...(segment === 'churned'
                    ? { lastInteraction: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }
                    : {}),
            },
            include: {
                _count: {
                    select: { conversations: true },
                },
            },
        });

        // Analyze characteristics
        const avgConversations =
            customers.reduce((sum, c) => sum + c._count.conversations, 0) / customers.length || 0;

        const characteristics = [
            {
                trait: 'Avg Conversations',
                value: Math.round(avgConversations * 10) / 10,
                description: 'Average number of conversations per customer',
            },
            {
                trait: 'Verification Rate',
                value: Math.round(
                    (customers.filter((c) => c.isVerified).length / customers.length) * 100
                ),
                description: 'Percentage of verified customers',
            },
        ];

        const recommendations =
            segment === 'high_value'
                ? ['Offer loyalty rewards', 'Provide priority support', 'Upsell premium services']
                : segment === 'churned'
                    ? ['Send win-back campaign', 'Offer special discount', 'Request feedback']
                    : ['Increase engagement', 'Offer product demos', 'Provide educational content'];

        return {
            segment,
            characteristics,
            recommendations,
        };
    }
}

/**
 * Prediction Service
 * Predictive analytics and ML-powered insights
 */
export class PredictionService {
    /**
     * Predict churn risk for customer
     */
    static async predictChurn(params: {
        customerId: string;
        businessId: string;
    }): Promise<ChurnPrediction> {
        const customer = await db.customer.findUnique({
            where: { id: params.customerId },
            include: {
                conversations: {
                    orderBy: { createdAt: 'desc' },
                    take: 10,
                },
                memories: {
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                },
            },
        });

        if (!customer) {
            throw new Error('Customer not found');
        }

        // Analyze risk factors
        const factors: string[] = [];
        let riskScore = 0;

        // Factor 1: Days since last interaction
        const daysSinceLastInteraction = Math.floor(
            (Date.now() - customer.lastInteraction.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysSinceLastInteraction > 30) {
            factors.push('No interaction in 30+ days');
            riskScore += 30;
        } else if (daysSinceLastInteraction > 14) {
            factors.push('No interaction in 14+ days');
            riskScore += 15;
        }

        // Factor 2: Low trust score
        if (customer.trustScore < 30) {
            factors.push('Low trust score');
            riskScore += 20;
        }

        // Factor 3: Negative sentiment in recent conversations
        const negativeSentiments = await db.sentimentLog.findMany({
            where: {
                customerId: params.customerId,
                sentiment: 'NEGATIVE',
                createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            },
        });

        if (negativeSentiments.length >= 2) {
            factors.push('Multiple negative sentiments recently');
            riskScore += 25;
        }

        // Factor 4: Complaint intent
        const complaints = await db.intentLog.findMany({
            where: {
                customerId: params.customerId,
                intent: 'COMPLAINT',
                createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            },
        });

        if (complaints.length > 0) {
            factors.push('Recent complaints');
            riskScore += 20;
        }

        // Determine risk level
        let churnRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
        if (riskScore >= 70) churnRisk = 'CRITICAL';
        else if (riskScore >= 50) churnRisk = 'HIGH';
        else if (riskScore >= 25) churnRisk = 'MEDIUM';

        // Generate recommendation
        let recommendation = 'Continue standard engagement';
        if (churnRisk === 'CRITICAL') {
            recommendation = 'Immediate intervention required - escalate to human agent';
        } else if (churnRisk === 'HIGH') {
            recommendation = 'Send personalized retention offer within 24 hours';
        } else if (churnRisk === 'MEDIUM') {
            recommendation = 'Increase engagement with helpful content';
        }

        return {
            customerId: params.customerId,
            churnRisk,
            confidence: Math.min(riskScore / 100 + 0.5, 0.95),
            factors,
            recommendation,
        };
    }

    /**
     * Predict customer lifetime value
     */
    static async predictLTV(params: {
        customerId: string;
        businessId: string;
    }): Promise<{
        predictedLTV: number;
        confidence: number;
        factors: Array<{ factor: string; impact: number }>;
        potential: 'LOW' | 'MEDIUM' | 'HIGH';
    }> {
        const customer = await db.customer.findUnique({
            where: { id: params.customerId },
            include: {
                _count: {
                    select: { conversations: true },
                },
            },
        });

        if (!customer) {
            throw new Error('Customer not found');
        }

        // Simple prediction model based on engagement
        let predictedLTV = customer._count.conversations * 10; // Base: $10 per conversation
        const factors: Array<{ factor: string; impact: number }> = [];

        // Positive factors
        if (customer.isVerified) {
            factors.push({ factor: 'Verified customer', impact: 20 });
            predictedLTV *= 1.2;
        }

        if (customer.trustScore > 70) {
            factors.push({ factor: 'High trust score', impact: 30 });
            predictedLTV *= 1.3;
        }

        // Negative factors
        const daysSinceInteraction = Math.floor(
            (Date.now() - customer.lastInteraction.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysSinceInteraction > 14) {
            factors.push({ factor: 'Recent inactivity', impact: -15 });
            predictedLTV *= 0.85;
        }

        const potential: 'LOW' | 'MEDIUM' | 'HIGH' =
            predictedLTV > 200 ? 'HIGH' : predictedLTV > 100 ? 'MEDIUM' : 'LOW';

        return {
            predictedLTV: Math.round(predictedLTV),
            confidence: 0.7,
            factors,
            potential,
        };
    }

    /**
     * Get next best action for customer
     */
    static async getNextBestAction(params: {
        customerId: string;
        businessId: string;
    }): Promise<NextBestAction> {
        const customer = await db.customer.findUnique({
            where: { id: params.customerId },
            include: {
                conversations: {
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                },
            },
        });

        if (!customer) {
            throw new Error('Customer not found');
        }

        // Analyze recent interactions
        const recentIntents = await db.intentLog.findMany({
            where: {
                customerId: params.customerId,
            },
            orderBy: { createdAt: 'desc' },
            take: 3,
        });

        const recentSentiment = await db.sentimentLog.findMany({
            where: {
                customerId: params.customerId,
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
        });

        // Determine best action
        let action: string;
        let priority: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';
        let expectedOutcome: string;
        let channel: string;

        const primaryIntent = recentIntents[0]?.intent;
        const sentiment = recentSentiment[0]?.sentiment;

        if (primaryIntent === 'COMPLAINT' || sentiment === 'NEGATIVE') {
            action = 'Escalate to human agent';
            priority = 'HIGH';
            expectedOutcome = 'Resolve issue and retain customer';
            channel = 'EMAIL';
        } else if (primaryIntent === 'SALES') {
            action = 'Send product demo offer';
            priority = 'HIGH';
            expectedOutcome = 'Schedule demo and move to opportunity';
            channel = customer.phone ? 'SMS' : 'EMAIL';
        } else if (!customer.isVerified) {
            action = 'Request verification';
            priority = 'MEDIUM';
            expectedOutcome = 'Increase trust score and engagement';
            channel = 'SMS';
        } else {
            action = 'Send helpful content';
            priority = 'LOW';
            expectedOutcome = 'Maintain engagement and build relationship';
            channel = 'EMAIL';
        }

        return {
            customerId: params.customerId,
            action,
            priority,
            expectedOutcome,
            channel,
        };
    }

    /**
     * Get business-wide predictions
     */
    static async getBusinessPredictions(params: {
        businessId: string;
    }): Promise<{
        atRiskCustomers: number;
        highPotentialCustomers: number;
        predictedRevenue: number;
        recommendedActions: string[];
    }> {
        const customers = await db.customer.findMany({
            where: { businessId: params.businessId },
        });

        let atRiskCount = 0;
        let highPotentialCount = 0;
        let totalPredictedLTV = 0;

        for (const customer of customers.slice(0, 100)) {
            // Skip for performance - in production, use batch processing
            const churnPrediction = await this.predictChurn({
                customerId: customer.id,
                businessId: params.businessId,
            });

            if (churnPrediction.churnRisk === 'HIGH' || churnPrediction.churnRisk === 'CRITICAL') {
                atRiskCount++;
            }

            const ltvPrediction = await this.predictLTV({
                customerId: customer.id,
                businessId: params.businessId,
            });

            if (ltvPrediction.potential === 'HIGH') {
                highPotentialCount++;
            }

            totalPredictedLTV += ltvPrediction.predictedLTV;
        }

        return {
            atRiskCustomers: atRiskCount,
            highPotentialCustomers: highPotentialCount,
            predictedRevenue: Math.round(totalPredictedLTV),
            recommendedActions: [
                `Contact ${atRiskCount} at-risk customers with retention offers`,
                `Nurture ${highPotentialCount} high-potential leads`,
                'Focus on converting qualified inquiries',
                'Implement feedback collection for negative sentiments',
            ],
        };
    }
}
