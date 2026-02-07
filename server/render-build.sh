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

# Clean dist directory
echo "🧹 Cleaning dist directory..."
rm -rf dist

# Compile TypeScript
echo "🔨 Compiling TypeScript..."
npx tsc

# Resolve path aliases
echo "🔗 Resolving path aliases..."
npx tsc-alias

echo "✅ Node.js Server Build Complete!"
