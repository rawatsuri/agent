# Deploy to Render Guide

This guide walks you through deploying the Omnichannel AI Platform to Render.com

## 📋 Prerequisites

1. A [Render](https://render.com) account (free tier available)
2. Your code pushed to GitHub/GitLab
3. API keys for external services (see below)

## 🔑 Required API Keys

Before deploying, gather these API keys:

### Required for Basic Operation
- **OpenAI API Key** - Get from [OpenAI Dashboard](https://platform.openai.com/api-keys)
- **Clerk Account** - Sign up at [Clerk.dev](https://clerk.dev) for authentication

### Required for Voice/SMS (choose one)
- **Exotel** (recommended for India) - Get from [Exotel](https://exotel.com)
- **Twilio** (international) - Get from [Twilio](https://twilio.com)

### Required for Email
- **SendGrid** - Get from [SendGrid](https://sendgrid.com)

### Required for WhatsApp/Instagram
- **Meta Developer Account** - Set up at [Meta for Developers](https://developers.facebook.com)

### Required for Voice Processing
- **Azure Speech Services** - Get from [Azure Portal](https://portal.azure.com)
  - Create a "Speech" resource
  - Note the Key and Region

### Optional
- **Deepgram** - For alternative speech recognition
- **Telegram Bot Token** - Via [@BotFather](https://t.me/botfather)

## 🚀 Deployment Steps

### Step 1: Push Code to GitHub

Make sure all your code is committed and pushed:

```bash
git add .
git commit -m "Prepare for Render deployment"
git push origin main
```

### Step 2: Connect to Render

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"Blueprint"**
3. Connect your GitHub repository
4. Select the repository with this project
5. Render will detect the `render.yaml` file automatically

### Step 3: Configure Environment Variables

When you create the Blueprint, Render will prompt you for environment variables marked as `sync: false` in `render.yaml`.

Fill in these values:

#### For API Service (omnichannel-ai-api):
- `OPENAI_API_KEY` - Your OpenAI API key
- `CLERK_SECRET_KEY` - From Clerk Dashboard
- `CLERK_PUBLISHABLE_KEY` - From Clerk Dashboard
- `EXOTEL_API_KEY` - Your Exotel credentials
- `EXOTEL_API_TOKEN` - Your Exotel credentials
- `EXOTEL_SID` - Your Exotel credentials
- `SENDGRID_API_KEY` - Your SendGrid API key
- `META_APP_ID` - Your Meta App ID
- `META_APP_SECRET` - Your Meta App Secret
- `META_ACCESS_TOKEN` - Your Meta Access Token
- `WHATSAPP_PHONE_NUMBER_ID` - Your WhatsApp Phone Number ID
- `TELEGRAM_BOT_TOKEN` - Your Telegram Bot Token
- `AZURE_TTS_KEY` - Your Azure Speech key
- `AZURE_TTS_REGION` - Your Azure Speech region (e.g., "westus", "southeastasia")

#### For Voice Service (omnichannel-ai-voice):
- `AZURE_TTS_KEY` - Same as above
- `AZURE_TTS_REGION` - Same as above
- `EXOTEL_API_KEY` - Same as above
- `EXOTEL_API_TOKEN` - Same as above
- `EXOTEL_SID` - Same as above
- `OPENAI_API_KEY` - Same as above
- `DEEPGRAM_API_KEY` - Optional Deepgram key

#### For Frontend (omnichannel-ai-web):
- `VITE_CLERK_PUBLISHABLE_KEY` - Same Clerk publishable key

### Step 4: Deploy

1. Click **"Apply"** to create the Blueprint
2. Render will automatically:
   - Create the PostgreSQL database
   - Create the Redis instance
   - Deploy the Node.js API server
   - Deploy the Python voice bridge
   - Deploy the React frontend
   - Run database migrations

3. Wait for all services to show **"Live"** status (5-10 minutes)

### Step 5: Verify Deployment

Once deployed, check these URLs:

- **API Health Check**: `https://omnichannel-ai-api.onrender.com/health`
- **Voice Bridge Health**: `https://omnichannel-ai-voice.onrender.com/health`
- **Web Dashboard**: `https://omnichannel-ai-web.onrender.com`

You should see JSON responses indicating the services are running.

## 📱 Configure Webhooks

After deployment, you need to configure webhooks from external services to point to your Render URLs.

### Exotel Webhooks

1. Log into Exotel Dashboard
2. Go to **"App Bazaar"** → **"Webhooks"**
3. Set these URLs:
   - Voice: `https://omnichannel-ai-api.onrender.com/webhooks/exotel/voice`
   - SMS: `https://omnichannel-ai-api.onrender.com/webhooks/exotel/sms`

### SendGrid Inbound Parse

1. Go to SendGrid Dashboard → **Inbound Parse**
2. Add a new host (e.g., `email.yourdomain.com`)
3. Set webhook URL: `https://omnichannel-ai-api.onrender.com/webhooks/sendgrid/inbound`

### Meta Webhooks (WhatsApp/Instagram)

1. Go to [Meta Developers](https://developers.facebook.com)
2. Select your app → **Webhooks**
3. Subscribe to these events:
   - `messages` for WhatsApp
   - `messaging` for Instagram
4. Set callback URL: `https://omnichannel-ai-api.onrender.com/webhooks/meta/whatsapp` (or `/instagram`)
5. Verify token: Use any secret string you configured

### Telegram Bot Webhook

1. Set webhook via API call:
```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://omnichannel-ai-api.onrender.com/webhooks/telegram"}'
```

## 🛠️ Manual Deployment (Without Blueprint)

If you prefer to create services manually:

### 1. Create PostgreSQL Database
- Type: PostgreSQL
- Name: `omnichannel-ai-db`
- Version: 15
- Plan: Starter (or higher for production)

### 2. Create Redis Instance
- Type: Redis
- Name: `omnichannel-ai-redis`
- Plan: Starter

### 3. Deploy Node.js API
- Type: Web Service
- Name: `omnichannel-ai-api`
- Runtime: Node
- Build Command: `cd server && npm install && npm run build`
- Start Command: `cd server && npm start`
- Add all environment variables from `.env.render.example`

### 4. Deploy Python Voice Bridge
- Type: Web Service
- Name: `omnichannel-ai-voice`
- Runtime: Python 3
- Build Command: `cd server/voice-bridge && pip install -r requirements.txt`
- Start Command: `cd server/voice-bridge && uvicorn app:app --host 0.0.0.0 --port $PORT`
- Add voice-related environment variables

### 5. Deploy Frontend
- Type: Static Site
- Name: `omnichannel-ai-web`
- Build Command: `cd web && npm install && npm run build`
- Publish Directory: `web/dist`
- Add `VITE_API_URL` and `VITE_CLERK_PUBLISHABLE_KEY`

## 🔧 Troubleshooting

### Database Connection Issues

```bash
# Check if database is running
# Render dashboard → PostgreSQL → "Connect" tab

# Test connection locally
psql $DATABASE_URL -c "SELECT 1"
```

### Build Failures

1. **Node.js Build Fails**:
   - Check `render-build.sh` has execute permissions
   - Verify `package.json` exists in `server/` directory

2. **Python Build Fails**:
   - Ensure `requirements.txt` exists in `server/voice-bridge/`
   - Check system dependencies (ffmpeg, portaudio)

### Service Communication Issues

The Node.js API and Python Voice Bridge need to communicate:

1. Check the services are both "Live"
2. Verify `VOICE_BRIDGE_URL` env var on API service
3. Verify `NODE_API_URL` env var on Voice service
4. Both services should use HTTPS URLs

### Webhook Not Receiving

1. Check webhook URL is correct
2. Verify the path matches the routes in `webhooks.routes.ts`
3. Check Render logs for incoming requests
4. Ensure webhook sender (Exotel/Meta/etc) can reach Render (no IP blocking)

## 💰 Cost Estimates

### Render Pricing (as of 2026)

**Free Tier:**
- Web Services: 750 hours/month (sleeps after 15 min inactivity)
- PostgreSQL: 90 days free trial
- Redis: 90 days free trial

**Starter Plan ($7/month each):**
- Keeps services always-on
- Good for testing and small deployments

**Standard Plan ($25/month each):**
- Higher performance
- Recommended for production

**Estimated Monthly Costs:**
- Development: $0 (free tier, services sleep)
- Production (Starter): ~$28/month (2 web services + PostgreSQL)
- Production (Standard): ~$75/month (2 web services + PostgreSQL + Redis)

### External API Costs

- **OpenAI**: ~$0.001 per AI response
- **Azure TTS**: ~$0.01 per minute
- **Exotel**: ~$0.02/min voice, ~$0.005/SMS
- **SendGrid**: Free tier: 100 emails/day

Example: 1000 conversations/month ≈ $10-30 in API costs

## 📊 Monitoring

### Render Dashboard

Monitor your services at:
- [Render Dashboard](https://dashboard.render.com)
- Check service logs for errors
- View metrics for CPU/Memory usage

### Health Endpoints

- `/health` - Full health check (DB, Redis, etc.)
- `/ready` - Kubernetes-style readiness probe
- `/live` - Kubernetes-style liveness probe
- `/metrics` - Prometheus-compatible metrics

## 🔄 Updating Deployment

### Automatic Deploys

By default, Render auto-deploys when you push to your default branch.

### Manual Deploy

1. Go to service in Render Dashboard
2. Click **"Manual Deploy"** → **"Deploy Latest Commit"**

### Database Migrations

Migrations run automatically on deploy (configured in `render-build.sh`).

To run manually:
```bash
# Connect to Render Shell
# Dashboard → Service → "Shell" tab
cd server
npx prisma migrate deploy
```

## 🌍 Custom Domain (Optional)

1. In Render Dashboard, go to your Static Site
2. Click **"Settings"** → **"Custom Domain"**
3. Add your domain and follow DNS instructions
4. Update webhook URLs to use your custom domain

## 🆘 Getting Help

- **Render Docs**: [render.com/docs](https://render.com/docs)
- **Project Issues**: Check `AGENTS.md` for architecture details
- **Logs**: View in Render Dashboard → Service → "Logs"

## ✅ Deployment Checklist

- [ ] Code pushed to GitHub
- [ ] Render Blueprint created
- [ ] All environment variables configured
- [ ] All services showing "Live"
- [ ] Health check endpoints responding
- [ ] Webhooks configured in external services
- [ ] Tested a conversation end-to-end
- [ ] Custom domain configured (optional)

## 🎉 Success!

Your Omnichannel AI Platform is now live on Render! 

Access points:
- API: `https://omnichannel-ai-api.onrender.com`
- Voice: `https://omnichannel-ai-voice.onrender.com`
- Dashboard: `https://omnichannel-ai-web.onrender.com`

Next steps:
1. Sign up on your dashboard
2. Configure your business settings
3. Test each channel (Voice, Chat, Email, SMS, WhatsApp, Telegram, Instagram)
4. Monitor costs and usage
