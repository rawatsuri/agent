"""
Vocode Streaming Server
Real-time conversation handling with Vocode
Integrates faster-whisper (STT) and Azure TTS
"""

import asyncio
import json
import time
from collections import deque
from typing import Optional

import numpy as np
from faster_whisper import WhisperModel
from loguru import logger

from config import settings
from handlers.azure_tts import AzureTTSService


class VocodeStreamingServer:
    """
    Streaming server for real-time voice conversations
    Uses faster-whisper for STT and Azure for TTS
    """
    
    def __init__(self, call_sid: str, phone_number: str, node_api_client):
        self.call_sid = call_sid
        self.phone_number = phone_number
        self.node_api_client = node_api_client
        
        # State
        self.websocket = None
        self.is_running = False
        self.start_time = None
        
        # Audio handling
        self.audio_buffer = bytearray()
        self.buffer_lock = asyncio.Lock()
        self.chunk_duration_ms = 20  # 20ms chunks
        
        # Transcription
        self.transcription_model: Optional[WhisperModel] = None
        self.recent_transcriptions: deque = deque(maxlen=5)
        self.speaking_buffer = []
        self.is_speaking = False
        self.silence_threshold = 0.5  # seconds of silence to consider speech ended
        self.last_speech_time = 0
        
        # TTS
        self.tts_service = AzureTTSService()
        self.synthesis_queue = asyncio.Queue()
        self.is_synthesizing = False
        
        # Conversation
        self.conversation_history = []
        self.business_config = None
        self.context_loaded = False
        
        # Sentence buffer for smoother responses
        self.sentence_buffer = []
        self.sentence_buffer_size = settings.Vocode_SENTENCE_BUFFER_SIZE
        
        logger.info(f"🎙️  VocodeStreamingServer initialized for call {call_sid}")
    
    async def start(self, websocket):
        """
        Start the streaming server
        
        Args:
            websocket: WebSocket connection for audio streaming
        """
        self.websocket = websocket
        self.is_running = True
        self.start_time = time.time()
        
        logger.info(f"🚀 Starting streaming server for call {self.call_sid}")
        
        # Load business configuration
        try:
            self.business_config = await self.node_api_client.get_business_config(
                self.phone_number
            )
            self.context_loaded = True
            logger.info(f"✅ Business config loaded for call {self.call_sid}")
        except Exception as e:
            logger.error(f"Failed to load business config: {e}")
            self.business_config = {}
        
        # Initialize transcription model
        try:
            self.transcription_model = WhisperModel(
                settings.WHISPER_MODEL_SIZE,
                device=settings.WHISPER_DEVICE,
                compute_type=settings.WHISPER_COMPUTE_TYPE
            )
            logger.info(f"✅ Whisper model loaded: {settings.WHISPER_MODEL_SIZE}")
        except Exception as e:
            logger.error(f"Failed to load Whisper model: {e}")
            await self._send_text_response("Sorry, I'm having trouble with speech recognition. Please try again later.")
            return
        
        # Play welcome message
        welcome_msg = self.business_config.get("welcomeMessage", "Hello! How can I help you today?")
        await self._send_text_response(welcome_msg)
        
        # Start background tasks
        tasks = [
            asyncio.create_task(self._audio_receive_loop()),
            asyncio.create_task(self._transcription_loop()),
            asyncio.create_task(self._synthesis_loop()),
            asyncio.create_task(self._conversation_timeout_checker())
        ]
        
        try:
            # Wait for all tasks
            await asyncio.gather(*tasks)
        except Exception as e:
            logger.error(f"Error in streaming tasks: {e}")
        finally:
            # Cleanup
            for task in tasks:
                task.cancel()
    
    async def stop(self):
        """Stop the streaming server"""
        logger.info(f"🛑 Stopping streaming server for call {self.call_sid}")
        self.is_running = False
        
        # Log conversation summary
        duration = time.time() - self.start_time if self.start_time else 0
        logger.info(f"Call {self.call_sid} ended. Duration: {duration:.1f}s, Messages: {len(self.conversation_history)}")
    
    async def _audio_receive_loop(self):
        """
        Continuously receive audio from WebSocket
        """
        try:
            while self.is_running:
                try:
                    # Receive audio data (mulaw 8kHz)
                    message = await self.websocket.receive()
                    
                    if message["type"] == "websocket.receive":
                        if "bytes" in message:
                            audio_data = message["bytes"]
                            
                            async with self.buffer_lock:
                                self.audio_buffer.extend(audio_data)
                                self.speaking_buffer.append(audio_data)
                                self.last_speech_time = time.time()
                                self.is_speaking = True
                                
                    elif message["type"] == "websocket.disconnect":
                        logger.info(f"WebSocket disconnected for call {self.call_sid}")
                        break
                        
                except Exception as e:
                    logger.error(f"Error receiving audio: {e}")
                    break
                    
        except Exception as e:
            logger.error(f"Audio receive loop error: {e}")
        finally:
            self.is_running = False
    
    async def _transcription_loop(self):
        """
        Process audio buffer and transcribe speech
        """
        min_audio_duration = 0.5  # Minimum audio to transcribe (seconds)
        sample_rate = settings.AUDIO_SAMPLE_RATE
        bytes_per_second = sample_rate  # 8-bit mulaw = 1 byte per sample
        
        try:
            while self.is_running:
                await asyncio.sleep(0.1)  # Check every 100ms
                
                # Check if we have enough audio and speech has ended
                async with self.buffer_lock:
                    if not self.speaking_buffer:
                        continue
                    
                    audio_duration = len(self.speaking_buffer) * self.chunk_duration_ms / 1000
                    silence_duration = time.time() - self.last_speech_time
                    
                    # Transcribe if we have enough audio and speech has ended
                    if audio_duration >= min_audio_duration and silence_duration >= self.silence_threshold:
                        # Combine audio chunks
                        audio_bytes = b"".join(self.speaking_buffer)
                        self.speaking_buffer = []
                        self.is_speaking = False
                    else:
                        continue
                
                # Transcribe audio
                try:
                    # Convert mulaw to PCM
                    pcm_audio = self._mulaw_to_pcm(audio_bytes)
                    
                    # Transcribe
                    segments, info = self.transcription_model.transcribe(
                        pcm_audio,
                        language="en",
                        task="transcribe",
                        beam_size=5,
                        best_of=5,
                        condition_on_previous_text=True
                    )
                    
                    # Combine segments
                    transcription = " ".join([segment.text for segment in segments]).strip()
                    
                    if transcription:
                        logger.info(f"🎤 Transcribed: '{transcription}'")
                        
                        # Add to recent transcriptions
                        self.recent_transcriptions.append(transcription)
                        
                        # Process user message
                        asyncio.create_task(self._process_user_message(transcription))
                        
                except Exception as e:
                    logger.error(f"Transcription error: {e}")
                    
        except Exception as e:
            logger.error(f"Transcription loop error: {e}")
    
    async def _process_user_message(self, text: str):
        """
        Process user message and get AI response
        
        Args:
            text: Transcribed user message
        """
        try:
            # Add to conversation history
            self.conversation_history.append({"role": "user", "content": text, "time": time.time()})
            
            # Log event
            await self.node_api_client.log_conversation_event(
                self.call_sid,
                "user_message",
                {"text": text}
            )
            
            # Get AI response
            context = {
                "businessConfig": self.business_config,
                "conversationHistory": list(self.conversation_history)[-10:],  # Last 10 messages
                "phoneNumber": self.phone_number
            }
            
            response = await self.node_api_client.process_voice_message(
                call_sid=self.call_sid,
                phone_number=self.phone_number,
                transcribed_text=text,
                conversation_context=context
            )
            
            if response and response.get("response"):
                ai_response = response["response"]
                
                # Add to conversation history
                self.conversation_history.append({
                    "role": "assistant",
                    "content": ai_response,
                    "time": time.time()
                })
                
                # Log event
                await self.node_api_client.log_conversation_event(
                    self.call_sid,
                    "ai_response",
                    {"text": ai_response}
                )
                
                # Queue for synthesis
                await self.synthesis_queue.put(ai_response)
                
            else:
                logger.error(f"No AI response for call {self.call_sid}")
                await self.synthesis_queue.put("I'm sorry, I didn't understand that. Could you please rephrase?")
                
        except Exception as e:
            logger.error(f"Error processing user message: {e}")
            await self.synthesis_queue.put("I'm having trouble processing your request. Please try again.")
    
    async def _synthesis_loop(self):
        """
        Synthesize and send AI responses
        """
        try:
            while self.is_running:
                # Wait for text to synthesize
                text = await self.synthesis_queue.get()
                
                if not text:
                    continue
                
                # Synthesize
                logger.info(f"🔊 Synthesizing: '{text[:50]}...'" if len(text) > 50 else f"🔊 Synthesizing: '{text}'")
                
                try:
                    audio_data = await self.tts_service.synthesize(text)
                    
                    if audio_data:
                        # Convert to mulaw and stream
                        mulaw_audio = self._pcm_to_mulaw(audio_data)
                        await self._stream_audio(mulaw_audio)
                        logger.info(f"✅ Sent {len(mulaw_audio)} bytes of audio")
                    else:
                        logger.error("TTS synthesis returned no audio")
                        
                except Exception as e:
                    logger.error(f"TTS error: {e}")
                    
        except Exception as e:
            logger.error(f"Synthesis loop error: {e}")
    
    async def _send_text_response(self, text: str):
        """
        Send a text response (synthesized to speech)
        
        Args:
            text: Text to speak
        """
        await self.synthesis_queue.put(text)
    
    async def _stream_audio(self, audio_data: bytes):
        """
        Stream audio data to WebSocket
        
        Args:
            audio_data: Audio bytes (mulaw 8kHz)
        """
        try:
            # Stream in chunks
            chunk_size = settings.AUDIO_CHUNK_SIZE  # 20ms at 8kHz = 160 bytes
            
            for i in range(0, len(audio_data), chunk_size):
                chunk = audio_data[i:i + chunk_size]
                await self.websocket.send_bytes(chunk)
                await asyncio.sleep(0.02)  # 20ms pacing
                
        except Exception as e:
            logger.error(f"Error streaming audio: {e}")
    
    async def _conversation_timeout_checker(self):
        """
        Check for conversation timeout and inactivity
        """
        max_duration = self.business_config.get("maxCallDuration", 600) if self.business_config else 600
        inactivity_timeout = 60  # 60 seconds of silence
        
        try:
            while self.is_running:
                await asyncio.sleep(5)  # Check every 5 seconds
                
                if not self.start_time:
                    continue
                
                duration = time.time() - self.start_time
                last_activity = time.time() - self.last_speech_time if self.last_speech_time else 0
                
                # Check max duration
                if duration >= max_duration:
                    logger.info(f"Call {self.call_sid} reached max duration ({max_duration}s)")
                    await self._send_text_response("Thank you for calling. This call will now end. Have a great day!")
                    await asyncio.sleep(3)
                    self.is_running = False
                    break
                
                # Check inactivity
                if last_activity >= inactivity_timeout and not self.is_speaking:
                    logger.info(f"Call {self.call_sid} inactive for {last_activity}s")
                    await self._send_text_response("Are you still there? I'm here to help if you need anything.")
                    
        except Exception as e:
            logger.error(f"Timeout checker error: {e}")
    
    def _mulaw_to_pcm(self, mulaw_data: bytes) -> np.ndarray:
        """
        Convert mu-law audio to PCM
        
        Args:
            mulaw_data: Mu-law encoded audio
            
        Returns:
            PCM audio as numpy array
        """
        # Mu-law decoding table
        MULAW_BIAS = 33
        MULAW_MAX = 0x1FFF
        
        # Decode mu-law to linear
        mulaw_table = np.array([
            0, 132, 396, 924, 1980, 4092, 8316, 16764,
            48, 144, 432, 1008, 2160, 4464, 9072, 18336,
            72, 168, 504, 1176, 2520, 5208, 10584, 21384,
            120, 216, 600, 1320, 2760, 5640, 11448, 23064,
            168, 264, 696, 1464, 3000, 6120, 12360, 24840,
            240, 336, 840, 1800, 3720, 7560, 15336, 30840,
            360, 456, 1080, 2232, 4584, 9256, 18696, 37512,
            552, 696, 1560, 3168, 6504, 13128, 26376, 52776
        ], dtype=np.int16)
        
        # Expand mu-law
        pcm_data = np.array([mulaw_table[b] for b in mulaw_data], dtype=np.float32)
        
        return pcm_data
    
    def _pcm_to_mulaw(self, pcm_data: bytes) -> bytes:
        """
        Convert PCM audio to mu-law
        
        Args:
            pcm_data: PCM audio data (assumed to be 16-bit)
            
        Returns:
            Mu-law encoded audio
        """
        # Convert bytes to numpy array
        pcm_array = np.frombuffer(pcm_data, dtype=np.int16)
        
        # Mu-law encoding
        MULAW_BIAS = 33
        MULAW_MAX = 0x1FFF
        MULAW_MASK = 0x0F
        
        # Clip to valid range
        pcm_array = np.clip(pcm_array, -MULAW_MAX, MULAW_MAX)
        
        # Encode
        mulaw_data = []
        for sample in pcm_array:
            # Convert to mu-law
            sign = 0x80 if sample < 0 else 0
            magnitude = abs(sample)
            magnitude += MULAW_BIAS
            
            if magnitude > MULAW_MAX:
                magnitude = MULAW_MAX
            
            # Calculate chord and step
            chord = 7
            if magnitude < 128:
                chord = 0
            elif magnitude < 256:
                chord = 1
            elif magnitude < 512:
                chord = 2
            elif magnitude < 1024:
                chord = 3
            elif magnitude < 2048:
                chord = 4
            elif magnitude < 4096:
                chord = 5
            elif magnitude < 8192:
                chord = 6
            
            step = (magnitude >> (chord + 3)) & MULAW_MASK
            
            # Combine sign, chord, and step
            mulaw = ~(sign | (chord << 4) | step) & 0xFF
            mulaw_data.append(mulaw)
        
        return bytes(mulaw_data)
