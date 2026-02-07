# Voice Bridge - Python Service

A production-ready, self-hosted voice telephony bridge that connects Exotel phone calls to AI-powered conversations using Vocode, faster-whisper, and Azure Text-to-Speech.

## Architecture

```
┌─────────────┐      WebSocket       ┌──────────────┐      HTTP       ┌─────────────┐
│   Exotel    │ ◄──────────────────► │ Voice Bridge │ ◄──────────────► │ Node.js API │
│   (PSTN)    │    Audio Stream      │   (Python)   │   AI Requests   │ (Main App)  │
└─────────────┘                      └──────────────┘                 └─────────────┘
                                            │
                                            │ Uses
                                            ▼
                              ┌─────────────────────────┐
                              │    faster-whisper       │
                              │    (Speech-to-Text)     │
                              └─────────────────────────┘
                                            │
                                            │ Uses
                                            ▼
                              ┌─────────────────────────┐
                              │   Azure TTS             │
                              │   (Text-to-Speech)      │
                              └─────────────────────────┘
```

## Features

- **Real-time streaming** - Low-latency bidirectional audio streaming
- **Fast transcription** - Uses `faster-whisper` for efficient STT
- **High-quality TTS** - Azure Cognitive Services with SSML support
- **Concurrent calls** - Handle multiple calls simultaneously
- **Budget control** - Integrates with Node.js API for cost tracking
- **Call management** - Transfer, hangup, and recording support
- **Health monitoring** - Built-in health checks and metrics
- **Production-ready** - Docker containerization, proper logging

## Quick Start

### Prerequisites

- Python 3.11+
- Azure Speech Services account
- Exotel account (SID, API Key, Token)
- Running Node.js API server

### Installation

```bash
# Navigate to voice-bridge directory
cd server/voice-bridge

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Node.js API Configuration
NODE_API_URL=http://localhost:3000
NODE_API_KEY=your-internal-api-key

# Exotel Configuration
EXOTEL_SID=your-exotel-sid
EXOTEL_API_KEY=your-exotel-api-key
EXOTEL_API_TOKEN=your-exotel-api-token
EXOTEL_SUBDOMAIN=api.exotel.com

# Azure Speech Services (TTS)
AZURE_SPEECH_KEY=your-azure-speech-key
AZURE_SPEECH_REGION=your-region
AZURE_SPEECH_VOICE=en-US-JennyNeural

# Server Configuration
VOICE_BRIDGE_PORT=8000
VOICE_BRIDGE_HOST=0.0.0.0
MAX_CONCURRENT_CALLS=10
```

### Running

**Development Mode:**
```bash
# Using the start script
./start.sh dev

# Or manually
python app.py
```

**Production Mode:**
```bash
./start.sh prod
```

**Docker:**
```bash
./start.sh docker

# Or manually
docker build -t voice-bridge .
docker run -p 8000:8000 --env-file .env voice-bridge
```

## API Endpoints

### Health & Monitoring

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Comprehensive health check with service status |
| `/ready` | GET | Kubernetes readiness probe |
| `/live` | GET | Kubernetes liveness probe |
| `/metrics` | GET | Prometheus-compatible metrics |

### Webhooks (Exotel)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhooks/exotel/incoming` | POST | Handle incoming calls |
| `/webhooks/exotel/status` | POST | Call status updates |
| `/webhooks/exotel/recording` | POST | Recording callbacks |

### Management API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/calls/active` | GET | List active calls |
| `/api/calls/{call_sid}/hangup` | POST | Hangup a call |
| `/api/calls/{call_sid}/transfer` | POST | Transfer to human |

### WebSocket

| Endpoint | Description |
|----------|-------------|
| `/ws/stream/{call_sid}` | Real-time audio streaming |

## File Structure

```
voice-bridge/
├── app.py                    # Main FastAPI application
├── config.py                 # Configuration management
├── vocode_server.py          # Vocode streaming server
├── requirements.txt          # Python dependencies
├── Dockerfile               # Docker configuration
├── start.sh                 # Startup script
├── .env.example             # Environment template
├── .env                     # Your configuration (gitignored)
├── api/
│   ├── __init__.py
│   └── client.py            # Node.js API client
└── handlers/
    ├── __init__.py
    ├── exotel_handler.py    # Exotel telephony integration
    └── azure_tts.py         # Azure Text-to-Speech
```

