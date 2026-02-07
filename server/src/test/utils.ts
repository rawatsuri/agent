import { vi } from 'vitest';
import { db } from '@/config/database';

/**
 * Test Utilities
 *
 * Helper functions for writing tests
 */

/**
 * Create a test business
 */
export async function createTestBusiness(overrides = {}) {
  const business = await db.business.create({
    data: {
      clerkId: `test_clerk_${Date.now()}`,
      name: 'Test Business',
      email: 'test@business.com',
      phone: '+1234567890',
      apiKey: `test_api_key_${Date.now()}`,
      ...overrides,
    },
  });

  // Create associated records
  await db.businessCredit.create({
    data: {
      businessId: business.id,
      totalCredits: 1000,
      monthlyBudget: 100,
    },
  });

  await db.rateLimitConfig.create({
    data: {
      businessId: business.id,
    },
  });

  return business;
}

/**
 * Create a test customer
 */
export async function createTestCustomer(businessId: string, overrides = {}) {
  return db.customer.create({
    data: {
      businessId,
      name: 'Test Customer',
      email: `test_${Date.now()}@customer.com`,
      phone: `+1555${Math.floor(Math.random() * 10000000)}`,
      trustScore: 50,
      isVerified: false,
      ...overrides,
    },
  });
}

/**
 * Create a test conversation
 */
export async function createTestConversation(
  businessId: string,
  customerId: string,
  overrides = {}
) {
  return db.conversation.create({
    data: {
      businessId,
      customerId,
      channel: 'CHAT',
      status: 'ACTIVE',
      ...overrides,
    },
  });
}

/**
 * Create test messages
 */
export async function createTestMessages(
  conversationId: string,
  count: number = 5
) {
  const messages = [];
  for (let i = 0; i < count; i++) {
    const message = await db.message.create({
      data: {
        conversationId,
        role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
        content: `Test message ${i + 1}`,
        channel: 'CHAT',
        status: 'SENT',
      },
    });
    messages.push(message);
  }
  return messages;
}

/**
 * Mock Redis client for testing
 */
export function createMockRedisClient() {
  const store = new Map<string, any>();

  return {
    get: vi.fn((key: string) => Promise.resolve(store.get(key) || null)),
    set: vi.fn((key: string, value: any) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    setex: vi.fn((key: string, seconds: number, value: any) => {
      store.set(key, value);
      setTimeout(() => store.delete(key), seconds * 1000);
      return Promise.resolve('OK');
    }),
    del: vi.fn((...keys: string[]) => {
      keys.forEach((key) => store.delete(key));
      return Promise.resolve(keys.length);
    }),
    keys: vi.fn((pattern: string) => {
      const regex = new RegExp(pattern.replace('*', '.*'));
      return Promise.resolve(
        Array.from(store.keys()).filter((k) => regex.test(k))
      );
    }),
    expire: vi.fn(() => Promise.resolve(1)),
    ttl: vi.fn(() => Promise.resolve(3600)),
    incr: vi.fn((key: string) => {
      const current = parseInt(store.get(key) || '0');
      store.set(key, (current + 1).toString());
      return Promise.resolve(current + 1);
    }),
    zadd: vi.fn(() => Promise.resolve(1)),
    zcard: vi.fn(() => Promise.resolve(0)),
    zrange: vi.fn(() => Promise.resolve([])),
    zrangebyscore: vi.fn(() => Promise.resolve([])),
    zremrangebyscore: vi.fn(() => Promise.resolve(0)),
    quit: vi.fn(() => Promise.resolve('OK')),
    _store: store, // Expose for inspection in tests
  };
}

/**
 * Mock Request object for testing middleware
 */
export function createMockRequest(overrides = {}) {
  return {
    headers: {},
    body: {},
    params: {},
    query: {},
    socket: {
      remoteAddress: '127.0.0.1',
    },
    auth: {
      userId: 'test_user_id',
      sessionId: 'test_session_id',
    },
    ...overrides,
  };
}

/**
 * Mock Response object for testing middleware
 */
export function createMockResponse() {
  const res: any = {
    statusCode: 200,
    jsonData: null,
    status: vi.fn(function (code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function (data: any) {
      this.jsonData = data;
      return this;
    }),
    send: vi.fn(function (data: any) {
      this.jsonData = data;
      return this;
    }),
    end: vi.fn(),
  };
  return res;
}

/**
 * Wait for a specified time
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate random string
 */
export function randomString(length: number = 10): string {
  return Math.random().toString(36).substring(2, 2 + length);
}

/**
 * Generate random phone number
 */
export function randomPhone(): string {
  return `+1555${Math.floor(Math.random() * 10000000).toString().padStart(7, '0')}`;
}

/**
 * Generate random email
 */
export function randomEmail(): string {
  return `test_${randomString(8)}@example.com`;
}
