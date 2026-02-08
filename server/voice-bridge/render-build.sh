#!/bin/bash
# Build script for Voice Bridge on Render
set -e

echo "🚀 Starting Voice Bridge Build..."

# Upgrade pip first (required for pre-built wheels)
echo "📦 Upgrading pip..."
pip install --upgrade pip

# Install dependencies
echo "📦 Installing dependencies..."
pip install -r requirements.txt

echo "✅ Voice Bridge Build Complete!"
