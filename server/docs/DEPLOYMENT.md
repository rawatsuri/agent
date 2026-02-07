# 🚀 Production Deployment Guide

## Pre-Deployment Checklist

### 1. Environment Setup ✅

```bash
# Copy and configure environment
cp .env.example .env
nano .env
```

**Required Variables:**
- [ ] `DATABASE_URL` - PostgreSQL with pgvector
- [ ] `REDIS_URL` - Redis connection
- [ ] `OPENAI_API_KEY` - OpenAI API
- [ ] `CLERK_SECRET_KEY` - Authentication
- [ ] `ENCRYPTION_KEY` - 256-bit encryption key

**Channel Variables:**
- [ ] `EXOTEL_SID` - Voice/SMS
- [ ] `SENDGRID_API_KEY` - Email
- [ ] `META_ACCESS_TOKEN` - WhatsApp/Instagram
- [ ] `TELEGRAM_BOT_TOKEN` - Telegram
- [ ] `AZURE_TTS_KEY` - Text-to-Speech

### 2. Database Setup ✅

```bash
# Run migrations
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate

# Verify tables created
npx prisma studio
```

### 3. Build Application ✅

```bash
# Install dependencies
npm ci --only=production

# Build TypeScript
npm run build

# Run tests
npm run test:ci
```

### 4. Start Services ✅

**Option A: Docker (Recommended)**
```bash
# Start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f app
```

**Option B: PM2**
```bash
# Start with PM2
pm2 start ecosystem.config.js --env production

# Save PM2 config
pm2 save
pm2 startup

# Monitor
pm2 monit
```

### 5. Configure Webhooks ✅

**Exotel Webhooks:**
```
Incoming Call: https://yourdomain.com/webhooks/exotel/voice
Call Status: https://yourdomain.com/webhooks/exotel/voice/status
```

**Meta Webhooks (WhatsApp/Instagram):**
```
Callback URL: https://yourdomain.com/webhooks/meta/whatsapp
Verify Token: Your META_WEBHOOK_VERIFY_TOKEN
```

**SendGrid Inbound:**
```
Webhook URL: https://yourdomain.com/webhooks/sendgrid/inbound
```

**Telegram Webhook:**
```bash
# Set webhook
curl -X POST https://api.telegram.org/bot<TOKEN>/setWebhook \
  -d "url=https://yourdomain.com/webhooks/telegram"
```

### 6. Health Checks ✅

```bash
# Check application health
curl https://yourdomain.com/health

# Expected response:
{
  "status": "healthy",
  "checks": {
    "database": { "status": "healthy", "latency": 15 },
    "redis": { "status": "healthy", "latency": 2 }
  }
}

# Kubernetes probes
curl https://yourdomain.com/ready
curl https://yourdomain.com/live

# Prometheus metrics
curl https://yourdomain.com/metrics
```

### 7. Security Verification ✅

```bash
# Test SSL
curl -I https://yourdomain.com

# Check security headers
curl -I https://yourdomain.com | grep -i "strict-transport\|content-security\|x-frame"

# Verify rate limiting
curl -X GET https://yourdomain.com/api/business/me \
  -H "Authorization: Bearer invalid" \
  -w "%{http_code}"
# Should return 401
```

### 8. Load Testing (Optional) ✅

```bash
# Install Artillery
npm install -g artillery

# Run load test
artillery quick --count 100 --num 10 https://yourdomain.com/health
```

### 9. Monitoring Setup ✅

**Health Checks:**
- Endpoint: `GET /health`
- Expected: `200 OK` with `status: "healthy"`
- Alert if: `status !== "healthy"` or 5xx errors

**Key Metrics:**
- Response time < 500ms
- Error rate < 1%
- Database latency < 100ms
- Redis latency < 10ms

**Log Aggregation:**
```bash
# View logs
docker-compose logs -f --tail=100

# Or with PM2
pm2 logs
```

### 10. Backup Strategy ✅

**Database:**
```bash
# Automated backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump $DATABASE_URL > backup_$DATE.sql
aws s3 cp backup_$DATE.sql s3://your-backup-bucket/
```

**Redis:**
```bash
# Redis persistence is enabled in docker-compose.yml
# Append-only file (AOF) configured
```

## Deployment Commands Reference

```bash
# Quick Deploy
docker-compose up -d

# Update Application
docker-compose pull
docker-compose up -d

# Rollback
docker-compose down
git checkout previous-commit
docker-compose up -d

# Scale Workers
docker-compose up -d --scale worker=3

# View Stats
docker stats

# Clean Up
docker system prune -a
```

## Troubleshooting

### Database Connection Issues
```bash
# Check connection
npx prisma db pull

# Reset if needed
npx prisma migrate reset
```

### Redis Connection Issues
```bash
# Test Redis
redis-cli ping

# Check memory
redis-cli info memory
```

### High Memory Usage
```bash
# Restart services
pm2 restart all

# Or with Docker
docker-compose restart
```

### Webhook Failures
```bash
# Test webhook endpoint
curl -X POST https://yourdomain.com/webhooks/test \
  -H "Content-Type: application/json" \
  -d '{"test": true}'

# Check logs
docker-compose logs -f | grep webhook
```

## Post-Deployment Verification

### ✅ Functionality Tests

**1. Business Registration:**
```bash
curl -X POST https://yourdomain.com/api/business/register \
  -H "Authorization: Bearer $CLERK_JWT" \
  -d '{"name": "Test Business"}'
```

**2. Customer Conversation:**
```bash
curl -X POST https://yourdomain.com/api/conversations \
  -H "Authorization: Bearer $CLERK_JWT" \
  -d '{"customerId": "uuid", "channel": "CHAT"}'
```

**3. AI Response:**
```bash
curl -X POST https://yourdomain.com/api/agent/process \
  -H "X-API-Key: $INTERNAL_API_KEY" \
  -d '{
    "businessId": "uuid",
    "content": "Hello",
    "channel": "CHAT"
  }'
```

### ✅ Cost Tracking Verification

Check that costs are being logged:
```sql
SELECT service, SUM(cost) as total
FROM cost_logs
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY service;
```

### ✅ Cache Verification

```bash
# Check cache stats
curl https://yourdomain.com/api/cache/stats \
  -H "Authorization: Bearer $CLERK_JWT"
```

## Support

**Issues:**
- 📧 support@yourdomain.com
- 🐛 GitHub Issues
- 💬 Discord Community

**Emergency Contacts:**
- 📞 +1-800-SUPPORT
- 📱 On-call: +1-555-ONCALL

---

**🎉 Deployment Complete!**

Your Omnichannel AI Platform is now serving customers! 🚀
