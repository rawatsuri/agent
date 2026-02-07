import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import app from './app';
import { env } from './config/env-config';
import { db } from './config/database';
import { logger } from './middleware/pino-logger';
import { initializeWorkers, shutdownWorkers, getWorkerStatus } from './workers.bootstrap';
import { closeAllQueues } from './queue';
import { ChannelFactory } from './channels/base/channel.factory';
import { ChatGateway } from './channels/chat/chat.gateway';

class Server {
  private readonly port: number | string;
  private serverInstance: any;
  private workersInitialized: boolean = false;
  private io: SocketIOServer | null = null;
  private chatGateway: ChatGateway | null = null;

  constructor(port: number | string) {
    this.port = port;
  }

  // Start the server
  public async start(): Promise<void> {
    try {
      // Initialize Phase 3: Channel Adapters
      await this.initializeChannels();

      // Initialize background workers (Phase 2)
      await this.initializeBackgroundWorkers();

      // Create HTTP server (for Socket.io)
      const httpServer = createServer(app);

      // Initialize Socket.io for Chat channel
      this.initializeSocketIO(httpServer);

      // Start HTTP server
      this.serverInstance = httpServer.listen(this.port, () => {
        logger.info(`Server running at http://localhost:${this.port}`);
        logger.info(`Worker status: ${JSON.stringify(getWorkerStatus())}`);
        logger.info(`Active channels: ${ChannelFactory.getEnabledChannels().join(', ')}`);
      });

      // Handle system signals for graceful shutdown
      process.on('SIGTERM', this.gracefulShutdown.bind(this));
      process.on('SIGINT', this.gracefulShutdown.bind(this));
      process.on('uncaughtException', this.handleUncaughtException.bind(this));
      process.on('unhandledRejection', this.handleUnhandledRejection.bind(this));
    } catch (error) {
      logger.error({ error }, 'Failed to start server');
      process.exit(1);
    }
  }

  // Initialize all channel adapters
  private async initializeChannels(): Promise<void> {
    try {
      logger.info('Initializing Phase 3: Channel Adapters...');
      
      ChannelFactory.initialize();
      
      logger.info('Phase 3 initialization complete - Channel adapters active');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize channel adapters');
      // Continue without some channels - system can still function
      logger.warn('Some channels may be unavailable');
    }
  }

  // Initialize Socket.io for Chat channel
  private initializeSocketIO(httpServer: any): void {
    try {
      this.io = new SocketIOServer(httpServer, {
        cors: {
          origin: process.env.WHITE_LIST_URLS?.split(',') || '*',
          methods: ['GET', 'POST'],
          credentials: true,
        },
        pingTimeout: 60000,
        pingInterval: 25000,
      });

      // Initialize chat gateway
      this.chatGateway = new ChatGateway();
      this.chatGateway.initialize(this.io);

      logger.info('Socket.io initialized for Chat channel');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize Socket.io');
    }
  }

  // Initialize background workers
  private async initializeBackgroundWorkers(): Promise<void> {
    try {
      logger.info('Initializing Phase 2: AI Orchestrator & Background Jobs...');
      
      await initializeWorkers();
      this.workersInitialized = true;
      
      logger.info('Phase 2 initialization complete - Background workers active');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize background workers');
      // Continue without workers - system can still function
      logger.warn('Continuing without background workers - some features may be limited');
    }
  }

  // Graceful shutdown logic
  private async gracefulShutdown(): Promise<void> {
    logger.info('Received shutdown signal, shutting down gracefully...');
    
    try {
      // Stop accepting new connections
      this.serverInstance.close(async () => {
        logger.info('No new requests are being accepted.');

        try {
          // Close Socket.io connections
          if (this.io) {
            this.io.close(() => {
              logger.info('Socket.io connections closed.');
            });
          }

          // Shutdown workers first
          if (this.workersInitialized) {
            await shutdownWorkers();
          }

          // Close all queue connections
          await closeAllQueues();

          // Close database connection
          await this.closeDBConnection();

          logger.info('All connections closed, shutting down...');
          process.exit(0);
        } catch (err) {
          logger.error({ err }, 'Error during shutdown');
          process.exit(1);
        }
      });

      // Timeout to force shutdown if requests are still pending
      setTimeout(() => {
        logger.error('Forcing shutdown due to timeout.');
        process.exit(1);
      }, 15000); // 15 seconds timeout
    } catch (err) {
      logger.error({ err }, 'Failed to initiate graceful shutdown');
      process.exit(1);
    }
  }

  // Close database connection
  private async closeDBConnection(): Promise<void> {
    logger.info('Closing database connection...');
    try {
      await db.$disconnect();
      logger.info('Database connection closed.');
    } catch (err) {
      logger.error({ err }, 'Error closing database connection');
      throw err;
    }
  }

  // Handle uncaught exceptions
  private handleUncaughtException(error: Error): void {
    logger.error({ error }, 'Uncaught Exception');
    process.exit(1);
  }

  // Handle unhandled promise rejections
  private handleUnhandledRejection(reason: any, promise: Promise<any>): void {
    logger.error({ reason, promise }, 'Unhandled Rejection');
    process.exit(1);
  }
}

// Initialize and start the server
const PORT = Number(env.PORT) || 4000;
const server = new Server(PORT);

// Start server
server.start().catch((error) => {
  logger.error({ error }, 'Fatal error starting server');
  process.exit(1);
});
