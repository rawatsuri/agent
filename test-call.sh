#!/bin/bash

# Voice Call Test Script
# Tests the complete voice flow

echo "🧪 Testing Voice Call Flow"
echo "=========================="

# Test 1: Health Checks
echo ""
echo "1. Testing Health Endpoints..."
echo "   Voice Bridge:"
curl -s https://agent-2-zc37.onrender.com/health | jq .

echo ""
echo "   Node.js API:"
curl -s https://agent-3-hkgc.onrender.com/health | jq .

# Test 2: Node Connection
echo ""
echo "2. Testing Voice Bridge → Node.js Connection..."
curl -s https://agent-2-zc37.onrender.com/test-connection 2>/dev/null || echo "   ⚠️  Connection test endpoint not found"

# Test 3: Simulate Webhook
echo ""
echo "3. Simulating Exotel Webhook..."
echo "   Sending test webhook to Voice Bridge..."
RESPONSE=$(curl -s -X POST https://agent-2-zc37.onrender.com/webhooks/exotel/voice \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=+919999999999" \
  -d "To=+916398912969" \
  -d "CallSid=test$(date +%s)")

echo "   Response:"
echo "$RESPONSE" | head -20

# Check if response contains TwiML
echo ""
echo "4. Checking Response Format..."
if echo "$RESPONSE" | grep -q "<Response>"; then
    echo "   ✅ Valid TwiML response received"
elif echo "$RESPONSE" | grep -q "error\|Error"; then
    echo "   ❌ Error in response"
    echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
else
    echo "   ⚠️  Unexpected response format"
    echo "$RESPONSE" | head -5
fi

echo ""
echo "=========================="
echo "Test Complete"
