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
    logger.info("=" * 60)
    logger.info("🚀 Voice Bridge starting up...")
    logger.info("=" * 60)
    logger.info(f"Environment: development")
    logger.info(f"Node.js API URL: https://agent-3-hkgc.onrender.com")

    # Log all registered routes
    logger.info("📋 Registered Routes:")
    for route in app.routes:
        path = getattr(route, "path", str(route))
        methods = list(getattr(route, "methods", []))
        if methods and path:
            logger.info(f"   {methods} {path}")

    # Test Node.js API connection
    try:
        health = await node_api_client.health_check()
        logger.info(f"✅ Node.js API connection: {health.get('status', 'ok')}")
    except Exception as e:
        logger.warning(f"⚠️  Node.js API health check failed: {e}")

    logger.info("=" * 60)

    yield

    logger.info("=" * 60)
    logger.info("🛑 Voice Bridge shutting down...")
    logger.info("=" * 60)


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
router = exotel_adapter.get_webhook_routes()
app.include_router(router)

logger.info(f"✅ Exotel webhook routes registered")
logger.info(f"   - GET  /webhooks/exotel/voice")
logger.info(f"   - POST /webhooks/exotel/voice")


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
        "version": "2.0.0",
        "webhook_url": "/webhooks/exotel/voice"
    }


# Debug endpoint to test TwiML directly
@app.get("/test/twiml")
@app.post("/test/twiml")
async def test_twiml(request):
    """Test endpoint to verify TwiML is being returned correctly"""
    logger.info(f"🧪 Test endpoint hit: {request.method}")

    twiml = """<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Hello! This is a test. The system is working properly.</Say>
    <Pause length="2"/>
    <Say>Thank you for calling. Goodbye.</Say>
    <Hangup/>
</Response>"""

    logger.info(f"✅ Returning test TwiML ({len(twiml)} bytes)")

    return PlainTextResponse(
        content=twiml,
        media_type="application/xml"
    )


# Debug endpoint to check routes
@app.get("/debug/routes")
async def debug_routes():
    """Debug endpoint to list all registered routes"""
    routes = []
    for route in app.routes:
        routes.append({
            "path": getattr(route, "path", str(route)),
            "methods": list(getattr(route, "methods", [])),
            "name": getattr(route, "name", None)
        })

    return {
        "total_routes": len(routes),
        "routes": routes,
        "exotel_webhook": "/webhooks/exotel/voice" in [r["path"] for r in routes]
    }
