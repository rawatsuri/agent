#!/bin/bash

# Build script for Node.js Server on Render
set -e

echo "🚀 Starting Node.js Server Build..."

# Navigate to server directory
cd server

# Install dependencies
echo "📦 Installing dependencies..."
npm ci

# Generate Prisma Client
echo "🔄 Generating Prisma Client..."
npx prisma generate

# Run database migrations (only if DATABASE_URL is set)
if [ ! -z "$DATABASE_URL" ]; then
  echo "🗄️ Running database migrations..."
  npx prisma migrate deploy || echo "⚠️ Migration skipped or failed"
fi

# Run linting
echo "🔍 Running linter..."
npm run lint || echo "⚠️ Linting warnings found"

# Build the application
echo "🔨 Building application..."
npm run build

echo "✅ Node.js Server Build Complete!"
