# Voice Implementation - Complete Task List

## 🎯 Project Overview
**Status**: 60% Complete | **Blocked By**: Exotel WebSocket Access
**Goal**: Real-time AI voice assistant with < 1s latency, ₹1-2/min cost

---

## 🔴 CRITICAL BLOCKERS (Cannot Proceed Without)

### 1. Exotel WebSocket Access
**Status**: 🚧 WAITING FOR EXOTEL
- [ ] Email sent to support@exotel.com
- [ ] Need "Voicebot" or "WebSocket" applet enabled
- [ ] Account: solutionai1, Exophone: 09513886363
- [ ] **If no response in 24h, call +91-8080-919-919**
- [ ] **Backup**: Switch to Twilio (has native WebSocket)

**Why Critical**: Without WebSocket, can't use Vocode streaming. Call drops immediately.

---

## 🟠 HIGH PRIORITY - Fix Before Going Live

### 2. Switch to Full Vocode Implementation
**File**: `server/voice-bridge/app.py`  
**Current**: Using `SimpleExotelAdapter` (no AI)  
**Required**: Use `ExotelAdapter` (full Vocode)

```python
# CHANGE THIS (line 16):
from adapters.simple_exotel_adapter import SimpleExotelAdapter

# TO THIS:
from adapters.exotel_adapter import ExotelAdapter
exotel_adapter = ExotelAdapter(node_api_client)
```

**Also need to fix (in exotel_adapter.py):**
- [ ] Change audio sample rate from 16kHz to 8kHz (Exotel uses 8kHz)
- [ ] Add Deepgram Nova model: `model="nova-2-general", tier="nova"`
- [ ] Add event handlers for transcript saving
- [ ] Fix Azure credentials passing (move to config)

### 3. Fix Audio Format
**File**: `server/voice-bridge/adapters/exotel_adapter.py`

```python
# Lines 52, 85 - CHANGE FROM:
sampling_rate: int = 16000

# TO:
sampling_rate: int = 8000  # Exotel uses 8kHz
```

**Impact**: Wrong sample rate causes garbled audio

### 4. Implement Missing Node.js API Endpoints
**File**: Create `server/src/routes/voice-agent.routes.ts`

