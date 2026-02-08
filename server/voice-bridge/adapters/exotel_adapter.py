"""
Exotel Adapter with Vocode Streaming Pipeline
Uses Vocode's low-latency components (Deepgram STT, ChatGPT Agent, Azure TTS)
with custom audio adapters for Exotel's format.

Exotel Audio Specs:
- Format: 16-bit Linear PCM (s16le)
- Sample Rate: 8kHz (default) or 16kHz (recommended)
- Channels: Mono
- Encoding: Base64 in WebSocket JSON frames
"""

import asyncio
import base64
import json
import time
from typing import Optional, Dict, Any
from loguru import logger

# Vocode core imports (streaming components - no TelephonyServer needed)
from vocode.streaming.streaming_conversation import StreamingConversation
from vocode.streaming.models.transcriber import (
    DeepgramTranscriberConfig,
    PunctuationEndpointingConfig,
)
from vocode.streaming.models.agent import ChatGPTAgentConfig
from vocode.streaming.models.synthesizer import AzureSynthesizerConfig
from vocode.streaming.models.message import BaseMessage
from vocode.streaming.transcriber.deepgram_transcriber import DeepgramTranscriber
from vocode.streaming.agent.chat_gpt_agent import ChatGPTAgent
from vocode.streaming.synthesizer.azure_synthesizer import AzureSynthesizer
from vocode.streaming.input_device.base_input_device import BaseInputDevice
from vocode.streaming.output_device.base_output_device import BaseOutputDevice

from config import settings


def mask_phone_number(phone: str) -> str:
    """Mask phone number for logging (GDPR/privacy compliance)"""
    if not phone or len(phone) < 6:
        return "****"
    return phone[:4] + "****" + phone[-2:]


class ExotelInputDevice(BaseInputDevice):
    """
    Custom input device for Exotel WebSocket audio.
    Receives base64-encoded 16-bit PCM from Exotel.
    """
    
    def __init__(self, sampling_rate: int = 16000):
        super().__init__(sampling_rate=sampling_rate, chunk_size=3200)  # 100ms chunks
        self.audio_queue: asyncio.Queue = asyncio.Queue()
        self._is_active = True
    
    async def get_audio(self) -> bytes:
        """Get audio chunk for Vocode transcriber"""
        try:
            return await asyncio.wait_for(self.audio_queue.get(), timeout=1.0)
        except asyncio.TimeoutError:
            # Return silence if no audio
            return b"\x00" * self.chunk_size
    
    async def receive_audio(self, base64_audio: str):
        """Receive base64-encoded audio from Exotel and queue it"""
        if not self._is_active:
            return
        try:
            audio_bytes = base64.b64decode(base64_audio)
            await self.audio_queue.put(audio_bytes)
        except Exception as e:
            logger.error(f"Error decoding Exotel audio: {e}")
    
    def stop(self):
        """Stop receiving audio"""
        self._is_active = False


class ExotelOutputDevice(BaseOutputDevice):
    """
    Custom output device for Exotel WebSocket audio.
    Sends base64-encoded 16-bit PCM to Exotel.
    """
    
    def __init__(self, websocket, sampling_rate: int = 16000):
        super().__init__(sampling_rate=sampling_rate)
        self.websocket = websocket
        self._is_active = True
    
    async def play(self, audio: bytes):
        """Send audio to Exotel via WebSocket"""
        if not self._is_active or not audio:
            return
        
        try:
            # Chunk audio into 100ms pieces (3200 bytes at 16kHz, 16-bit)
            chunk_size = 3200
            for i in range(0, len(audio), chunk_size):
                if not self._is_active:
                    break
                    
                chunk = audio[i:i + chunk_size]
                encoded = base64.b64encode(chunk).decode("utf-8")
                
                # Send in Exotel's expected format
                message = {
                    "event": "media",
                    "media": {
                        "payload": encoded
                    }
                }
                
                await self.websocket.send_json(message)
                # Small delay between chunks
                await asyncio.sleep(0.08)  # ~80ms per chunk
                
        except Exception as e:
            logger.error(f"Error sending audio to Exotel: {e}")
    
    def stop(self):
        """Stop sending audio"""
        self._is_active = False
    
    # Required by BaseOutputDevice
    async def start(self):
        pass
    
    async def terminate(self):
        self.stop()


