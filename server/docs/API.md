# Omnichannel AI Platform - API Documentation

## Base URL
```
Production: https://api.yourdomain.com
Development: http://localhost:3000
```

## Authentication
All API requests require a Clerk JWT token in the Authorization header:
```
Authorization: Bearer <your-clerk-jwt-token>
```

## Rate Limiting
- 200 requests per 15 minutes per API key
- Rate limit headers included in all responses:
  - `X-RateLimit-Limit`: Maximum requests allowed
  - `X-RateLimit-Remaining`: Remaining requests in current window
  - `X-RateLimit-Reset`: Time when limit resets (Unix timestamp)

## Response Format
All responses follow a standardized format:

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

### Error Response
```json
{
  "success": false,
  "message": "Error description",
  "code": "ERROR_CODE",
  "errors": [
    { "field": "email", "message": "Invalid email format" }
  ]
}
```

## API Endpoints

### Business API

#### Get Business Profile
```http
GET /api/business/me
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Your Business",
    "email": "business@example.com",
    "phone": "+1234567890",
    "industry": "healthcare",
    "active": true,
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

#### Update AI Configuration
```http
PUT /api/business/ai-config
Content-Type: application/json

{
  "customPrompt": "You are a helpful assistant for our clinic...",
  "tone": "professional",
  "language": "en",
  "prohibitedTopics": ["medical advice", "diagnosis"],
  "fallbackMessage": "Let me connect you with a human agent."
}
```

#### Get Credit Balance
```http
GET /api/business/credits
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalCredits": 1000.00,
    "usedCredits": 150.50,
    "availableCredits": 849.50,
    "monthlyBudget": 500.00,
    "currentMonthSpend": 150.50,
    "percentUsed": 30,
    "isPaused": false
  }
}
```

### Customer API

#### List Customers
```http
GET /api/customers?page=1&limit=20&search=john&verified=true
```

**Query Parameters:**
- `page` (number): Page number (default: 1)
- `limit` (number): Items per page (default: 20, max: 100)
- `search` (string): Search by name, email, or phone
- `verified` (boolean): Filter by verification status
- `tags` (string[]): Filter by tags (comma-separated)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "John Doe",
      "email": "john@example.com",
      "phone": "+15551234567",
      "trustScore": 85,
      "isVerified": true,
      "tags": ["vip", "recurring"],
      "lastInteraction": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

#### Get Customer Conversations
```http
GET /api/customers/:id/conversations?page=1&limit=10
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "channel": "WHATSAPP",
      "status": "ACTIVE",
      "messageCount": 12,
      "startedAt": "2024-01-15T10:00:00Z",
      "lastMessageAt": "2024-01-15T10:30:00Z",
      "summary": "Customer inquiring about appointment scheduling"
    }
  ]
}
```

### Analytics API

#### Get Dashboard Metrics
```http
GET /api/analytics/dashboard
```

**Response:**
```json
{
  "success": true,
  "data": {
    "conversations": {
      "total": 1250,
      "active": 15,
      "closed": 1235,
      "avgDuration": 12.5
    },
    "customers": {
      "total": 450,
      "newThisMonth": 50,
      "verified": 380
    },
    "costs": {
      "today": 12.50,
      "thisMonth": 450.00,
      "projected": 500.00
    },
    "cache": {
      "hitRate": 65,
      "totalCached": 850
    }
  }
}
```

#### Get Cost Breakdown
```http
GET /api/analytics/costs?startDate=2024-01-01&endDate=2024-01-31&groupBy=service
```

**Query Parameters:**
- `startDate` (string): Start date (ISO 8601)
- `endDate` (string): End date (ISO 8601)
- `groupBy` (string): Group by 'service', 'channel', or 'day'

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 450.00,
    "breakdown": [
      { "service": "OPENAI_GPT", "cost": 350.00, "percentage": 77.8 },
      { "service": "EXOTEL_SMS", "cost": 50.00, "percentage": 11.1 },
      { "service": "OPENAI_EMBEDDING", "cost": 50.00, "percentage": 11.1 }
    ]
  }
}
```

### Conversation API

#### List Conversations
```http
GET /api/conversations?status=ACTIVE&channel=WHATSAPP&page=1
```

**Query Parameters:**
- `status` (string): Filter by status (ACTIVE, CLOSED, TRANSFERRED)
- `channel` (string): Filter by channel
- `customerId` (string): Filter by customer
- `page` (number): Page number
- `limit` (number): Items per page

#### Get Conversation Messages
```http
GET /api/conversations/:id/messages?page=1&limit=50
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "role": "USER",
      "content": "What are your business hours?",
      "channel": "WHATSAPP",
      "status": "READ",
      "createdAt": "2024-01-15T10:00:00Z",
      "aiCost": 0.001,
      "cachedResponse": false
    },
    {
      "id": "uuid",
      "role": "ASSISTANT",
      "content": "We're open from 9 AM to 6 PM, Monday through Saturday.",
      "channel": "WHATSAPP",
      "status": "DELIVERED",
      "createdAt": "2024-01-15T10:00:05Z",
      "aiCost": 0.001,
      "cachedResponse": true
    }
  ]
}
```

