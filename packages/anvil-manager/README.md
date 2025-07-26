# @volga/anvil-manager

A TypeScript library for managing Anvil (Foundry) instances in tests and examples. Provides easy-to-use APIs for starting, stopping, and working with local Ethereum test networks.

## Features

- 🚀 **Simple API** - Start Anvil with a single function call
- 🧪 **Test-Optimized** - Built-in utilities for parallel test execution
- 🔄 **Lifecycle Management** - Automatic cleanup and graceful shutdown
- 📦 **Zero Config** - Sensible defaults that just work
- 🛡️ **Type-Safe** - Full TypeScript support with comprehensive types

## Why anvil-manager?

We chose to build anvil-manager instead of using existing solutions like [prool](https://github.com/wevm/prool) for several key reasons:

1. **Simplicity**: Our implementation is simpler and more direct, which aligns with PicoSafe's minimalistic philosophy. We provide straightforward process management without unnecessary abstractions.

2. **Specific Purpose**: We only need Anvil management, not the full suite of capabilities that prool offers (bundlers, multiple instance types, etc.). This focused approach keeps our codebase lean and easy to understand.

3. **Lower Overhead**: No HTTP proxy layer or server management - just direct process control. This reduces complexity and potential points of failure while maintaining full functionality.

## Installation

```bash
npm install --save-dev @volga/anvil-manager
```

## Quick Start

### Basic Usage

```typescript
import { startAnvil } from "@volga/anvil-manager";

// Start an Anvil instance
const anvil = await startAnvil({
  port: 8545,
  accounts: 10,
  balance: "10000",
});

console.log(`Anvil running at ${anvil.rpcUrl}`);

// Use the instance...

// Stop when done
await anvil.stop();
```

### With Automatic Cleanup

```typescript
import { withAnvil } from "@volga/anvil-manager";
import { createPublicClient, http } from "viem";

const result = await withAnvil(async (anvil) => {
  const client = createPublicClient({
    transport: http(anvil.rpcUrl),
  });
  
  const blockNumber = await client.getBlockNumber();
  return blockNumber;
});
// Anvil is automatically stopped after the callback
```

### Test Setup (Vitest)

```typescript
// vitest.config.ts
export default {
  test: {
    setupFiles: ["./test-setup.ts"],
  },
};

// test-setup.ts
import { startAnvil, createTestAnvilOptions } from "@volga/anvil-manager";
import { afterAll } from "vitest";

const workerId = parseInt(process.env.VITEST_WORKER_ID || "0");
const options = createTestAnvilOptions(workerId);
const anvil = await startAnvil(options);

process.env.ANVIL_RPC_URL = anvil.rpcUrl;

afterAll(async () => {
  await anvil.stop();
});
```

## API Reference

### `startAnvil(options?)`

Starts a new Anvil instance with the specified options.

**Parameters:**
- `options` (optional): Configuration options
  - `port`: Port number (default: 8545)
  - `accounts`: Number of test accounts (default: 10)
  - `balance`: Initial balance per account in ETH (default: "10000")
  - `genesisPath`: Path to genesis JSON file
  - `verbose`: Enable verbose logging (default: false)
  - `autoMine`: Enable auto-mining (default: true)
  - `blockTime`: Block time in seconds
  - `additionalArgs`: Additional CLI arguments

**Returns:** `Promise<AnvilInstance>`

### `withAnvil(callback, options?)`

Executes a function with a temporary Anvil instance that is automatically cleaned up.

**Parameters:**
- `callback`: Function to execute with the Anvil instance
- `options`: Same as `startAnvil` options

**Returns:** The result of the callback function

### Test Utilities

- `getTestAnvilPort(workerId)`: Calculate unique port for test worker
- `createTestAnvilOptions(workerId, genesisPath?)`: Create options for test environments

## License

MIT