class ExotelAdapter:
    """
    Exotel adapter using Vocode's streaming pipeline.
    Provides low-latency voice calls for India (cost optimized).
    
    Uses:
    - Vocode's StreamingConversation for orchestration
    - DeepgramTranscriber for STT (low latency)
    - ChatGPTAgent for AI responses
    - AzureSynthesizer for TTS
    - Custom input/output devices for Exotel audio format
    """
    
    def __init__(self, node_api_client):
        self.node_api_client = node_api_client
        self.active_calls: Dict[str, Dict[str, Any]] = {}
        
        # Validate config
        if not all([settings.EXOTEL_SID, settings.EXOTEL_API_KEY]):
            logger.warning("Exotel credentials not configured")
        if not settings.DEEPGRAM_API_KEY:
            logger.warning("Deepgram API key not configured - STT won't work")
        if not settings.AZURE_SPEECH_KEY:
            logger.warning("Azure Speech key not configured - TTS won't work")
    
    def _create_agent_config(self, context: Dict[str, Any]) -> ChatGPTAgentConfig:
        """Create ChatGPT agent config with business context"""
        customer = context.get("customer", {})
        business = context.get("business", {})
        memories = context.get("memories", [])
        
        # Build context-rich system prompt
        system_prompt = f"""You are an AI voice assistant for {business.get("name", "the business")}.

## Customer Information
- Name: {customer.get("name", "Customer")}
- Trust Score: {customer.get("trustScore", 50)}/100

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
- If customer speaks Hindi, respond in Hindi
"""
        
        return ChatGPTAgentConfig(
            openai_api_key=settings.OPENAI_API_KEY,
            initial_message=BaseMessage(
                text=context.get("welcomeMessage", "Hello! How can I help you today?")
            ),
            prompt_preamble=system_prompt,
            model_name=settings.VOCODE_MODEL_NAME or "gpt-4o-mini",
            generate_responses=True,
        )
    
    async def start_conversation(
        self,
        call_sid: str,
        from_number: str,
        to_number: str,
        websocket,
    ) -> StreamingConversation:
        """
        Start a Vocode StreamingConversation for an Exotel call.
        """
        logger.info(f"📞 Starting Vocode conversation for {call_sid} from {mask_phone_number(from_number)}")
        
        # Load context from Node.js API
        context = await self.node_api_client.get_full_context(from_number)
        
        # Create custom input/output devices for Exotel
        input_device = ExotelInputDevice(sampling_rate=16000)
        output_device = ExotelOutputDevice(websocket, sampling_rate=16000)
        
        # Create Vocode StreamingConversation with all components
        conversation = StreamingConversation(
            output_device=output_device,
            transcriber=DeepgramTranscriber(
                DeepgramTranscriberConfig.from_input_device(
                    input_device,
                    endpointing_config=PunctuationEndpointingConfig(),
                    api_key=settings.DEEPGRAM_API_KEY,
                )
            ),
            agent=ChatGPTAgent(self._create_agent_config(context)),
            synthesizer=AzureSynthesizer(
                AzureSynthesizerConfig(
                    api_key=settings.AZURE_SPEECH_KEY,
                    region=settings.AZURE_SPEECH_REGION,
                    voice_name=context.get("voiceId", settings.AZURE_SPEECH_VOICE),
                    sampling_rate=16000,
                )
            ),
        )
        
        # Store call info
        self.active_calls[call_sid] = {
            "from_number": from_number,
            "to_number": to_number,
            "context": context,
            "conversation": conversation,
            "input_device": input_device,
            "output_device": output_device,
            "transcript": [],
            "start_time": time.time(),
        }
        
        # Create conversation record in backend
        await self.node_api_client.create_voice_conversation(
            call_sid=call_sid,
            phone_number=from_number,
            business_id=context.get("business", {}).get("id"),
            customer_id=context.get("customer", {}).get("id"),
        )
        
        # Start Vocode conversation
        await conversation.start()
        
        logger.info(f"🚀 Vocode conversation started for {call_sid}")
        return conversation
    
    async def process_audio(self, call_sid: str, base64_audio: str):
        """Process incoming audio from Exotel WebSocket"""
        if call_sid not in self.active_calls:
            return
        
        input_device = self.active_calls[call_sid]["input_device"]
        await input_device.receive_audio(base64_audio)
    
    async def end_call(self, call_sid: str):
        """End call and cleanup"""
        if call_sid not in self.active_calls:
            return
        
        call_data = self.active_calls[call_sid]
        duration = int(time.time() - call_data.get("start_time", time.time()))
        
        try:
            # Stop Vocode conversation
            conversation = call_data.get("conversation")
            if conversation:
                await conversation.terminate()
            
            # Stop devices
            input_device = call_data.get("input_device")
            if input_device:
                input_device.stop()
            
            output_device = call_data.get("output_device")
            if output_device:
                output_device.stop()
            
            # Report to backend (async, don't block)
            asyncio.create_task(
                self.node_api_client.report_call_cost(
                    call_sid=call_sid,
                    duration_seconds=duration,
                    phone_number=call_data.get("from_number"),
                )
            )
            
        except Exception as e:
            logger.error(f"Error ending call: {e}")
        finally:
            if call_sid in self.active_calls:
                del self.active_calls[call_sid]
        
        logger.info(f"📴 Call ended: {call_sid}, duration: {duration}s")
    
    def get_webhook_routes(self):
        """Return FastAPI routes for Exotel webhooks"""
        from fastapi import APIRouter, Request, WebSocket
        from fastapi.responses import JSONResponse
        
        router = APIRouter(prefix="/exotel", tags=["exotel"])
        
        @router.websocket("/stream")
        async def exotel_stream(websocket: WebSocket):
            """
            WebSocket endpoint for Exotel Voicebot audio streaming.
            
            Configure in Exotel App Bazaar:
            - Create Voicebot Applet
            - Set WebSocket URL: wss://your-domain.com/exotel/stream
            - Connect to your ExoPhone
            """
            await websocket.accept()
            logger.info("📞 Exotel WebSocket connected")
            
            call_sid = None
            
            try:
                while True:
                    message = await websocket.receive()
                    
                    if message["type"] == "websocket.disconnect":
                        break
                    
                    if message["type"] == "websocket.receive":
                        data = message.get("text")
                        if data:
                            try:
                                json_data = json.loads(data)
                                event = json_data.get("event")
                                
                                if event == "start":
                                    # Call started - extract metadata
                                    start_data = json_data.get("start", {})
                                    call_sid = start_data.get("callSid") or start_data.get("streamSid") or f"exotel_{int(time.time())}"
                                    
                                    custom_params = start_data.get("customParameters", {})
                                    from_number = custom_params.get("from") or start_data.get("from", "")
                                    to_number = custom_params.get("to") or start_data.get("to", "")
                                    
                                    logger.info(f"📞 Call started: {call_sid} from {mask_phone_number(from_number)}")
                                    
                                    # Start Vocode conversation
                                    await self.start_conversation(
                                        call_sid=call_sid,
                                        from_number=from_number,
                                        to_number=to_number,
                                        websocket=websocket,
                                    )
                                    
                                elif event == "media":
                                    # Audio data from caller
                                    if call_sid:
                                        payload = json_data.get("media", {}).get("payload", "")
                                        if payload:
                                            await self.process_audio(call_sid, payload)
                                            
                                elif event == "stop":
                                    # Call ended by Exotel
                                    logger.info(f"📞 Call stopped by Exotel: {call_sid}")
                                    break
                                    
                                elif event == "mark":
                                    # Audio playback completed marker
                                    pass
                                    
                            except json.JSONDecodeError:
                                pass
                                
            except Exception as e:
                logger.error(f"WebSocket error: {e}")
            finally:
                if call_sid:
                    await self.end_call(call_sid)
        
        @router.get("/health")
        async def exotel_health():
            """Health check"""
            return {
                "status": "ok",
                "adapter": "exotel",
                "vocode": "enabled",
                "active_calls": len(self.active_calls),
            }
        
        @router.post("/status")
        async def exotel_status(request: Request):
            """Handle Exotel call status webhook"""
            try:
                form = await request.form()
                call_sid = form.get("CallSid")
                status = form.get("Status")
                
                logger.info(f"📊 Call status: {call_sid} - {status}")
                
                if status in ["completed", "no-answer", "busy", "failed"]:
                    await self.end_call(call_sid)
                
                return {"status": "ok"}
            except Exception as e:
                logger.error(f"Status webhook error: {e}")
                return {"status": "error"}
        
        return router
