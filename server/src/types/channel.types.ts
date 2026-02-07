// Type definitions for all channels

export enum Channel {
  VOICE = 'VOICE',
  CHAT = 'CHAT',
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  TELEGRAM = 'TELEGRAM',
  WHATSAPP = 'WHATSAPP',
  INSTAGRAM = 'INSTAGRAM',
}

export enum MessageRole {
  USER = 'USER',
  ASSISTANT = 'ASSISTANT',
  SYSTEM = 'SYSTEM',
}

export enum ConversationStatus {
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
  TRANSFERRED = 'TRANSFERRED',
}

// Universal message format for all channels
export interface IChannelMessage {
  businessId: string;
  customerId?: string; // May not exist on first message
  customerIdentifier: {
    // How to identify the customer
    phone?: string;
    email?: string;
    telegramId?: string;
    whatsappId?: string;
    instagramId?: string;
    sessionToken?: string; // For web chat
  };
  content: string;
  channel: Channel;
  metadata?: Record<string, any>; // Channel-specific data
  timestamp: Date;
}

// Response format
export interface IAgentResponse {
  content: string;
  metadata?: Record<string, any>;
  needsHumanTransfer?: boolean;
}

// Context for AI
export interface IConversationContext {
  customer: {
    id: string;
    name?: string;
    phone?: string;
    email?: string;
    preferences?: Record<string, any>;
  };
  recentMessages: Array<{
    role: MessageRole;
    content: string;
    timestamp: Date;
  }>;
  relevantMemories: Array<{
    content: string;
    source?: string;
    createdAt: Date;
  }>;
  business: {
    id: string;
    name: string;
    config?: Record<string, any>;
  };
}
