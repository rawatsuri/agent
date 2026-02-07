# Backend Only - Render Deployment

Backend deployment configuration (Node.js API + Python Voice Bridge)

## 📁 Files

- `render.yaml` - Render Blueprint (backend only)
- `render-build.sh` - Node.js build script
- `render-start.sh` - Node.js start script
- `voice-bridge/render-build.sh` - Python build script
- `voice-bridge/render-start.sh` - Python start script
- `.env` - Environment variables (already created)

## 🚀 Deploy

1. **Push code to GitHub** (from project root):
```bash
git add server/
git commit -m "Backend ready for Render"
git push origin main
```

2. **Go to Render Dashboard**:
   - https://dashboard.render.com/blueprints
   - Click "New +" → "Blueprint"
   - IMPORTANT: Select the **server/** directory, not the root
   - Connect repository
   - Configure environment variables
   - Deploy

## 🌐 Services Deployed

- **API**: `https://omnichannel-ai-api.onrender.com`
- **Voice Bridge**: `https://omnichannel-ai-voice.onrender.com`

## Required Environment Variables

Copy from your `.env` file:
- OPENAI_API_KEY
- CLERK_SECRET_KEY / CLERK_PUBLISHABLE_KEY
- EXOTEL_API_KEY / EXOTEL_API_TOKEN / EXOTEL_SID
- AZURE_SPEECH_KEY / AZURE_SPEECH_REGION
- SENDGRID_API_KEY
- INTERNAL_API_KEY
- (and others from your .env file)

## Testing

Once deployed, test with:
```bash
curl https://omnichannel-ai-api.onrender.com/health
```
