# PicoSafe

A minimalistic but advanced TypeScript SDK for Safe Smart Account contracts (v1.4.1), providing a simple API for Safe operations without managing keys or connections.

**⚠️ Work in Progress**: This project is under active development and not yet ready for production use.

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

```typescript
import { createWalletClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { deploySafeAccount, buildSafeTransaction, signSafeTransaction, executeSafeTransaction } from 'picosafe'

// Initialize viem wallet client
const walletClient = createWalletClient({
  chain: mainnet,
  transport: http(),
  account: '0x...' // Your account address
})

// Deploy a new Safe
const deployment = await deploySafeAccount(walletClient, {
  owners: [walletClient.account.address],
  threshold: 1n,
})
const txHash = await deployment.send()
const safeAddress = deployment.data.safeAddress

// Build and execute a transaction
const transaction = await buildSafeTransaction(walletClient, safeAddress, [{
  to: '0x...', // Target address
  value: 0n,
  data: '0x'
}])

const signature = await signSafeTransaction(walletClient, transaction)
const executeTx = await executeSafeTransaction(walletClient, transaction, [signature])
await executeTx.send()
```

## Development

```bash
npm install
npm run dev    # Development build with watch mode
npm test       # Run tests
npm run build  # Production build
```
