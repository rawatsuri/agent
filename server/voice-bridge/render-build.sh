#!/bin/bash

# Build script for Python Voice Bridge on Render
set -e

echo "🎙️ Starting Python Voice Bridge Build..."

cd server/voice-bridge

# Install system dependencies
echo "📦 Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq ffmpeg portaudio19-dev python3-pyaudio

# Install Python dependencies
echo "🐍 Installing Python dependencies..."
pip install --no-cache-dir -r requirements.txt

echo "✅ Python Voice Bridge Build Complete!"
