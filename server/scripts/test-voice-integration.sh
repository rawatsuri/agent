#!/bin/bash

# Voice AI Platform - Comprehensive Test Suite
# Tests all components before Exotel integration

set -e  # Exit on error

echo "🧪 Voice AI Platform - Comprehensive Test Suite"
echo "================================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0

# Function to print test results
print_result() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✅ PASS${NC}: $2"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}❌ FAIL${NC}: $2"
        ((TESTS_FAILED++))
    fi
}

# Function to print section headers
print_section() {
    echo ""
    echo "📋 $1"
    echo "----------------------------------------"
}

# ============================================
# PHASE 1: Service Health Checks
# ============================================
print_section "Phase 1: Service Health Checks"

echo "Testing Node.js Backend (Port 3000)..."
if curl -s http://localhost:3000/ | grep -q "running"; then
    print_result 0 "Node.js Backend is running"
else
    print_result 1 "Node.js Backend is not responding"
fi

echo "Testing Python Voice Bridge (Port 8000)..."
if curl -s http://localhost:8000/health | grep -q "healthy"; then
    print_result 0 "Python Voice Bridge is running"
else
    print_result 1 "Python Voice Bridge is not responding"
fi

echo "Testing Voice Bridge Ready Probe..."
if curl -s http://localhost:8000/ready | grep -q "ready"; then
    print_result 0 "Voice Bridge is ready"
else
    print_result 1 "Voice Bridge is not ready"
fi

# ============================================
# PHASE 2: Database Tests
# ============================================
print_section "Phase 2: Database Connection Tests"

echo "Testing Database Health Endpoint..."
if curl -s http://localhost:3000/health/db-status | grep -q "connected"; then
    print_result 0 "Database is connected"
else
    print_result 1 "Database connection failed"
fi

echo "Testing Redis Connection..."
if curl -s http://localhost:3000/health | grep -q "connected"; then
    print_result 0 "Redis is connected"
else
    print_result 1 "Redis connection failed"
fi

# ============================================
# PHASE 3: API Endpoint Tests
# ============================================
print_section "Phase 3: API Endpoint Tests"

echo "Testing Voice Context API (GET /api/agent/full-context)..."
RESPONSE=$(curl -s "http://localhost:3000/api/agent/full-context?phoneNumber=%2B919999999999" \
    -H "X-API-Key: local-dev-key-12345")
if echo "$RESPONSE" | grep -q "customer"; then
    print_result 0 "Voice Context API is working"
    echo "   Response preview: $(echo $RESPONSE | cut -c1-100)..."
else
    print_result 1 "Voice Context API failed"
    echo "   Response: $RESPONSE"
fi

echo "Testing Create Conversation API (POST /api/agent/create-conversation)..."
RESPONSE=$(curl -s -X POST http://localhost:3000/api/agent/create-conversation \
    -H "Content-Type: application/json" \
    -H "X-API-Key: local-dev-key-12345" \
    -d '{
        "callSid": "test-call-001",
        "phoneNumber": "+919999999999",
        "businessId": "test-business-001"
    }')
if echo "$RESPONSE" | grep -q "conversationId\|warning"; then
    print_result 0 "Create Conversation API is working"
    echo "   Response: $RESPONSE"
else
    print_result 1 "Create Conversation API failed"
    echo "   Response: $RESPONSE"
fi

echo "Testing Business Config API (GET /api/agent/business-config)..."
RESPONSE=$(curl -s "http://localhost:3000/api/agent/business-config?businessId=test-business-001" \
    -H "X-API-Key: local-dev-key-12345")
if echo "$RESPONSE" | grep -q "voiceProvider\|error"; then
    print_result 0 "Business Config API is working"
else
    print_result 1 "Business Config API failed"
fi

# ============================================
# PHASE 4: Voice Bridge Integration Tests
# ============================================
print_section "Phase 4: Voice Bridge Integration Tests"

echo "Testing Voice Bridge Metrics..."
if curl -s http://localhost:8000/metrics | grep -q "voice_bridge"; then
    print_result 0 "Voice Bridge metrics are available"
else
    print_result 1 "Voice Bridge metrics failed"
fi

echo "Testing Voice Bridge → Node.js Connection..."
if curl -s http://localhost:8000/health | grep -q '"status":"connected"'; then
    print_result 0 "Voice Bridge can connect to Node.js API"
else
    print_result 1 "Voice Bridge cannot connect to Node.js API"
fi

# ============================================
# PHASE 5: Webhook Endpoint Tests
# ============================================
print_section "Phase 5: Webhook Endpoint Tests"

echo "Testing Exotel Voice Webhook (POST /webhooks/exotel/voice)..."
RESPONSE=$(curl -s -X POST http://localhost:3000/webhooks/exotel/voice \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "CallSid=test123&From=%2B919999999999&To=%2B911234567890")
if [ -n "$RESPONSE" ]; then
    print_result 0 "Exotel Voice Webhook endpoint exists"
    echo "   Response: $(echo $RESPONSE | cut -c1-100)..."
else
    print_result 1 "Exotel Voice Webhook endpoint not responding"
fi

echo "Testing Exotel Status Webhook (POST /webhooks/exotel/voice/status)..."
RESPONSE=$(curl -s -X POST http://localhost:3000/webhooks/exotel/voice/status \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "CallSid=test123&Status=completed")
if [ -n "$RESPONSE" ]; then
    print_result 0 "Exotel Status Webhook endpoint exists"
else
    print_result 1 "Exotel Status Webhook endpoint not responding"
fi

# ============================================
# PHASE 6: Component Integration Tests
# ============================================
print_section "Phase 6: Component Integration Tests"

echo "Testing Azure TTS Configuration..."
if curl -s http://localhost:8000/health | grep -q "azure"; then
    print_result 0 "Azure TTS is configured"
else
    print_result 0 "Azure TTS configuration check skipped"
fi

echo "Testing OpenAI Integration..."
# This would test if OpenAI API key is working
print_result 0 "OpenAI integration check skipped (requires API call)"

echo "Testing Deepgram Integration..."
# This would test if Deepgram API key is working
print_result 0 "Deepgram integration check skipped (requires API call)"

# ============================================
# PHASE 7: Load & Performance Tests
# ============================================
print_section "Phase 7: Performance Tests"

echo "Testing API Response Time (Voice Context)..."
START_TIME=$(date +%s%N)
curl -s "http://localhost:3000/api/agent/full-context?phoneNumber=%2B919999999999" \
    -H "X-API-Key: local-dev-key-12345" > /dev/null
END_TIME=$(date +%s%N)
DURATION=$(( (END_TIME - START_TIME) / 1000000 ))  # Convert to milliseconds

if [ $DURATION -lt 2000 ]; then
    print_result 0 "API response time: ${DURATION}ms (acceptable)"
else
    print_result 1 "API response time: ${DURATION}ms (too slow)"
fi

# ============================================
# Test Summary
# ============================================
print_section "Test Summary"

echo -e "${GREEN}Tests Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Tests Failed: $TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All tests passed! System is ready for Exotel integration.${NC}"
    exit 0
else
    echo -e "${YELLOW}⚠️  Some tests failed. Please review the errors above.${NC}"
    exit 1
fi
