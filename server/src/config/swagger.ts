import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Omnichannel AI Platform API',
      version: '1.0.0',
      description: 'Production-ready AI customer service platform with 7 channels',
      contact: {
        name: 'API Support',
        email: 'support@yourdomain.com',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
      {
        url: 'https://api.yourdomain.com',
        description: 'Production server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Clerk JWT token',
        },
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'Internal API key for agent endpoints',
        },
      },
      schemas: {
        Business: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            industry: { type: 'string' },
            active: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Customer: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            businessId: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            trustScore: { type: 'integer', minimum: 0, maximum: 100 },
            isVerified: { type: 'boolean' },
            tags: { type: 'array', items: { type: 'string' } },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Conversation: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            businessId: { type: 'string', format: 'uuid' },
            customerId: { type: 'string', format: 'uuid' },
            channel: { 
              type: 'string', 
              enum: ['VOICE', 'CHAT', 'EMAIL', 'SMS', 'WHATSAPP', 'TELEGRAM', 'INSTAGRAM'] 
            },
            status: { type: 'string', enum: ['ACTIVE', 'CLOSED', 'TRANSFERRED'] },
            summary: { type: 'string' },
            startedAt: { type: 'string', format: 'date-time' },
          },
        },
        Message: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            conversationId: { type: 'string', format: 'uuid' },
            role: { type: 'string', enum: ['USER', 'ASSISTANT', 'SYSTEM'] },
            content: { type: 'string' },
            channel: { 
              type: 'string', 
              enum: ['VOICE', 'CHAT', 'EMAIL', 'SMS', 'WHATSAPP', 'TELEGRAM', 'INSTAGRAM'] 
            },
            status: { type: 'string', enum: ['PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string' },
            code: { type: 'string' },
            errors: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
    tags: [
      { name: 'Health', description: 'Health check endpoints' },
      { name: 'Business', description: 'Business management' },
      { name: 'Customers', description: 'Customer management' },
      { name: 'Conversations', description: 'Conversation management' },
      { name: 'Campaigns', description: 'Campaign management' },
      { name: 'Analytics', description: 'Analytics and reporting' },
      { name: 'FAQ', description: 'FAQ and cache management' },
      { name: 'Agent', description: 'AI agent endpoints' },
    ],
  },
  apis: [
    './src/routes/*.ts', 
    './src/api/**/*.routes.ts', 
    './src/docs/swagger-docs.ts',
    './src/docs/swagger-docs-part1.ts'
  ],
};

const specs = swaggerJsdoc(options);

export function setupSwagger(app: Express): void {
  // Swagger UI
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Omnichannel AI API',
  }));

  // Swagger JSON
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(specs);
  });

  console.log('📚 Swagger documentation available at: http://localhost:3000/api-docs');
}
