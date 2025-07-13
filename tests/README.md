# PicoSafe Testing Guide

This directory contains comprehensive integration tests for the PicoSafe SDK.

## Prerequisites

- Node.js 22+
- [Foundry](https://getfoundry.sh/) installed (for Anvil)

## Running Tests

### 1. Start Anvil (Local Blockchain)

```bash
# Start Anvil with preloaded Safe 1.4.1 contracts via custom genesis
npm run anvil
```

### 2. Run Tests

In a separate terminal:

```bash
# Run all integration tests
npm run test:integration

# Run tests in watch mode
npm test

# Run with coverage
npm run coverage
```


### Port already in use
Kill any existing Anvil processes:
```bash
pkill anvil
```

