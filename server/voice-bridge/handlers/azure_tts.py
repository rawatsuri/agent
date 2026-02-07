"""
Azure Text-to-Speech Service
Handles speech synthesis with SSML support
"""

import asyncio
from typing import Optional

import azure.cognitiveservices.speech as speechsdk
from loguru import logger

from config import settings


class AzureTTSService:
    """Azure Cognitive Services Text-to-Speech wrapper"""
    
    def __init__(self):
        self.speech_config: Optional[speechsdk.SpeechConfig] = None
        self.voice_name = settings.AZURE_SPEECH_VOICE
        self.rate = settings.AZURE_SPEECH_RATE
        self.enabled = all([settings.AZURE_SPEECH_KEY, settings.AZURE_SPEECH_REGION])
        
        if self.enabled:
            self._initialize()
        else:
            logger.warning("⚠️  Azure Speech not configured. TTS will not work.")
    
    def _initialize(self):
        """Initialize Azure Speech SDK"""
        try:
            self.speech_config = speechsdk.SpeechConfig(
                subscription=settings.AZURE_SPEECH_KEY,
                region=settings.AZURE_SPEECH_REGION
            )
            
            # Set voice
            self.speech_config.speech_synthesis_voice_name = self.voice_name
            
            # Set output format for telephony (8kHz)
            self.speech_config.set_speech_synthesis_output_format(
                speechsdk.SpeechSynthesisOutputFormat.Raw8Khz8BitMonoMULaw
            )
            
            logger.info(f"✅ Azure TTS initialized with voice: {self.voice_name}")
            
        except Exception as e:
            logger.error(f"Failed to initialize Azure TTS: {e}")
            self.enabled = False
    
    @staticmethod
    def validate_config() -> bool:
        """Validate Azure configuration without initializing"""
        return all([settings.AZURE_SPEECH_KEY, settings.AZURE_SPEECH_REGION])
    
    def create_ssml(self, text: str, style: Optional[str] = None, 
                    rate: Optional[str] = None) -> str:
        """
        Create SSML for enhanced speech synthesis
        
        Args:
            text: Text to synthesize
            style: Speaking style (cheerful, sad, angry, etc.)
            rate: Speaking rate (x-slow, slow, default, fast, x-fast)
            
        Returns:
            SSML string
        """
        rate_value = rate or self.rate
        
        if rate_value == "slow":
            rate_attr = 'rate="-15%"'
        elif rate_value == "fast":
            rate_attr = 'rate="+15%"'
        else:
            rate_attr = ''
        
        # Base SSML
        ssml = f"""<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" 
         xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
    <voice name="{self.voice_name}">
        <prosody {rate_attr}>
            {text}
        </prosody>
    </voice>
</speak>"""
        
        # Add style if specified and voice supports it
        if style and "Neural" in self.voice_name:
            ssml = f"""<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" 
         xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
    <voice name="{self.voice_name}">
        <mstts:express-as style="{style}">
            <prosody {rate_attr}>
                {text}
            </prosody>
        </mstts:express-as>
    </voice>
</speak>"""
        
        return ssml
    
    async def synthesize(self, text: str, use_ssml: bool = False,
                         style: Optional[str] = None) -> Optional[bytes]:
        """
        Synthesize text to speech
        
        Args:
            text: Text to synthesize
            use_ssml: Whether to use SSML formatting
            style: Speaking style for SSML
            
        Returns:
            Audio data as bytes or None on error
        """
        if not self.enabled or not self.speech_config:
            logger.error("Azure TTS not configured")
            return None
        
        try:
            # Create synthesizer
            synthesizer = speechsdk.SpeechSynthesizer(
                speech_config=self.speech_config,
                audio_config=None  # No audio output, we'll get data
            )
            
            # Synthesize
            if use_ssml:
                ssml = self.create_ssml(text, style=style)
                result = synthesizer.speak_ssml_async(ssml).get()
            else:
                result = synthesizer.speak_text_async(text).get()
            
            # Check result
            if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
                audio_data = result.audio_data
                logger.debug(f"✅ Synthesized {len(text)} chars to {len(audio_data)} bytes")
                return audio_data
            elif result.reason == speechsdk.ResultReason.Canceled:
                cancellation = speechsdk.SpeechSynthesisCancellationDetails(result)
                logger.error(f"TTS canceled: {cancellation.reason}")
                if cancellation.reason == speechsdk.CancellationReason.Error:
                    logger.error(f"TTS error: {cancellation.error_details}")
                return None
            else:
                logger.error(f"TTS failed: {result.reason}")
                return None
                
        except Exception as e:
            logger.error(f"Error in TTS synthesis: {e}")
            return None
    
    async def synthesize_streaming(self, text: str, 
                                   audio_callback: callable) -> bool:
        """
        Synthesize with streaming output
        
        Args:
            text: Text to synthesize
            audio_callback: Function to call with audio chunks
            
        Returns:
            True if successful
        """
        if not self.enabled:
            return False
        
        try:
            # For streaming, we use the callback-based approach
            synthesizer = speechsdk.SpeechSynthesizer(
                speech_config=self.speech_config,
                audio_config=None
            )
            
            # Track if we're done
            done = False
            
            def audio_cb(evt):
                """Callback for audio data"""
                if evt.result.audio_data:
                    audio_callback(evt.result.audio_data)
            
            def complete_cb(evt):
                """Callback for completion"""
                nonlocal done
                done = True
                if evt.result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
                    logger.debug("Streaming synthesis completed")
                else:
                    logger.error(f"Streaming synthesis failed: {evt.result.reason}")
            
            # Connect callbacks
            synthesizer.synthesizing.connect(audio_cb)
            synthesizer.synthesis_completed.connect(complete_cb)
            synthesizer.synthesis_canceled.connect(complete_cb)
            
            # Start synthesis
            result = synthesizer.speak_text_async(text)
            
            # Wait for completion
            while not done:
                await asyncio.sleep(0.01)
            
            return True
            
        except Exception as e:
            logger.error(f"Error in streaming TTS: {e}")
            return False
    
    def get_available_voices(self) -> list[dict]:
        """
        Get list of available voices
        
        Returns:
            List of voice dictionaries
        """
        if not self.enabled:
            return []
        
        try:
            synthesizer = speechsdk.SpeechSynthesizer(
                speech_config=self.speech_config,
                audio_config=None
            )
            
            result = synthesizer.get_voices_async().get()
            
            if result.reason == speechsdk.ResultReason.VoicesListRetrieved:
                return [
                    {
                        "name": v.name,
                        "locale": v.locale,
                        "gender": v.gender,
                        "type": v.voice_type
                    }
                    for v in result.voices
                ]
            else:
                logger.error(f"Failed to get voices: {result.reason}")
                return []
                
        except Exception as e:
            logger.error(f"Error getting voices: {e}")
            return []
    
    async def test_voice(self, text: str = "Hello, this is a test.") -> bool:
        """
        Test voice synthesis
        
        Args:
            text: Test text
            
        Returns:
            True if successful
        """
        try:
            audio = await self.synthesize(text)
            if audio:
                logger.info(f"✅ Voice test successful: {len(audio)} bytes")
                return True
            return False
        except Exception as e:
            logger.error(f"Voice test failed: {e}")
            return False
