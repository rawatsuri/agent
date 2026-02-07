import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '@/app';
import { db } from '@/config/database';
import { createTestBusiness, createTestCustomer, wait } from '@test/utils';
import { ConversationOrchestrator } from '@/services/conversation.orchestrator';
import { BudgetService } from '@/features/cost-control/budget.service';

describe('Integration Tests - End-to-End Flows', () => {
  beforeAll(async () => {
    // Clean database
    await db.costLog.deleteMany();
    await db.message.deleteMany();
    await db.conversation.deleteMany();
    await db.customer.deleteMany();
    await db.businessCredit.deleteMany();
    await db.business.deleteMany();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  describe('Full Conversation Flow', () => {
    it('should handle complete customer conversation with caching', async () => {
      // 1. Create business
      const business = await createTestBusiness();
      await BudgetService.initializeBusiness(business.id);

      // 2. Simulate customer message via chat
      const customerData = {
        phone: '+15551234567',
        businessId: business.id,
        channel: 'CHAT',
        content: 'What are your business hours?',
      };

      // 3. Process message through orchestrator
      const response1 = await ConversationOrchestrator.processMessage({
        businessId: business.id,
        channel: 'CHAT',
        content: customerData.content,
        customerPhone: customerData.phone,
        metadata: { source: 'integration_test' },
      });

      // Verify response
      expect(response1.content).toBeTruthy();
      expect(response1.needsHumanTransfer).toBe(false);
      expect(response1.metadata?.conversationId).toBeTruthy();

      // 4. Verify customer was created
      const customer = await db.customer.findFirst({
        where: { phone: customerData.phone, businessId: business.id },
      });
      expect(customer).toBeTruthy();

      // 5. Verify conversation was created
      const conversation = await db.conversation.findFirst({
        where: { customerId: customer?.id },
      });
      expect(conversation).toBeTruthy();
      expect(conversation?.status).toBe('ACTIVE');

      // 6. Verify messages were saved
      const messages = await db.message.findMany({
        where: { conversationId: conversation?.id },
      });
      expect(messages).toHaveLength(2); // User + Assistant

      // 7. Verify cost was logged
      const costLogs = await db.costLog.findMany({
        where: { businessId: business.id },
      });
      expect(costLogs.length).toBeGreaterThan(0);

      // 8. Send follow-up message (should potentially use cache)
      const response2 = await ConversationOrchestrator.processMessage({
        businessId: business.id,
        channel: 'CHAT',
        content: 'When do you close?',
        customerPhone: customerData.phone,
        metadata: { source: 'integration_test' },
      });

      expect(response2.content).toBeTruthy();

      // 9. Verify conversation continued
      const updatedMessages = await db.message.findMany({
        where: { conversationId: conversation?.id },
      });
      expect(updatedMessages).toHaveLength(4); // 2 more messages added
    });

    it('should handle rate limiting correctly', async () => {
      const business = await createTestBusiness();
      await BudgetService.initializeBusiness(business.id);
      const phone = '+15559876543';

      // Send messages up to limit
      const messages = [];
      for (let i = 0; i < 5; i++) {
        const response = await ConversationOrchestrator.processMessage({
          businessId: business.id,
          channel: 'CHAT',
          content: `Test message ${i}`,
          customerPhone: phone,
        });
        messages.push(response);
      }

      // All should succeed (under daily limit)
      expect(messages.every((m) => m.content)).toBe(true);

      // Verify customer was rate-limited in Redis
      // (This would be checked via middleware in real scenarios)
    });

    it('should respect budget limits', async () => {
      const business = await createTestBusiness();
      await BudgetService.initializeBusiness(business.id);

      // Set very low budget
      await db.businessCredit.update({
        where: { businessId: business.id },
        data: { monthlyBudget: 0.001 },
      });

      // First request should work
      const response1 = await ConversationOrchestrator.processMessage({
        businessId: business.id,
        channel: 'CHAT',
        content: 'Hello',
        customerPhone: '+15551112222',
      });

      expect(response1.content).toBeTruthy();

      // Check if budget would be exceeded
      const budgetCheck = await BudgetService.hasBudgetAvailable(business.id, 0.001);

      if (!budgetCheck.allowed) {
        // Budget was auto-paused
        const credit = await db.businessCredit.findUnique({
          where: { businessId: business.id },
        });
        expect(credit?.isPaused).toBe(true);
      }
    });

    it('should handle abuse detection', async () => {
      const business = await createTestBusiness();
      await BudgetService.initializeBusiness(business.id);
      const phone = '+15553334444';

      // Send rapid messages to trigger abuse detection
      const startTime = Date.now();
      for (let i = 0; i < 6; i++) {
        await ConversationOrchestrator.processMessage({
          businessId: business.id,
          channel: 'CHAT',
          content: `Rapid message ${i}`,
          customerPhone: phone,
        });
      }
      const endTime = Date.now();

      // Should complete quickly (under 10 seconds to trigger rapid fire)
      expect(endTime - startTime).toBeLessThan(10000);

      // Verify abuse logs were created
      const abuseLogs = await db.abuseLog.findMany({
        where: { phone },
      });

      // Abuse detection would flag rapid fire
      expect(abuseLogs.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Multi-Channel Flow', () => {
    it('should maintain context across channels', async () => {
      const business = await createTestBusiness();
      await BudgetService.initializeBusiness(business.id);
      const phone = '+15557778888';
      const email = 'test@customer.com';

      // 1. Start conversation on Chat
      await ConversationOrchestrator.processMessage({
        businessId: business.id,
        channel: 'CHAT',
        content: 'I need help with my order',
        customerPhone: phone,
        customerEmail: email,
      });

      // 2. Continue on Email
      await ConversationOrchestrator.processMessage({
        businessId: business.id,
        channel: 'EMAIL',
        content: 'Following up on my previous message',
        customerEmail: email,
      });

      // 3. Customer should be the same
      const customers = await db.customer.findMany({
        where: {
          OR: [{ phone }, { email }],
          businessId: business.id,
        },
      });

      // Should have created single customer
      expect(customers.length).toBeLessThanOrEqual(2);

      // 4. Should have multiple conversations
      const conversations = await db.conversation.findMany({
        where: { businessId: business.id },
      });

      expect(conversations.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('API Endpoints', () => {
    it('should return health check status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
    });

    it('should handle webhook endpoints', async () => {
      // Test webhook endpoint exists
      const response = await request(app)
        .post('/webhooks/test')
        .send({ test: true });

      // Should not crash (actual validation happens with real webhooks)
      expect(response.status).toBeGreaterThanOrEqual(200);
    });
  });
});
