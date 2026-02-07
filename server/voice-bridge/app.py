"""
Voice Bridge - Main FastAPI Application
Multi-provider telephony server (Twilio + Exotel) with Vocode integration
SECURED: Webhook signature validation, PII masking, conversation tracking
"""

import time
from contextlib import asynccontextmanager
from typing import Dict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from loguru import logger

from api.client import NodeAPIClient
from config import settings
from telephony_router import TelephonyRouter


# Active call tracking
active_calls: Dict[str, dict] = {}

# Initialize services
node_api_client = NodeAPIClient()
telephony_router = TelephonyRouter(node_api_client)


def mask_phone(phone: str) -> str:
    """Mask phone number for logging (GDPR compliance)"""
    if not phone or len(phone) < 6:
        return "****"
    return phone[:4] + "****" + phone[-2:]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan context manager"""
    # Startup
    logger.info("🚀 Voice Bridge starting up...")
    logger.info(f"Environment: {settings.ENVIRONMENT}")
    logger.info(f"Node.js API URL: {settings.NODE_API_URL}")
    logger.info(f"Max concurrent calls: {settings.MAX_CONCURRENT_CALLS}")
    
    # Store start time
    app.state.start_time = time.time()
    
    # Test Node.js API connection
    try:
        health = await node_api_client.health_check()
        logger.info(f"✅ Node.js API connection: {health.get('status', 'ok')}")
    except Exception as e:
        logger.warning(f"⚠️  Node.js API health check failed: {e}")
    
    yield
    
    # Shutdown
    logger.info("🛑 Voice Bridge shutting down...")
    
    # Cleanup active calls
    for call_sid in list(telephony_router.active_calls.keys()):
        try:
            await telephony_router.handle_call_end(call_sid, 0)
        except Exception as e:
            logger.error(f"Error cleaning up call {call_sid}: {e}")
    
    logger.info("✅ Shutdown complete")


# Create FastAPI app
app = FastAPI(
    title="Voice Bridge",
    description="Multi-provider telephony server for AI-powered voice calls",
    version="2.0.0",
    lifespan=lifespan
)

# CORS middleware (restrict in production)
origins = ["*"] if settings.ENVIRONMENT == "development" else [
    f"https://{settings.BASE_URL}",
    settings.NODE_API_URL,
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============ Include Telephony Routes ============
# These include secured Twilio and Exotel webhook handlers
app.include_router(telephony_router.get_all_routes())


# ============ Health Check Endpoints ============

@app.get("/health", tags=["Health"])
async def health_check():
    """Comprehensive health check endpoint"""
    start_time = time.time()
    
    health_status = {
        "status": "healthy",
        "timestamp": time.time(),
        "version": "2.0.0",
        "uptime_seconds": time.time() - getattr(app.state, "start_time", time.time()),
        "services": {}
    }
    
    # Check Node.js API
    try:
        node_health = await node_api_client.health_check()
        health_status["services"]["node_api"] = {
            "status": "connected",
            "latency_ms": round((time.time() - start_time) * 1000, 2)
        }
    except Exception as e:
        health_status["services"]["node_api"] = {
            "status": "disconnected",
            "error": str(e)
        }
        health_status["status"] = "degraded"
    
    # Check telephony providers
    health_status["services"]["twilio"] = {
        "configured": bool(settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN)
    }
    health_status["services"]["exotel"] = {
        "configured": bool(settings.EXOTEL_SID and settings.EXOTEL_API_KEY)
    }
    
    # Call stats
    router_stats = telephony_router.get_stats()
    health_status["calls"] = {
        "active": router_stats["active_calls"],
        "by_provider": router_stats["calls_by_provider"],
        "limit": settings.MAX_CONCURRENT_CALLS
    }
    
    if router_stats["active_calls"] >= settings.MAX_CONCURRENT_CALLS:
        health_status["status"] = "at_capacity"
    
    return JSONResponse(
        status_code=200 if health_status["status"] == "healthy" else 503,
        content=health_status
    )


@app.get("/ready", tags=["Health"])
async def readiness_check():
    """Kubernetes readiness probe"""
    stats = telephony_router.get_stats()
    return {
        "status": "ready",
        "active_calls": stats["active_calls"]
    }


@app.get("/live", tags=["Health"])
async def liveness_check():
    """Kubernetes liveness probe"""
    return {"status": "alive"}


# ============ API Endpoints ============

@app.get("/api/calls/active", tags=["API"])
async def get_active_calls():
    """Get list of active calls"""
    stats = telephony_router.get_stats()
    return {
        "total": stats["active_calls"],
        "by_provider": stats["calls_by_provider"],
        "limit": settings.MAX_CONCURRENT_CALLS
    }


@app.post("/api/calls/{call_sid}/hangup", tags=["API"])
async def hangup_call(call_sid: str):
    """Manually hangup a call"""
    if call_sid not in telephony_router.active_calls:
        return JSONResponse(
            status_code=404,
            content={"error": "Call not found"}
        )
    
    try:
        await telephony_router.handle_call_end(call_sid, 0)
        return {"success": True, "message": "Call hangup initiated"}
    except Exception as e:
        logger.error(f"Error hanging up call {call_sid}: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )


# ============ Metrics Endpoint ============

@app.get("/metrics", tags=["Monitoring"])
async def get_metrics():
    """Prometheus-compatible metrics endpoint"""
    stats = telephony_router.get_stats()
    
    metrics_text = f"""# HELP voice_bridge_active_calls Number of active calls
# TYPE voice_bridge_active_calls gauge
voice_bridge_active_calls{{}} {stats['active_calls']}

# HELP voice_bridge_active_calls_twilio Active Twilio calls
# TYPE voice_bridge_active_calls_twilio gauge
voice_bridge_active_calls_twilio{{}} {stats['calls_by_provider']['twilio']}

# HELP voice_bridge_active_calls_exotel Active Exotel calls
# TYPE voice_bridge_active_calls_exotel gauge
voice_bridge_active_calls_exotel{{}} {stats['calls_by_provider']['exotel']}

# HELP voice_bridge_max_concurrent_calls Max concurrent calls limit
# TYPE voice_bridge_max_concurrent_calls gauge
voice_bridge_max_concurrent_calls{{}} {settings.MAX_CONCURRENT_CALLS}
"""
    return PlainTextResponse(content=metrics_text)


# ============ Error Handlers ============

@app.exception_handler(Exception)
async def global_exception_handler(request, exc: Exception):
    """Global exception handler - masks sensitive info"""
    logger.error(f"Unhandled exception: {type(exc).__name__}: {exc}")
    return JSONResponse(
        status_code=500,
        content={"success": False, "error": "Internal server error"}
    )


if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "app:app",
        host=settings.VOICE_BRIDGE_HOST,
        port=settings.VOICE_BRIDGE_PORT,
        reload=settings.ENVIRONMENT == "development",
        workers=1 if settings.ENVIRONMENT == "development" else settings.WORKERS,
        log_level="info" if settings.ENVIRONMENT == "production" else "debug"
    )
