#!/bin/bash

# Start script for Python Voice Bridge on Render
set -e

echo "🎙️ Starting Python Voice Bridge..."

cd voice-bridge

# Check required environment variables
if [ -z "$AZURE_TTS_KEY" ]; then
  echo "⚠️ Warning: AZURE_TTS_KEY not set. TTS features will not work."
fi

if [ -z "$NODE_API_URL" ]; then
  echo "⚠️ Warning: NODE_API_URL not set. Voice processing will not work."
fi

# Download Whisper model if not exists
if [ ! -d "/tmp/whisper-models" ]; then
  echo "📥 Downloading Whisper model..."
  mkdir -p /tmp/whisper-models
fi

export WHISPER_MODEL_PATH=/tmp/whisper-models

# Start the FastAPI server
echo "🌐 Starting voice bridge on port ${PORT:-8000}..."
exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --loop uvloop
