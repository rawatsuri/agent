"""
Voice Bridge Test Utilities
Helper functions for testing voice functionality
"""

import asyncio
from pathlib import Path

from loguru import logger

from config import settings
from handlers.azure_tts import AzureTTSService


async def test_azure_tts():
    """Test Azure Text-to-Speech"""
    logger.info("🎵 Testing Azure TTS...")
    
    tts = AzureTTSService()
    
    # Test basic synthesis
    test_text = "Hello! This is a test of the voice system."
    audio_data = await tts.synthesize(test_text)
    
    if audio_data:
        logger.info(f"✅ TTS test passed: {len(audio_data)} bytes generated")
        return True
    else:
        logger.error("❌ TTS test failed")
        return False


async def test_node_api_connection():
    """Test Node.js API connection"""
    logger.info("🌐 Testing Node.js API connection...")
    
    from api.client import NodeAPIClient
    
    client = NodeAPIClient()
    health = await client.health_check()
    
    if health.get("status") == "ok":
        logger.info("✅ Node.js API connection successful")
        return True
    else:
        logger.error(f"❌ Node.js API connection failed: {health}")
        return False


async def test_whisper_model():
    """Test Whisper model loading"""
    logger.info("🎤 Testing Whisper model...")
    
    try:
        from faster_whisper import WhisperModel
        
        model = WhisperModel(
            settings.WHISPER_MODEL_SIZE,
            device=settings.WHISPER_DEVICE,
            compute_type=settings.WHISPER_COMPUTE_TYPE
        )
        
        logger.info(f"✅ Whisper model loaded: {settings.WHISPER_MODEL_SIZE}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Whisper model failed to load: {e}")
        return False


async def run_all_tests():
    """Run all tests"""
    logger.info("🧪 Running Voice Bridge Tests...")
    
    results = {
        "azure_tts": await test_azure_tts(),
        "whisper": await test_whisper_model(),
        "node_api": await test_node_api_connection()
    }
    
    # Summary
    total = len(results)
    passed = sum(1 for v in results.values() if v)
    
    logger.info(f"\n📊 Test Results: {passed}/{total} passed")
    
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        logger.info(f"  {test_name}: {status}")
    
    return all(results.values())


if __name__ == "__main__":
    success = asyncio.run(run_all_tests())
    exit(0 if success else 1)
