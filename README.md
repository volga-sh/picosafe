# PicoSafe

A minimalistic but advanced TypeScript SDK for Safe Smart Account contracts (v1.4.1), providing a simple API for Safe operations without managing keys or connections.

**⚠️ Work in Progress**: This project is under active development and not yet ready for production use.

![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/volga-sh/picosafe)

## Overview

PicoSafe provides modules for:

- Account deployment and management
- Transaction building, signing, and execution
- Module and owner management
- Guard and fallback handler management
- EIP-712 signing support
- Batch operations via MultiSend

## Installation

```bash
npm install picosafe
```

## Basic Usage

PicoSafe works with any EIP-1193 provider. You can use Viem, Ethers, or any other library that provides an EIP-1193 compatible provider.

### Using with Viem

```typescript
import { createWalletClient, http } from "viem"
import { mainnet } from "viem/chains"
import {
  deploySafeAccount,
  buildSafeTransaction,
  signSafeTransaction,
  executeSafeTransaction,
} from "picosafe"

// Initialize viem wallet client
const walletClient = createWalletClient({
  chain: mainnet,
  transport: http(),
  account: "0x...", // Your account address
})

// Deploy a new Safe
const deployment = await deploySafeAccount(walletClient, {
  owners: [walletClient.account.address],
  threshold: 1n,
})
const txHash = await deployment.send()
const safeAddress = deployment.data.safeAddress

// Build and execute a transaction
const transaction = await buildSafeTransaction(walletClient, safeAddress, [
  {
    to: "0x...", // Target address
    value: 0n,
    data: "0x",
  },
])

const signature = await signSafeTransaction(walletClient, transaction)
const executeTx = await executeSafeTransaction(walletClient, transaction, [signature])
await executeTx.send()
```

### Using with Ethers

```typescript
import { BrowserProvider } from "ethers"
import {
  deploySafeAccount,
  buildSafeTransaction,
  signSafeTransaction,
  executeSafeTransaction,
} from "picosafe"

// Initialize ethers provider
const provider = new BrowserProvider(window.ethereum)
const signer = await provider.getSigner()

// Deploy a new Safe
const deployment = await deploySafeAccount(provider, {
  owners: [await signer.getAddress()],
  threshold: 1n,
})
const txHash = await deployment.send()
const safeAddress = deployment.data.safeAddress

// Build and execute a transaction
const transaction = await buildSafeTransaction(provider, safeAddress, [
  {
    to: "0x...", // Target address
    value: 0n,
    data: "0x",
  },
])

const signature = await signSafeTransaction(provider, transaction)
const executeTx = await executeSafeTransaction(provider, transaction, [signature])
await executeTx.send()
```

### Provider Requirements

The SDK requires an EIP-1193 compatible provider that supports:
- `eth_call` - For reading blockchain state
- `eth_accounts` - For getting connected accounts
- `eth_chainId` - For chain identification
- `eth_sendTransaction` - For sending transactions
- `eth_signTypedData_v4` - For EIP-712 signing (optional, for signature operations)

## Project Structure

This is a monorepo managed with npm workspaces, containing:

- `packages/picosafe` - The main PicoSafe SDK
- `packages/anvil-manager` - Anvil process management for tests and examples
- `packages/safe-genesis` - Genesis configuration with pre-deployed Safe v1.4.1 contracts
- `packages/examples` - Example applications demonstrating SDK usage

## Development

```bash
# install all workspace dependencies
npm install

# library development (watch mode)
npm run dev -w @volga/picosafe

# run tests
npm run test -w @volga/picosafe

# build the library
npm run build -w @volga/picosafe

# run examples
npm run dev -w @volga/examples
```