## Configuration Options

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENVIRONMENT` | `development` | Environment mode |
| `VOICE_BRIDGE_HOST` | `0.0.0.0` | Server bind address |
| `VOICE_BRIDGE_PORT` | `8000` | Server port |
| `MAX_CONCURRENT_CALLS` | `10` | Maximum concurrent calls |
| `WORKERS` | `1` | Number of worker processes |
| `NODE_API_URL` | - | Node.js API URL |
| `NODE_API_KEY` | - | API authentication key |
| `EXOTEL_SID` | - | Exotel account SID |
| `EXOTEL_API_KEY` | - | Exotel API key |
| `EXOTEL_API_TOKEN` | - | Exotel API token |
| `AZURE_SPEECH_KEY` | - | Azure Speech key |
| `AZURE_SPEECH_REGION` | - | Azure region |
| `AZURE_SPEECH_VOICE` | `en-US-JennyNeural` | Default voice |
| `WHISPER_MODEL_SIZE` | `base` | Whisper model (tiny/base/small) |

### Audio Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `AUDIO_SAMPLE_RATE` | `8000` | Sample rate (Hz) |
| `AUDIO_CHANNELS` | `1` | Audio channels |
| `AUDIO_CHUNK_SIZE` | `160` | Chunk size in bytes |

## How It Works

### Call Flow

1. **Incoming Call** - Exotel receives a call and sends webhook to `/webhooks/exotel/incoming`

2. **Budget Check** - Voice Bridge checks Node.js API for budget/rate limits

3. **Accept Call** - Returns TwiML to connect to WebSocket stream

4. **Audio Streaming** - WebSocket connection established for bidirectional audio

5. **Speech Recognition** - `faster-whisper` transcribes incoming audio in real-time

6. **AI Processing** - Transcribed text sent to Node.js API for AI response

7. **Speech Synthesis** - Azure TTS converts AI response to audio

8. **Playback** - Audio streamed back to caller via WebSocket

9. **Repeat** - Steps 5-8 continue until call ends

### Audio Processing

- **Input**: μ-law (mu-law) encoded audio at 8kHz (standard telephony)
- **STT**: Converted to PCM, processed by Whisper model
- **TTS**: Azure generates PCM audio, converted back to μ-law
- **Output**: μ-law encoded audio at 8kHz

## Cost Structure

| Service | Cost | Unit |
|---------|------|------|
| Exotel Voice | $0.02/min | Per minute |
| Azure TTS | $0.01/min | Per minute |
| Whisper STT | $0 (local) | Self-hosted |
| AI API Calls | $0.001 | Per request |

**Total**: ~$0.03/min for a typical call

## Production Deployment

### Docker Compose

Add to your `docker-compose.yml`:

```yaml
services:
  voice-bridge:
    build: ./voice-bridge
    ports:
      - "8000:8000"
    environment:
      - ENVIRONMENT=production
      - NODE_API_URL=http://api:3000
      # ... other env vars
    env_file:
      - ./voice-bridge/.env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### PM2 (Alternative)

```bash
# Install PM2
npm install -g pm2

# Create ecosystem file
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'voice-bridge',
    script: 'app.py',
    interpreter: 'python3',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      ENVIRONMENT: 'production'
    },
    error_file: './logs/voice-bridge-error.log',
    out_file: './logs/voice-bridge-out.log'
  }]
}
EOF

# Start with PM2
pm2 start ecosystem.config.js
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: voice-bridge
spec:
  replicas: 2
  selector:
    matchLabels:
      app: voice-bridge
  template:
    metadata:
      labels:
        app: voice-bridge
    spec:
      containers:
      - name: voice-bridge
        image: voice-bridge:latest
        ports:
        - containerPort: 8000
        env:
        - name: ENVIRONMENT
          value: "production"
        - name: NODE_API_URL
          value: "http://api-service:3000"
        livenessProbe:
          httpGet:
            path: /live
            port: 8000
          initialDelaySeconds: 10
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8000
          initialDelaySeconds: 5
          periodSeconds: 5
```

## Monitoring

### Health Checks

```bash
# Check health
curl http://localhost:8000/health

# Response:
{
  "status": "healthy",
  "services": {
    "node_api": {"status": "connected"},
    "azure_tts": {"status": "configured"}
  },
  "active_calls": 3,
  "active_calls_limit": 10
}
```

### Metrics (Prometheus)

```bash
curl http://localhost:8000/metrics
```

### Logging

Logs use structured JSON format via `loguru`:

```bash
# View logs
tail -f logs/voice-bridge.log

# Structured output:
2024-01-01 12:00:00 | INFO | 🚀 Voice Bridge starting up...
2024-01-01 12:00:01 | INFO | ✅ Node.js API connection: {'status': 'ok'}
2024-01-01 12:05:30 | INFO | 📞 Incoming call: abc-123 from +1234567890
2024-01-01 12:05:31 | INFO | ✅ Call abc-123 accepted, returning TwiML
2024-01-01 12:05:35 | INFO | 🔌 WebSocket connected for call abc-123
```

## Troubleshooting

### Common Issues

**Import errors:**
```bash
# Make sure you're in the virtual environment
source venv/bin/activate
pip install -r requirements.txt
```

**Whisper model not loading:**
```bash
# Download whisper model manually
python -c "from faster_whisper import WhisperModel; WhisperModel('base')"
```

**Azure TTS not working:**
```bash
# Test Azure credentials
python -c "from handlers.azure_tts import AzureTTSService; AzureTTSService().test_voice()"
```

**Node.js API not reachable:**
```bash
# Test connectivity
curl http://localhost:3000/health
```

### Debug Mode

Enable debug logging:

```env
LOG_LEVEL=DEBUG
ENVIRONMENT=development
```

## Development

### Running Tests

```bash
# Install dev dependencies
pip install pytest pytest-asyncio

# Run tests
pytest
```

### Code Structure

- **app.py** - FastAPI app, webhooks, WebSocket handling
- **config.py** - Environment configuration with Pydantic validation
- **vocode_server.py** - Real-time conversation orchestration
- **api/client.py** - HTTP client for Node.js API
- **handlers/** - Exotel and Azure integrations

## License

MIT License - See LICENSE file

## Support

For issues and feature requests, please create an issue in the repository.

---

**Built with:**
- FastAPI ⚡
- Vocode 🎙️
- faster-whisper 🗣️
- Azure Cognitive Services 🔊
- Exotel ☎️
