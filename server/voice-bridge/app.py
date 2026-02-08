"""
Voice Bridge - Main FastAPI Application (Simplified)
Basic Exotel webhook handler that actually works
"""

import time
from contextlib import asynccontextmanager
from typing import Dict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from loguru import logger

from api.client import NodeAPIClient
from adapters.simple_exotel_adapter import SimpleExotelAdapter


# Active call tracking
active_calls: Dict[str, dict] = {}

# Initialize services
node_api_client = NodeAPIClient()
exotel_adapter = SimpleExotelAdapter(node_api_client)


def mask_phone(phone: str) -> str:
    """Mask phone number for logging (GDPR compliance)"""
    if not phone or len(phone) < 6:
        return "****"
    return phone[:4] + "****" + phone[-2:]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan context manager"""
    logger.info("🚀 Voice Bridge starting up...")
    logger.info(f"Environment: development")
    logger.info(f"Node.js API URL: https://agent-3-hkgc.onrender.com")
    
    # Test Node.js API connection
    try:
        health = await node_api_client.health_check()
        logger.info(f"✅ Node.js API connection: {health.get('status', 'ok')}")
    except Exception as e:
        logger.warning(f"⚠️  Node.js API health check failed: {e}")
    
    yield
    
    logger.info("🛑 Voice Bridge shutting down...")


# Create FastAPI app
app = FastAPI(
    title="Voice Bridge",
    description="Simple telephony server for Exotel integration",
    version="2.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Include Exotel routes
app.include_router(exotel_adapter.get_webhook_routes())


# Direct route for Exotel webhook (ensure it works)
@app.get("/webhooks/exotel/voice")
@app.post("/webhooks/exotel/voice")
async def direct_exotel_voice(request):
    """Direct webhook handler for Exotel"""
    try:
        # Get params
        if request.method == "GET":
            params = dict(request.query_params)
        else:
            params = dict(await request.form())
        
        call_sid = params.get("CallSid") or f"call_{int(time.time())}"
        from_number = params.get("From") or params.get("CallFrom", "unknown")
        
        logger.info(f"📞 Webhook received! Call: {call_sid} from {from_number}")
        
        # Return simple TwiML (Exotel format - no voice attribute)
        twiml = """<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Hello! This is a test. The system is working.</Say>
    <Pause length="1"/>
    <Hangup/>
</Response>"""
        
        return PlainTextResponse(content=twiml, media_type="application/xml")
        
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        return PlainTextResponse(
            content="""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Error occurred. Please try again.</Say>
    <Hangup/>
</Response>""",
            media_type="application/xml"
        )


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "voice-bridge",
        "version": "2.0.0",
        "adapter": "simple_exotel",
        "active_calls": len(exotel_adapter.active_calls),
        "timestamp": time.time()
    }


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "service": "Voice Bridge",
        "status": "running",
        "version": "2.0.0"
    }
