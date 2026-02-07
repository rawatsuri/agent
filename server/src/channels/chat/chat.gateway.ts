import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { IChannelAdapter } from '../base/channel.types';
import { Channel, IAgentResponse } from '@/types/channel.types';
import { ConversationOrchestrator } from '@/services/conversation.orchestrator';
import { logger } from '@/utils/logger';

/**
 * Chat Gateway - Socket.io Implementation
 * 
 * Real-time chat for website widgets and custom chat interfaces
 */
export class ChatGateway {
  private io: SocketIOServer | null = null;
  private activeSessions: Map<string, ChatSession> = new Map();

  /**
   * Initialize the Socket.io server
   */
  initialize(io: SocketIOServer): void {
    this.io = io;
    
    io.on('connection', (socket: Socket) => {
      this.handleConnection(socket);
    });

    logger.info('Chat gateway initialized');
  }

  /**
   * Handle new socket connection
   */
  private handleConnection(socket: Socket): void {
    logger.info({ socketId: socket.id }, 'New chat connection');

    // Send welcome message
    socket.emit('message', {
      type: 'system',
      content: 'Connected to AI assistant. Please provide your business context.',
      timestamp: new Date(),
    });

    // Handle authentication/join
    socket.on('join', async (data: JoinData) => {
      await this.handleJoin(socket, data);
    });

    // Handle incoming messages
    socket.on('message', async (data: MessageData) => {
      await this.handleMessage(socket, data);
    });

    // Handle typing indicators
    socket.on('typing', (data: { isTyping: boolean; businessId?: string }) => {
      const session = this.activeSessions.get(socket.id);
      const businessId = data.businessId || session?.businessId;
      if (businessId) {
        socket.to(`business:${businessId}`).emit('typing', {
          sessionId: socket.id,
          isTyping: data.isTyping,
        });
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      this.handleDisconnect(socket);
    });

    // Handle errors
    socket.on('error', (error: Error) => {
      logger.error({ error, socketId: socket.id }, 'Socket error');
    });
  }

  /**
   * Handle join event (authenticates session)
   */
  private async handleJoin(socket: Socket, data: JoinData): Promise<void> {
    try {
      const { businessId, customerEmail, customerPhone, customerName } = data;

      // Validate businessId
      if (!businessId) {
        socket.emit('error', { message: 'Business ID required' });
        return;
      }

      // Join business room for broadcasting
      socket.join(`business:${businessId}`);

      // Create session
      const session: ChatSession = {
        socketId: socket.id,
        businessId,
        customerIdentifier: {
          email: customerEmail,
          phone: customerPhone,
        },
        customerName: customerName || 'Guest',
        joinedAt: new Date(),
        messageCount: 0,
      };

      this.activeSessions.set(socket.id, session);

      // Send join confirmation
      socket.emit('joined', {
        sessionId: socket.id,
        businessId,
        timestamp: new Date(),
      });

      logger.info(
        { socketId: socket.id, businessId, customerEmail, customerPhone },
        'Chat session joined'
      );

    } catch (error) {
      logger.error({ error, socketId: socket.id }, 'Join error');
      socket.emit('error', { message: 'Failed to join chat' });
    }
  }

  /**
   * Handle incoming chat message
   */
  private async handleMessage(socket: Socket, data: MessageData): Promise<void> {
    try {
      const session = this.activeSessions.get(socket.id);
      if (!session) {
        socket.emit('error', { message: 'Session not found. Please join first.' });
        return;
      }

      // Update session message count
      session.messageCount++;
      session.lastMessageAt = new Date();

      // Show typing indicator
      socket.emit('typing', { isTyping: true });

      // Process through orchestrator
      const response = await ConversationOrchestrator.processMessage({
        businessId: session.businessId,
        customerIdentifier: session.customerIdentifier,
        content: data.content,
        channel: 'CHAT' as Channel,
        metadata: {
          socketId: socket.id,
          sessionId: socket.id,
          userAgent: socket.handshake.headers['user-agent'],
          ipAddress: socket.handshake.address,
        },
        timestamp: new Date(),
      });

      // Hide typing indicator
      socket.emit('typing', { isTyping: false });

      // Send response
      socket.emit('message', {
        type: 'assistant',
        content: response.content,
        metadata: response.metadata,
        timestamp: new Date(),
      });

      // If needs human transfer, notify
      if (response.needsHumanTransfer) {
        socket.emit('human_transfer', {
          message: 'Transferring to human agent...',
          estimatedWaitTime: '2 minutes',
        });

        // TODO: Implement human handoff logic
      }

    } catch (error) {
      logger.error({ error, socketId: socket.id }, 'Message handling error');
      socket.emit('error', { message: 'Failed to process message' });
    }
  }

  /**
   * Handle socket disconnection
   */
  private handleDisconnect(socket: Socket): void {
    const session = this.activeSessions.get(socket.id);
    
    if (session) {
      logger.info(
        { 
          socketId: socket.id, 
          businessId: session.businessId,
          messageCount: session.messageCount,
          duration: session.lastMessageAt 
            ? Date.now() - session.joinedAt.getTime() 
            : 0 
        },
        'Chat session ended'
      );

      this.activeSessions.delete(socket.id);
    }
  }

  /**
   * Get active session count
   */
  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  /**
   * Get sessions for a business
   */
  getBusinessSessions(businessId: string): ChatSession[] {
    return Array.from(this.activeSessions.values())
      .filter(s => s.businessId === businessId);
  }

  /**
   * Broadcast message to all sessions in a business
   */
  broadcastToBusiness(businessId: string, message: any): void {
    if (this.io) {
      this.io.to(`business:${businessId}`).emit('broadcast', message);
    }
  }
}

/**
 * Chat Session Data
 */
export interface ChatSession {
  socketId: string;
  businessId: string;
  customerIdentifier: {
    email?: string;
    phone?: string;
  };
  customerName: string;
  joinedAt: Date;
  lastMessageAt?: Date;
  messageCount: number;
}

/**
 * Join event data
 */
export interface JoinData {
  businessId: string;
  customerEmail?: string;
  customerPhone?: string;
  customerName?: string;
}

/**
 * Message event data
 */
export interface MessageData {
  content: string;
  timestamp?: Date;
}
