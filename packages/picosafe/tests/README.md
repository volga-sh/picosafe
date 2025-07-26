# PicoSafe Testing Guide

This directory contains comprehensive integration tests for the PicoSafe SDK.

## Prerequisites

- Node.js 22+
- [Foundry](https://getfoundry.sh/) installed (for Anvil)

## Test Architecture

Our test suite uses a parallel testing architecture where each Vitest worker runs its own isolated Anvil instance:

- **Parallel Execution**: Tests run concurrently across multiple workers for faster execution
- **Isolated Environments**: Each worker gets a unique Anvil instance on a dedicated port (8545 + worker ID)
- **Pre-deployed Contracts**: Safe 1.4.1 contracts are pre-deployed via genesis.json for faster test execution
- **Automatic Management**: Anvil instances are automatically started and stopped by the test runner

## Running Tests

### Quick Start

```bash
# Run all tests (automatically manages Anvil instances)
npm run test -w @volga/picosafe

# Run tests in watch mode
npm run test:ui -w @volga/picosafe

# Run with verbose Anvil output for debugging
npm run test:anvil-verbose -w @volga/picosafe
```

### Running Specific Tests

```bash
# Run tests matching a pattern
npm run test -w @volga/picosafe deployment

# Run a specific test file
npm run test -w @volga/picosafe -- packages/picosafe/tests/deployment.test.ts

# Run tests by name pattern
npm run test -w @volga/picosafe -- -t "should deploy"
```

### Coverage Reports

```bash
# Generate test coverage
npm run coverage -w @volga/picosafe
```

## Manual Anvil Setup (Optional)

For debugging or running tests manually with [Anvil](https://getfoundry.sh/anvil/overview#anvil):

```bash
# Terminal 1: Start Anvil manually
anvil

# Terminal 2: Run tests without automatic Anvil management
npm run test:run -w @volga/picosafe
```

## Troubleshooting

### Port Already in Use

If you encounter port conflicts:

```bash
# Kill any existing Anvil processes
pkill anvil

# Or find and kill specific process
lsof -i :8545
kill -9 <PID>
```

### Debugging Test Failures

1. Run tests with verbose Anvil output:
   ```bash
   npm run test:anvil-verbose -w @volga/picosafe
   ```

2. Check specific worker logs to see which port/instance had issues

3. Run tests sequentially to isolate problems:
   ```bash
   npm run test -w @volga/picosafe -- --no-file-parallelism
   ```

## Test Structure

- `fixtures/` - Common test utilities and helpers
- `scripts/` - Genesis file with pre-deployed Safe contracts
- `*.test.ts` - Test files organized by SDK module functionality