// Business API
export { BusinessController } from './business/business.controller';

// Customer API
export { CustomerController } from './customers/customer.controller';

// Analytics API
export { AnalyticsController } from './analytics/analytics.controller';
export { AnalyticsService } from './analytics/analytics.service';

// Conversation API
export { ConversationController } from './conversations/conversation.controller';

// Campaign API
export { CampaignController } from './campaigns/campaign.controller';

// FAQ API
export { FAQController } from './faq/faq.controller';

// Phase 6: Enterprise Features
export * from './ai-advanced/ai-advanced.routes';
export * from './crm/crm.routes';
export * from './advanced-analytics/advanced-analytics.routes';
export * from './white-label/white-label.routes';
export * from './advanced-campaigns/advanced-campaigns.routes';
