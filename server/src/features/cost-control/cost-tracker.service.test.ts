import { describe, it, expect, beforeEach } from 'vitest';
import { CostTrackerService } from '@/features/cost-control/cost-tracker.service';
import { BudgetService } from '@/features/cost-control/budget.service';
import { db } from '@/config/database';
import { createTestBusiness, createTestCustomer, createTestConversation } from '@test/utils';

describe('CostTrackerService', () => {
  beforeEach(async () => {
    await db.costLog.deleteMany();
    await db.businessCredit.deleteMany();
    await db.conversation.deleteMany();
    await db.customer.deleteMany();
    await db.business.deleteMany();
  });

  describe('logAICost', () => {
    it('should log AI cost and update business spend', async () => {
      const business = await createTestBusiness();
      await BudgetService.initializeBusiness(business.id);
      const customer = await createTestCustomer(business.id);
      const conversation = await createTestConversation(business.id, customer.id);

      await CostTrackerService.logAICost({
        businessId: business.id,
        customerId: customer.id,
        conversationId: conversation.id,
        service: 'OPENAI_GPT',
        cost: 0.0015,
        tokensUsed: 150,
        model: 'gpt-4o-mini',
        channel: 'CHAT',
        metadata: { inputTokens: 100, outputTokens: 50 },
      });

      const costLogs = await db.costLog.findMany({
        where: { businessId: business.id },
      });

      expect(costLogs).toHaveLength(1);
      expect(costLogs[0].service).toBe('OPENAI_GPT');
      expect(Number(costLogs[0].cost)).toBe(0.0015);
      expect(costLogs[0].tokensUsed).toBe(150);
      expect(costLogs[0].model).toBe('gpt-4o-mini');

      // Verify business spend was updated
      const credit = await db.businessCredit.findUnique({
        where: { businessId: business.id },
      });
      expect(Number(credit?.usedCredits)).toBe(0.0015);
      expect(Number(credit?.currentMonthSpend)).toBe(0.0015);
    });
  });

  describe('logExternalCost', () => {
    it('should log external service cost', async () => {
      const business = await createTestBusiness();
      await BudgetService.initializeBusiness(business.id);

      await CostTrackerService.logExternalCost({
        businessId: business.id,
        service: 'EXOTEL_SMS',
        cost: 0.005,
        channel: 'SMS',
        metadata: { messageParts: 1 },
      });

      const costLogs = await db.costLog.findMany({
        where: { businessId: business.id },
      });

      expect(costLogs).toHaveLength(1);
      expect(costLogs[0].service).toBe('EXOTEL_SMS');
      expect(Number(costLogs[0].cost)).toBe(0.005);
    });

    it('should log voice call cost with duration', async () => {
      const business = await createTestBusiness();
      await BudgetService.initializeBusiness(business.id);

      await CostTrackerService.logExternalCost({
        businessId: business.id,
        service: 'EXOTEL_VOICE',
        cost: 0.04,
        durationSeconds: 120,
        channel: 'VOICE',
      });

      const costLogs = await db.costLog.findMany({
        where: { businessId: business.id },
      });

      expect(costLogs[0].service).toBe('EXOTEL_VOICE');
      expect(costLogs[0].durationSeconds).toBe(120);
    });
  });

  describe('calculateGPTCost', () => {
    it('should calculate GPT-4o-mini cost correctly', () => {
      const cost = CostTrackerService.calculateGPTCost('gpt-4o-mini', 1000, 500);
      
      // Input: 1000 tokens * $0.00015/1K = $0.00015
      // Output: 500 tokens * $0.0006/1K = $0.0003
      // Total: $0.00045
      expect(cost).toBeCloseTo(0.00045, 5);
    });

    it('should calculate GPT-4o cost correctly', () => {
      const cost = CostTrackerService.calculateGPTCost('gpt-4o', 2000, 1000);
      
      // Input: 2000 tokens * $0.005/1K = $0.01
      // Output: 1000 tokens * $0.015/1K = $0.015
      // Total: $0.025
      expect(cost).toBeCloseTo(0.025, 3);
    });

    it('should default to gpt-4o-mini for unknown models', () => {
      const cost = CostTrackerService.calculateGPTCost('unknown-model', 1000, 500);
      expect(cost).toBeGreaterThan(0);
    });
  });

  describe('calculateEmbeddingCost', () => {
    it('should calculate embedding cost correctly', () => {
      const cost = CostTrackerService.calculateEmbeddingCost(1000000);
      
      // 1M tokens * $0.02/1M = $0.02
      expect(cost).toBe(0.02);
    });

    it('should handle small token counts', () => {
      const cost = CostTrackerService.calculateEmbeddingCost(1000);
      expect(cost).toBeCloseTo(0.00002, 5);
    });
  });

  describe('calculateTTSCost', () => {
    it('should calculate TTS cost correctly', () => {
      const cost = CostTrackerService.calculateTTSCost(1000000);
      
      // 1M characters * $1/1M = $1
      expect(cost).toBe(1.0);
    });
  });

  describe('getMonthlyCostSummary', () => {
    it('should return cost summary for current month', async () => {
      const business = await createTestBusiness();
      await BudgetService.initializeBusiness(business.id);

      // Create cost logs
      await db.costLog.createMany({
        data: [
          { businessId: business.id, service: 'OPENAI_GPT', cost: 0.5, tokensUsed: 1000 },
          { businessId: business.id, service: 'OPENAI_GPT', cost: 0.3, tokensUsed: 600 },
          { businessId: business.id, service: 'EXOTEL_SMS', cost: 0.01 },
        ],
      });

      const summary = await CostTrackerService.getMonthlyCostSummary(business.id);

      expect(summary.totalCost).toBe(0.81);
      expect(summary.byService['OPENAI_GPT']).toBe(0.8);
      expect(summary.byService['EXOTEL_SMS']).toBe(0.01);
      expect(summary.tokenCount).toBe(1600);
      expect(summary.messageCount).toBe(3);
    });
  });
});
