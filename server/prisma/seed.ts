import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...\n');

  // Clean up existing test data first
  console.log('Cleaning up existing test data...');
  await prisma.business.deleteMany({
    where: { clerkId: 'test_clerk_id_12345' }
  });
  console.log('✅ Cleaned up existing test data\n');

  // 1. Create Test Business
  console.log('Creating test business...');
  const business = await prisma.business.create({
    data: {
      clerkId: 'test_clerk_id_12345',
      name: 'Test AI Business',
      email: 'test@example.com',
      phone: '+911234567890',
      industry: 'technology',
      active: true,
      enabledChannels: ['VOICE', 'CHAT', 'SMS'],
      aiModel: 'gpt-4o-mini',
      ttsProvider: 'azure',
      ttsVoiceId: 'en-US-JennyNeural',
      defaultLanguage: 'en',
      supportedLanguages: ['en', 'hi'],
      voiceProvider: 'exotel',
      config: {
        personality: 'friendly_professional',
        tone: 'warm',
        customInstructions: 'Be helpful and concise. Always greet customers warmly.',
        prohibitedTopics: ['politics', 'religion'],
        escalationTriggers: ['angry', 'frustrated', 'manager', 'supervisor'],
        operatingHours: {
          monday: { start: '09:00', end: '18:00' },
          tuesday: { start: '09:00', end: '18:00' },
          wednesday: { start: '09:00', end: '18:00' },
          thursday: { start: '09:00', end: '18:00' },
          friday: { start: '09:00', end: '18:00' },
          saturday: { start: '10:00', end: '14:00' },
          sunday: { start: null, end: null },
        },
        autoReply: true,
        humanHandoff: true,
      },
    },
  });
  console.log(`✅ Business created: ${business.name} (ID: ${business.id})\n`);

  // 2. Create Business Credits
  console.log('Creating business credits...');
  await prisma.businessCredit.create({
    data: {
      businessId: business.id,
      totalCredits: 1000.00,
      availableCredits: 1000.00,
      monthlyBudget: 500.00,
      planType: 'STARTER',
      planCredits: 100.00,
    },
  });
  console.log('✅ Business credits created\n');

  // 3. Create Test Customer
  console.log('Creating test customer...');
  const customer = await prisma.customer.create({
    data: {
      businessId: business.id,
      name: 'John Doe',
      email: 'john.doe@example.com',
      phone: '+919999999999',
      trustScore: 75,
      isVerified: true,
      preferences: {
        language: 'en',
        communicationChannel: 'VOICE',
      },
      tags: ['vip', 'repeat-customer'],
    },
  });
  console.log(`✅ Customer created: ${customer.name} (ID: ${customer.id})\n`);

  // 4. Create Sample Memories
  console.log('Creating sample memories...');
  await prisma.memory.createMany({
    data: [
      {
        customerId: customer.id,
        content: 'Customer prefers morning appointments between 9-11 AM',
        source: 'CONVERSATION',
        metadata: { conversationId: 'conv-001', importance: 8 },
      },
      {
        customerId: customer.id,
        content: 'Interested in premium pricing plan',
        source: 'CONVERSATION',
        metadata: { conversationId: 'conv-002', importance: 9 },
      },
      {
        customerId: customer.id,
        content: 'Has 2 previous support tickets resolved successfully',
        source: 'SYSTEM',
        metadata: { tickets: 2, importance: 5 },
      },
    ],
  });
  console.log('✅ Sample memories created\n');

  // 5. Create Past Conversation
  console.log('Creating past conversation...');
  const conversation = await prisma.conversation.create({
    data: {
      customerId: customer.id,
      businessId: business.id,
      channel: 'CHAT',
      status: 'CLOSED',
      summary: 'Customer inquired about pricing plans and features',
      metadata: {
        userAgent: 'Mozilla/5.0',
        ipAddress: '192.168.1.1',
      },
      messages: {
        create: [
          {
            role: 'USER',
            content: 'Hi, I want to know about your pricing',
            channel: 'CHAT',
          },
          {
            role: 'ASSISTANT',
            content: 'Hello! We have three pricing tiers: Starter ($99/month), Growth ($199/month), and Enterprise ($499/month). Which one interests you?',
            channel: 'CHAT',
            aiCost: 0.002,
          },
          {
            role: 'USER',
            content: 'Tell me more about the Growth plan',
            channel: 'CHAT',
          },
          {
            role: 'ASSISTANT',
            content: 'The Growth plan includes unlimited conversations, advanced analytics, multi-channel support, and priority support. Would you like me to schedule a demo?',
            channel: 'CHAT',
            aiCost: 0.002,
          },
        ],
      },
    },
  });
  console.log(`✅ Past conversation created (ID: ${conversation.id})\n`);

  // 6. Create Business FAQ
  console.log('Creating business FAQs...');
  await prisma.businessFAQ.createMany({
    data: [
      {
        businessId: business.id,
        question: 'What are your business hours?',
        answer: 'We are open Monday to Friday from 9 AM to 6 PM, and Saturday from 10 AM to 2 PM. We are closed on Sundays.',
        category: 'GENERAL',
      },
      {
        businessId: business.id,
        question: 'How do I contact support?',
        answer: 'You can reach our support team via phone at +911234567890 or email at support@example.com. We typically respond within 2 hours.',
        category: 'SUPPORT',
      },
      {
        businessId: business.id,
        question: 'What is your refund policy?',
        answer: 'We offer a 30-day money-back guarantee on all our plans. No questions asked.',
        category: 'BILLING',
      },
    ],
  });
  console.log('✅ Business FAQs created\n');

  // 7. Create Rate Limit Config
  console.log('Creating rate limit configuration...');
  await prisma.rateLimitConfig.create({
    data: {
      businessId: business.id,
      maxMessagesPerDay: 50,
      maxCallsPerDay: 3,
      maxCallDurationMinutes: 5,
      messageCooldownSeconds: 30,
      maxMessagesPerHour: 20,
      maxCallsPerHour: 1,
      monthlyMessageQuota: 1000,
      monthlyCallQuota: 100,
      monthlySMQuota: 500,
      enableAbuseDetection: true,
      blockVpnTraffic: false,
      requireVerification: true,
      autoBlockAfterAbuseCount: 3,
    },
  });
  console.log('✅ Rate limit configuration created\n');

  console.log('🎉 Database seed completed successfully!\n');
  console.log('Test Data Summary:');
  console.log(`- Business: ${business.name} (${business.id})`);
  console.log(`- Customer: ${customer.name} (${customer.phone})`);
  console.log(`- Credits: $1000 balance, $500/month budget`);
  console.log(`- Memories: 3 stored`);
  console.log(`- Past Conversations: 1`);
  console.log(`- FAQs: 3`);
  console.log('\nYou can now test the voice API with:');
  console.log(`Phone: ${customer.phone}`);
  console.log(`Business ID: ${business.id}`);
  console.log(`Customer ID: ${customer.id}`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
