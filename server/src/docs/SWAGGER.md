# Swagger API Documentation

## Accessing the API Docs

Once the server is running, access the interactive API documentation at:

**Local Development:**
```
http://localhost:3000/api-docs
```

**Production:**
```
https://api.yourdomain.com/api-docs
```

## Features

- **Interactive UI**: Test all API endpoints directly from the browser
- **Authentication**: Built-in support for Bearer tokens (Clerk JWT)
- **Request/Response Examples**: See exactly what to send and expect
- **Schema Definitions**: Full TypeScript schema documentation
- **Try It Out**: Execute real API calls with your credentials

## Using the API Tester

### 1. Authentication

1. Click the **Authorize** button (top right)
2. Enter your Clerk JWT token:
   ```
   Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```
3. Click **Authorize**, then close the dialog

### 2. Test an Endpoint

1. Find the endpoint you want to test (e.g., `GET /api/business/me`)
2. Click **Try it out**
3. Fill in any required parameters
4. Click **Execute**
5. See the response below

### 3. Example Workflow

**Get Business Profile:**
```
GET /api/business/me
→ Returns your business details
```

**Create a Customer:**
```
POST /api/customers
Body: {
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+15551234567"
}
→ Returns created customer object
```

**Process an AI Message:**
```
POST /api/agent/process
Headers: X-API-Key: your-internal-api-key
Body: {
  "businessId": "your-business-id",
  "content": "Hello!",
  "channel": "CHAT"
}
→ Returns AI response
```

## API Endpoints Covered

### Public
- `GET /health` - Health check

### Business (Authenticated)
- `GET /api/business/me` - Get profile
- `PUT /api/business/me` - Update profile
- `GET /api/business/ai-config` - Get AI config
- `PUT /api/business/ai-config` - Update AI config
- `GET /api/business/credits` - Get credits

### Customers (Authenticated)
- `GET /api/customers` - List customers
- `POST /api/customers` - Create customer
- `GET /api/customers/{id}` - Get customer
- `GET /api/customers/{id}/conversations` - Get history

### Conversations (Authenticated)
- `GET /api/conversations` - List conversations
- `GET /api/conversations/{id}/messages` - Get messages

### Agent (API Key)
- `POST /api/agent/process` - Process AI message

### Analytics (Authenticated)
- `GET /api/analytics/dashboard` - Dashboard metrics
- `GET /api/analytics/costs` - Cost breakdown

### Campaigns (Authenticated)
- `GET /api/campaigns` - List campaigns
- `POST /api/campaigns` - Create campaign
- `POST /api/campaigns/{id}/execute` - Execute campaign

### FAQ & Cache (Authenticated)
- `GET /api/faq` - List FAQs
- `POST /api/faq` - Create FAQ
- `GET /api/cache/stats` - Cache statistics

## Authentication Methods

### Bearer Token (Most APIs)
Used for all `/api/*` endpoints except `/api/agent/*`:
```
Authorization: Bearer <clerk-jwt-token>
```

### API Key (Agent Endpoints)
Used for `/api/agent/*` endpoints:
```
X-API-Key: <internal-api-key>
```

## Response Format

All responses follow this structure:

**Success:**
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

**Error:**
```json
{
  "success": false,
  "message": "Error description",
  "code": "ERROR_CODE",
  "errors": [ ... ]
}
```

## Troubleshooting

### 401 Unauthorized
- Make sure you've clicked **Authorize** and entered a valid token
- Check that the token hasn't expired
- Verify you're using the right auth type (Bearer vs API Key)

### 404 Not Found
- The endpoint might not exist
- Check the URL path carefully
- Make sure the server is running

### 500 Internal Server Error
- Check the server logs for details
- Verify your request body matches the schema
- Ensure all required fields are provided

## Tips

1. **Use the Schemas**: Expand the "Schemas" section at the bottom to see all data structures
2. **Check Examples**: Each endpoint shows example request/response values
3. **Test Gradually**: Start with simple GET requests before trying POST/PUT
4. **Monitor Costs**: Check `/api/business/credits` to track your spending
5. **Rate Limits**: Remember there's a 200 req/15min limit per API key

## Alternative: Raw JSON

You can also download the raw OpenAPI spec:

```
GET /api-docs.json
```

This returns the complete OpenAPI 3.0 specification that you can import into:
- Postman
- Insomnia
- Any OpenAPI-compatible tool

## Need Help?

- Check the full API docs: `docs/API.md`
- Look at the test files: `src/test/`
- Review the developer guide: `AGENTS.md`
