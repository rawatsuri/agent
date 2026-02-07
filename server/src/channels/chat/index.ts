// Chat Channel exports
export { ChatService } from './chat.service';
export { ChatGateway } from './chat.gateway';
export type { ChatSession, JoinData, MessageData } from './chat.gateway';
export type { 
  ChatSession as IChatSession, 
  ChatMessage, 
  ChatConfig, 
  ChatWidgetConfig, 
  TypedSocketIOServer,
  ServerToClientEvents,
  ClientToServerEvents,
} from './chat.types';
