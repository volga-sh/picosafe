#!/usr/bin/env bash
#
# run_tests.sh - Automated test runner for PicoSafe integration tests
#
# DESCRIPTION:
#   This script automates the setup and teardown of a local Anvil blockchain
#   for running integration tests. It starts Anvil with a custom genesis file
#   containing pre-deployed Safe 1.4.1 contracts, runs the tests, and ensures
#   proper cleanup of the Anvil process.
#
# USAGE:
#   ./run_tests.sh                    # Run all integration tests
#   ./run_tests.sh deployment         # Run specific test file/pattern
#   ./run_tests.sh "deployment|owners" # Run tests matching pattern
#
# REQUIREMENTS:
#   - Anvil must be installed (part of Foundry toolkit)
#   - Node.js and npm must be available
#   - genesis.json file must exist in the same directory
#
# EXIT CODES:
#   0 - Tests passed successfully
#   1 - Tests failed or error occurred
#

set -e

# Start Anvil with custom genesis (Safe 1.4.1 contracts preloaded)
echo "Starting Anvil with custom genesis..."
ANVIL_DIR=$(dirname "$0")
GENESIS_FILE="$ANVIL_DIR/genesis.json"

# Function to cleanup Anvil process
cleanup() {
  if [ -n "$ANVIL_PID" ] && kill -0 $ANVIL_PID 2>/dev/null; then
    echo "Stopping Anvil..."
    kill -TERM $ANVIL_PID 2>/dev/null || true
    # Give it time to gracefully shutdown
    sleep 1
    # Force kill if still running
    if kill -0 $ANVIL_PID 2>/dev/null; then
      kill -KILL $ANVIL_PID 2>/dev/null || true
    fi
  fi
}

# Set up cleanup on exit, error, or interrupt
trap cleanup EXIT INT TERM

anvil \
  --init "$GENESIS_FILE" \
  --accounts 10 \
  --balance 10000 \
  --port 8545 > /dev/null 2>&1 &
ANVIL_PID=$!

# Run Vitest tests
# Pass through any arguments (e.g., specific test files or patterns)
npm run test:run -- "$1"
