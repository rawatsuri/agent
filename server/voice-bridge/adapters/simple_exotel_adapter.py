"""
Simple Exotel Adapter - No Vocode, just basic TwiML
This will actually work for testing
"""

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse, JSONResponse
from loguru import logger
import time


class SimpleExotelAdapter:
    """Simple Exotel adapter that returns basic TwiML"""
    
    def __init__(self, node_api_client=None):
        self.node_api_client = node_api_client
        self.active_calls = {}
        logger.info("📞 SimpleExotelAdapter initialized")
    
    def get_webhook_routes(self):
        """Return FastAPI routes for Exotel webhooks"""
        router = APIRouter(prefix="/exotel", tags=["exotel"])
        
        @router.get("/voice")
        @router.post("/voice")
        async def exotel_voice(request: Request):
            """Handle incoming call - return simple TwiML"""
            try:
                # Get params from GET or POST
                if request.method == "GET":
                    params = dict(request.query_params)
                else:
                    params = dict(await request.form())
                
                call_sid = params.get("CallSid") or params.get("callSid", f"call_{int(time.time())}")
                from_number = params.get("From") or params.get("CallFrom", "unknown")
                to_number = params.get("To") or params.get("CallTo", "unknown")
                
                logger.info(f"📞 Incoming call: {call_sid} from {from_number}")
                
                # Store call
                self.active_calls[call_sid] = {
                    "from": from_number,
                    "to": to_number,
                    "start_time": time.time()
                }
                
                # Return simple TwiML that speaks a greeting and hangs up
                # This proves the webhook is working
                twiml = """<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">Hello! This is a test call. Your AI assistant is being configured. Please call back in a few minutes.</Say>
    <Hangup/>
</Response>"""
                
                return PlainTextResponse(content=twiml, media_type="application/xml")
                
            except Exception as e:
                logger.error(f"Voice webhook error: {e}")
                error_twiml = """<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Sorry, we are experiencing technical difficulties. Please try again later.</Say>
    <Hangup/>
</Response>"""
                return PlainTextResponse(content=error_twiml, media_type="application/xml")
        
        @router.get("/health")
        async def health_check():
            return {
                "status": "healthy",
                "adapter": "simple_exotel",
                "active_calls": len(self.active_calls)
            }
        
        return router
