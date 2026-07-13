#!/bin/bash

# Run All Unit Tests for Agent System Services
# This script runs comprehensive unit tests for all refactored services

set -e

echo "========================================="
echo "Running Agent System Unit Tests"
echo "========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Change to workspace directory
cd "$(dirname "$0")/../.."

# Function to run a test file
run_test() {
    local test_file=$1
    local test_name=$2

    echo -e "${YELLOW}Running: ${test_name}${NC}"
    echo "----------------------------------------"

    if npm test -- "$test_file" --run; then
        echo -e "${GREEN}✓ ${test_name} passed${NC}"
    else
        echo -e "${RED}✗ ${test_name} failed${NC}"
        exit 1
    fi
    echo ""
}

# Run each test suite
echo "Starting test execution..."
echo ""

# Core Services Tests
run_test "tests/unit/unified-id-service.test.ts" "UnifiedIdService Tests"
run_test "tests/unit/direct-stream-manager.test.ts" "DirectStreamManager Tests"
run_test "tests/unit/unified-state-store.test.ts" "UnifiedStateStore Tests"
run_test "tests/unit/optimized-persistence.test.ts" "OptimizedPersistenceService Tests"
run_test "tests/unit/cached-rules-service.test.ts" "CachedRulesService Tests"
run_test "tests/unit/memory-manager.test.ts" "MemoryManager Tests"
run_test "tests/unit/performance-optimizer.test.ts" "PerformanceOptimizer Tests"

echo "========================================="
echo -e "${GREEN}All Unit Tests Passed Successfully!${NC}"
echo "========================================="

# Generate coverage report
echo ""
echo "Generating coverage report..."
npm test -- --coverage tests/unit/

echo ""
echo "Test execution complete!"
