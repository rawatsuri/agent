// Channel Adapters - Main Export File
// Phase 3: Channel Adapters Implementation

// Base exports
export { IChannelAdapter, IChannelConfig, IMessageDeliveryStatus, WebhookEventType, IWebhookPayload } from './base/channel.types';
export { ChannelFactory } from './base/channel.factory';

// Voice channel
export { VoiceService } from './voice/voice.service';
export { VoiceWebhook } from './voice/voice.webhook';

// Chat channel
export { ChatService } from './chat/chat.service';
export { ChatGateway, type ChatSession, type JoinData, type MessageData } from './chat/chat.gateway';
export type { ChatSession as IChatSession, ChatMessage, ChatConfig, ChatWidgetConfig, TypedSocketIOServer } from './chat/chat.types';

// Email channel
export { EmailService } from './email/email.service';
export { EmailWebhook } from './email/email.webhook';
export { EmailParser } from './email/email.parser';

// SMS channel
export { SmsService } from './sms/sms.service';
export { SmsWebhook } from './sms/sms.webhook';

// Social channels
export { WhatsAppService } from './social/whatsapp/whatsapp.service';
export { WhatsAppWebhook } from './social/whatsapp/whatsapp.webhook';

export { TelegramService } from './social/telegram/telegram.service';
export { TelegramWebhook } from './social/telegram/telegram.webhook';

export { InstagramService } from './social/instagram/instagram.service';
export { InstagramWebhook } from './social/instagram/instagram.webhook';
