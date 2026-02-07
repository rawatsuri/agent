#!/bin/bash

# Build script for Node.js Server on Render
set -e

echo "🚀 Starting Node.js Server Build..."

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Generate Prisma Client
echo "🔄 Generating Prisma Client..."
npx prisma generate

# Build the application (skip linting and tests)
echo "🔨 Building application..."
npx tsc && npx tsc-alias

echo "✅ Node.js Server Build Complete!"
