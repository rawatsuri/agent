#!/bin/bash

# Start script for Node.js Server on Render
set -e

echo "🚀 Starting Node.js Server..."

# Check if Redis is configured
if [ -z "$REDIS_URL" ]; then
  echo "⚠️ Warning: REDIS_URL not set. Queue features will be disabled."
fi

# Check if DATABASE_URL is configured
if [ -z "$DATABASE_URL" ]; then
  echo "❌ Error: DATABASE_URL not set"
  exit 1
fi

# Run migrations if DATABASE_URL is set
if [ ! -z "$DATABASE_URL" ]; then
  echo "🗄️ Running database migrations..."
  npx prisma migrate deploy || echo "⚠️ Migration failed, continuing anyway"
fi

# Start the server
echo "🌐 Starting server on port ${PORT:-3000}..."
exec npm start
