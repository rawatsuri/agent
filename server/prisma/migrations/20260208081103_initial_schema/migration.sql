/*
  Warnings:

  - You are about to drop the `Roles` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('VOICE', 'CHAT', 'EMAIL', 'SMS', 'TELEGRAM', 'WHATSAPP', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'CLOSED', 'TRANSFERRED', 'HUMAN_HANDOFF', 'COMPLETED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "CampaignType" AS ENUM ('SCHEDULED', 'EVENT_BASED', 'REMINDER', 'PROMOTION', 'FOLLOW_UP', 'ABANDONED_CART', 'APPOINTMENT_REMINDER', 'BIRTHDAY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CampaignTrigger" AS ENUM ('SCHEDULED', 'EVENT_BASED', 'BEHAVIORAL');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "WinnerCriteria" AS ENUM ('OPEN_RATE', 'CLICK_RATE', 'REPLY_RATE', 'CONVERSION_RATE');

-- CreateEnum
CREATE TYPE "CRMProvider" AS ENUM ('SALESFORCE', 'HUBSPOT', 'ZOHO', 'FRESHSALES', 'PIPEDRIVE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CUSTOMER_CREATED', 'CUSTOMER_UPDATED', 'CUSTOMER_DELETED', 'CUSTOMER_VERIFIED', 'CUSTOMER_BLOCKED', 'CUSTOMER_UNBLOCKED', 'BUSINESS_CREATED', 'BUSINESS_UPDATED', 'BUSINESS_DELETED', 'CONVERSATION_CREATED', 'CONVERSATION_CLOSED', 'CONVERSATION_TRANSFERRED', 'MESSAGE_SENT', 'MESSAGE_DELETED', 'CAMPAIGN_CREATED', 'CAMPAIGN_UPDATED', 'CAMPAIGN_EXECUTED', 'CAMPAIGN_DELETED', 'AI_CONFIG_UPDATED', 'CREDITS_ADDED', 'CREDITS_DEDUCTED', 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'PASSWORD_CHANGED');

-- CreateEnum
CREATE TYPE "AuditSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_roleId_fkey";

-- DropTable
DROP TABLE "Roles";

-- DropTable
DROP TABLE "User";

-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "clerkId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" TEXT NOT NULL,
    "clerkId" TEXT,
    "apiKey" TEXT,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "aiConfig" JSONB,
    "enabledChannels" "Channel"[] DEFAULT ARRAY['VOICE', 'CHAT', 'EMAIL', 'SMS', 'TELEGRAM', 'WHATSAPP', 'INSTAGRAM']::"Channel"[],
    "aiModel" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "ttsProvider" TEXT NOT NULL DEFAULT 'azure',
    "ttsVoiceId" TEXT NOT NULL DEFAULT 'en-US-JennyNeural',
    "defaultLanguage" TEXT NOT NULL DEFAULT 'en',
    "supportedLanguages" TEXT[] DEFAULT ARRAY['en']::TEXT[],
    "voiceProvider" TEXT,
    "twilioPhoneNumber" TEXT,
    "exotelPhoneNumber" TEXT,
    "tier" TEXT NOT NULL DEFAULT 'STARTER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_credits" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "planType" TEXT NOT NULL DEFAULT 'STARTER',
    "totalCredits" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "usedCredits" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "availableCredits" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "monthlyBudget" DECIMAL(10,2) NOT NULL DEFAULT 100,
    "currentMonthSpend" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lastResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alertThresholds" INTEGER[] DEFAULT ARRAY[75, 90]::INTEGER[],
    "lastAlertAt75" TIMESTAMP(3),
    "lastAlertAt90" TIMESTAMP(3),
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "pausedAt" TIMESTAMP(3),
    "pauseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "email" TEXT,
    "password" TEXT,
    "phone" TEXT,
    "name" TEXT,
    "aiConfig" JSONB,
    "enabledChannels" "Channel"[] DEFAULT ARRAY['VOICE', 'CHAT', 'EMAIL', 'SMS', 'TELEGRAM', 'WHATSAPP', 'INSTAGRAM']::"Channel"[],
    "metadata" JSONB,
    "preferences" JSONB,
    "tags" TEXT[],
    "trustScore" INTEGER NOT NULL DEFAULT 50,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "firstInteraction" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInteraction" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_credits" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "totalCredits" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "usedCredits" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "availableCredits" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "monthlyBudget" DECIMAL(10,2) NOT NULL DEFAULT 100,
    "currentMonthSpend" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lastResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "pausedAt" TIMESTAMP(3),
    "pauseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "summary" TEXT,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'SENT',
    "metadata" JSONB,
    "aiCost" DECIMAL(10,6),
    "embeddingCost" DECIMAL(8,6),
    "cachedResponse" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memories" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "source" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_recordings" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'exotel',
    "recordingUrl" TEXT,
    "duration" INTEGER,
    "transcription" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_logs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "conversationId" TEXT,
    "service" TEXT NOT NULL,
    "cost" DECIMAL(10,6) NOT NULL,
    "tokensUsed" INTEGER,
    "durationSeconds" INTEGER,
    "channel" "Channel",
    "model" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "response_caches" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "embeddingHash" TEXT NOT NULL,
    "queryVector" vector(1536),
    "query" TEXT NOT NULL,
    "queryText" TEXT NOT NULL,
    "queryNormalized" TEXT NOT NULL,
    "responseText" TEXT NOT NULL,
    "contextHash" TEXT,
    "hitCount" INTEGER NOT NULL DEFAULT 1,
    "similarityScore" DECIMAL(65,30) NOT NULL DEFAULT 0.92,
    "lastAccessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sourceChannel" TEXT,
    "isFAQ" BOOLEAN NOT NULL DEFAULT false,
    "avgRating" DECIMAL(3,2),
    "feedbackCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "response_caches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_faqs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "questionVariants" TEXT[],
    "answer" TEXT NOT NULL,
    "category" TEXT,
    "embedding" vector(1536),
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "autoExtracted" BOOLEAN NOT NULL DEFAULT false,
    "extractedFrom" TEXT,
    "confidence" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "CampaignType" NOT NULL,
    "triggerType" "CampaignTrigger" NOT NULL,
    "triggerConfig" JSONB,
    "scheduledAt" TIMESTAMP(3),
    "targetFilter" JSONB,
    "channel" "Channel" NOT NULL,
    "messageTemplate" TEXT NOT NULL,
    "aiPersonalized" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "totalTargeted" INTEGER NOT NULL DEFAULT 0,
    "totalSent" INTEGER NOT NULL DEFAULT 0,
    "totalFailed" INTEGER NOT NULL DEFAULT 0,
    "totalReplied" INTEGER NOT NULL DEFAULT 0,
    "totalConverted" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(65,30),
    "actualCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ab_tests" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "variants" JSONB NOT NULL,
    "winnerCriteria" "WinnerCriteria" NOT NULL DEFAULT 'OPEN_RATE',
    "confidenceLevel" DECIMAL(65,30) NOT NULL DEFAULT 0.95,
    "sampleSize" INTEGER,
    "winner" TEXT,
    "winningVariant" TEXT,
    "results" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_integrations" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "provider" "CRMProvider" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "autoSync" BOOLEAN NOT NULL DEFAULT true,
    "credentials" JSONB NOT NULL,
    "apiKey" TEXT,
    "apiSecret" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "instanceUrl" TEXT,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "syncContacts" BOOLEAN NOT NULL DEFAULT true,
    "syncLeads" BOOLEAN NOT NULL DEFAULT true,
    "syncOpportunities" BOOLEAN NOT NULL DEFAULT false,
    "syncCases" BOOLEAN NOT NULL DEFAULT false,
    "fieldMapping" JSONB,
    "settings" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_configs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "requestsPerMinute" INTEGER NOT NULL DEFAULT 60,
    "requestsPerHour" INTEGER NOT NULL DEFAULT 1000,
    "requestsPerDay" INTEGER NOT NULL DEFAULT 10000,
    "maxMessagesPerDay" INTEGER NOT NULL DEFAULT 1000,
    "maxMessagesPerHour" INTEGER NOT NULL DEFAULT 100,
    "messageCooldownSeconds" INTEGER NOT NULL DEFAULT 0,
    "monthlyMessageQuota" INTEGER NOT NULL DEFAULT 10000,
    "maxCallsPerDay" INTEGER NOT NULL DEFAULT 100,
    "maxCallsPerHour" INTEGER NOT NULL DEFAULT 20,
    "monthlyCallQuota" INTEGER NOT NULL DEFAULT 500,
    "monthlySMQuota" INTEGER NOT NULL DEFAULT 1000,
    "autoBlockAfterAbuseCount" INTEGER NOT NULL DEFAULT 5,
    "requireVerification" BOOLEAN NOT NULL DEFAULT false,
    "customRules" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_hits" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT,
    "endpoint" TEXT NOT NULL,
    "hitType" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limit_hits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abuse_logs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "ipAddress" TEXT,
    "fingerprint" TEXT,
    "abuseType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reason" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abuse_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sentiment_logs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "conversationId" TEXT,
    "sentiment" TEXT NOT NULL,
    "score" DECIMAL(4,3) NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "channel" "Channel",
    "messageContent" TEXT,
    "alertTriggered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sentiment_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intent_logs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "conversationId" TEXT,
    "intent" TEXT NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "entities" JSONB,
    "urgency" INTEGER NOT NULL DEFAULT 0,
    "channel" "Channel",
    "messageContent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intent_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessId" TEXT,
    "customerId" TEXT,
    "adminId" TEXT,
    "action" "AuditAction" NOT NULL,
    "severity" "AuditSeverity" NOT NULL DEFAULT 'INFO',
    "resource" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "metadata" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_clerkId_key" ON "admins"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE INDEX "admins_clerkId_idx" ON "admins"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_clerkId_key" ON "businesses"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_apiKey_key" ON "businesses"("apiKey");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_email_key" ON "businesses"("email");

-- CreateIndex
CREATE INDEX "businesses_email_idx" ON "businesses"("email");

-- CreateIndex
CREATE INDEX "businesses_isActive_idx" ON "businesses"("isActive");

-- CreateIndex
CREATE INDEX "businesses_clerkId_idx" ON "businesses"("clerkId");

-- CreateIndex
CREATE INDEX "businesses_apiKey_idx" ON "businesses"("apiKey");

-- CreateIndex
CREATE UNIQUE INDEX "business_credits_businessId_key" ON "business_credits"("businessId");

-- CreateIndex
CREATE INDEX "customers_businessId_idx" ON "customers"("businessId");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customers_email_idx" ON "customers"("email");

-- CreateIndex
CREATE INDEX "customers_isActive_idx" ON "customers"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "customers_businessId_phone_key" ON "customers"("businessId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "customers_businessId_email_key" ON "customers"("businessId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "customer_credits_customerId_key" ON "customer_credits"("customerId");

-- CreateIndex
CREATE INDEX "conversations_businessId_idx" ON "conversations"("businessId");

-- CreateIndex
CREATE INDEX "conversations_customerId_idx" ON "conversations"("customerId");

-- CreateIndex
CREATE INDEX "conversations_channel_idx" ON "conversations"("channel");

-- CreateIndex
CREATE INDEX "conversations_status_idx" ON "conversations"("status");

-- CreateIndex
CREATE INDEX "conversations_startedAt_idx" ON "conversations"("startedAt");

-- CreateIndex
CREATE INDEX "messages_conversationId_idx" ON "messages"("conversationId");

-- CreateIndex
CREATE INDEX "messages_createdAt_idx" ON "messages"("createdAt");

-- CreateIndex
CREATE INDEX "messages_cachedResponse_idx" ON "messages"("cachedResponse");

-- CreateIndex
CREATE INDEX "memories_customerId_idx" ON "memories"("customerId");

-- CreateIndex
CREATE INDEX "call_recordings_conversationId_idx" ON "call_recordings"("conversationId");

-- CreateIndex
CREATE INDEX "cost_logs_businessId_createdAt_idx" ON "cost_logs"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "cost_logs_customerId_createdAt_idx" ON "cost_logs"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "cost_logs_businessId_service_idx" ON "cost_logs"("businessId", "service");

-- CreateIndex
CREATE INDEX "cost_logs_service_createdAt_idx" ON "cost_logs"("service", "createdAt");

-- CreateIndex
CREATE INDEX "cost_logs_createdAt_idx" ON "cost_logs"("createdAt");

-- CreateIndex
CREATE INDEX "response_caches_businessId_expiresAt_idx" ON "response_caches"("businessId", "expiresAt");

-- CreateIndex
CREATE INDEX "response_caches_businessId_isFAQ_idx" ON "response_caches"("businessId", "isFAQ");

-- CreateIndex
CREATE INDEX "response_caches_customerId_expiresAt_idx" ON "response_caches"("customerId", "expiresAt");

-- CreateIndex
CREATE INDEX "response_caches_lastAccessedAt_idx" ON "response_caches"("lastAccessedAt");

-- CreateIndex
CREATE UNIQUE INDEX "response_caches_businessId_embeddingHash_key" ON "response_caches"("businessId", "embeddingHash");

-- CreateIndex
CREATE INDEX "business_faqs_businessId_category_idx" ON "business_faqs"("businessId", "category");

-- CreateIndex
CREATE INDEX "business_faqs_businessId_isActive_idx" ON "business_faqs"("businessId", "isActive");

-- CreateIndex
CREATE INDEX "business_faqs_businessId_priority_idx" ON "business_faqs"("businessId", "priority");

-- CreateIndex
CREATE INDEX "campaigns_businessId_status_idx" ON "campaigns"("businessId", "status");

-- CreateIndex
CREATE INDEX "campaigns_businessId_type_idx" ON "campaigns"("businessId", "type");

-- CreateIndex
CREATE INDEX "campaigns_customerId_status_idx" ON "campaigns"("customerId", "status");

-- CreateIndex
CREATE INDEX "campaigns_scheduledAt_idx" ON "campaigns"("scheduledAt");

-- CreateIndex
CREATE INDEX "campaigns_status_scheduledAt_idx" ON "campaigns"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "ab_tests_businessId_idx" ON "ab_tests"("businessId");

-- CreateIndex
CREATE INDEX "ab_tests_campaignId_idx" ON "ab_tests"("campaignId");

-- CreateIndex
CREATE INDEX "crm_integrations_businessId_idx" ON "crm_integrations"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_integrations_businessId_provider_key" ON "crm_integrations"("businessId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_configs_businessId_key" ON "rate_limit_configs"("businessId");

-- CreateIndex
CREATE INDEX "rate_limit_hits_businessId_createdAt_idx" ON "rate_limit_hits"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "rate_limit_hits_customerId_createdAt_idx" ON "rate_limit_hits"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "abuse_logs_businessId_createdAt_idx" ON "abuse_logs"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "abuse_logs_customerId_createdAt_idx" ON "abuse_logs"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "abuse_logs_abuseType_createdAt_idx" ON "abuse_logs"("abuseType", "createdAt");

-- CreateIndex
CREATE INDEX "abuse_logs_ipAddress_idx" ON "abuse_logs"("ipAddress");

-- CreateIndex
CREATE INDEX "sentiment_logs_businessId_createdAt_idx" ON "sentiment_logs"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "sentiment_logs_customerId_createdAt_idx" ON "sentiment_logs"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "sentiment_logs_sentiment_createdAt_idx" ON "sentiment_logs"("sentiment", "createdAt");

-- CreateIndex
CREATE INDEX "intent_logs_businessId_createdAt_idx" ON "intent_logs"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "intent_logs_customerId_createdAt_idx" ON "intent_logs"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "intent_logs_intent_createdAt_idx" ON "intent_logs"("intent", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_businessId_timestamp_idx" ON "audit_logs"("businessId", "timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_customerId_timestamp_idx" ON "audit_logs"("customerId", "timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_adminId_timestamp_idx" ON "audit_logs"("adminId", "timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_action_timestamp_idx" ON "audit_logs"("action", "timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_severity_timestamp_idx" ON "audit_logs"("severity", "timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_resource_resourceId_idx" ON "audit_logs"("resource", "resourceId");

-- AddForeignKey
ALTER TABLE "business_credits" ADD CONSTRAINT "business_credits_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_recordings" ADD CONSTRAINT "call_recordings_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_logs" ADD CONSTRAINT "cost_logs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_logs" ADD CONSTRAINT "cost_logs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response_caches" ADD CONSTRAINT "response_caches_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_faqs" ADD CONSTRAINT "business_faqs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ab_tests" ADD CONSTRAINT "ab_tests_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ab_tests" ADD CONSTRAINT "ab_tests_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_integrations" ADD CONSTRAINT "crm_integrations_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_limit_configs" ADD CONSTRAINT "rate_limit_configs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