#### Close Conversation
```http
POST /api/conversations/:id/close
Content-Type: application/json

{
  "reason": "RESOLVED",
  "summary": "Customer was satisfied with the response"
}
```

### Campaign API

#### Create Campaign
```http
POST /api/campaigns
Content-Type: application/json

{
  "name": "Appointment Reminders",
  "type": "REMINDER",
  "channel": "SMS",
  "triggerType": "SCHEDULED",
  "scheduledAt": "2024-01-20T09:00:00Z",
  "targetFilter": {
    "hasUpcomingAppointment": true,
    "appointmentWithin": "24h"
  },
  "messageTemplate": "Hi {{name}}, this is a reminder for your appointment tomorrow at {{time}}. Reply CONFIRM to confirm or RESCHEDULE to change."
}
```

#### Execute Campaign
```http
POST /api/campaigns/:id/execute
```

**Response:**
```json
{
  "success": true,
  "data": {
    "campaignId": "uuid",
    "status": "RUNNING",
    "targeted": 150,
    "estimatedCost": 0.75
  }
}
```

### FAQ API

#### Create FAQ
```http
POST /api/faq
Content-Type: application/json

{
  "question": "What are your business hours?",
  "answer": "We're open 9 AM to 6 PM, Monday through Saturday.",
  "category": "hours",
  "questionVariants": [
    "When do you open?",
    "What time do you close?",
    "Are you open on Sunday?"
  ]
}
```

#### Auto-Extract FAQs
```http
POST /api/faq/extract
Content-Type: application/json

{
  "minFrequency": 5,
  "maxResults": 10
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "extracted": 5,
    "faqs": [
      {
        "question": "What are your business hours?",
        "answer": "We're open 9 AM to 6 PM...",
        "frequency": 12,
        "confidence": 0.95
      }
    ]
  }
}
```

### Cache API

#### Get Cache Statistics
```http
GET /api/cache/stats
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalCached": 850,
    "totalHits": 15000,
    "hitRate": 65,
    "byChannel": {
      "CHAT": { "hitRate": 70, "cached": 500 },
      "WHATSAPP": { "hitRate": 60, "cached": 350 }
    },
    "topQueries": [
      { "query": "business hours", "hits": 450 },
      { "query": "pricing", "hits": 320 }
    ]
  }
}
```

#### Warm Cache
```http
POST /api/cache/warm
Content-Type: application/json

{
  "queries": [
    "What are your business hours?",
    "How much does it cost?",
    "Where are you located?"
  ]
}
```

## Error Codes

| Code | Description | HTTP Status |
|------|-------------|-------------|
| `UNAUTHORIZED` | Invalid or missing authentication | 401 |
| `FORBIDDEN` | Insufficient permissions | 403 |
| `NOT_FOUND` | Resource not found | 404 |
| `RATE_LIMIT_EXCEEDED` | Too many requests | 429 |
| `INSUFFICIENT_BUDGET` | Business budget depleted | 403 |
| `VALIDATION_ERROR` | Invalid request data | 400 |
| `INTERNAL_ERROR` | Server error | 500 |

## Webhooks

### Receiving Webhooks

Configure webhooks in your dashboard. We support webhooks for:
- Message delivery status
- Conversation events
- Cost threshold alerts
- Campaign completions

**Webhook Payload:**
```json
{
  "event": "message.delivered",
  "timestamp": "2024-01-15T10:00:05Z",
  "data": {
    "messageId": "uuid",
    "conversationId": "uuid",
    "channel": "WHATSAPP",
    "status": "DELIVERED"
  }
}
```

**Webhook Verification:**
All webhooks include a signature header for verification:
```
X-Webhook-Signature: sha256=<signature>
```

## SDK & Libraries

### JavaScript/TypeScript
```bash
npm install omnichannel-ai-sdk
```

```javascript
import { OmnichannelAI } from 'omnichannel-ai-sdk';

const client = new OmnichannelAI({
  apiKey: 'your-api-key',
  baseURL: 'https://api.yourdomain.com'
});

// Get customers
const customers = await client.customers.list({
  page: 1,
  limit: 20
});

// Send message
const response = await client.conversations.sendMessage({
  customerId: 'uuid',
  content: 'Hello!',
  channel: 'WHATSAPP'
});
```

## Support

- 📧 Email: support@yourdomain.com
- 💬 Chat: https://yourdomain.com/support
- 📚 Docs: https://docs.yourdomain.com

---

**Last Updated:** February 2024  
**API Version:** 1.0.0
