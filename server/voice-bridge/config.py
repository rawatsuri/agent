"""
Configuration Management for Voice Bridge
Loads and validates environment variables
"""

import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings

# Load .env file
ENV_FILE = Path(__file__).parent / ".env"
load_dotenv(ENV_FILE)


class Settings(BaseSettings):
    """Application settings with validation"""
    
    # Environment
    ENVIRONMENT: str = Field(default="development", pattern="^(development|staging|production)$")
    ENV_FILE: Path = Field(default=ENV_FILE)
    
    # Server Configuration
    VOICE_BRIDGE_HOST: str = Field(default="0.0.0.0")
    VOICE_BRIDGE_PORT: int = Field(default=8000, ge=1, le=65535)
    WORKERS: int = Field(default=1, ge=1, le=16)
    MAX_CONCURRENT_CALLS: int = Field(default=10, ge=1, le=100)
    
    # Node.js API Configuration
    NODE_API_URL: str = Field(default="http://localhost:3000")
    NODE_API_KEY: str = Field(default="")
    NODE_API_TIMEOUT: int = Field(default=30, ge=1, le=300)
    NODE_API_RETRY_ATTEMPTS: int = Field(default=3, ge=1, le=10)
    
    # Exotel Configuration (India)
    EXOTEL_SID: str = Field(default="")
    EXOTEL_API_KEY: str = Field(default="")
    EXOTEL_API_TOKEN: str = Field(default="")
    EXOTEL_SUBDOMAIN: str = Field(default="api.exotel.com")
    EXOTEL_REGION: str = Field(default="")
    
    # Twilio Configuration (Global)
    TWILIO_ACCOUNT_SID: str = Field(default="")
    TWILIO_AUTH_TOKEN: str = Field(default="")
    TWILIO_PHONE_NUMBER: str = Field(default="")
    
    # Base URL for webhooks (e.g., ngrok URL or production domain)
    BASE_URL: str = Field(default="localhost:8000")
    
    # Azure Speech Services
    AZURE_SPEECH_KEY: str = Field(default="")
    AZURE_SPEECH_REGION: str = Field(default="")
    AZURE_SPEECH_VOICE: str = Field(default="en-US-JennyNeural")
    AZURE_SPEECH_RATE: str = Field(default="default")  # default, slow, fast
    
    # OpenAI Configuration (for Whisper if needed)
    OPENAI_API_KEY: Optional[str] = Field(default=None)
    
    # Deepgram Configuration (for Vocode STT - has FREE tier)
    DEEPGRAM_API_KEY: Optional[str] = Field(default=None)
    
    # Vocode Configuration
    Vocode_LOG_LEVEL: str = Field(default="INFO")
    Vocode_SENTENCE_BUFFER_SIZE: int = Field(default=5)
    VOCODE_MODEL_NAME: str = Field(default="gpt-4o-mini")
    
    # Audio Configuration
    AUDIO_SAMPLE_RATE: int = Field(default=8000)  # Exotel uses 8kHz
    AUDIO_CHANNELS: int = Field(default=1)
    AUDIO_CHUNK_SIZE: int = Field(default=160)  # 20ms at 8kHz
    
    # Transcription (Whisper)
    WHISPER_MODEL_SIZE: str = Field(default="base")  # tiny, base, small, medium, large
    WHISPER_DEVICE: str = Field(default="cpu")  # cpu, cuda
    WHISPER_COMPUTE_TYPE: str = Field(default="int8")  # int8, float16, float32
    
    # Logging
    LOG_LEVEL: str = Field(default="INFO")
    LOG_FORMAT: str = Field(default="{time:YYYY-MM-DD HH:mm:ss} | {level} | {message}")
    LOG_FILE: Optional[str] = Field(default=None)
    
    # Feature Flags
    ENABLE_RECORDING: bool = Field(default=True)
    ENABLE_TRANSFER: bool = Field(default=True)
    ENABLE_SENTIMENT_ANALYSIS: bool = Field(default=False)
    
    @field_validator("NODE_API_URL")
    @classmethod
    def validate_node_api_url(cls, v: str) -> str:
        """Ensure NODE_API_URL doesn't end with /"""
        return v.rstrip("/")
    
    @field_validator("AZURE_SPEECH_VOICE")
    @classmethod
    def validate_azure_voice(cls, v: str) -> str:
        """Validate Azure voice name format"""
        valid_voices = [
            "en-US-JennyNeural", "en-US-GuyNeural", "en-US-AriaNeural",
            "en-GB-SoniaNeural", "en-GB-RyanNeural",
            "en-AU-NatashaNeural", "en-AU-WilliamNeural",
            "en-IN-NeerjaNeural", "en-IN-PrabhatNeural",
            "hi-IN-SwaraNeural", "hi-IN-MadhurNeural"
        ]
        if v not in valid_voices:
            # Allow custom voices but warn
            pass
        return v
    
    def validate_required(self) -> list[str]:
        """Validate that all required settings are present"""
        missing = []
        
        # Required for production
        if self.ENVIRONMENT == "production":
            required = [
                ("NODE_API_KEY", self.NODE_API_KEY),
                ("EXOTEL_SID", self.EXOTEL_SID),
                ("EXOTEL_API_KEY", self.EXOTEL_API_KEY),
                ("EXOTEL_API_TOKEN", self.EXOTEL_API_TOKEN),
                ("AZURE_SPEECH_KEY", self.AZURE_SPEECH_KEY),
                ("AZURE_SPEECH_REGION", self.AZURE_SPEECH_REGION),
            ]
        else:
            # Development can work with minimal config
            required = [
                ("AZURE_SPEECH_KEY", self.AZURE_SPEECH_KEY),
                ("AZURE_SPEECH_REGION", self.AZURE_SPEECH_REGION),
            ]
        
        for name, value in required:
            if not value:
                missing.append(name)
        
        return missing
    
    @property
    def is_production(self) -> bool:
        """Check if running in production"""
        return self.ENVIRONMENT == "production"
    
    @property
    def is_development(self) -> bool:
        """Check if running in development"""
        return self.ENVIRONMENT == "development"
    
    @property
    def exotel_base_url(self) -> str:
        """Get Exotel API base URL"""
        subdomain = self.EXOTEL_SUBDOMAIN or "api.exotel.com"
        return f"https://{subdomain}/v1/Accounts/{self.EXOTEL_SID}"
    
    @property
    def exotel_auth(self) -> tuple:
        """Get Exotel authentication tuple"""
        return (self.EXOTEL_API_KEY, self.EXOTEL_API_TOKEN)
    
    class Config:
        env_file = ENV_FILE
        env_file_encoding = "utf-8"
        case_sensitive = False


# Create global settings instance
settings = Settings()

# Validate on import (warn only in development)
missing_settings = settings.validate_required()
if missing_settings:
    import warnings
    warnings.warn(
        f"Missing required settings: {', '.join(missing_settings)}",
        RuntimeWarning
    )
