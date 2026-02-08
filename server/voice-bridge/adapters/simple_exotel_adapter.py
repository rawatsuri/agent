"""
Simple Exotel Adapter - Exotel-compatible TwiML
"""

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse, JSONResponse
from loguru import logger
import time
import traceback


class SimpleExotelAdapter:
    """Simple Exotel adapter with Exotel-compatible TwiML"""

    def __init__(self, node_api_client=None):
        self.node_api_client = node_api_client
        self.active_calls = {}
        logger.info("📞 SimpleExotelAdapter initialized")

    def get_webhook_routes(self):
        """Return FastAPI routes for Exotel webhooks"""
        router = APIRouter(prefix="/webhooks/exotel", tags=["exotel"])

        @router.get("/voice")
        @router.post("/voice")
        async def exotel_voice(request: Request):
            """Handle incoming call - return Exotel-compatible TwiML"""
            start_time = time.time()
            call_sid = None

            try:
                logger.info(f"🎯 WEBHOOK HIT: {request.method} {request.url}")

                # Get params
                if request.method == "GET":
                    params = dict(request.query_params)
                else:
                    params = dict(await request.form())

                call_sid = params.get("CallSid") or f"call_{int(time.time())}"
                from_number = params.get("From") or params.get("CallFrom", "unknown")
                to_number = params.get("To") or params.get("CallTo", "unknown")

                logger.info(f"📞 Incoming call: {call_sid} from {from_number} to {to_number}")

                # Store call
                self.active_calls[call_sid] = {
                    "from": from_number,
                    "to": to_number,
                    "start_time": time.time()
                }

                # Exotel-compatible TwiML - NOTE: Exotel uses Connect with Stream for WebSocket
                # But for basic testing, we use simpler Play or Say
                twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Play>https://example.com/silent.mp3</Play>
    <Dial>{to_number}</Dial>
</Response>"""

                processing_time = time.time() - start_time
                logger.info(f"✅ TwiML generated in {processing_time:.3f}s ({len(twiml)} bytes)")

                return PlainTextResponse(
                    content=twiml,
                    media_type="text/xml"
                )

            except Exception as e:
                logger.error(f"❌ Error: {e}")
                logger.error(traceback.format_exc())

                # Error TwiML
                error_twiml = """<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Hangup/>
</Response>"""

                return PlainTextResponse(
                    content=error_twiml,
                    media_type="text/xml"
                )

        @router.get("/health")
        async def health_check():
            return {
                "status": "healthy",
                "adapter": "simple_exotel",
                "active_calls": len(self.active_calls)
            }

        return router
