"""
Twilio Adapter for Vocode
Uses Vocode's native TelephonyServer for global calls
"""

import os
import time
from typing import Optional, Dict, Any
from loguru import logger

from vocode.streaming.telephony.server.base import TelephonyServer
from vocode.streaming.models.telephony import TwilioConfig
from vocode.streaming.models.agent import ChatGPTAgentConfig
from vocode.streaming.agent.chat_gpt_agent import ChatGPTAgent
from vocode.streaming.models.message import BaseMessage
from vocode.streaming.models.transcriber import DeepgramTranscriberConfig, PunctuationEndpointingConfig
from vocode.streaming.models.synthesizer import AzureSynthesizerConfig

from config import settings


def mask_phone_number(phone: str) -> str:
    """Mask phone number for logging (GDPR/privacy compliance)"""
    if not phone or len(phone) < 6:
        return "****"
    return phone[:4] + "****" + phone[-2:]


class TwilioAdapter:
    """
    Twilio adapter using Vocode's native TelephonyServer.
    Provides low-latency voice calls for global regions.
    """
    
    def __init__(self, node_api_client):
        self.node_api_client = node_api_client
        self.server: Optional[TelephonyServer] = None
        self.active_calls: Dict[str, Any] = {}
        
        # Validate Twilio config
        if not all([
            settings.TWILIO_ACCOUNT_SID,
            settings.TWILIO_AUTH_TOKEN,
        ]):
            logger.warning("Twilio credentials not configured")
    
    def create_agent_config(self, context: Dict[str, Any]) -> ChatGPTAgentConfig:
        """Create ChatGPT agent config with business context"""
        
        customer = context.get("customer", {})
        business = context.get("business", {})
        memories = context.get("memories", [])
        
        # Build context-rich system prompt
        system_prompt = f"""You are an AI voice assistant for {business.get('name', 'the business')}.

## Customer Information
- Name: {customer.get('name', 'Customer')}
- Trust Score: {customer.get('trustScore', 50)}/100

## Customer History
"""
        if memories:
            for memory in memories[:5]:
                system_prompt += f"- {memory.get('content', '')}\n"
        
        # Business instructions
        custom_prompt = business.get("customPrompt", "")
        if custom_prompt:
            system_prompt += f"\n## Business Instructions\n{custom_prompt}\n"
        
        # Voice guidelines
        system_prompt += """
## Voice Conversation Guidelines
- Keep responses SHORT (under 30 words)
- Use natural, spoken language
- Ask one question at a time
- Be warm and friendly
"""
        
        return ChatGPTAgentConfig(
            openai_api_key=settings.OPENAI_API_KEY,
            initial_message=BaseMessage(
                text=context.get("welcomeMessage", "Hello! How can I help you today?")
            ),
            prompt_preamble=system_prompt,
            model_name=settings.VOCODE_MODEL_NAME,
            generate_responses=True,
        )
    
    def get_transcriber_config(self) -> DeepgramTranscriberConfig:
        """Get Deepgram transcriber config for STT"""
        return DeepgramTranscriberConfig(
            api_key=settings.DEEPGRAM_API_KEY,
            endpointing_config=PunctuationEndpointingConfig(),
        )
    
    def get_synthesizer_config(self, voice_id: str = None) -> AzureSynthesizerConfig:
        """Get Azure synthesizer config for TTS"""
        return AzureSynthesizerConfig(
            api_key=settings.AZURE_SPEECH_KEY,
            region=settings.AZURE_SPEECH_REGION,
            voice_name=voice_id or settings.AZURE_SPEECH_VOICE,
        )
    
    async def create_telephony_server(self, base_url: str) -> TelephonyServer:
        """Create and configure Vocode TelephonyServer for Twilio"""
        
        twilio_config = TwilioConfig(
            account_sid=settings.TWILIO_ACCOUNT_SID,
            auth_token=settings.TWILIO_AUTH_TOKEN,
        )
        
        self.server = TelephonyServer(
            base_url=base_url,
            config_manager=None,  # We'll handle config per-call
            telephony_config=twilio_config,
        )
        
        logger.info("✅ Twilio TelephonyServer created")
        return self.server
    
    async def handle_inbound_call(
        self, 
        call_sid: str, 
        from_number: str, 
        to_number: str
    ) -> Dict[str, Any]:
        """
        Handle incoming Twilio call.
        Loads context and starts Vocode conversation.
        """
        # Log with masked phone (GDPR compliance)
        logger.info(f"📞 Incoming Twilio call: {call_sid} from {mask_phone_number(from_number)}")
        
        # Load full context from Node.js (once at call start)
        context = await self.node_api_client.get_full_context(from_number)
        
        # Create agent config with context
        agent_config = self.create_agent_config(context)
        
        # Store call info with start time for duration tracking
        self.active_calls[call_sid] = {
            "from_number": from_number,
            "to_number": to_number,
            "context": context,
            "agent_config": agent_config,
            "start_time": time.time(),  # Track call duration
            "transcript": [],
        }
        
        # Create conversation in backend (so transcript can be saved later)
        await self.node_api_client.create_voice_conversation(
            call_sid=call_sid,
            phone_number=from_number,
            business_id=context.get("business", {}).get("id"),
            customer_id=context.get("customer", {}).get("id"),
        )
        
        return {
            "call_sid": call_sid,
            "status": "connected",
            "provider": "twilio",
        }
    
    async def handle_call_end(self, call_sid: str, duration: int = None):
        """Handle call end - log async"""
        if call_sid not in self.active_calls:
            logger.warning(f"Call {call_sid} not found in active calls")
            return
            
        call_data = self.active_calls[call_sid]
        
        # Calculate duration if not provided
        if duration is None or duration == 0:
            duration = int(time.time() - call_data.get("start_time", time.time()))
        
        try:
            # Log cost async
            await self.node_api_client.report_call_cost(
                call_sid=call_sid,
                duration_seconds=duration,
                phone_number=call_data.get("from_number"),
            )
            
            # Save transcript if exists
            if call_data.get("transcript"):
                await self.node_api_client.save_transcript(
                    call_sid=call_sid,
                    transcript=call_data["transcript"],
                )
        except Exception as e:
            logger.error(f"Error saving call data: {e}")
        finally:
            # Always cleanup to prevent memory leak
            if call_sid in self.active_calls:
                del self.active_calls[call_sid]
            
        logger.info(f"📴 Twilio call ended: {call_sid}, duration: {duration}s")
    
    def get_webhook_routes(self):
        """Return FastAPI routes for Twilio webhooks"""
        from fastapi import APIRouter, Request, Response, HTTPException
        from twilio.twiml.voice_response import VoiceResponse
        from twilio.request_validator import RequestValidator
        
        router = APIRouter(prefix="/twilio", tags=["twilio"])
        
        async def validate_twilio_signature(request: Request) -> bool:
            """Validate Twilio webhook signature for security"""
            if not settings.TWILIO_AUTH_TOKEN:
                logger.warning("Twilio auth token not set, skipping validation")
                return True
            
            validator = RequestValidator(settings.TWILIO_AUTH_TOKEN)
            
            # Get the signature from header
            signature = request.headers.get("X-Twilio-Signature", "")
            
            # Reconstruct the URL
            url = str(request.url)
            
            # Get form data
            form = await request.form()
            params = {key: value for key, value in form.items()}
            
            return validator.validate(url, params, signature)
        
        @router.post("/inbound")
        async def twilio_inbound(request: Request):
            """Handle incoming Twilio call webhook"""
            # SECURITY: Validate Twilio signature
            if not await validate_twilio_signature(request):
                logger.warning("Invalid Twilio signature - rejecting request")
                raise HTTPException(status_code=403, detail="Invalid signature")
            
            form = await request.form()
            call_sid = form.get("CallSid")
            from_number = form.get("From")
            to_number = form.get("To")
            
            try:
                await self.handle_inbound_call(call_sid, from_number, to_number)
                
                # Return TwiML to connect to WebSocket
                response = VoiceResponse()
                response.connect().stream(
                    url=f"wss://{settings.BASE_URL}/twilio/stream/{call_sid}"
                )
                
                return Response(
                    content=str(response),
                    media_type="application/xml"
                )
            except Exception as e:
                logger.error(f"Error handling inbound call: {e}")
                
                # Return error message to caller (good UX)
                response = VoiceResponse()
                response.say("Sorry, we're experiencing technical difficulties. Please try again later.")
                response.hangup()
                
                return Response(
                    content=str(response),
                    media_type="application/xml"
                )
        
        @router.post("/status")
        async def twilio_status(request: Request):
            """Handle Twilio call status webhook"""
            # SECURITY: Validate Twilio signature
            if not await validate_twilio_signature(request):
                raise HTTPException(status_code=403, detail="Invalid signature")
            
            form = await request.form()
            call_sid = form.get("CallSid")
            status = form.get("CallStatus")
            duration = int(form.get("CallDuration", 0))
            
            if status == "completed":
                await self.handle_call_end(call_sid, duration)
            elif status in ["failed", "busy", "no-answer", "canceled"]:
                # Handle failed calls - cleanup without charging
                if call_sid in self.active_calls:
                    del self.active_calls[call_sid]
                logger.info(f"Call {call_sid} ended with status: {status}")
            
            return {"status": "ok"}
        
        return router

