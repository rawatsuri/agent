#!/bin/bash

# Quick Deploy Script - Pushes code and triggers Render deployment
set -e

echo "🚀 Quick Deploy to Render"
echo "=========================="

# Check if we're in the right directory
if [ ! -f "render.yaml" ]; then
    echo "❌ Error: render.yaml not found. Are you in the project root?"
    exit 1
fi

# Get current branch
BRANCH=$(git branch --show-current)
echo "📍 Current branch: $BRANCH"

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    echo "⚠️  You have uncommitted changes."
    read -p "Do you want to commit them? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -p "Enter commit message: " msg
        git add .
        git commit -m "$msg"
    else
        echo "❌ Deployment cancelled. Please commit your changes first."
        exit 1
    fi
fi

# Push to GitHub
echo "📤 Pushing to GitHub..."
git push origin $BRANCH

echo ""
echo "✅ Code pushed successfully!"
echo ""
echo "📋 Next steps:"
echo "   1. Go to Render Dashboard: https://dashboard.render.com"
echo "   2. Your services will auto-deploy if already configured"
echo "   3. Or run: render blueprint apply"
echo ""
echo "🌐 Your services will be available at:"
echo "   API: https://omnichannel-ai-api.onrender.com"
echo "   Voice: https://omnichannel-ai-voice.onrender.com"
echo "   Web: https://omnichannel-ai-web.onrender.com"
