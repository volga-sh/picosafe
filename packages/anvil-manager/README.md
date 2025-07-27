# @volga/anvil-manager

A TypeScript library for managing Anvil (Foundry) instances in tests and examples. Provides easy-to-use APIs for starting, stopping, and working with local Ethereum test networks.

## Features

- 🚀 **Simple API** - Start Anvil with a single function call
- 🧪 **Test-Optimized** - Built-in utilities for parallel test execution
- 🔄 **Lifecycle Management** - Automatic cleanup and graceful shutdown
- 📦 **Zero Config** - Sensible defaults that just work
- 🛡️ **Type-Safe** - Full TypeScript support with comprehensive types
- 🔍 **Automatic Port Discovery** - Finds available ports automatically when not specified
- ⚡ **Port Conflict Detection** - Validates port availability for explicit port requests

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

// Start with automatic port discovery (recommended)
const anvil = await startAnvil();
console.log(`Anvil running at ${anvil.rpcUrl}`); // e.g., http://127.0.0.1:8545

// Or specify a port explicitly
const anvilWithPort = await startAnvil({
  port: 8545,
  accounts: 10,
  balance: "10000",
});

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

With automatic port discovery, parallel test execution is now simpler:

```typescript
// vitest.config.ts
export default {
  test: {
    setupFiles: ["./test-setup.ts"],
  },
};

// test-setup.ts
import { startAnvil } from "@volga/anvil-manager";
import { afterAll } from "vitest";

// Automatic port discovery handles parallel test workers
const anvil = await startAnvil();

process.env.ANVIL_RPC_URL = anvil.rpcUrl;

afterAll(async () => {
  await anvil.stop();
});
```

## Parallel Testing

Anvil Manager makes it easy to run tests in parallel without port conflicts:

### Automatic Port Discovery (Recommended)

Simply omit the port option and Anvil Manager will find an available port:

```typescript
// Each test worker gets a unique port automatically
const anvil = await startAnvil();
```

### Manual Port Management

If you need specific ports, use the test utilities:

```typescript
const workerId = parseInt(process.env.VITEST_WORKER_ID || "0");
const port = getTestAnvilPort(workerId); // 8545, 8546, 8547...

// Or with a custom base port
const port = getTestAnvilPort(workerId, 9000); // 9000, 9001, 9002...

// Or via environment variable
process.env.ANVIL_BASE_PORT = "9000";
const port = getTestAnvilPort(workerId); // 9000, 9001, 9002...
```

## API Reference

### `startAnvil(options?)`

Starts a new Anvil instance with the specified options.

**Parameters:**
- `options` (optional): Configuration options
  - `port`: Port number. If not specified, automatically finds an available port starting from 8545
  - `accounts`: Number of test accounts (default: 10)
  - `balance`: Initial balance per account in ETH (default: "10000")
  - `genesisPath`: Path to genesis JSON file
  - `verbose`: Enable verbose logging (default: false)
  - `autoMine`: Enable auto-mining (default: true)
  - `blockTime`: Block time in seconds
  - `additionalArgs`: Additional CLI arguments

**Returns:** `Promise<AnvilInstance>`

**Port Behavior:**
- If `port` is omitted: Automatically finds an available port
- If `port` is specified: Validates the port is available before starting, throws an error if in use

**Note on Port Discovery:** When using automatic port discovery, there is a theoretical race condition between when the port is identified as available and when Anvil binds to it. In practice, this is extremely rare, especially with OS-assigned high-numbered ports. If you experience port conflicts in high-concurrency environments, consider using explicit port assignment with coordination between processes.

### `withAnvil(callback, options?)`

Executes a function with a temporary Anvil instance that is automatically cleaned up.

**Parameters:**
- `callback`: Function to execute with the Anvil instance
- `options`: Same as `startAnvil` options

**Returns:** The result of the callback function

### Port Utilities

- `findAvailablePort(preferredPort?, maxAttempts?)`: Find an available port starting from a preferred port
- `checkPortAvailable(port)`: Check if a specific port is available

### Test Utilities

- `getTestAnvilPort(workerId, basePort?)`: Calculate unique port for test worker (supports `ANVIL_BASE_PORT` env var)
- `createTestAnvilOptions(workerId, genesisPath?)`: Create options for test environments

## Troubleshooting

### Common Issues

#### "Anvil is not installed or not found in PATH"

**Solution:** Install Foundry by running:
```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

#### "Port already in use" errors

**Solutions:**
1. Use automatic port discovery by omitting the `port` option
2. Check for orphaned Anvil processes: `pkill anvil`
3. Use a different port range: `startAnvil({ port: 9545 })`

#### Tests hang or timeout

**Possible causes:**
- Anvil failed to start - check console for error messages
- Port conflicts in parallel tests - ensure using automatic port discovery or unique ports per worker
- Insufficient system resources - reduce parallel test workers

**Debug steps:**
1. Enable verbose logging: `startAnvil({ verbose: true })`
2. Set `ANVIL_DEBUG=true` environment variable
3. Run tests serially to isolate the issue

#### "Failed to connect to Anvil" errors

**Common causes:**
- Anvil process crashed during startup
- Network/firewall blocking localhost connections
- Anvil binary is corrupted

**Solutions:**
1. Test Anvil manually: `anvil --port 8545`
2. Check system logs for crash reports
3. Reinstall Foundry: `foundryup`

#### Process cleanup issues

If you notice orphaned Anvil processes after tests:

1. Ensure proper test cleanup:
   ```typescript
   afterAll(async () => {
     await anvil.stop();
   });
   ```

2. Use `withAnvil` for automatic cleanup:
   ```typescript
   await withAnvil(async (anvil) => {
     // Your test code
   }); // Automatically cleaned up
   ```

3. Emergency cleanup: `pkill -f anvil`

### Environment Variables

- `ANVIL_BASE_PORT`: Override default base port for test utilities
- `ANVIL_DEBUG`: Enable debug logging when set to "true"
- `ANVIL_VERBOSE`: Enable verbose Anvil output when set to "true"

## License

MIT