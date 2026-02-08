"""
Simple Exotel Adapter - No Vocode, just basic TwiML
This will actually work for testing
"""

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse, JSONResponse
from loguru import logger
import time
import traceback


class SimpleExotelAdapter:
    """Simple Exotel adapter that returns basic TwiML"""

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
            """Handle incoming call - return simple TwiML"""
            start_time = time.time()
            call_sid = None

            try:
                # Log request details
                logger.info(f"🎯 WEBHOOK HIT: {request.method} {request.url}")
                logger.info(f"   Headers: {dict(request.headers)}")

                # Get params from GET or POST
                if request.method == "GET":
                    params = dict(request.query_params)
                    logger.info(f"   GET params: {params}")
                else:
                    try:
                        params = dict(await request.form())
                        logger.info(f"   POST form params: {params}")
                    except Exception as form_error:
                        logger.error(f"   Error parsing form: {form_error}")
                        # Try to read as text for debugging
                        body = await request.body()
                        logger.info(f"   Raw body: {body.decode('utf-8', errors='replace')}")
                        params = {}

                call_sid = params.get("CallSid") or params.get("callSid") or f"call_{int(time.time())}"
                from_number = params.get("From") or params.get("CallFrom", "unknown")
                to_number = params.get("To") or params.get("CallTo", "unknown")
                direction = params.get("Direction", "inbound")

                logger.info(f"📞 Incoming call details:")
                logger.info(f"   CallSid: {call_sid}")
                logger.info(f"   From: {from_number}")
                logger.info(f"   To: {to_number}")
                logger.info(f"   Direction: {direction}")
                logger.info(f"   All params: {params}")

                # Store call
                self.active_calls[call_sid] = {
                    "from": from_number,
                    "to": to_number,
                    "direction": direction,
                    "start_time": time.time(),
                    "params": params
                }

                # Build TwiML for Exotel (Exotel uses Twilio-compatible format)
                # Note: Exotel requires specific format - no voice attribute on Say
                twiml = """<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Hello! This is a test. The system is working properly.</Say>
    <Pause length="2"/>
    <Say>Thank you for calling. Goodbye.</Say>
    <Hangup/>
</Response>"""

                processing_time = time.time() - start_time
                logger.info(f"✅ TwiML generated in {processing_time:.3f}s")
                logger.info(f"   Response length: {len(twiml)} bytes")
                logger.info(f"   Response preview: {twiml[:200]}...")

                response = PlainTextResponse(
                    content=twiml,
                    media_type="application/xml"
                )

                logger.info(f"📤 Returning response with status: {response.status_code}")
                return response

            except Exception as e:
                processing_time = time.time() - start_time
                logger.error(f"❌ Voice webhook error after {processing_time:.3f}s: {e}")
                logger.error(f"   Traceback: {traceback.format_exc()}")

                error_twiml = """<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Sorry, we are experiencing technical difficulties. Please try again later.</Say>
    <Hangup/>
</Response>"""

                return PlainTextResponse(
                    content=error_twiml,
                    media_type="application/xml"
                )

        @router.get("/health")
        async def health_check():
            return {
                "status": "healthy",
                "adapter": "simple_exotel",
                "active_calls": len(self.active_calls),
                "call_ids": list(self.active_calls.keys())[-5:]  # Last 5 calls
            }

        return router
