import type { Server as SocketIOServer } from 'socket.io';

/**
 * Chat-specific type definitions
 */

export interface ChatSession {
  id: string;
  businessId: string;
  customerId?: string;
  customerIdentifier: {
    email?: string;
    phone?: string;
    sessionToken: string;
  };
  socketId: string;
  status: 'active' | 'idle' | 'closed';
  joinedAt: Date;
  lastActivityAt: Date;
  messageCount: number;
  metadata?: Record<string, any>;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  businessId: string;
  customerId?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface ChatConfig {
  maxSessionDuration: number; // in minutes
  idleTimeout: number; // in minutes
  maxMessageLength: number;
  enableTypingIndicator: boolean;
  enableReadReceipts: boolean;
}

export interface ChatWidgetConfig {
  businessId: string;
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  primaryColor: string;
  greetingMessage: string;
  avatarUrl?: string;
  businessName: string;
}

// Socket.io event types
export interface ServerToClientEvents {
  message: (message: ChatMessage) => void;
  typing: (data: { sessionId: string; isTyping: boolean }) => void;
  joined: (data: { sessionId: string; businessId: string; timestamp: Date }) => void;
  error: (data: { message: string; retryAfter?: number }) => void;
  human_transfer: (data: { message: string; estimatedWaitTime: string }) => void;
  broadcast: (message: any) => void;
  session_ended: (data: { reason: string }) => void;
}

export interface ClientToServerEvents {
  join: (data: {
    businessId: string;
    customerEmail?: string;
    customerPhone?: string;
    customerName?: string;
  }) => void;
  message: (data: { content: string }) => void;
  typing: (data: { isTyping: boolean }) => void;
  disconnect: () => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  session: ChatSession;
}

// Export Socket.io server type with proper types
export type TypedSocketIOServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
