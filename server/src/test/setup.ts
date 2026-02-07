import { vi } from 'vitest';
import { db } from '@/config/database';

// Mock environment variables
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_db';
process.env.REDIS_URL = 'redis://localhost:6379/1';
process.env.OPENAI_API_KEY = 'sk-test-key';
process.env.CLERK_SECRET_KEY = 'sk_test_clerk';
process.env.NODE_ENV = 'test';

// Global test setup
beforeAll(async () => {
  // Clean test database before running tests
  await cleanDatabase();
});

// Global test teardown
afterAll(async () => {
  // Clean up after all tests
  await cleanDatabase();
  await db.$disconnect();
});

// Clean database helper
async function cleanDatabase() {
  const tables = [
    'rate_limit_hits',
    'abuse_logs',
    'cost_logs',
    'response_caches',
    'business_faqs',
    'campaigns',
    'business_credits',
    'rate_limit_configs',
    'call_recordings',
    'memories',
    'messages',
    'conversations',
    'customers',
    'businesses',
  ];

  for (const table of tables) {
    try {
      await db.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
    } catch (error) {
      // Table might not exist, ignore
    }
  }
}

// Mock Redis
vi.mock('@/config/redis', () => ({
  getRedisClient: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    keys: vi.fn(() => []),
    expire: vi.fn(),
    ttl: vi.fn(),
    incr: vi.fn(),
    zadd: vi.fn(),
    zcard: vi.fn(),
    zrange: vi.fn(() => []),
    zrangebyscore: vi.fn(() => []),
    zremrangebyscore: vi.fn(),
    quit: vi.fn(),
  })),
}));

// Mock OpenAI
vi.mock('openai', () => ({
  default: vi.fn(() => ({
    chat: {
      completions: {
        create: vi.fn(() =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: 'Test AI response',
                },
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150,
            },
          })
        ),
      },
    },
    embeddings: {
      create: vi.fn(() =>
        Promise.resolve({
          data: [
            {
              embedding: Array(1536).fill(0).map(() => Math.random()),
            },
          ],
        })
      ),
    },
  })),
}));

// Mock SendGrid
vi.mock('@sendgrid/mail', () => ({
  setApiKey: vi.fn(),
  send: vi.fn(() => Promise.resolve([{ statusCode: 202 }])),
}));

// Mock logger to reduce noise in tests
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Global test utilities
declare global {
  var expect: typeof import('vitest').expect;
  var describe: typeof import('vitest').describe;
  var it: typeof import('vitest').it;
  var beforeAll: typeof import('vitest').beforeAll;
  var afterAll: typeof import('vitest').afterAll;
  var beforeEach: typeof import('vitest').beforeEach;
  var afterEach: typeof import('vitest').afterEach;
  var vi: typeof import('vitest').vi;
}
