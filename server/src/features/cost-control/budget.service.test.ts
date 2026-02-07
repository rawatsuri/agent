import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BudgetService } from '@/features/cost-control/budget.service';
import { db } from '@/config/database';
import { createTestBusiness } from '@test/utils';

describe('BudgetService', () => {
  beforeEach(async () => {
    // Clean up before each test
    await db.costLog.deleteMany();
    await db.businessCredit.deleteMany();
    await db.business.deleteMany();
  });

  describe('initializeBusiness', () => {
    it('should create a business with default starter plan', async () => {
      const business = await createTestBusiness();
      
      await BudgetService.initializeBusiness(business.id, 'STARTER');
      
      const credit = await db.businessCredit.findUnique({
        where: { businessId: business.id },
      });
      
      expect(credit).toBeTruthy();
      expect(credit?.planType).toBe('STARTER');
      expect(Number(credit?.totalCredits)).toBe(100);
      expect(Number(credit?.monthlyBudget)).toBe(50);
    });

    it('should create a business with pro plan', async () => {
      const business = await createTestBusiness();
      
      await BudgetService.initializeBusiness(business.id, 'PRO');
      
      const credit = await db.businessCredit.findUnique({
        where: { businessId: business.id },
      });
      
      expect(credit?.planType).toBe('PRO');
      expect(Number(credit?.totalCredits)).toBe(500);
      expect(Number(credit?.monthlyBudget)).toBe(200);
    });
  });

  describe('hasBudgetAvailable', () => {
    it('should allow requests when budget is available', async () => {
      const business = await createTestBusiness();
      await BudgetService.initializeBusiness(business.id);
      
      const result = await BudgetService.hasBudgetAvailable(business.id, 0.01);
      
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should deny requests when account is paused', async () => {
      const business = await createTestBusiness();
      await BudgetService.initializeBusiness(business.id);
      await BudgetService.pauseBusiness(business.id, 'Test pause');
      
      const result = await BudgetService.hasBudgetAvailable(business.id, 0.01);
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('paused');
      expect(result.percentUsed).toBe(100);
    });

    it('should auto-pause when budget would be exceeded', async () => {
      const business = await createTestBusiness();
      await BudgetService.initializeBusiness(business.id);
      
      // Update to use almost all budget
      await db.businessCredit.update({
        where: { businessId: business.id },
        data: { currentMonthSpend: 49.99 },
      });
      
      const result = await BudgetService.hasBudgetAvailable(business.id, 0.02);
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('auto-paused');
    });
  });

  describe('pauseBusiness', () => {
    it('should pause a business account', async () => {
      const business = await createTestBusiness();
      await BudgetService.initializeBusiness(business.id);
      
      await BudgetService.pauseBusiness(business.id, 'Budget exceeded');
      
      const credit = await db.businessCredit.findUnique({
        where: { businessId: business.id },
      });
      
      expect(credit?.isPaused).toBe(true);
      expect(credit?.pauseReason).toBe('Budget exceeded');
      expect(credit?.pausedAt).toBeTruthy();
    });
  });

  describe('resumeBusiness', () => {
    it('should resume a paused business with available budget', async () => {
      const business = await createTestBusiness();
      await BudgetService.initializeBusiness(business.id);
      await BudgetService.pauseBusiness(business.id, 'Test');
      
      await BudgetService.resumeBusiness(business.id);
      
      const credit = await db.businessCredit.findUnique({
        where: { businessId: business.id },
      });
      
      expect(credit?.isPaused).toBe(false);
      expect(credit?.pausedAt).toBeNull();
    });

    it('should throw error if no budget available', async () => {
      const business = await createTestBusiness();
      await BudgetService.initializeBusiness(business.id);
      await BudgetService.pauseBusiness(business.id, 'Test');
      
      // Use up all budget
      await db.businessCredit.update({
        where: { businessId: business.id },
        data: { 
          currentMonthSpend: 100,
          totalCredits: 0,
          usedCredits: 0,
        },
      });
      
      await expect(
        BudgetService.resumeBusiness(business.id)
      ).rejects.toThrow('No budget or credits available');
    });
  });

  describe('addCredits', () => {
    it('should add credits to business account', async () => {
      const business = await createTestBusiness();
      await BudgetService.initializeBusiness(business.id);
      
      await BudgetService.addCredits(business.id, 500);
      
      const credit = await db.businessCredit.findUnique({
        where: { businessId: business.id },
      });
      
      expect(Number(credit?.totalCredits)).toBe(600); // 100 + 500
    });
  });

  describe('getCostDashboard', () => {
    it('should return dashboard data with daily spend', async () => {
      const business = await createTestBusiness();
      await BudgetService.initializeBusiness(business.id);
      
      // Add some cost logs
      await db.costLog.create({
        data: {
          businessId: business.id,
          service: 'OPENAI_GPT',
          cost: 0.5,
        },
      });
      
      await db.businessCredit.update({
        where: { businessId: business.id },
        data: { currentMonthSpend: 0.5 },
      });
      
      const dashboard = await BudgetService.getCostDashboard(business.id);
      
      expect(dashboard.currentMonthSpend).toBe(0.5);
      expect(dashboard.monthlyBudget).toBe(50);
      expect(dashboard.budgetUsedPercent).toBe(1);
      expect(dashboard.isPaused).toBe(false);
      expect(dashboard.dailySpend).toHaveLength(1);
    });
  });
});
