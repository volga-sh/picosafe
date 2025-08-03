#!/bin/bash

# Run all examples sequentially
# This script is useful for testing all examples locally

set -e  # Exit on any error

echo "🚀 Running all PicoSafe examples..."
echo "=================================="
echo ""

# Color codes for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Track which examples pass/fail
PASSED=0
FAILED=0
FAILED_EXAMPLES=""

# Function to run an example
run_example() {
    local example_number=$1
    local example_file=$2
    local example_name=$3
    
    echo "📘 Example $example_number: $example_name"
    echo "   File: $example_file"
    echo "   Running..."
    
    if npm run run-example -- "$example_file" > /tmp/example_$example_number.log 2>&1; then
        echo -e "   ${GREEN}✅ PASSED${NC}"
        PASSED=$((PASSED + 1))
    else
        echo -e "   ${RED}❌ FAILED${NC}"
        echo "   Check /tmp/example_$example_number.log for details"
        FAILED=$((FAILED + 1))
        FAILED_EXAMPLES="$FAILED_EXAMPLES\n   - Example $example_number: $example_name"
    fi
    echo ""
}

# Run each example
run_example 1 "1-basic-account-deployment.ts" "Basic Account Deployment"
run_example 2 "2-safe-transaction-execution.ts" "Safe Transaction Execution"
run_example 3 "3-batch-safe-deployment-with-multisend.ts" "Batch Safe Deployment with MultiSend"
run_example 4 "4-multiple-transfers-with-multisend.ts" "Multiple Transfers with MultiSend"

# Summary
echo "=================================="
echo "📊 Summary:"
echo -e "   ${GREEN}Passed: $PASSED${NC}"
echo -e "   ${RED}Failed: $FAILED${NC}"

if [ $FAILED -gt 0 ]; then
    echo ""
    echo -e "${RED}Failed examples:${NC}"
    echo -e "$FAILED_EXAMPLES"
    exit 1
else
    echo ""
    echo -e "${GREEN}🎉 All examples passed successfully!${NC}"
fi