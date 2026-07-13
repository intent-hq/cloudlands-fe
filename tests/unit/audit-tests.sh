#!/bin/bash

# Audit Script for Unit Tests
# This script checks which services exist and their actual APIs

echo "========================================="
echo "Unit Test Audit Report"
echo "========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Change to workspace directory
cd "$(dirname "$0")/../.."

echo "Checking Service Files..."
echo "-------------------------"

# Services to check
services=(
    "src/features/agent/services/unified-id-service.ts"
    "src/features/agent/services/direct-stream-manager.ts"
    "src/features/agent/services/unified-state-store.ts"
    "src/features/agent/services/optimized-persistence.ts"
    "src/features/agent/services/cached-rules-service.ts"
    "src/features/agent/main/utils/memory-manager.ts"
    "src/features/agent/services/performance-optimizer.ts"
)

for service in "${services[@]}"; do
    if [ -f "$service" ]; then
        echo -e "${GREEN}✓${NC} $service exists"
        # Extract class name and methods
        echo "  Methods:"
        grep -E "^\s*(public |private |protected |static |async )?\w+\(" "$service" | head -5 | sed 's/^/    /'
    else
        echo -e "${RED}✗${NC} $service NOT FOUND"
    fi
    echo ""
done

echo "Checking Test Files..."
echo "----------------------"

# Test files to check
tests=(
    "tests/unit/unified-id-service.test.ts"
    "tests/unit/direct-stream-manager.test.ts"
    "tests/unit/unified-state-store.test.ts"
    "tests/unit/optimized-persistence.test.ts"
    "tests/unit/cached-rules-service.test.ts"
    "tests/unit/memory-manager.test.ts"
    "tests/unit/performance-optimizer.test.ts"
)

for test in "${tests[@]}"; do
    if [ -f "$test" ]; then
        echo -e "${GREEN}✓${NC} $test exists"
        # Count test cases
        test_count=$(grep -c "it(" "$test" || echo 0)
        echo "  Test cases: $test_count"
    else
        echo -e "${RED}✗${NC} $test NOT FOUND"
    fi
done

echo ""
echo "Running Quick Test Check..."
echo "---------------------------"

# Try to run tests with --reporter=silent to check for errors
npm test -- tests/unit/unified-id-service.test.ts --run --reporter=silent 2>&1 | head -20

echo ""
echo "========================================="
echo "Audit Complete"
echo "========================================="
