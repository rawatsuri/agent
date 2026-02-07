"""
Exotel Adapter for Vocode
Custom adapter for Exotel telephony (India - cost optimized)
"""

import asyncio
import hashlib
import hmac
import time
from typing import Optional, Dict, Any, Callable
from loguru import logger

try:
    import audioop
except ImportError:
    # Python 3.13+ removed audioop, use audioop-lts
    import audioop_lts as audioop

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

from config import settings


def mask_phone_number(phone: str) -> str:
    """Mask phone number for logging (GDPR/privacy compliance)"""
    if not phone or len(phone) < 6:
        return "****"
    return phone[:4] + "****" + phone[-2:]


def verify_exotel_signature(payload: str, signature: str, api_token: str) -> bool:
    """Verify Exotel webhook signature"""
    if not api_token:
        return True  # Skip in dev if not configured

    expected = hmac.new(
        api_token.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()

    return hmac.compare_digest(expected, signature)


class ExotelAudioInput:
    """Adapter for Exotel's 8kHz mu-law audio to Vocode's expected format"""

    def __init__(self, websocket):
        self.websocket = websocket
        self.buffer = asyncio.Queue()
        self.sample_rate = 8000

    async def get_audio(self):
        """Get audio chunk, converting from mu-law to PCM if needed"""
        chunk = await self.buffer.get()

        # Convert mu-law to linear PCM
        pcm_chunk = audioop.ulaw2lin(chunk, 2)

        # Upsample 8kHz to 16kHz for Vocode/Deepgram
        pcm_16k = audioop.ratecv(pcm_chunk, 2, 1, 8000, 16000, None)[0]

        return pcm_16k

    async def receive_audio(self, data: bytes):
        """Receive audio from Exotel WebSocket"""
        await self.buffer.put(data)


class ExotelAudioOutput:
    """Adapter for Vocode output to Exotel's 8kHz mu-law format"""

    def __init__(self, websocket):
        self.websocket = websocket
        self.sample_rate = 8000

    async def send_audio(self, pcm_data: bytes):
        """Convert and send audio to Exotel"""
        # Downsample 16kHz/24kHz to 8kHz
        pcm_8k = audioop.ratecv(pcm_data, 2, 1, 16000, 8000, None)[0]

        # Convert PCM to mu-law
        mulaw_data = audioop.lin2ulaw(pcm_8k, 2)

        # Send to Exotel via WebSocket
        await self.websocket.send_bytes(mulaw_data)


class ExotelAdapter:
    """
    Exotel adapter with Vocode's streaming pipeline.
    Provides low-latency voice calls for India (cost optimized).
    """

    def __init__(self, node_api_client):
        self.node_api_client = node_api_client
        self.active_calls: Dict[str, Any] = {}

        # Validate Exotel config
        if not all(
            [
                settings.EXOTEL_SID,
                settings.EXOTEL_API_KEY,
            ]
        ):
            logger.warning("Exotel credentials not configured")

    def create_agent_config(self, context: Dict[str, Any]) -> ChatGPTAgentConfig:
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

    async def handle_inbound_call(
        self, call_sid: str, from_number: str, to_number: str, websocket
    ) -> StreamingConversation:
        """
        Handle incoming Exotel call.
        Creates Vocode StreamingConversation with audio adapters.
        """
        # Log with masked phone (GDPR compliance)
        logger.info(
            f"📞 Incoming Exotel call: {call_sid} from {mask_phone_number(from_number)}"
        )

        # Load full context from Node.js (once at call start)
        context = await self.node_api_client.get_full_context(from_number)

        # Create audio adapters for Exotel format
        audio_input = ExotelAudioInput(websocket)
        audio_output = ExotelAudioOutput(websocket)

        # Create Vocode StreamingConversation
        conversation = StreamingConversation(
            output_device=audio_output,
            transcriber=DeepgramTranscriber(
                DeepgramTranscriberConfig(
                    api_key=settings.DEEPGRAM_API_KEY,
                    endpointing_config=PunctuationEndpointingConfig(),
                    sampling_rate=16000,  # After upsampling
                ),
            ),
            agent=ChatGPTAgent(self.create_agent_config(context)),
            synthesizer=AzureSynthesizer(
                AzureSynthesizerConfig(
                    api_key=settings.AZURE_SPEECH_KEY,
                    region=settings.AZURE_SPEECH_REGION,
                    voice_name=context.get("voiceId", settings.AZURE_SPEECH_VOICE),
                ),
            ),
        )

        # Store call info with start time for duration tracking
        self.active_calls[call_sid] = {
            "from_number": from_number,
            "to_number": to_number,
            "context": context,
            "conversation": conversation,
            "audio_input": audio_input,
            "transcript": [],
            "start_time": time.time(),  # Track call duration
        }

        # Create conversation in backend (so transcript can be saved later)
        await self.node_api_client.create_voice_conversation(
            call_sid=call_sid,
            phone_number=from_number,
            business_id=context.get("business", {}).get("id"),
            customer_id=context.get("customer", {}).get("id"),
        )

        # Start conversation
        await conversation.start()

        logger.info(f"🚀 Exotel call started with Vocode: {call_sid}")
        return conversation

    async def process_audio(self, call_sid: str, audio_data: bytes):
        """Process incoming audio from Exotel WebSocket"""
        if call_sid not in self.active_calls:
            return

        call_data = self.active_calls[call_sid]
        audio_input = call_data["audio_input"]
        conversation = call_data["conversation"]

        # Feed audio to input adapter
        await audio_input.receive_audio(audio_data)

        # Get converted audio and send to Vocode
        pcm_audio = await audio_input.get_audio()
        conversation.receive_audio(pcm_audio)

    async def handle_call_end(self, call_sid: str, duration: int = None):
        """Handle call end - log async and cleanup"""
        if call_sid not in self.active_calls:
            logger.warning(f"Call {call_sid} not found in active calls")
            return

        call_data = self.active_calls[call_sid]

        # Calculate duration if not provided
        if duration is None or duration == 0:
            duration = int(time.time() - call_data.get("start_time", time.time()))

        try:
            # Terminate Vocode conversation
            if call_data.get("conversation"):
                await call_data["conversation"].terminate()

            # Log cost async (don't block on this)
            asyncio.create_task(
                self.node_api_client.report_call_cost(
                    call_sid=call_sid,
                    duration_seconds=duration,
                    phone_number=call_data.get("from_number"),
                )
            )

            # Save transcript async (don't block on this)
            if call_data.get("transcript"):
                asyncio.create_task(
                    self.node_api_client.save_transcript(
                        call_sid=call_sid,
                        transcript=call_data["transcript"],
                    )
                )
        except Exception as e:
            logger.error(f"Error during call cleanup: {e}")
        finally:
            # ALWAYS cleanup to prevent memory leak
            if call_sid in self.active_calls:
                del self.active_calls[call_sid]

        logger.info(f"📴 Exotel call ended: {call_sid}, duration: {duration}s")

    def get_webhook_routes(self):
        """Return FastAPI routes for Exotel webhooks"""
        from fastapi import APIRouter, Request, WebSocket, HTTPException
        from fastapi.responses import PlainTextResponse

        router = APIRouter(prefix="/exotel", tags=["exotel"])

        async def validate_exotel_signature(request: Request) -> bool:
            """Validate Exotel webhook signature"""
            if not settings.EXOTEL_API_TOKEN:
                return True  # Skip in dev

            signature = request.headers.get("X-Exotel-Signature", "")
            body = await request.body()

            return verify_exotel_signature(
                body.decode(), signature, settings.EXOTEL_API_TOKEN
            )

        @router.api_route("/incoming", methods=["GET", "POST"])
        async def exotel_incoming(request: Request):
            """Handle incoming Exotel call webhook - accepts both GET and POST"""
            # SECURITY: Validate signature (skip for GET in development)
            if request.method == "POST":
                if not await validate_exotel_signature(request):
                    logger.warning("Invalid Exotel signature - rejecting")
                    raise HTTPException(status_code=403, detail="Invalid signature")

            # Get parameters from query string (GET) or form body (POST)
            if request.method == "GET":
                params = request.query_params
            else:
                params = await request.form()

            call_sid = params.get("CallSid")
            from_number = params.get("From")
            to_number = params.get("To") or params.get("CallTo")

            # Store pending call
            self.active_calls[call_sid] = {
                "from_number": from_number,
                "to_number": to_number,
                "status": "pending",
                "start_time": time.time(),
            }

            # Return response to connect to WebSocket streaming
            ws_url = f"wss://{settings.BASE_URL}/exotel/stream/{call_sid}"

            return PlainTextResponse(
                content=f"stream:{ws_url}", media_type="text/plain"
            )

        @router.websocket("/stream/{call_sid}")
        async def exotel_stream(websocket: WebSocket, call_sid: str):
            """WebSocket endpoint for Exotel audio streaming"""
            await websocket.accept()

            if call_sid not in self.active_calls:
                await websocket.close(code=4004, reason="Call not found")
                return

            call_data = self.active_calls[call_sid]

            try:
                # Start Vocode conversation
                conversation = await self.handle_inbound_call(
                    call_sid=call_sid,
                    from_number=call_data["from_number"],
                    to_number=call_data["to_number"],
                    websocket=websocket,
                )

                # Audio processing loop
                while True:
                    try:
                        audio_data = await websocket.receive_bytes()
                        await self.process_audio(call_sid, audio_data)
                    except Exception as e:
                        logger.debug(f"WebSocket receive error: {e}")
                        break

            except Exception as e:
                logger.error(f"Exotel WebSocket error: {e}")
            finally:
                # ALWAYS cleanup - calculate actual duration
                if call_sid in self.active_calls:
                    start_time = self.active_calls[call_sid].get(
                        "start_time", time.time()
                    )
                    duration = int(time.time() - start_time)
                    await self.handle_call_end(call_sid, duration)

        @router.post("/status")
        async def exotel_status(request: Request):
            """Handle Exotel call status webhook"""
            # SECURITY: Validate signature
            if not await validate_exotel_signature(request):
                raise HTTPException(status_code=403, detail="Invalid signature")

            form = await request.form()
            call_sid = form.get("CallSid")
            status = form.get("Status")
            duration = int(form.get("Duration") or form.get("CallDuration") or 0)

            if status in ["completed", "no-answer", "busy", "failed"]:
                await self.handle_call_end(call_sid, duration)

            return {"status": "ok"}

        return router