**Missing endpoints** (voice bridge calls these but they don't exist):
- [ ] `POST /api/agent/voice` - Process voice messages
- [ ] `POST /api/agent/check-budget` - Validate budget before call
- [ ] `POST /api/agent/log-event` - Log conversation events
- [ ] `POST /api/agent/request-transfer` - Transfer to human
- [ ] `POST /api/agent/save-recording` - Save call recording
- [ ] `GET /api/agent/customer` - Lookup customer by phone

**Why Critical**: Without these, Vocode can't get context or save data

### 5. Add Webhook Security
**Files**: All adapter files

**Required**:
- [ ] Add Exotel webhook signature validation
- [ ] Add IP whitelisting (Exotel IPs: 52.203.14.206, 52.203.14.207)
- [ ] Add rate limiting (max 10 calls/min per number)
- [ ] Fix CORS (don't allow all origins in production)

**Example IP whitelist**:
```python
ALLOWED_IPS = [
    "52.203.14.206",    # Exotel India
    "52.203.14.207",
    "54.172.60.0/23",   # Twilio
]
```

### 6. Fix Environment Variables
**File**: `server/voice-bridge/config/settings.py` and `.env`

**Issues**:
- [ ] `.env` uses `INTERNAL_API_KEY`, code uses `NODE_API_KEY` - STANDARDIZE
- [ ] Missing `EXOTEL_PHONE_NUMBER` in config
- [ ] Missing `WEBSOCKET_PING_INTERVAL` (add 20 seconds)
- [ ] Missing `MAX_CALL_DURATION` (add 600 seconds = 10 min)

**Add to `.env`:**
```bash
EXOTEL_PHONE_NUMBER=+916398912969
INTERNAL_API_KEY=your-internal-api-key-here
WEBSOCKET_MAX_SIZE=1048576
WEBSOCKET_PING_INTERVAL=20
WEBSOCKET_PING_TIMEOUT=10
MAX_CALL_DURATION_SECONDS=600
```

### 7. Add Error Handling
**Files**: All adapter files

**Every async operation needs try-catch**:
```python
try:
    result = await operation()
except httpx.TimeoutException:
    logger.error("Timeout, using fallback")
    return get_fallback_twiml()
except Exception as e:
    logger.exception(f"Error: {e}")
    return get_error_twiml()
```

**Specifically fix**:
- [ ] `exotel_adapter.py:207-266` - start_conversation error handling
- [ ] `exotel_adapter.py:267-273` - process_audio error handling
- [ ] `telephony_router.py:135-143` - provider switching errors
- [ ] `app.py:86-87` - router include error handling

---

## 🟡 MEDIUM PRIORITY - Optimize for Performance

### 8. Optimize for Low Latency (< 1s)
**Target**: 500ms-1s response time (currently would be 2-3s)

**Optimizations needed**:

**A. Deepgram STT** (`exotel_adapter.py:190-197`):
```python
# ADD THESE OPTIONS:
DeepgramTranscriberConfig.from_input_device(
    input_device,
    endpointing_config=PunctuationEndpointingConfig(),
    api_key=settings.DEEPGRAM_API_KEY,
    model="nova-2-general",  # Fastest model
    tier="nova",              # Fastest tier
    language="en-US",         # Specify explicitly
    smart_format=True,        # Better formatting
)
```

**B. Connection Pooling** (`client.py:56`):
```python
# Current: New client per request
# Fix: Use singleton client
_client = None

def get_client():
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=30.0,
            limits=httpx.Limits(max_connections=100)
        )
    return _client
```

**C. Cache Business Config**:
```python
# Load once and cache for 5 minutes
# Don't load on every call
```

**D. Pre-warm TTS Connections**:
```python
# Keep Azure Speech SDK connection open
# Don't reconnect per synthesis
```

### 9. Add Call Features

**A. Call Transfer to Human**:
- [ ] Implement transfer API endpoint
- [ ] Add transfer logic in Vocode agent
- [ ] Test with real phone number

**B. Call Recording**:
- [ ] Capture Exotel recording URL
- [ ] Save to database
- [ ] Add retrieval API

**C. Multi-language Support**:
- [ ] Add Hindi voice (Azure: `hi-IN-MadhurNeural`)
- [ ] Add language detection
- [ ] Allow per-customer language preference

**D. Maximum Call Duration**:
- [ ] Enforce 10-minute limit
- [ ] Warn at 8 minutes
- [ ] Graceful hangup at 10 minutes

### 10. Add Monitoring & Metrics

**Required metrics**:
- [ ] Active calls (gauge)
- [ ] Call duration (histogram)
- [ ] STT latency (timer)
- [ ] TTS latency (timer)
- [ ] AI response time (timer)
- [ ] Error rate (counter)

**Add endpoint**: `GET /metrics` for Prometheus

**Structured logging**:
```python
logger.info({
    "event": "call_started",
    "call_sid": call_sid,
    "from": mask_phone(from_number),
    "provider": "exotel",
    "timestamp": time.time()
})
```

### 11. Testing Infrastructure

**Create test files**:
```
server/voice-bridge/tests/
├── __init__.py
├── conftest.py              # pytest fixtures
├── unit/
│   ├── test_exotel_adapter.py
│   ├── test_twilio_adapter.py
│   └── test_client.py
├── integration/
│   ├── test_websocket.py
│   └── test_node_api.py
├── mocks.py                 # Mock Exotel, Azure, etc.
└── e2e/
    └── test_call_flow.py
```

**Required tests**:
- [ ] Unit tests for all adapters (70% coverage)
- [ ] WebSocket connection tests
- [ ] Load tests (10 concurrent calls)
- [ ] E2E test with mock Exotel

---

## 🟢 LOW PRIORITY - Nice to Have

### 12. Code Quality Improvements

**A. Create Base Adapter Class**:
```python
# adapters/base_adapter.py
from abc import ABC, abstractmethod

class BaseTelephonyAdapter(ABC):
    @abstractmethod
    async def handle_inbound_call(self, call_sid, from_number, to_number):
        pass
    
    @abstractmethod
    def get_webhook_routes(self):
        pass
```

**B. Remove Duplicate Code**:
- [ ] Extract common TwiML generation
- [ ] Extract common logging
- [ ] Extract common error handling

**C. Add Type Hints**:
- [ ] All functions should have type hints
- [ ] Add mypy checking

### 13. Deployment Improvements

**A. Multi-stage Dockerfile**:
```dockerfile
# Smaller production image
FROM python:3.11-slim as builder
# ... build dependencies ...

FROM python:3.11-slim
# ... runtime only ...
USER appuser  # Don't run as root
```

**B. Health Checks**:
- [ ] Add WebSocket health check (not just HTTP)
- [ ] Add Deepgram connectivity check
- [ ] Add Azure Speech connectivity check

**C. Render Configuration**:
Create `render.yaml`:
```yaml
services:
  - type: web
    name: voice-bridge
    runtime: docker
    plan: standard
    envVars:
      - key: PORT
        value: 10000
      - key: MAX_CONCURRENT_CALLS
        value: 20
    healthCheckPath: /health
    autoDeploy: true
```

### 14. Documentation

**Create files**:
- [ ] `server/voice-bridge/README.md` - Setup instructions
- [ ] `server/voice-bridge/API.md` - API documentation
- [ ] `server/voice-bridge/ARCHITECTURE.md` - Architecture diagrams
- [ ] `server/voice-bridge/DEPLOYMENT.md` - Deployment guide

---

## 📊 COST BREAKDOWN (Verified)

| Service | Cost/Minute | Notes |
|---------|-------------|-------|
| **Exotel India** | ₹0.30-0.40 | Base telephony cost |
| **Deepgram STT** | ₹0.14 | Nova model, streaming |
| **Azure TTS** | ₹0.25 | Standard voices |
| **OpenAI GPT-4o-mini** | ₹0.15 | Average per call |
| **Total** | **₹0.84-0.94** | **Within ₹1.5-2 budget!** ✅ |

---

## ⚡ LATENCY TARGETS (Achievable with Vocode)

| Component | Current | Target | Status |
|-----------|---------|--------|--------|
| **Time to First Byte** | - | 300-500ms | 🟡 Needs WebSocket |
| **Time to First Audio** | - | 500-800ms | 🟡 Needs optimization |
| **Full Response** | - | 1-2s | 🟡 Depends on query |
| **Streaming Chunks** | - | 50-100ms | 🟡 Audio buffering |

**500ms is achievable for simple responses with Vocode streaming!**

---

## 📅 RECOMMENDED TIMELINE

### Week 1: Critical Fixes
- **Day 1-2**: Switch to full Vocode, fix audio rate, implement missing APIs
- **Day 3-4**: Add security (signatures, IP whitelist, rate limiting)
- **Day 5**: Test WebSocket streaming (requires Exotel access)

### Week 2: Features & Testing
- **Day 6-7**: Add call transfer, recording, multi-language
- **Day 8-9**: Write comprehensive tests
- **Day 10**: Load testing (10 concurrent calls)

### Week 3: Optimization & Deployment
- **Day 11-12**: Optimize latency, add monitoring
- **Day 13-14**: Production deployment, documentation
- **Day 15**: Soft launch with 10 beta users

---

## 🔍 FILES TO CHECK/UPDATE

### Must Modify (Critical):
1. `server/voice-bridge/app.py` - Switch to full Vocode
2. `server/voice-bridge/adapters/exotel_adapter.py` - Fix audio rate, add error handling
3. `server/voice-bridge/config/settings.py` - Fix env vars
4. `server/.env` - Add missing variables
5. `server/src/routes/voice-agent.routes.ts` - Create missing endpoints

### Should Modify (High Priority):
6. `server/voice-bridge/api/client.py` - Add connection pooling
7. `server/voice-bridge/adapters/simple_exotel_adapter.py` - Add security
8. `server/voice-bridge/telephony_router.py` - Fix routing
9. All adapter files - Add comprehensive error handling

### Nice to Have (Medium Priority):
10. `server/voice-bridge/tests/` - Create test suite
11. `server/voice-bridge/Dockerfile` - Multi-stage build
12. `server/voice-bridge/render.yaml` - Deployment config
13. Documentation files

---

## ⚠️ KNOWN ISSUES (Documented)

### Issue #1: WebSocket Not Working
**Status**: Blocked by Exotel  
**Workaround**: Use Twilio instead  
**Impact**: Can't test Vocode streaming

### Issue #2: Wrong Audio Sample Rate
**Status**: Code ready, needs activation  
**Fix**: Change 16kHz to 8kHz  
**Impact**: Will cause garbled audio if not fixed

### Issue #3: Missing API Endpoints
**Status**: Node.js needs implementation  
**Impact**: Vocode can't get context or save data

### Issue #4: No Security on Webhooks
**Status**: Needs implementation  
**Impact**: Anyone can call webhook, spam calls

### Issue #5: Simple Adapter Active
**Status**: Wrong adapter being used  
**Fix**: Switch import in app.py  
**Impact**: No AI conversation currently

---

## ✅ COMPLETION CHECKLIST

### Before Going Live:
- [ ] Exotel WebSocket enabled OR Twilio configured
- [ ] Full Vocode adapter activated
- [ ] Audio sample rate fixed (8kHz)
- [ ] All 6 Node.js API endpoints implemented
- [ ] Webhook security implemented
- [ ] Error handling complete
- [ ] Tests passing (70% coverage)
- [ ] Load tested (10 concurrent calls)
- [ ] Monitoring active
- [ ] Documentation complete

### Performance Targets:
- [ ] < 1s response time achieved
- [ ] < ₹2/minute cost maintained
- [ ] 99% uptime in testing
- [ ] < 1% error rate

---

## 📞 EMERGENCY CONTACTS

**Exotel Support**:
- Email: support@exotel.com
- Phone: +91-8080-919-919
- Reference: solutionai1, App ID: 1176163

**Twilio Backup**:
- Can switch in 1 day if Exotel fails
- Higher cost (₹1.50/min vs ₹0.35/min)
- Better documentation and support

---

## 🎯 SUCCESS CRITERIA

**MVP Ready When**:
1. Caller dials number
2. AI answers within 1 second
3. Natural conversation with < 2s response time
4. Call ends, recording saved, summary generated
5. Cost < ₹2/minute
6. Works reliably for 100+ calls/day

**Current Progress**: 60% complete, blocked on WebSocket access

---

**Last Updated**: 2026-02-08  
**Next Review**: After Exotel responds  
**Owner**: Development Team
