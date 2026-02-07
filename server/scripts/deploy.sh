#!/bin/bash

# Deployment script for Omnichannel AI Platform
# Usage: ./scripts/deploy.sh [environment]

set -e

ENVIRONMENT=${1:-production}
SERVER_USER=${DEPLOY_USER:-deploy}
SERVER_HOST=${DEPLOY_HOST:-your-server-ip}
SERVER_PATH=${DEPLOY_PATH:-/var/www/omnichannel-ai}

echo "🚀 Deploying Omnichannel AI Platform to $ENVIRONMENT..."

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if environment variables are set
if [ -z "$DEPLOY_HOST" ]; then
    echo -e "${RED}Error: DEPLOY_HOST environment variable is not set${NC}"
    exit 1
fi

# Build locally
echo -e "${YELLOW}Building application...${NC}"
npm run build

# Run tests
echo -e "${YELLOW}Running tests...${NC}"
npm run test:ci

if [ $? -ne 0 ]; then
    echo -e "${RED}Tests failed! Deployment aborted.${NC}"
    exit 1
fi

# Deploy to server using PM2
echo -e "${YELLOW}Deploying to server...${NC}"
pm2 deploy ecosystem.config.js $ENVIRONMENT

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Deployment successful!${NC}"
    echo -e "${GREEN}Application is running at: http://$SERVER_HOST${NC}"
else
    echo -e "${RED}❌ Deployment failed!${NC}"
    exit 1
fi

# Run database migrations
echo -e "${YELLOW}Running database migrations...${NC}"
ssh $SERVER_USER@$SERVER_HOST "cd $SERVER_PATH/current && npx prisma migrate deploy"

# Health check
echo -e "${YELLOW}Performing health check...${NC}"
sleep 5
curl -f http://$SERVER_HOST/health || {
    echo -e "${RED}❌ Health check failed!${NC}"
    exit 1
}

echo -e "${GREEN}✅ Health check passed!${NC}"
echo -e "${GREEN}🎉 Deployment complete!${NC}"
