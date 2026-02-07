#!/bin/bash

# Voice Bridge Startup Script
# Usage: ./start.sh [dev|prod]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Default environment
ENV=${1:-dev}

echo -e "${GREEN}🚀 Voice Bridge Startup${NC}"
echo "Environment: $ENV"
echo "Directory: $SCRIPT_DIR"

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  .env file not found, copying from .env.example${NC}"
    cp .env.example .env
    echo -e "${RED}⚠️  Please edit .env with your configuration before running!${NC}"
    exit 1
fi

# Check Python version
PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
echo -e "${GREEN}✅ Python version: $PYTHON_VERSION${NC}"

# Check if running in Docker
if [ "$ENV" == "docker" ] || [ "$ENV" == "container" ]; then
    echo -e "${GREEN}🐳 Starting in Docker container...${NC}"
    
    # Build and run with Docker Compose
    if [ -f "../docker-compose.yml" ]; then
        docker-compose -f ../docker-compose.yml up -d voice-bridge
    else
        # Standalone Docker run
        docker build -t voice-bridge .
        docker run -d \
            --name voice-bridge \
            -p 8000:8000 \
            --env-file .env \
            --restart unless-stopped \
            voice-bridge
    fi
    
    echo -e "${GREEN}✅ Voice Bridge started in Docker${NC}"
    echo "Health check: http://localhost:8000/health"
    exit 0
fi

# Check virtual environment
if [ ! -d "venv" ]; then
    echo -e "${YELLOW}📦 Creating virtual environment...${NC}"
    python3 -m venv venv
fi

# Activate virtual environment
echo -e "${GREEN}✅ Activating virtual environment...${NC}"
source venv/bin/activate

# Install/update dependencies
echo -e "${YELLOW}📦 Installing dependencies...${NC}"
pip install --upgrade pip
pip install -r requirements.txt

# Run pre-flight checks
echo -e "${YELLOW}🔍 Running pre-flight checks...${NC}"

# Check Azure credentials
if [ -z "$AZURE_SPEECH_KEY" ] && ! grep -q "AZURE_SPEECH_KEY=" .env; then
    echo -e "${RED}⚠️  AZURE_SPEECH_KEY not configured${NC}"
fi

# Check Node.js API
NODE_API_URL=$(grep NODE_API_URL .env | cut -d '=' -f2 | tr -d ' ')
if [ -z "$NODE_API_URL" ]; then
    NODE_API_URL="http://localhost:3000"
fi

echo -e "${YELLOW}🌐 Checking Node.js API at $NODE_API_URL...${NC}"
if curl -s "$NODE_API_URL/health" > /dev/null; then
    echo -e "${GREEN}✅ Node.js API is reachable${NC}"
else
    echo -e "${YELLOW}⚠️  Node.js API not reachable at $NODE_API_URL${NC}"
    echo -e "${YELLOW}   The Voice Bridge will start but may not function correctly${NC}"
fi

# Start based on environment
if [ "$ENV" == "prod" ] || [ "$ENV" == "production" ]; then
    echo -e "${GREEN}🏭 Starting in PRODUCTION mode...${NC}"
    export ENVIRONMENT=production
    
    # Use gunicorn with uvicorn workers for production
    gunicorn app:app \
        --workers 2 \
        --worker-class uvicorn.workers.UvicornWorker \
        --bind 0.0.0.0:8000 \
        --access-logfile - \
        --error-logfile - \
        --log-level info \
        --timeout 120 \
        --keep-alive 5
else
    echo -e "${GREEN}🔧 Starting in DEVELOPMENT mode...${NC}"
    export ENVIRONMENT=development
    
    # Use uvicorn with reload for development
    uvicorn app:app \
        --host 0.0.0.0 \
        --port 8000 \
        --reload \
        --log-level debug
fi
