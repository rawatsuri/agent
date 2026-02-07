import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { logger } from './utils/logger';

// Swagger Documentation
import { setupSwagger } from './config/swagger';

// Routes
import agentRoutes from './features/voice/agent.routes';
import apiRoutes from './routes/api.routes';
import webhookRoutes from './routes/webhooks.routes';
import healthRoutes from './routes/health.routes';
import voiceContextRoutes from './routes/voice-context.routes';

// Middleware
import { requestTracing } from './middleware/request-tracing.middleware';

// Services
import { startEmbeddingWorker } from './services/queue.service';

const app = express();

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.WHITE_LIST_URLS?.split(',') || [],
    credentials: true,
  }),
);

// Rate limiting for non-API routes
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // higher limit for webhooks
  message: 'Too many requests from this IP',
});
app.use('/webhooks/', webhookLimiter);

// Body parsing - with raw body capture for webhook signature validation
app.use(express.json({
  limit: '10mb',
  verify: (req: any, res, buf) => {
    // Capture raw body for webhook signature validation
    req.rawBody = buf.toString('utf8');
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Swagger Documentation (available at /api-docs)
setupSwagger(app);

// Logging
app.use(
  pinoHttp({
    logger,
    customLogLevel: (req, res, err) => {
      if (res.statusCode >= 400 && res.statusCode < 500) return 'warn';
      if (res.statusCode >= 500 || err) return 'error';
      return 'info';
    },
  }),
);

// Request tracing
app.use(requestTracing);

// Routes
// Health checks first (no authentication needed)
app.use('/health', healthRoutes);

app.use('/api', apiRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/agent', voiceContextRoutes);
app.use('/webhooks', webhookRoutes);

// Root health check
app.get('/', (req, res) => {
  res.json({
    service: 'Omnichannel AI Backend',
    status: 'running',
    version: '1.0.0',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested resource does not exist',
  });
});

// Error handler
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    logger.error({ err }, 'Unhandled error');
    res.status(500).json({
      error: 'Internal Server Error',
      message:
        process.env.NODE_ENV === 'development'
          ? err.message
          : 'Something went wrong',
    });
  },
);

// Start background workers
if (process.env.NODE_ENV !== 'test') {
  startEmbeddingWorker();
  logger.info('Background workers started');
}

export default app;
