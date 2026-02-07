"""
Vocode Native Streaming Server
Low-latency voice conversations using Vocode's native pipeline
Context loaded at call start, events logged async
"""

import asyncio
import time
from typing import Optional, Dict, Any

from loguru import logger

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
from vocode.streaming.models.audio import AudioEncoding

from config import settings


class VocodeNativeServer:
    """
    Native Vocode streaming server with async event logging.
    Achieves ~300-400ms latency by using Vocode's optimized pipeline.
    """
    
    def __init__(
        self,
        call_sid: str,
        phone_number: str,
        node_api_client,
        audio_input,
        audio_output
    ):
        self.call_sid = call_sid
        self.phone_number = phone_number
        self.node_api_client = node_api_client
        self.audio_input = audio_input
        self.audio_output = audio_output
        
        # State
        self.conversation: Optional[StreamingConversation] = None
        self.context: Dict[str, Any] = {}
        self.is_running = False
        self.start_time = None
        
        # Transcript buffer for async logging
        self.transcript_buffer = []
        
        logger.info(f"🎙️ VocodeNativeServer initialized for call {call_sid}")
    
    def _mask_phone(self, phone: str) -> str:
        """Mask phone number for logging (GDPR compliance)"""
        if not phone or len(phone) < 6:
            return "****"
        return phone[:4] + "****" + phone[-2:]
    
    async def start(self):
        """Start the streaming conversation"""
        self.is_running = True
        self.start_time = time.time()
        
        # Mask phone for logging (GDPR compliance)
        masked_phone = self._mask_phone(self.phone_number)
        
        # Step 1: Load full context from Node.js (one-time, ~100ms)
        logger.info(f"📥 Loading context for call {self.call_sid}")
        try:
            self.context = await self.node_api_client.get_full_context(
                self.phone_number
            )
            logger.info(f"✅ Context loaded: customer={self.context.get('customer', {}).get('name', 'Unknown')}")
        except Exception as e:
            logger.error(f"Failed to load context: {e}")
            self.context = self._get_default_context()
        
        # Step 2: Create conversation record (CRITICAL for transcript saving)
        try:
            await self.node_api_client.create_voice_conversation(
                call_sid=self.call_sid,
                phone_number=self.phone_number,
                business_id=self.context.get("business", {}).get("id"),
                customer_id=self.context.get("customer", {}).get("id"),
            )
            logger.info(f"✅ Conversation created for call {self.call_sid}")
        except Exception as e:
            logger.error(f"Failed to create conversation: {e}")
        
        # Step 3: Build context-rich system prompt
        system_prompt = self._build_system_prompt()
        
        # Step 3: Create Vocode StreamingConversation
        try:
            self.conversation = StreamingConversation(
                output_device=self.audio_output,
                transcriber=DeepgramTranscriber(
                    DeepgramTranscriberConfig.from_input_device(
                        self.audio_input,
                        endpointing_config=PunctuationEndpointingConfig(),
                        api_key=settings.DEEPGRAM_API_KEY,
                    ),
                ),
                agent=ChatGPTAgent(
                    ChatGPTAgentConfig(
                        openai_api_key=settings.OPENAI_API_KEY,
                        initial_message=BaseMessage(
                            text=self.context.get("welcomeMessage", "Hello! How can I help you today?")
                        ),
                        prompt_preamble=system_prompt,
                        model_name=settings.VOCODE_MODEL_NAME,
                    )
                ),
                synthesizer=AzureSynthesizer(
                    AzureSynthesizerConfig.from_output_device(
                        self.audio_output,
                        voice_name=self.context.get("voiceId", settings.AZURE_SPEECH_VOICE),
                    ),
                    azure_speech_key=settings.AZURE_SPEECH_KEY,
                    azure_speech_region=settings.AZURE_SPEECH_REGION,
                ),
                # Event handlers for async logging
                on_transcription=self._on_transcription,
                on_response=self._on_response,
            )
            
            # Start conversation
            await self.conversation.start()
            logger.info(f"🚀 Vocode conversation started for call {self.call_sid}")
            
            # Run audio processing loop
            while self.is_running and self.conversation.is_active():
                try:
                    chunk = await asyncio.wait_for(
                        self.audio_input.get_audio(),
                        timeout=1.0
                    )
                    self.conversation.receive_audio(chunk)
                except asyncio.TimeoutError:
                    continue
                except Exception as e:
                    logger.error(f"Audio processing error: {e}")
                    break
                    
        except Exception as e:
            logger.error(f"Failed to create Vocode conversation: {e}")
            raise
    
    async def stop(self):
        """Stop the conversation and log final data"""
        logger.info(f"🛑 Stopping VocodeNativeServer for call {self.call_sid}")
        self.is_running = False
        
        if self.conversation:
            await self.conversation.terminate()
        
        # Calculate duration
        duration = time.time() - self.start_time if self.start_time else 0
        
        # Flush any remaining transcripts (async)
        asyncio.create_task(self._flush_transcripts())
        
        # Log call cost (async)
        asyncio.create_task(
            self.node_api_client.report_call_cost(
                call_sid=self.call_sid,
                duration_seconds=int(duration),
                phone_number=self.phone_number
            )
        )
        
        logger.info(f"Call {self.call_sid} ended. Duration: {duration:.1f}s")
    
    def _build_system_prompt(self) -> str:
        """Build context-rich system prompt"""
        customer = self.context.get("customer", {})
        business = self.context.get("business", {})
        memories = self.context.get("memories", [])
        recent_chats = self.context.get("recentConversations", [])
        
        prompt = f"""You are an AI voice assistant for {business.get('name', 'the business')}.

## Customer Information
- Name: {customer.get('name', 'Unknown')}
- Phone: {self.phone_number}
- Trust Score: {customer.get('trustScore', 50)}/100

## Customer History
"""
        # Add memories
        if memories:
            prompt += "### Past Context:\n"
            for memory in memories[:5]:  # Top 5 relevant memories
                prompt += f"- {memory.get('content', '')}\n"
        
        # Add recent conversations summary
        if recent_chats:
            prompt += "\n### Recent Conversations:\n"
            for chat in recent_chats[:3]:  # Last 3 conversations
                prompt += f"- {chat.get('summary', '')}\n"
        
        # Add business-specific prompt
        custom_prompt = business.get("customPrompt", "")
        if custom_prompt:
            prompt += f"\n## Business Instructions\n{custom_prompt}\n"
        
        # Voice-specific instructions
        prompt += """
## Voice Conversation Guidelines
- Keep responses SHORT and conversational (under 30 words when possible)
- Use natural, spoken language (contractions, simple words)
- Ask one question at a time
- Be warm and friendly
- If unsure, ask for clarification
- For complex requests, offer to send details via SMS/WhatsApp
"""
        
        return prompt
    
    def _get_default_context(self) -> Dict[str, Any]:
        """Default context when Node.js is unavailable"""
        return {
            "customer": {"name": "Customer"},
            "business": {"name": "Business"},
            "memories": [],
            "recentConversations": [],
            "welcomeMessage": "Hello! How can I help you today?",
            "voiceId": settings.AZURE_SPEECH_VOICE,
        }
    
    async def _on_transcription(self, transcription: str):
        """
        Called when user speech is transcribed.
        Logs async to Node.js without blocking conversation.
        """
        logger.info(f"🎤 User: {transcription}")
        
        # Add to buffer
        self.transcript_buffer.append({
            "role": "user",
            "content": transcription,
            "timestamp": time.time()
        })
        
        # Log async (non-blocking)
        asyncio.create_task(
            self.node_api_client.log_conversation_event(
                self.call_sid,
                "user_message",
                {"text": transcription}
            )
        )
    
    async def _on_response(self, response: str):
        """
        Called when AI responds.
        Logs async to Node.js without blocking conversation.
        """
        logger.info(f"🤖 AI: {response}")
        
        # Add to buffer
        self.transcript_buffer.append({
            "role": "assistant",
            "content": response,
            "timestamp": time.time()
        })
        
        # Log async (non-blocking)
        asyncio.create_task(
            self.node_api_client.log_conversation_event(
                self.call_sid,
                "ai_response",
                {"text": response}
            )
        )
    
    async def _flush_transcripts(self):
        """Save full transcript to database"""
        if not self.transcript_buffer:
            return
        
        try:
            await self.node_api_client.save_transcript(
                call_sid=self.call_sid,
                transcript=self.transcript_buffer
            )
            logger.info(f"✅ Transcript saved for call {self.call_sid}")
        except Exception as e:
            logger.error(f"Failed to save transcript: {e}")
